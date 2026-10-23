/** The 2D and 3D views as the tools reach them: each view's own projection between the pointer and
 *  the map, aimed at the surface a person sees there. */
import { describe, expect } from 'vitest';
import * as THREE from 'three';
import { spec } from '../../_support/spec';
import { TerrainType, world, type SpecWorld } from '../_world';
import { brush, picture, type AimedView } from './_editing';
import { Viewport } from '../../../view/map2d/camera/viewport';
import { Projection3D } from '../../../view/map3d/camera/projection';
import { mapCenterOffset } from '../../../view/map3d/geometry/coords';
import { surfaceHeightAt } from '../../../view/map3d/geometry/pick';
import type { MacroCoord } from '../../../core/model/types';

const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });

/** The 2D view, zoomed in a little. */
function flat(): AimedView {
  const projection = new Viewport(800, 600);
  projection.setZoom(1.5, 0, 0);
  return { projection, aim: (p) => projection.macroToScreen(p) };
}

/** The 3D view, its camera looking down at `target` from the south. */
function perspective(w: SpecWorld, target: MacroCoord): AimedView {
  const { width, height } = w.state.template;
  const off = mapCenterOffset(width, height);
  const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
  camera.position.set(target.x - off.x, 22, target.y - off.z + 18);
  camera.lookAt(target.x - off.x, 0, target.y - off.z);
  camera.updateMatrixWorld(true);
  const projection = new Projection3D({
    camera, state: () => w.state,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
    pickObjectAt: () => null, objectBoundingBox: () => null,
  });
  return {
    projection,
    aim: (p) => {
      const wx = p.x - off.x, wz = p.y - off.z;
      const v = new THREE.Vector3(wx, surfaceHeightAt(w.state, wx, wz), wz).project(camera);
      return { x: (v.x + 1) * 400, y: (1 - v.y) * 300 };
    },
  };
}

describe('the 2D and 3D views', () => {
  spec('EDIT-39', 'the same gestures make the same change, refusal and undo step in either view', () => {
    const run = (view: '2d' | '3d') => {
      const w = world();
      const at = w.openGround(8, 8);
      const p = brush(w, {}, view === '2d' ? flat() : perspective(w, shift(at, 3, 3)));
      p.drag(at, shift(at, 4, 0), shift(at, 4, 3));
      p.click(shift(at, 4, 3));
      p.arm({ floor: 6 });
      p.click(shift(at, 1, 5));
      const laid = picture(w);
      w.undo();
      return { laid, undone: picture(w), toasts: p.toasts, top: w.terrainAt(shift(at, 4, 3)) };
    };
    const twoD = run('2d'), threeD = run('3d');
    expect(twoD.top).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect(twoD.toasts).toHaveLength(1);
    expect(threeD).toEqual(twoD);
  });

  spec('EDIT-39', 'a curve being adjusted carries over when the view switches', () => {
    const w = world();
    const at = w.openGround(14, 10);
    const a = shift(at, 1, 2), b = shift(at, 9, 2);
    const p = brush(w, { shape: 'curve' }, flat());
    p.click(a);
    p.doubleClick(b);
    expect(p.curve.isOpen()).toBe(true);
    p.showView(perspective(w, shift(at, 6, 4)));
    expect(p.curve.isOpen(), 'the handles stay up').toBe(true);
    p.curve.moveAnchor(1, b.x, b.y + 5, true);
    expect(w.terrainAt(b), 'the adjustment re-lays the curve').toBeNull();
    expect(w.terrainAt({ x: b.x, y: b.y + 5 })).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });
});

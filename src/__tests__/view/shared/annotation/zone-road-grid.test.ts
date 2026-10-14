// @vitest-environment jsdom
/** Note zones live on the road and object grid in both views, so their edges meet road edges. */
import '../../../_support/pixi-env';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Container, Graphics } from 'pixi.js-legacy';
import { AnnotationLayer } from '../../../../view/map2d/layers/annotation-layer';
import { AnnotationLayer3D } from '../../../../view/map3d/layers/annotation-layer';
import { Viewport } from '../../../../view/map2d/camera/viewport';
import { mapCenterOffset } from '../../../../view/map3d/geometry/coords';
import { zoneBorderPaths } from '../../../../view/shared/annotation/annotation-line';
import { cellEdges } from '../../../../core/model/annotation/dimensions';
import { zoneCellAt, type ZoneNote } from '../../../../core/model/annotations';
import { TILE_SIZE } from '../../../../view/map2d/geometry/world';
import { setReducedMotion, __resetMotionState } from '../../../../platform/channels/motion-state';
import { TerrainType } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';
import { cellUnder } from '../../../../core/grid/pointer';

const zone = (cells: Array<{ x: number; y: number }>): ZoneNote => ({ kind: 'zone', id: 'z', cells, color: '#FF8A7A', tag: null, num: 0 });
const OPTS = { draft: null, selectionIds: [] as string[], inkScale: 1, tagLabel: (tag: string) => tag };

describe('zones on the road grid', () => {
  it('reads the same cell under a screen point as the road tools do', () => {
    const v = new Viewport(800, 600);
    v.setView({ zoom: 0.37, offsetX: 211, offsetY: 97 });
    for (let sx = 3; sx < 800; sx += 37) {
      for (let sy = 5; sy < 600; sy += 41) expect(zoneCellAt(v.screenToPoint(sx, sy))).toEqual(cellUnder(v, sx, sy, 'object'));
    }
  });

  it('washes a one-cell tap over exactly that road cell in 2D', () => {
    setReducedMotion(true);
    const layer = new AnnotationLayer(() => {});
    layer.draw({ items: [zone([{ x: 5, y: 7 }])], visible: true, locked: false }, OPTS);
    const wash = (layer.container.children[0] as Container).children[0] as Graphics;
    const b = wash.getLocalBounds();
    expect([b.x, b.y, b.width, b.height]).toEqual([5 * TILE_SIZE, 7 * TILE_SIZE, TILE_SIZE, TILE_SIZE]);
    layer.destroy(); __resetMotionState();
  });

  it('washes a one-cell tap over exactly that road cell in 3D', () => {
    const state = makeState(20, 20);
    const layer = new AnnotationLayer3D();
    layer.update(state, { items: [zone([{ x: 5, y: 7 }])], visible: true, locked: false }, { draft: null, tagLabel: (t: string) => t });
    const wash = layer.group.children.find((n): n is THREE.Mesh => n.type === 'Mesh' && n.renderOrder === 90)!;
    wash.geometry.computeBoundingBox();
    const box = wash.geometry.boundingBox!;
    const off = mapCenterOffset(20, 20);
    expect(box.min.x).toBeCloseTo(5 - off.x);
    expect(box.max.x).toBeCloseTo(6 - off.x);
    expect(box.min.z).toBeCloseTo(7 - off.z);
    expect(box.max.z).toBeCloseTo(8 - off.z);
    layer.dispose();
  });

  it('shares its edge with a road laid beside it', () => {
    // A road down column 4 ends at x = 5, where a zone over columns 5 to 8 begins.
    const cells = [];
    for (let y = 2; y <= 6; y++) for (let x = 5; x <= 8; x++) cells.push({ x, y });
    const road = { x: 4, y: 2 };
    expect(cellEdges(cells)!.left).toBe(road.x + 1);
    // The border runs just inside that edge, by the hair it keeps clear of a neighbour's wall.
    const border = zoneBorderPaths(cells, 0)[0]!;
    expect(Math.min(...border.map(([x]) => x))).toBeCloseTo(road.x + 1 + 0.02);
  });
});

describe('zone walls over a terrace in 3D', () => {
  /** The XZ extent of the wash's vertical faces in grid coordinates, null when it has none. */
  const walls = (cells: Array<{ x: number; y: number }>) => {
    const state = makeState(20, 20);
    for (let y = 0; y < 20; y++) for (let x = 6; x < 20; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    const layer = new AnnotationLayer3D();
    layer.update(state, { items: [zone(cells)], visible: true, locked: false }, { draft: null, tagLabel: (t: string) => t });
    const wash = layer.group.children.find((n): n is THREE.Mesh => n.type === 'Mesh' && n.renderOrder === 90)!;
    const pos = wash.geometry.getAttribute('position');
    const index = wash.geometry.getIndex()!;
    const off = mapCenterOffset(20, 20);
    const xs: number[] = [], zs: number[] = [];
    const v = (i: number) => new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    for (let t = 0; t < index.count; t += 3) {
      const [a, b, c] = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
      const n = new THREE.Vector3().crossVectors(v(b).sub(v(a)), v(c).sub(v(a)));
      if (Math.abs(n.y) > 1e-6) continue;
      for (const i of [a, b, c]) { xs.push(pos.getX(i) + off.x); zs.push(pos.getZ(i) + off.z); }
    }
    layer.dispose();
    return xs.length ? [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map((n) => +n.toFixed(6)) : null;
  };

  it('stands the step wall on the terrain edge across exactly the zone rows', () => {
    // Terrain column 6 begins at x = 5.5, inside zone column 5.
    const cells = [];
    for (let y = 3; y <= 4; y++) for (let x = 5; x <= 7; x++) cells.push({ x, y });
    expect(walls(cells)).toEqual([5.5, 5.5, 3, 5]);
  });

  it('gives a one-cell-wide zone over the step its wall', () => {
    expect(walls([{ x: 5, y: 3 }, { x: 5, y: 4 }])).toEqual([5.5, 5.5, 3, 5]);
  });

  it('stands no wall in a zone on level ground', () => {
    expect(walls([{ x: 8, y: 3 }, { x: 9, y: 3 }, { x: 8, y: 4 }])).toBeNull();
  });
});

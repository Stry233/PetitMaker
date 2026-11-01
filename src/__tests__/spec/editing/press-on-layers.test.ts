/**
 * Where a press lands on a stepped mountain: the 3D view's own projection turns the screen point a
 * person aims at a terrace into a map point, and the map's press, the paste key and the touch menu's
 * Paste read that point on a headless spec world. The camera looks down from the south at a low
 * angle, so each higher terrace stands in front of the ground behind it on screen.
 */
import { describe, expect } from 'vitest';
import * as THREE from 'three';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { Projection3D } from '../../../view/map3d/camera/projection';
import { mapCenterOffset } from '../../../view/map3d/geometry/coords';
import { surfaceHeightAt } from '../../../view/map3d/geometry/pick';
import { cellAtPoint } from '../../../core/grid/pointer';
import { mapPoint } from '../../../core/grid/grids';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';

const ROSE = 'flower-rose';
const DAISY = 'flower-daisy';

/** A three-level mountain stepping up northwards (rows 0-1 of each terrace are its own level, the top
 *  four rows level 3) beside an "abab" row of flowers on open ground. */
function terraces(): { w: SpecWorld; hill: MacroCoord; flowers: PlacedObject[] } {
  const w = world();
  const at = w.openGround(14, 16);
  const hill = { x: at.x + 1, y: at.y };
  for (const [level, rows] of [[1, 10], [2, 7], [3, 4]] as const) {
    const out = w.stroke(rect(hill, 10, rows), TerrainType.Mountain, level);
    if (!out.ok) throw new Error(`level ${level} was refused: ${out.refusedBy.join(', ')}`);
  }
  const row = { x: at.x + 1, y: at.y + 13 };
  const flowers = [ROSE, DAISY, ROSE, DAISY].map((item, i) => {
    const placed = w.place(item, row.x + i, row.y);
    if (!placed.ok) throw new Error(`the flower was refused: ${placed.refusedBy.join(', ')}`);
    return w.object(placed.id!)!;
  });
  return { w, hill, flowers };
}

/** The 3D view looking north at `target` from low in the south, and the screen point a person puts
 *  the pointer on to touch the visible surface at map point `p`. */
function lowCamera(w: SpecWorld, target: MacroCoord) {
  const off = mapCenterOffset(w.state.template.width, w.state.template.height);
  const camera = new THREE.PerspectiveCamera(55, 800 / 600, 0.5, 1500);
  camera.position.set(target.x - off.x, 9, target.y - off.z + 16);
  camera.lookAt(target.x - off.x, 1, target.y - off.z);
  camera.updateMatrixWorld(true);
  const projection = new Projection3D({
    camera, state: () => w.state,
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as HTMLCanvasElement,
    pickObjectAt: () => null, objectBoundingBox: () => null,
  });
  const aim = (p: MacroCoord) => {
    const wx = p.x - off.x, wz = p.y - off.z;
    const v = new THREE.Vector3(wx, surfaceHeightAt(w.state, wx, wz), wz).project(camera);
    return { x: (v.x + 1) * 400, y: (1 - v.y) * 300 };
  };
  /** The map point the press lands on when the pointer touches the surface at `p`. */
  const through = (p: MacroCoord): MacroCoord => {
    const s = aim(p);
    return projection.screenToPoint(s.x, s.y);
  };
  return { through };
}

/** A cell on each terrace whose object cell and the one beside it stand wholly on that level. Terrain
 *  cell (x, y) spans map points x-0.5 to x+0.5 and object cell (x, y) spans x to x+1, so a pointer
 *  at (x+0.2, y+0.2) is in both cells (x, y). */
const aims = (hill: MacroCoord) => [
  { level: 1, cell: { x: hill.x + 3, y: hill.y + 8 } },
  { level: 2, cell: { x: hill.x + 4, y: hill.y + 5 } },
  { level: 3, cell: { x: hill.x + 5, y: hill.y + 2 } },
];

/** The world with the flowers selected and copied, as Ctrl+click on each and Ctrl+C do. */
function copied(w: SpecWorld, flowers: readonly PlacedObject[]): void {
  w.sandbox.held.multiSelect = true;
  for (const f of flowers) {
    const centre = { x: f.position.x + 0.5, y: f.position.y + 0.5 };
    w.sandbox.pressMap(centre);
    w.sandbox.releaseMap(centre);
  }
  w.sandbox.held.multiSelect = false;
  expect(w.sandbox.selectedIds()).toHaveLength(4);
  w.sandbox.copySelection();
}

const placedAfter = (w: SpecWorld, before: ReadonlySet<string>) => [...w.state.objects.values()]
  .filter((o) => !before.has(o.id))
  .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

describe('a press on a stepped mountain in the 3D view', () => {
  spec('EDIT-25', 'lands on the terrace cell the pointer touches on every level, not on the ground behind or below it', () => {
    const { w, hill } = terraces();
    const { through } = lowCamera(w, { x: hill.x + 5, y: hill.y + 5 });
    for (const { level, cell } of aims(hill)) {
      expect(w.terrainAt(cell)?.elevation, `aimed cell on level ${level}`).toBe(level);
      const p = through({ x: cell.x + 0.2, y: cell.y + 0.2 });
      expect(cellAtPoint(mapPoint(p), PLACEMENT_GRID), `level ${level}`).toEqual(cell);
      w.sandbox.pressMap(p);
      w.sandbox.releaseMap(p);
      expect(w.sandbox.selection, `level ${level} is selected`).toEqual([{ kind: 'terrain', ...cell }]);
      expect(w.sandbox.pickedCell, `level ${level} picks its object cell`).toEqual(cell);
    }
  });

  spec('EDIT-54', 'Ctrl+V after a press on a terrace puts the copy\'s top-left on the object cell pressed, standing on that level', () => {
    for (const level of [1, 2, 3]) {
      const { w, hill, flowers } = terraces();
      const target = aims(hill).find((a) => a.level === level)!.cell;
      const { through } = lowCamera(w, { x: hill.x + 5, y: hill.y + 5 });
      copied(w, flowers);
      const p = through({ x: target.x + 0.2, y: target.y + 0.2 });
      w.sandbox.pressMap(p);
      w.sandbox.releaseMap(p);
      const before = new Set(w.state.objects.keys());
      w.sandbox.pasteKey();
      const copy = placedAfter(w, before);
      expect(copy.map((o) => [o.catalogId, o.position.x - target.x, o.position.y - target.y, o.elevation]), `level ${level}`)
        .toEqual([[ROSE, 0, 0, level], [DAISY, 1, 0, level], [ROSE, 2, 0, level], [DAISY, 3, 0, level]]);
      expect(w.sandbox.selectedIds().sort()).toEqual(copy.map((o) => o.id).sort());
    }
  });

  spec('EDIT-56', 'the long-press menu\'s Paste puts the copy\'s top-left on the pressed terrace cell, on that level', () => {
    for (const level of [1, 2, 3]) {
      const { w, hill, flowers } = terraces();
      const target = aims(hill).find((a) => a.level === level)!.cell;
      const { through } = lowCamera(w, { x: hill.x + 5, y: hill.y + 5 });
      copied(w, flowers);
      const p = through({ x: target.x + 0.2, y: target.y + 0.2 });
      w.sandbox.pressMap(p, true);
      w.sandbox.holdMap();
      w.sandbox.releaseMap(p);
      const before = new Set(w.state.objects.keys());
      w.sandbox.menuPaste();
      const copy = placedAfter(w, before);
      expect(copy.map((o) => [o.catalogId, o.position.x - target.x, o.position.y - target.y, o.elevation]), `level ${level}`)
        .toEqual([[ROSE, 0, 0, level], [DAISY, 1, 0, level], [ROSE, 2, 0, level], [DAISY, 3, 0, level]]);
      expect(w.sandbox.selectedIds().sort()).toEqual(copy.map((o) => o.id).sort());
    }
  });
});

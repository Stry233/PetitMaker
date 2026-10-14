/**
 * The 3D view reads the same cell as the 2D view for the same map point: a point on the map is
 * projected through a yawed 3D camera, read back through `Projection3D`, and resolved on each grid
 * exactly as a 2D pointer at that point would be.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Projection3D } from '../../../../view/map3d/camera/projection';
import { mapCenterOffset } from '../../../../view/map3d/geometry/coords';
import { pickSurface, surfaceHeightAt } from '../../../../view/map3d/geometry/pick';
import { cellAtPoint } from '../../../../core/grid/pointer';
import { mapPoint } from '../../../../core/grid/grids';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../../core/game/profile';
import { TerrainType, type GridState } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';

const W = 800, H = 600;

/** A camera looking down at `target` (map coordinates) from `yaw` degrees around it, 55 degrees up. */
function projectionAt(state: GridState, target: { x: number; y: number }, yaw: number) {
  const off = mapCenterOffset(state.template.width, state.template.height);
  const tx = target.x - off.x, tz = target.y - off.z;
  const a = (yaw * Math.PI) / 180, dist = 18, pitch = (55 * Math.PI) / 180;
  const camera = new THREE.PerspectiveCamera(50, W / H, 0.5, 1500);
  camera.position.set(tx + Math.sin(a) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, tz + Math.cos(a) * Math.cos(pitch) * dist);
  camera.lookAt(tx, 0, tz);
  camera.updateMatrixWorld(true);
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H, right: W, bottom: H }) } as unknown as HTMLCanvasElement;
  const proj = new Projection3D({ camera, canvas, state: () => state, pickObjectAt: () => null, objectBoundingBox: () => null });
  /** The screen point a map point on the visible surface projects to. */
  const toScreen = (p: { x: number; y: number }) => {
    const wx = p.x - off.x, wz = p.y - off.z;
    const v = new THREE.Vector3(wx, surfaceHeightAt(state, wx, wz), wz).project(camera);
    return { sx: ((v.x + 1) / 2) * W, sy: ((1 - v.y) / 2) * H };
  };
  return { proj, toScreen };
}

function expectSameCells(state: GridState, p: { x: number; y: number }, yaw: number) {
  const { proj, toScreen } = projectionAt(state, p, yaw);
  const { sx, sy } = toScreen(p);
  const back = proj.screenToPoint(sx, sy);
  const label = `(${p.x}, ${p.y}) at yaw ${yaw}`;
  for (const grid of [PLACEMENT_GRID, TERRAIN_GRID] as const) {
    expect(cellAtPoint(back, grid), `${grid} ${label}`).toMatchObject(cellAtPoint(mapPoint(p), grid));
  }
}

const YAWS = [0, 37, 90, 145, 180, 233, 270, 318];

describe('2D and 3D read the same cell', () => {
  it.each(YAWS)('on flat ground at the map edges, yaw %s', (yaw) => {
    const state = makeState(20, 20);
    for (const p of [{ x: 0.25, y: 0.25 }, { x: 19.75, y: 0.25 }, { x: 0.25, y: 19.75 }, { x: 19.75, y: 19.75 }, { x: 10.75, y: 3.25 }]) {
      expectSameCells(state, p, yaw);
    }
  });

  it.each(YAWS)('on a raised plateau out to its rim, yaw %s', (yaw) => {
    const state = makeState(20, 20);
    for (let y = 5; y < 12; y++) for (let x = 5; x < 12; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    // Terrain cells 5 to 11 span map coordinates 4.5 to 11.5; nothing stands higher, so no point here is hidden.
    for (const p of [{ x: 8.25, y: 8.25 }, { x: 8.75, y: 7.25 }, { x: 4.75, y: 8.25 }, { x: 11.25, y: 11.25 }, { x: 4.6, y: 11.4 }]) {
      expectSameCells(state, p, yaw);
    }
  });

  it.each([0, 90, 180, 270])('across all four quadrants of a 70 by 70 map, yaw %s', (yaw) => {
    const state = makeState(70, 70);
    setTerrain(state, 3, 66, TerrainType.Mountain, 1);
    for (const p of [
      { x: 0.25, y: 0.25 }, { x: 34.75, y: 34.75 }, { x: 35.25, y: 0.75 }, { x: 69.75, y: 69.25 }, { x: 3.25, y: 66.25 }, { x: 2.75, y: 65.75 },
    ]) {
      expectSameCells(state, p, yaw);
    }
  });
});

describe('a trimmed terrain cell', () => {
  /** World point over map point (x, y), straight down. */
  function pickDown(state: GridState, x: number, y: number) {
    const off = mapCenterOffset(state.template.width, state.template.height);
    return pickSurface(state, { x: x - off.x, y: 40, z: y - off.z }, { x: 0, y: -1, z: 0 });
  }

  it('picks the ground through a cut corner and the block beside it, both in the cell 2D names', () => {
    const state = makeState(20, 20);
    setTerrain(state, 8, 8, TerrainType.Mountain, 2);
    state.cells[8]![8]!.terrain!.corners = ['empty', 'square', 'square', 'square'];
    // Terrain cell (8, 8) spans [7.5, 8.5); its top-left quadrant is cut away.
    const cut = pickDown(state, 7.6, 7.6)!;
    const solid = pickDown(state, 8.4, 8.4)!;
    expect(solid).toMatchObject({ kind: 'terrain', elevation: 2, cell: { x: 8, y: 8 } });
    expect(cut.kind).toBe('ground');
    expect(cut.point.y).toBeLessThan(solid.point.y);
    expect(cut.cell).toEqual(cellAtPoint(mapPoint({ x: 7.6, y: 7.6 }), TERRAIN_GRID));
  });

  // A camera on the north-west side sees into the cut; the block itself is visible from anywhere.
  it.each([200, 225, 250])('reads the same cell as 2D in the cut and on the block, yaw %s', (yaw) => {
    const state = makeState(20, 20);
    setTerrain(state, 8, 8, TerrainType.Mountain, 2);
    state.cells[8]![8]!.terrain!.corners = ['empty', 'square', 'square', 'square'];
    for (const p of [{ x: 7.6, y: 7.6 }, { x: 7.7, y: 7.9 }, { x: 8.4, y: 8.4 }, { x: 8.1, y: 8.3 }, { x: 8.4, y: 7.6 }]) expectSameCells(state, p, yaw);
  });

  it.each([0, 60, 120])('reads the same cell as 2D on the block from the far side, yaw %s', (yaw) => {
    const state = makeState(20, 20);
    setTerrain(state, 8, 8, TerrainType.Mountain, 2);
    state.cells[8]![8]!.terrain!.corners = ['empty', 'square', 'square', 'square'];
    for (const p of [{ x: 8.4, y: 8.4 }, { x: 8.1, y: 8.3 }, { x: 8.4, y: 7.6 }]) expectSameCells(state, p, yaw);
  });
});

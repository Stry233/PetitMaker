import { describe, expect, it } from 'vitest';
import { cellAtPoint, halfPoint } from '../../../core/grid/pointer';
import { mapPoint } from '../../../core/grid/grids';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import { zoneCellAt } from '../../../core/model/annotations';
import { terrainCellAt } from '../../../core/grid/grid-convert';

// Map coordinates against the cell each reading gives. The object grid's cell n spans [n, n + 1);
// the terrain grid's spans [n - 0.5, n + 0.5); the half-cell point rounds ties toward +infinity.
const TABLE: Array<[at: number, object: number, terrain: number, half: number]> = [
  [-1, -1, -1, -1],
  [-0.75, -1, -1, -0.5],
  [-0.5, -1, 0, -0.5],
  [-0.25, -1, 0, 0],
  [0, 0, 0, 0],
  [0.25, 0, 0, 0.5],
  [0.5, 0, 1, 0.5],
  [0.75, 0, 1, 1],
  [0.999, 0, 1, 1],
  [1, 1, 1, 1],
];

describe('pointer readings at quarter-cell points', () => {
  it.each(TABLE)('map coordinate %s reads object cell %s, terrain cell %s, half point %s', (at, object, terrain, half) => {
    expect(cellAtPoint(mapPoint({ x: at, y: at }), PLACEMENT_GRID)).toMatchObject({ x: object, y: object });
    expect(cellAtPoint(mapPoint({ x: at, y: at }), TERRAIN_GRID)).toMatchObject({ x: terrain, y: terrain });
    // A tie just below zero rounds to negative zero, which equals zero everywhere a cell is compared or keyed.
    const h = halfPoint(mapPoint({ x: at, y: at }));
    expect({ x: h.x + 0, y: h.y + 0 }).toEqual({ x: half, y: half });
    expect(zoneCellAt({ x: at, y: at })).toEqual({ x: object, y: object });
  });

  it.each(TABLE)('reads each axis on its own (%s against its mirror)', (at, object, terrain) => {
    const mirrored = TABLE.find(([a]) => a === 1 - at);
    const p = mapPoint({ x: at, y: 1 - at });
    const objectY = mirrored ? mirrored[1] : Math.floor(1 - at);
    expect(cellAtPoint(p, PLACEMENT_GRID)).toMatchObject({ x: object, y: objectY });
    expect(cellAtPoint(p, TERRAIN_GRID).x).toBe(terrain);
  });
});

describe('pointer readings at the map edges', () => {
  const W = 85, H = 70;

  it('reads the first and last cells of a map from points just inside them', () => {
    expect(cellAtPoint(mapPoint({ x: 0, y: 0 }), PLACEMENT_GRID)).toMatchObject({ x: 0, y: 0 });
    expect(cellAtPoint(mapPoint({ x: W - 0.25, y: H - 0.25 }), PLACEMENT_GRID)).toMatchObject({ x: W - 1, y: H - 1 });
    expect(cellAtPoint(mapPoint({ x: -0.25, y: -0.25 }), TERRAIN_GRID)).toMatchObject({ x: 0, y: 0 });
    expect(cellAtPoint(mapPoint({ x: W - 0.75, y: H - 0.75 }), TERRAIN_GRID)).toMatchObject({ x: W - 1, y: H - 1 });
  });

  it('reads points past the edge as cells off the map, never clamped onto it', () => {
    expect(cellAtPoint(mapPoint({ x: -0.25, y: 3 }), PLACEMENT_GRID).x).toBe(-1);
    expect(cellAtPoint(mapPoint({ x: W, y: 3 }), PLACEMENT_GRID).x).toBe(W);
    expect(cellAtPoint(mapPoint({ x: -0.75, y: 3 }), TERRAIN_GRID).x).toBe(-1);
    expect(cellAtPoint(mapPoint({ x: W - 0.5, y: 3 }), TERRAIN_GRID).x).toBe(W);
  });

  it('agrees with the terrain conversion the rules use at every quarter point across the edges', () => {
    for (let q = -8; q <= 8; q++) {
      for (const base of [0, W]) {
        const at = base + q / 4;
        expect(cellAtPoint(mapPoint({ x: at, y: at }), TERRAIN_GRID), `${at}`).toMatchObject(terrainCellAt(at, at));
      }
    }
  });
});

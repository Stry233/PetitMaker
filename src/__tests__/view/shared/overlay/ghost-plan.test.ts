/**
 * Both overlays build a ghost from `ghostPlan`, so the 2D map and the 3D view split cells by grid
 * and reduce trims the same way. A road trim keeps its canonical corners in both; only terrain
 * patches lose the square quadrants that belong to the block beneath them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ghostPlan } from '../../../../view/shared/overlay/ghost-geometry';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../../core/game/profile';
import type { Corners } from '../../../../core/model/types';

const PATCH: Corners = ['fan', 'square', 'square', 'square'];

describe('ghost plan', () => {
  it('splits cells by grid in input order', () => {
    const cells = [{ x: 1, y: 1 }, { x: 2, y: 1, grid: PLACEMENT_GRID }, { x: 3, y: 1, grid: TERRAIN_GRID }];
    const plan = ghostPlan(cells, TERRAIN_GRID);
    expect(plan.own).toEqual([cells[0], cells[2]]);
    expect(plan.across).toEqual([cells[1]]);
  });

  it('reduces a terrain patch to the shape it adds', () => {
    const { trim } = ghostPlan([], TERRAIN_GRID, [{ x: 0, y: 0, corners: PATCH, patch: true }]);
    expect(trim[0]!.corners).toEqual(['fan', 'empty', 'empty', 'empty']);
  });

  it('keeps a road trim in its canonical state, patch or not', () => {
    const road = { x: 0, y: 0, corners: PATCH, patch: true, road: 'N' as const };
    const { trim } = ghostPlan([], PLACEMENT_GRID, [road]);
    expect(trim[0]).toBe(road);
  });

  it('is the plan both overlays draw from', () => {
    for (const file of ['../../../../view/map2d/layers/overlay/ghost.ts', '../../../../view/map3d/layers/overlay/ghost.ts']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8') as string;
      expect(source).toMatch(/\bghostPlan\(/);
      expect(source).not.toMatch(/\bfilletOnly\(/);
    }
  });
});

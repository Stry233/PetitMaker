import { describe, it, expect } from 'vitest';
import { TerrainType } from '../../../core/model/types';
import { planToCommands } from '../../../tools/generation/commit';
import type { TerrainPlan } from '../../../tools/generation/types';

describe('planToCommands', () => {
  it('emits a PaintTerrain per (type,elevation) layer + nothing for ground', () => {
    const plan: TerrainPlan = { width: 4, height: 1, tier: new Int8Array([0, 1, 1, 0]), water: new Int8Array([-1, -1, -1, 2]) };
    const cmds = planToCommands(plan, null);
    const mtn = cmds.find((c) => c.terrainType === TerrainType.Mountain && c.elevation === 1)!;
    expect(mtn.cells).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    const water = cmds.find((c) => c.terrainType === TerrainType.Water && c.elevation === 2)!;
    expect(water.cells).toEqual([{ x: 3, y: 0 }]);
  });

  it('builds mountains CUMULATIVELY bottom-up so no layer floats (V-MTN-02)', () => {
    // a single tier-3 cell must be painted at 1, then 2, then 3 — present in every lower layer.
    const plan: TerrainPlan = { width: 1, height: 1, tier: new Int8Array([3]), water: new Int8Array([-1]) };
    const cmds = planToCommands(plan, null);
    const elevs = cmds.map((c) => c.elevation);
    expect(elevs).toEqual([1, 2, 3]);                         // ascending layers, no gaps
    for (const c of cmds) expect(c.cells).toEqual([{ x: 0, y: 0 }]); // the cell appears in all three
  });

  it('cumulative layers carry every cell whose final tier >= L', () => {
    const plan: TerrainPlan = { width: 3, height: 1, tier: new Int8Array([1, 2, 3]), water: new Int8Array(3).fill(-1) };
    const cmds = planToCommands(plan, null);
    const at = (e: number) => cmds.find((c) => c.terrainType === TerrainType.Mountain && c.elevation === e)!.cells.map((p) => p.x);
    expect(at(1)).toEqual([0, 1, 2]); // tier >= 1
    expect(at(2)).toEqual([1, 2]);    // tier >= 2
    expect(at(3)).toEqual([2]);       // tier >= 3
  });

  it('region-scopes the cells', () => {
    const plan: TerrainPlan = { width: 4, height: 1, tier: new Int8Array([1, 1, 0, 0]), water: new Int8Array(4).fill(-1) };
    const cmds = planToCommands(plan, [{ x: 0, y: 0 }]); // only (0,0) in region
    expect(cmds[0]!.cells).toEqual([{ x: 0, y: 0 }]);
  });
});

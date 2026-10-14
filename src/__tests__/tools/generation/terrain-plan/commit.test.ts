import { describe, it, expect } from 'vitest';
import { TerrainType } from '../../../../core/model/types';
import { paintLayer, planToCommands, raiseBottomUp, type RaiseTarget } from '../../../../tools/generation/terrain-plan/commit';
import type { Command, PaintTerrainCommand, ValidationResult } from '../../../../core/model/types';
import type { TerrainPlan } from '../../../../tools/generation/terrain-plan/types';

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

/** An executor that records every paint and refuses any command holding `refused` at `layer`. */
function recorder(refuse: (cmd: PaintTerrainCommand) => boolean) {
  const seen: PaintTerrainCommand[] = [];
  const execute = (cmd: Command): ValidationResult => {
    const paint = cmd as PaintTerrainCommand;
    seen.push(paint);
    return refuse(paint) ? { success: false, errors: [] } : { success: true, errors: [] };
  };
  return { seen, execute };
}

describe('paintLayer', () => {
  it('lands a legal layer as one command', () => {
    const { seen, execute } = recorder(() => false);
    expect(paintLayer([{ x: 0, y: 0 }, { x: 1, y: 0 }], TerrainType.Water, 0, execute)).toBe(2);
    expect(seen).toHaveLength(1);
  });

  it('retries a refused batch cell by cell and names each refusal', () => {
    const { execute } = recorder((c) => c.cells.some((p) => p.x === 1));
    const refused: number[] = [];
    expect(paintLayer([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], TerrainType.Mountain, 1, execute, (i) => refused.push(i))).toBe(2);
    expect(refused).toEqual([1]);
  });
});

describe('raiseBottomUp', () => {
  const row = (tops: number[]): RaiseTarget[] => tops.map((top, x) => ({ coord: { x, y: 0 }, top }));

  it('raises every column layer by layer to its own top', () => {
    const { seen, execute } = recorder(() => false);
    expect(raiseBottomUp(row([1, 3, 2]), execute)).toEqual({ placed: 6, skipped: 0 });
    expect(seen.map((c) => [c.elevation, c.cells.map((p) => p.x)])).toEqual([[1, [0, 1, 2]], [2, [1, 2]], [3, [1]]]);
  });

  it('stops a refused column one layer below the refusal', () => {
    const { seen, execute } = recorder((c) => c.elevation === 2 && c.cells.some((p) => p.x === 0));
    const targets = row([4, 4]);
    expect(raiseBottomUp(targets, execute)).toEqual({ placed: 5, skipped: 1 });
    expect(targets.map((t) => t.top)).toEqual([1, 4]);
    expect(seen.filter((c) => c.elevation > 2).every((c) => c.cells.every((p) => p.x === 1))).toBe(true);
  });

  it('with settle, brings neighbours down to what the stopped column can carry', () => {
    const { execute } = recorder((c) => c.elevation === 1 && c.cells.some((p) => p.x === 0));
    const targets = row([6, 8, 8]);
    raiseBottomUp(targets, execute, { settle: 3 });
    expect(targets.map((t) => t.top)).toEqual([0, 3, 6]);
  });
});

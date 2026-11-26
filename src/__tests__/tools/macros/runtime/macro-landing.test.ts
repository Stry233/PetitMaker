/** A Smart Build landing reports how much of the map it changed, which decides whether a drag landed. */
import { describe, expect, it } from 'vitest';
import { makeExecutor, makeState } from '../../../_support/map-state';
import { materialisePatchCommand, paintTerrainCommand } from '../../../../core/model/command-build';
import { mapFingerprint } from '../../../../core/model/fingerprint';
import { TerrainType } from '../../../../core/model/types';
import { applyMacro, landMacroRun } from '../../../../tools/macros/run';

function kit() {
  const state = makeState(20, 20);
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

describe('a Smart Build landing', () => {
  it('counts no change for a corner patch it rewrites as it stood', () => {
    const ctx = kit();
    expect(applyMacro(ctx, 'raise', { seed: 1, at: { x: 10, y: 10 }, radius: 3, trim: 'round' }).changes).toBeGreaterThan(0);
    // Undo and redo bring the raise back as the history copied it.
    ctx.executor.undo();
    ctx.executor.redo();
    const at = ctx.state.cells.flatMap((row, y) => row.map((cell, x) => ({ x, y, t: cell.terrain }))).find((c) => c.t?.patchOnly);
    expect(at).toBeDefined();
    const { x, y, t } = at!;
    const patch = materialisePatchCommand(x, y, t!.corners!, { terrainType: t!.type, elevation: t!.elevation, patchBase: t!.patchBase });
    const opts = { seed: 1, from: { x: 2, y: 2 }, at: { x: 6, y: 2 } };
    const outcome = landMacroRun(ctx, 'stream', opts, { run: { base: mapFingerprint(ctx.state), commands: [patch] } });
    expect(outcome?.changes).toBe(0);
  });

  it('counts each cell whose terrain it changed', () => {
    const ctx = kit();
    const cells = [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }];
    const run = { base: mapFingerprint(ctx.state), commands: [paintTerrainCommand(cells, TerrainType.Mountain, 1)] };
    expect(landMacroRun(ctx, 'raise', { seed: 1, at: cells[0] }, { run })?.changes).toBe(3);
  });
});

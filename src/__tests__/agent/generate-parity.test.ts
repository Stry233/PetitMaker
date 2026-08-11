/**
 * The agent and the Generate panel run the SAME generator. They diverged once, silently, and the
 * difference only showed up as maps the agent made having no author.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newMap, generateMap } from '../../kit/operations';
import { currentKit } from '../../kit/context';
import { executeToolCall } from '../../agent/tools';
import { stableSerialize } from '../kit/_stable-serialize';
import type { GenerateConfig, MacroCoord } from '../../core/model/types';

beforeEach(() => newMap('hexia'));

const SEED = 31337;

const config: GenerateConfig = {
  algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 3, seed: SEED, region: null,
  relief: 0.8, naturalness: 1, settlement: 0.5, nature: 0.5,
};

/** Row-major so it matches `resolveCells`'s own rect-enumeration order exactly — the operation
 *  call and the tool call must hand `generateMap` the identical cell list, not just the same set. */
function rectCells(x1: number, y1: number, x2: number, y2: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.push({ x, y });
  return cells;
}

describe('generate parity', () => {
  it('makes the same map through the operation and through the agent tool', async () => {
    await generateMap(currentKit()!, { config, region: null });
    const viaOperation = stableSerialize(currentKit()!.state);
    const provViaOperation = currentKit()!.executor.getProvenanceSummary();
    const genViaOperation = currentKit()!.state.generation;

    newMap('hexia');
    const kit = currentKit()!;
    const res = await executeToolCall(
      { id: 't1', name: 'run_generator', input: { seed: SEED, maxElevation: 3, relief: 80, naturalness: 100, settlement: 0.5, nature: 0.5 } },
      { getState: () => kit.state, getExecutor: () => kit.executor, getRegion: () => [] },
    );

    expect(res.isError).toBe(false);
    expect(stableSerialize(kit.state)).toBe(viaOperation);
    expect(kit.executor.getProvenanceSummary()).toEqual(provViaOperation);
    expect(kit.executor.getUndoStackSize()).toBe(1);
    // A full run is replayable from (seed, config); the old agent tool never recorded this at all.
    expect(kit.state.generation).toEqual(genViaOperation);
  });

  it('makes the same map over a region, through the operation and through the agent tool', async () => {
    // This is the branch the deleted hand-rolled erase lived in — the whole-map case above never
    // touches it.
    const rect = { x1: 10, y1: 10, x2: 29, y2: 29 };
    const region = rectCells(rect.x1, rect.y1, rect.x2, rect.y2);

    await generateMap(currentKit()!, { config, region });
    const viaOperation = stableSerialize(currentKit()!.state);
    const genViaOperation = currentKit()!.state.generation;

    newMap('hexia');
    const kit = currentKit()!;
    const res = await executeToolCall(
      { id: 't2', name: 'run_generator', input: { seed: SEED, maxElevation: 3, relief: 80, naturalness: 100, settlement: 0.5, nature: 0.5, rect } },
      { getState: () => kit.state, getExecutor: () => kit.executor, getRegion: () => [] },
    );

    expect(res.isError).toBe(false);
    expect(stableSerialize(kit.state)).toBe(viaOperation);
    // A scoped run is NOT replayable from blank (it depends on whatever was already there).
    expect(kit.state.generation).toEqual(genViaOperation);
  });
});

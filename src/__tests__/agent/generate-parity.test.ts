/**
 * The agent and the Generate panel run the SAME generator. A divergence between them is silent: it
 * surfaces only as maps the agent made having no author.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { newMap, generateMap } from '../../kit/operations';
import { currentKit } from '../../kit/context';
import { executeToolCall } from '../../agent/tools';
import { stableSerialize } from '../kit/_stable-serialize';
import { objectRect } from '../../state/object-geometry';
import type { GenerateConfig, MacroCoord } from '../../core/model/types';

beforeEach(() => newMap('hexia'));

const SEED = 31337;

// The recipe the agent's tool builds for the same input, field for field: `run_generator` is a
// delegation to `generateMap`, so the two must agree on the whole config and not only on the map.
const config: GenerateConfig = {
  algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 3, seed: SEED, region: null,
  richness: 0.7,
};

/** Row-major so it matches `resolveCells`'s own rect-enumeration order exactly — the operation
 *  call and the tool call must hand `generateMap` the identical cell list, not just the same set. */
function rectCells(x1: number, y1: number, x2: number, y2: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.push({ x, y });
  return cells;
}

describe('generate parity', () => {
  // Each case builds TWO whole islands through the live rules; the default 5s timeout is a
  // stopwatch on the generator rather than on what this file is testing.
  it('makes the same map through the operation and through the agent tool', async () => {
    await generateMap(currentKit()!, { config, region: null });
    const viaOperation = stableSerialize(currentKit()!.state);
    const provViaOperation = currentKit()!.executor.getProvenanceSummary();
    const genViaOperation = currentKit()!.state.generation;

    newMap('hexia');
    const kit = currentKit()!;
    const res = await executeToolCall(
      { id: 't1', name: 'run_generator', input: { seed: SEED, maxElevation: 3, richness: 70 } },
      { getState: () => kit.state, getExecutor: () => kit.executor, getRegion: () => [] },
    );

    expect(res.isError).toBe(false);
    expect(stableSerialize(kit.state)).toBe(viaOperation);
    expect(kit.executor.getProvenanceSummary()).toEqual(provViaOperation);
    expect(kit.executor.getUndoStackSize()).toBe(1);
    // A full run is replayable from (seed, config), so the tool has to record the recipe and not
    // only the map it built.
    expect(kit.state.generation).toEqual(genViaOperation);
  }, 60_000);

  it('makes the same map over a region, through the operation and through the agent tool', async () => {
    // The scoped branch: the whole-map case above never reaches it.
    const rect = { x1: 10, y1: 10, x2: 29, y2: 29 };
    const region = rectCells(rect.x1, rect.y1, rect.x2, rect.y2);

    await generateMap(currentKit()!, { config, region });
    const viaOperation = stableSerialize(currentKit()!.state);
    const genViaOperation = currentKit()!.state.generation;

    newMap('hexia');
    const kit = currentKit()!;
    const res = await executeToolCall(
      { id: 't2', name: 'run_generator', input: { seed: SEED, maxElevation: 3, richness: 70, rect } },
      { getState: () => kit.state, getExecutor: () => kit.executor, getRegion: () => [] },
    );

    expect(res.isError).toBe(false);
    expect(stableSerialize(kit.state)).toBe(viaOperation);
    // A scoped run is NOT replayable from blank (it depends on whatever was already there).
    expect(kit.state.generation).toEqual(genViaOperation);

    // AND THE SCOPE IS REAL. Parity alone would be satisfied by two runs that both ignored the rect
    // — a tool reporting "over the 400-cell region" while the designed pipeline builds the whole
    // island. Every written cell and every placed object's whole footprint stands inside it.
    const inside = new Set(region.map((c) => `${c.x},${c.y}`));
    for (let y = 0; y < kit.state.template.height; y++) {
      for (let x = 0; x < kit.state.template.width; x++) {
        if (!kit.state.cells[y]![x]!.terrain) continue;
        expect(inside.has(`${x},${y}`), `terrain at ${x},${y}`).toBe(true);
      }
    }
    let placed = 0;
    for (const o of kit.state.objects.values()) {
      if (o.locked) continue;
      placed++;
      const r = objectRect(o);
      for (let cy = Math.floor(r.y); cy < Math.ceil(r.y + r.h); cy++) {
        for (let cx = Math.floor(r.x); cx < Math.ceil(r.x + r.w); cx++) {
          expect(inside.has(`${cx},${cy}`), `${o.catalogId} covers ${cx},${cy}`).toBe(true);
        }
      }
    }
    expect(placed, 'the region came back with something in it').toBeGreaterThan(0);
  }, 60_000);
});

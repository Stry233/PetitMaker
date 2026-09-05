/*
 * generation.perf.test.ts — the generation system's operation costs.
 *
 * Covers the paths a Generate press actually pays for: the full designed run (what a candidate
 * worker computes), the command replay (what the main thread pays when a cached candidate lands),
 * the cache fingerprint (paid on every shelf interaction), the worker wire codec (paid per job
 * crossing the pool boundary), a region-confined run (the seam repair's path), the maze, and the
 * scorecard the eval harnesses run. See `_harness.ts` for the gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { cloneWorld, denseIsland, islandConfig, templateWorld } from './_fixtures';
import { clearAllObjects, clearAllTerrain, generateTerrain } from '../../tools/generation/terrain-generator';
import { evaluateMap } from '../../tools/generation/designer/eval';
import { detachCommand, mapFingerprint } from '../../tools/macros';
import { encodeCells, decodeCells } from '../../core/model/grid-wire';
import type { Command, GenerateConfig, MacroCoord } from '../../core/model/types';
import type { World } from './_fixtures';

const s = perfSuite('generation');

function runGeneration(world: World, config: GenerateConfig): Command[] {
  const commands: Command[] = [];
  const start = world.executor.getUndoStackSize();
  generateTerrain(config, world.state, (c) => {
    commands.push(c);
    return world.executor.execute(c);
  }, world.executor.getRegistry());
  world.executor.commitStrokeGroup(start);
  return commands;
}

describe.runIf(PERF)('perf: generation', () => {
  it('designed island: full run', async () => {
    let world = templateWorld();
    await s.bench('designed/full-run', () => {
      runGeneration(world, islandConfig());
    }, {
      setup: () => { world = templateWorld(); },
      minSamples: 3, maxSamples: 6, budgetMs: 8000,
      meta: { template: 'hexia', seed: 12345, richness: 0.7 },
    });
  });

  it('designed island: command replay (cached candidate apply)', async () => {
    const commands = runGeneration(templateWorld(), islandConfig());
    let world = templateWorld();
    await s.bench('designed/replay-apply', () => {
      const start = world.executor.getUndoStackSize();
      for (const c of commands) world.executor.execute(c);
      world.executor.commitStrokeGroup(start);
    }, {
      setup: () => { world = templateWorld(); },
      minSamples: 3, maxSamples: 10, budgetMs: 6000,
      meta: { commands: commands.length },
    });
  });

  it('map fingerprint over the dense island', async () => {
    const { state } = denseIsland();
    await s.bench('cache/map-fingerprint', () => { mapFingerprint(state); }, {
      meta: { objects: state.objects.size },
    });
  });

  it('grid wire: encode and decode the dense island', async () => {
    const { state } = denseIsland();
    const { width, height } = state.template;
    await s.bench('wire/encode', () => { encodeCells(state.cells, width, height); });
    const wire = encodeCells(state.cells, width, height);
    await s.bench('wire/decode', () => { decodeCells(wire); });
  });

  it('region-confined run over a built island (seam repair path)', async () => {
    const island = denseIsland();
    const region: MacroCoord[] = [];
    for (let y = 20; y < 44; y++) for (let x = 20; x < 44; x++) region.push({ x, y });
    let world = cloneWorld(island);
    await s.bench('designed/region-run', () => {
      runGeneration(world, { ...islandConfig(777), region });
    }, {
      setup: () => { world = cloneWorld(island); },
      minSamples: 3, maxSamples: 6, budgetMs: 8000,
      meta: { regionCells: region.length },
    });
  });

  it('maze: full run', async () => {
    let world = templateWorld();
    const config: GenerateConfig = { ...islandConfig(), algorithm: 'maze', corridorWidth: 1 };
    await s.bench('maze/full-run', () => { runGeneration(world, config); }, {
      setup: () => { world = templateWorld(); },
      minSamples: 3, maxSamples: 10, budgetMs: 6000,
    });
  });

  it('eval scorecard over the dense island', async () => {
    const { state } = denseIsland();
    await s.bench('eval/evaluate-map', () => { evaluateMap(state); });
  });

  it('landing a cached candidate on a built island: the clear, then the replay', async () => {
    const island = denseIsland();
    const replay = runGeneration(templateWorld(), islandConfig(777));
    let world = cloneWorld(island);
    await s.bench('landing/clear-built', () => {
      const start = world.executor.getUndoStackSize();
      clearAllObjects(world.state, (c) => world.executor.execute(c));
      clearAllTerrain(world.state, (c) => world.executor.execute(c));
      world.executor.commitStrokeGroup(start);
    }, {
      setup: () => { world = cloneWorld(island); },
      minSamples: 5, maxSamples: 20, budgetMs: 4000,
      meta: { objects: island.state.objects.size },
    });
    let cleared = cloneWorld(island);
    const clearOn = (w: World): void => {
      const start = w.executor.getUndoStackSize();
      clearAllObjects(w.state, (c) => w.executor.execute(c));
      clearAllTerrain(w.state, (c) => w.executor.execute(c));
      w.executor.commitStrokeGroup(start);
    };
    clearOn(cleared);
    await s.bench('landing/replay-on-cleared', () => {
      const start = cleared.executor.getUndoStackSize();
      for (const c of replay) cleared.executor.execute(detachCommand(c));
      cleared.executor.commitStrokeGroup(start);
    }, {
      setup: () => { cleared = cloneWorld(island); clearOn(cleared); },
      minSamples: 5, maxSamples: 20, budgetMs: 4000,
      meta: { commands: replay.length },
    });
  });
});

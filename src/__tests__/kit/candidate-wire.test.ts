/**
 * The worker's ANSWER crosses as a buffer, the same way the question did.
 *
 * `Worker` does not exist here, so the pool never runs in the suite and the two ends of this wire
 * can only be held equal by hand: encode a real generated map the way the worker does, revive it
 * the way the pool does, and require the map to come back the map it was. What that catches is a
 * field added to one end and not the other, which is the whole failure mode of a hand-written wire.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { encodeCells } from '../../core/model/grid-wire';
import { createGrid, createPlazaObject } from '../../core/model/grid-model';
import { createDefaultRegistry } from '../../rules';
import { getMapTemplate } from '../../config/maps';
import { roadLookup } from '../../state/object-index';
import { mapFingerprint } from '../../tools/macros/scratch';
import { reviveCandidate, type WireCandidate } from '../../kit/operations/candidate-pool';
import { generateMap, __resetCandidateCache } from '../../kit/operations/generate';
import type { EditorEvents, GenerateConfig, GridState, PlacedObject } from '../../core/model/types';

function hexia(): GridState {
  const template = getMapTemplate('hexia');
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells: createGrid(template), objects, lockedLayers: new Set() };
}

const config: GenerateConfig = {
  algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 8123, region: null,
  richness: 1,
};

describe('a candidate on the wire', () => {
  it('comes back the map the worker built', async () => {
    __resetCandidateCache();
    const state = hexia();
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    await generateMap({ state, executor, registry: executor.getRegistry() }, { config, region: null });
    const before = mapFingerprint(state);

    // Exactly what `candidate.worker` posts, and exactly what `runCandidateInPool` revives.
    const answer: WireCandidate = {
      wire: encodeCells(state.cells, state.template.width, state.template.height),
      objects: [...state.objects.values()],
      lockedLayers: [...state.lockedLayers],
      cellsVersion: state.cellsVersion ?? 0,
      objectsVersion: state.objectsVersion ?? 0,
      outcome: { cells: [], placed: 7, removedCells: 0, removedObjects: 0, violations: [], cancelled: false },
      commands: [],
      bare: 'ground',
    };
    const run = reviveCandidate(answer, state.template);

    expect(mapFingerprint(run.state)).toBe(before);
    expect(run.state.objects.size).toBe(state.objects.size);
    expect(run.state.lockedLayers).toEqual(state.lockedLayers);
    expect(run.state.cellsVersion).toBe(state.cellsVersion ?? 0);
    expect(run.bare).toBe('ground');
    expect(run.outcome.placed).toBe(7);
  }, 120_000);
});

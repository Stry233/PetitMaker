/**
 * A TEXT run's outcome has to reach the caller, or a word that arrived shorter than it was typed
 * arrives with no reason attached.
 *
 * The engine counts three of them — cells crossing a step or a pond, cells at the edge of the ground
 * the word stands on, cells already at the grid's tallest layer — and the kit seam is where that
 * count is either carried or dropped: `generateMap` lands a candidate built on a copy, so it returns
 * the copy's own outcome, and a field the operation forgets to spread is a field no interface can
 * ever show.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { TerrainType, type EditorEvents, type GenerateConfig, type GridState, type Stencil } from '../../core/model/types';
import { createDefaultRegistry } from '../../rules';
import { roadLookup } from '../../state/object-index';
import { generateMap, __resetCandidateCache } from '../../kit/operations/generate';
import type { KitContext } from '../../kit/context';
import { makeState, setTerrain } from '../rules/_helpers';

const SIZE = 24;

function kitOn(build?: (state: GridState) => void): KitContext {
  const state = makeState(SIZE, SIZE);
  build?.(state);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

/** A solid block of glyph, which is all the outcome cares about. */
function slab(n: number): Stencil {
  return {
    width: n, height: n,
    coverage: new Uint8Array(n * n).fill(255),
    color: new Uint32Array(n * n),
  };
}

function textConfig(origin: { x: number; y: number }, n: number): GenerateConfig {
  return {
    algorithm: 'stencil', mode: 'earth', corridorWidth: 1, region: null,
    seed: 1, maxElevation: 8, richness: 1,
    stencilPlan: { read: 'shape', fill: { kind: 'terrain', terrain: TerrainType.Mountain }, stencil: slab(n), origin },
  };
}

beforeEach(() => { __resetCandidateCache(); });

describe('a text run reports where it landed', () => {
  it('carries the tier and the three skip counts out through the kit', async () => {
    const kit = kitOn();
    const outcome = await generateMap(kit, { config: textConfig({ x: 8, y: 8 }, 6), region: null });
    expect(outcome.cancelled).toBe(false);
    expect(outcome.stencil).toEqual({ base: 0, offBase: 0, unsupported: 0, atCeiling: 0 });
    expect(outcome.violations).toEqual([]);
  });

  it('carries the counts, not just the shape of them', async () => {
    // EVERY RUN CLEARS ITS SCOPE FIRST, so a full-map text run always writes on bare ground. Here
    // the scope is a small square inside the word, so the ground under the rest of it survives the
    // clearing and the glyph really does straddle a step: the cleared cells stand on another surface
    // and the plateau's rim cannot carry a layer four over sea-level ground.
    const kit = kitOn((state) => {
      for (let y = 6; y < 18; y++) for (let x = 6; x < 18; x++) setTerrain(state, x, y, TerrainType.Mountain, 3);
    });
    const scope: { x: number; y: number }[] = [];
    for (let y = 9; y < 12; y++) for (let x = 9; x < 12; x++) scope.push({ x, y });
    const outcome = await generateMap(kit, { config: textConfig({ x: 7, y: 7 }, 10), region: scope });
    expect(outcome.stencil?.base).toBe(3);
    expect(outcome.stencil?.offBase).toBe(scope.length);      // the cells the clearing took down to ground
    expect(outcome.stencil?.unsupported).toBeGreaterThan(0);  // the plateau's own rim
    expect(outcome.violations).toEqual([]);
  });

  it('says nothing about a run that was not text', async () => {
    const kit = kitOn();
    const outcome = await generateMap(kit, {
      config: {
        algorithm: 'maze', mode: 'earth', corridorWidth: 1, region: null,
        seed: 3, maxElevation: 3, richness: 1,
      },
      region: null,
    });
    expect(outcome.stencil).toBeUndefined();
  });
});

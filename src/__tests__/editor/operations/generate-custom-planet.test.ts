import { beforeEach, describe, expect, it } from 'vitest';
import { generateMap } from '../../../editor/operations/generate';
import { __resetCandidateCache } from '../../../tools/generation/run/candidates';
import type { EditContext } from '../../../core/commands/edit-context';
import { isCustomTemplate } from '../../../core/model/planet';
import { createGridState } from '../../../core/model/template';
import { isLandmarkItem } from '../../../core/model/landmarks';
import { isGrassZone } from '../../../core/game/zones';
import { serialize } from '../../../io/save/json-codec';
import { TerrainType, type GridState } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';
import { makeExecutor } from '../../_support/map-state';
import { planetFixture, pondMask } from '../../_support/planet';

const config = (seed: number): GenerateConfig => (defaultConfig('designed', { maxElevation: 4, seed, richness: 1 }));

function kitOn(state: GridState): EditContext {
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

/** A custom planet with an irregular coast and a pond, the shape a scanned planet arrives in. */
function scannedPlanet(): GridState {
  const template = planetFixture({ water: pondMask([[30, 20], [31, 20], [30, 21], [31, 21]]) });
  return createGridState(template);
}

const mapOnly = (state: GridState) => {
  const parsed = JSON.parse(serialize(state));
  return JSON.stringify({ cells: parsed.cells, objects: (parsed.objects as { id: string }[]).map(({ id: _id, ...o }) => o) });
};

beforeEach(() => { __resetCandidateCache(); });

describe('generating on a custom planet', () => {
  it('builds a legal map that keeps to the planet, its landmark and its pond', async () => {
    const state = scannedPlanet();
    expect(isCustomTemplate(state.template)).toBe(true);
    const kit = kitOn(state);
    const landmarks = [...state.objects.values()].filter((o) => isLandmarkItem(o.id));
    const outcome = await generateMap(kit, { config: config(7), region: null });
    expect(outcome.cancelled).toBe(false);
    expect(outcome.violations).toEqual([]);
    expect(outcome.placed).toBeGreaterThan(0);
    expect(kit.registry.validatePostStroke(state)).toEqual([]);
    for (const l of landmarks) expect(state.objects.get(l.id)).toEqual(l);
    // Nothing stands off the planet's own grass.
    for (const obj of state.objects.values()) {
      if (isLandmarkItem(obj.id)) continue;
      const zone = state.cells[Math.floor(obj.position.y)]?.[Math.floor(obj.position.x)]?.zone;
      expect(zone !== undefined && isGrassZone(zone), obj.id).toBe(true);
    }
    for (const [x, y] of [[30, 20], [31, 21]] as const) expect(state.cells[y]![x]!.terrain?.type, `pond ${x},${y}`).toBe(TerrainType.Water);
    expect(kit.executor.historyDepth()).toBe(1);
  });

  it('builds the same map from the same seed', async () => {
    const a = scannedPlanet(), b = scannedPlanet();
    await generateMap(kitOn(a), { config: config(11), region: null });
    __resetCandidateCache();
    await generateMap(kitOn(b), { config: config(11), region: null });
    expect(mapOnly(a)).toBe(mapOnly(b));
  });
});

describe('a generation cancelled while it builds', () => {
  it('leaves the previous generation, its history and its authorship untouched', async () => {
    const state = scannedPlanet();
    const kit = kitOn(state);
    await generateMap(kit, { config: config(3), region: null });
    const before = mapOnly(state);
    const summary = kit.executor.getProvenanceSummary();
    const controller = new AbortController();
    const { signal } = controller;
    const run = generateMap(kit, { config: config(4), region: null, signal });
    // Past the first yield, so the build itself is under way when the cancel arrives.
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const outcome = await run;
    expect(outcome.cancelled).toBe(true);
    expect(mapOnly(state)).toBe(before);
    expect(kit.executor.historyDepth()).toBe(1);
    expect(kit.executor.canRedo()).toBe(false);
    expect(kit.executor.getProvenanceSummary()).toEqual(summary);
    // The kept generation still undoes to the bare planet.
    kit.executor.undo();
    expect(mapOnly(state)).toBe(mapOnly(scannedPlanet()));
  });
});

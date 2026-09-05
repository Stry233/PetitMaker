/*
 * _fixtures.ts — the maps the perf suites measure against.
 *
 * A perf number is only comparable to itself on the same input, so every fixture here is
 * deterministic: real planet templates, the real generator at a fixed (seed, config), the plaza
 * standing as it does in the app. Fixtures are cached per key — building the dense island costs
 * seconds, and a suite asks for it many times.
 */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { createGrid, createPlazaObject } from '../../core/model/grid-model';
import { getMapTemplate } from '../../config/maps';
import { generateTerrain } from '../../tools/generation/terrain-generator';
import { roadLookup } from '../../state/object-index';
import { catalogLoadValue } from '../../state/catalog';
import type { EditorEvents, GenerateConfig, GridState } from '../../core/model/types';

export interface World {
  state: GridState;
  bus: EventBus<EditorEvents>;
  executor: CommandExecutor;
}

/** A live world over `state`: full rule registry, road lookup, load values — the app's own wiring. */
export function makeWorld(state: GridState): World {
  const bus = new EventBus<EditorEvents>();
  const executor = new CommandExecutor(state, bus, createDefaultRegistry(), roadLookup(state), catalogLoadValue);
  return { state, bus, executor };
}

/** A bare template world (plaza placed, nothing else) — the map a new session opens on. */
export function templateWorld(templateId = 'hexia'): World {
  const template = getMapTemplate(templateId);
  const state: GridState = {
    template,
    cells: createGrid(template),
    objects: new Map(),
    lockedLayers: new Set(),
  };
  const plaza = createPlazaObject(template);
  if (plaza) state.objects.set(plaza.id, plaza);
  return makeWorld(state);
}

export const ISLAND_SEED = 12345;

export function islandConfig(seed = ISLAND_SEED): GenerateConfig {
  return {
    algorithm: 'designed', mode: 'mixed', corridorWidth: 1,
    maxElevation: 8, seed, region: null, richness: 0.7,
  };
}

const cache = new Map<string, World>();

/**
 * The dense generated island: full-richness terrain, water, streets and dressing on the real
 * template — the object- and terrain-heavy map the renderers and indexes are sized for.
 */
export function denseIsland(seed = ISLAND_SEED, templateId = 'hexia'): World {
  const key = `${templateId}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const world = templateWorld(templateId);
  const start = world.executor.getUndoStackSize();
  generateTerrain(islandConfig(seed), world.state, (c) => world.executor.execute(c), world.executor.getRegistry());
  world.executor.commitStrokeGroup(start);
  cache.set(key, world);
  return world;
}

/** Deep-clone a world's grid into a fresh live world, for benches that mutate it. */
export function cloneWorld(src: World): World {
  const state: GridState = {
    template: src.state.template,
    cells: structuredClone(src.state.cells),
    objects: structuredClone(src.state.objects),
    lockedLayers: new Set(src.state.lockedLayers),
  };
  return makeWorld(state);
}

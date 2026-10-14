/*
 * The maps the perf suites measure against.
 *
 * A perf number is only comparable to itself on the same input, so every fixture here is
 * deterministic: real planet templates, the real generator at a fixed (seed, config), the plaza
 * standing as it does in the app. Fixtures are cached per key — building the dense map costs
 * seconds, and a suite asks for it many times.
 */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { createGrid } from '../../core/model/grid-model';
import { templateLandmarkObjects } from '../../core/model/landmarks';
import { getMapTemplate } from '../../config/maps';
import type { GridState } from '../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../tools/generation/recipe';
import type { EditorEvents } from '../../state/editing/events';
import { createExecutor } from '../../state/executor';
import { generateWith } from '../_support/generation';

export interface World {
  state: GridState;
  bus: EventBus<EditorEvents>;
  executor: CommandExecutor;
}

/** A live world over `state`: full rule registry, road lookup, load values — the app's own wiring. */
export function makeWorld(state: GridState): World {
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(state, createDefaultRegistry(), bus);
  return { state, bus, executor };
}

/** A bare template world (plaza placed, nothing else) — the map a new session opens on. */
export function templateWorld(templateId = 'hexia'): World {
  const template = getMapTemplate(templateId);
  const state: GridState = {
    template,
    cells: createGrid(template),
    objects: new Map(),
    objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
  };
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) state.objects.set(plaza.id, plaza);
  return makeWorld(state);
}

export const ISLAND_SEED = 12345;

export function islandConfig(seed = ISLAND_SEED): GenerateConfig {
  return defaultConfig('designed', { maxElevation: 8, seed, richness: 0.7 });
}

const cache = new Map<string, World>();

/**
 * The dense generated map: full-richness terrain, water, streets and dressing on the real
 * template — the object- and terrain-heavy map the renderers and indexes are sized for.
 */
export function denseIsland(seed = ISLAND_SEED, templateId = 'hexia'): World {
  const key = `${templateId}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const world = templateWorld(templateId);
  const start = world.executor.beginStroke();
  generateWith(world.state, world.executor, islandConfig(seed));
  start.commit();
  cache.set(key, world);
  return world;
}

/** Deep-clone a world's grid into a fresh live world, for benches that mutate it. */
export function cloneWorld(src: World): World {
  const state: GridState = {
    template: src.state.template,
    cells: structuredClone(src.state.cells),
    objects: structuredClone(src.state.objects),
    objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(src.state.lockedLayers),
  };
  return makeWorld(state);
}

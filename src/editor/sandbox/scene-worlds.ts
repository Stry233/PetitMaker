/**
 * Where a figure's lived-in world comes from. A scene that names its plot plays inside the designed
 * neighbourhood of its template with the plot and a margin cleared (`neighbourhood.ts:scenePlot`);
 * one without plays on the neighbourhood whole.
 *
 * The neighbourhood and its cleared plots are fixed by the template, the recipe and the code that
 * builds them. A figure asks for them before it stands (`prepareSceneWorld`): a released build reads
 * back what an earlier session kept under its own identity, and otherwise a worker builds them, so
 * the generator never holds the main thread; this thread builds them only where no worker answers.
 */
import type { GridState } from '../../core/model/types';
import { __setKeptWorldIdentity, keepWorld, keepsWorlds, keptWorld } from './kept-worlds';
import { plotKeyOf, sceneNeighbourhood, scenePlot, type ScenePlot } from './neighbourhood';
import { buildInWorker } from './scene-world-builder';
import { restoredWorld } from './stored-world';

/** The world a scene asks for: a template's neighbourhood, with `plot` cleared in it where given. */
export interface SceneWorldAsk { templateId?: string; plot?: ScenePlot }

/** Each template's neighbourhood and its cleared plots, keyed by template id ('' the default). */
const neighbourhoods = new Map<string, { base: GridState; plots: Map<string, GridState> }>();

/** The part a template's neighbourhood is kept as; each cleared plot is kept under its plot key. */
const BASE = 'base';

function neighbourhood(templateId: string | undefined): { base: GridState; plots: Map<string, GridState> } {
  const key = templateId ?? '';
  let entry = neighbourhoods.get(key);
  if (!entry) {
    entry = { base: sceneNeighbourhood(templateId), plots: new Map() };
    neighbourhoods.set(key, entry);
    keepWorld(templateId, BASE, entry.base);
  }
  return entry;
}

/** Test seam: the identity kept worlds are keyed by, null to keep none; drops the worlds held here. */
export function __setSceneCacheIdentity(id: string | null): void {
  __setKeptWorldIdentity(id);
  neighbourhoods.clear();
}

/** Makes the world asked for ready for `sceneBase` without building it on this thread: read back
 *  from what an earlier session of this build kept, or built by the worker. Resolves at once for
 *  worlds already here. */
export async function prepareSceneWorld({ templateId, plot }: SceneWorldAsk): Promise<void> {
  const key = templateId ?? '';
  const plotKey = plot ? plotKeyOf(plot) : null;
  const ready = (): boolean => {
    const entry = neighbourhoods.get(key);
    return !!entry && (plotKey === null || entry.plots.has(plotKey));
  };
  if (ready()) return;
  if (keepsWorlds()) {
    if (!neighbourhoods.has(key)) {
      const base = await keptWorld(templateId, BASE);
      if (base && !neighbourhoods.has(key)) neighbourhoods.set(key, { base, plots: new Map() });
    }
    const entry = neighbourhoods.get(key);
    if (entry && plotKey !== null && !entry.plots.has(plotKey)) {
      const kept = await keptWorld(templateId, plotKey);
      if (kept && !entry.plots.has(plotKey)) entry.plots.set(plotKey, kept);
    }
    if (ready()) return;
  }
  const reply = await buildInWorker({ ...(templateId !== undefined ? { templateId } : {}), ...(plot ? { plot } : {}) });
  if (!reply) return;
  let entry = neighbourhoods.get(key);
  if (!entry) {
    entry = { base: restoredWorld(templateId, reply.base), plots: new Map() };
    neighbourhoods.set(key, entry);
    keepWorld(templateId, BASE, entry.base);
  }
  if (plotKey !== null && reply.plot && !entry.plots.has(plotKey)) {
    const cleared = restoredWorld(templateId, reply.plot);
    entry.plots.set(plotKey, cleared);
    keepWorld(templateId, plotKey, cleared);
  }
}

/** The map a scene's world starts from: the template's neighbourhood, around `plot` cleared where
 *  one is asked for. Built on this thread where `prepareSceneWorld` did not make it ready. */
export function sceneBase({ templateId, plot }: SceneWorldAsk): GridState {
  const entry = neighbourhood(templateId);
  if (!plot) return entry.base;
  const plotKey = plotKeyOf(plot);
  let state = entry.plots.get(plotKey);
  if (!state) {
    state = scenePlot(entry.base, plot);
    entry.plots.set(plotKey, state);
    keepWorld(templateId, plotKey, state);
  }
  return state;
}

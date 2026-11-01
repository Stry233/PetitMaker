/**
 * The world a scene plays in. A scene that names its plot plays inside a lived-in map: the designed
 * generator's own run on its template, built once per template, with the plot and a margin cleared
 * back to the template by the editor's own Clear, and the neighbourhood's objects put back where no
 * rule of theirs reaches the plot (`clearedPlot`'s `keep`). The world starts from that map with an
 * empty history, so the player's rewind stops at the neighbourhood. A scene that only draws notes plays on
 * the neighbourhood whole, since a note meets no rule of the ground under it.
 *
 * The neighbourhood and its cleared plots are fixed by the template, the recipe and the code that
 * builds them. A demo asks for them before it stands (`prepareSceneWorld`): a released build reads
 * back what an earlier session kept under its own identity, and otherwise a worker builds them, so
 * the generator never holds the main thread; this thread builds them only where no worker answers.
 */
import type { GridState } from '../../../../core/model/types';
import { SandboxWorld } from '../../../../editor/sandbox/demo-world';
import { BUILD_NUMBER, BUILD_SHA } from '../../../../platform/build/build-info';
import { readFigureCache, writeFigureCache } from '../../../../platform/storage/figure-cache';
import type { HelpScene, Plot } from './common';
import { buildInWorker } from './scene-world-builder';
import { buildNeighbourhood, clearPlot, plotKeyOf } from './world-build';
import { restoredWorld, storedWorld, type StoredWorld } from './stored-world';

/** Each template's neighbourhood and its cleared plots, keyed by template id ('' the default). */
const neighbourhoods = new Map<string, { base: GridState; plots: Map<string, GridState> }>();

function neighbourhood(templateId: string | undefined): { base: GridState; plots: Map<string, GridState> } {
  const key = templateId ?? '';
  let entry = neighbourhoods.get(key);
  if (!entry) {
    entry = { base: buildNeighbourhood(templateId), plots: new Map() };
    neighbourhoods.set(key, entry);
    persist(cacheKey(templateId, 'base'), entry.base);
  }
  return entry;
}

function plotted(templateId: string | undefined, plot: Plot): GridState {
  const entry = neighbourhood(templateId);
  const plotKey = plotKeyOf(plot);
  let state = entry.plots.get(plotKey);
  if (!state) {
    state = clearPlot(entry.base, plot);
    entry.plots.set(plotKey, state);
    persist(cacheKey(templateId, plotKey), state);
  }
  return state;
}

/* ── kept across sessions ─────────────────────────────────────────────── */

/** The build a stored world belongs to: any change of code or data is a new build. A development
 *  server has no identity of its own, so it keeps nothing. */
let identity: string | null = BUILD_SHA === 'dev' ? null : `${BUILD_SHA}.${BUILD_NUMBER}`;

/** Test seam: the identity stored worlds are keyed by, null to keep none. */
export function __setSceneCacheIdentity(id: string | null): void {
  identity = id;
  neighbourhoods.clear();
}

const cacheKey = (templateId: string | undefined, part: string): string | null =>
  identity === null ? null : `${identity}|scene-world|${templateId ?? ''}|${part}`;

function persist(key: string | null, state: GridState): void {
  if (key === null || identity === null) return;
  void writeFigureCache(key, storedWorld(state), `${identity}|`);
}

/** Makes `scene`'s worlds ready for `sceneWorld` without building them on this thread: read back
 *  from what an earlier session of this build kept, or built by the worker. Resolves at once for a
 *  scene that needs no neighbourhood or whose worlds are already here. */
export async function prepareSceneWorld(scene: HelpScene): Promise<void> {
  if (!scene.plot && !scene.notesOnly) return;
  const key = scene.template ?? '';
  const plotKey = scene.plot ? plotKeyOf(scene.plot) : null;
  const ready = (): boolean => {
    const entry = neighbourhoods.get(key);
    return !!entry && (plotKey === null || entry.plots.has(plotKey));
  };
  if (ready()) return;
  const baseKey = cacheKey(scene.template, 'base');
  if (baseKey !== null) {
    if (!neighbourhoods.has(key)) {
      const base = await readFigureCache<StoredWorld>(baseKey);
      if (base && !neighbourhoods.has(key)) neighbourhoods.set(key, { base: restoredWorld(scene.template, base), plots: new Map() });
    }
    const entry = neighbourhoods.get(key);
    if (entry && plotKey !== null && !entry.plots.has(plotKey)) {
      const plot = await readFigureCache<StoredWorld>(cacheKey(scene.template, plotKey)!);
      if (plot && !entry.plots.has(plotKey)) entry.plots.set(plotKey, restoredWorld(scene.template, plot));
    }
    if (ready()) return;
  }
  const reply = await buildInWorker(scene.template, scene.plot);
  if (!reply) return;
  let entry = neighbourhoods.get(key);
  if (!entry) {
    entry = { base: restoredWorld(scene.template, reply.base), plots: new Map() };
    neighbourhoods.set(key, entry);
    persist(cacheKey(scene.template, 'base'), entry.base);
  }
  if (plotKey !== null && reply.plot && !entry.plots.has(plotKey)) {
    const plot = restoredWorld(scene.template, reply.plot);
    entry.plots.set(plotKey, plot);
    persist(cacheKey(scene.template, plotKey), plot);
  }
}

/** A fresh world for `scene`: with a plot, the neighbourhood around that plot; a scene that only
 *  draws notes, the neighbourhood as it stands; otherwise its template. */
export function sceneWorld(scene: HelpScene): SandboxWorld {
  if (scene.plot) return new SandboxWorld(scene.template, { base: plotted(scene.template, scene.plot) });
  if (scene.notesOnly) return new SandboxWorld(scene.template, { base: neighbourhood(scene.template).base });
  return new SandboxWorld(scene.template);
}

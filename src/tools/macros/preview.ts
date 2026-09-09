/** Preview the actual committed macro on a detached map. Calls share a bounded per-map cache. */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { cloneGridState } from '../../core/model/grid-model';
import { hashJSON } from '../../core/model/hash';
import type { EditorEvents, GridState, MacroCoord } from '../../core/model/types';
import { roadLookup } from '../../state/object-index';
import { catalogLoadValue } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import type { MacroContext } from './context';
import { applyMacro, type MacroId, type MacroOpts } from './run';

/** Final cell and object footprints, including removals and refusal evidence. */
export interface MacroPreview {
  valid?: boolean;
  added: MacroCoord[];
  removed: MacroCoord[];
  /** Cells the run needed and a decoration holds. Left standing; the ghost marks them. */
  blocked: MacroCoord[];
  /** The route profiles drafted, in offer order. */
  offers: readonly string[];
  /** The built terrain height, when the macro reports one. */
  peak?: number;
}

/** Recent answers, keyed by everything that decides one — the macro, its options and the map's
 *  versions — so re-hovering a cell costs a lookup, not a run. Bounded FIFO: a hover trail is
 *  short, and an unbounded map would hold every cell ever visited. */
const CACHE_MAX = 64;
const caches = new WeakMap<GridState, Map<string, MacroPreview>>();
function cacheFor(state: GridState): Map<string, MacroPreview> {
  let cache = caches.get(state);
  if (!cache) { cache = new Map(); caches.set(state, cache); }
  return cache;
}

const cacheKey = (state: GridState, id: MacroId, opts: MacroOpts): string => (
  `${id}|${hashJSON(opts)}|${state.cellsVersion ?? 0}|${state.objectsVersion ?? 0}|${[...state.lockedLayers].sort().join(',')}`
);

function cachePut(state: GridState, key: string, preview: MacroPreview): void {
  const cache = cacheFor(state);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, preview);
}

/**
 * A runner that answers the preview OFF this thread — installed by the layer that owns the worker
 * pool (`kit/operations/candidate-pool`, wired in App), declared here because this layer cannot
 * import it. The cache stays HERE, on the asking side, whichever runner answers.
 */
type RemotePreview = (state: GridState, id: MacroId, opts: MacroOpts) => Promise<MacroPreview>;
let remote: RemotePreview | null = null;

export function installMacroPreviewRunner(fn: RemotePreview): void { remote = fn; }

/**
 * `previewMacro`, preferring the installed off-thread runner: the run costs what the macro costs,
 * and on the main thread that cost is a hitch under a moving pointer. A runner that breaks is
 * dropped and the synchronous run below answers instead — same code, same cells.
 */
export async function previewMacroAsync(ctx: MacroContext, id: MacroId, opts: MacroOpts): Promise<MacroPreview> {
  const key = cacheKey(ctx.state, id, opts);
  const hit = cacheFor(ctx.state).get(key);
  if (hit) return hit;
  if (remote) {
    try {
      const preview = await remote(ctx.state, id, opts);
      cachePut(ctx.state, key, preview);
      return preview;
    } catch {
      // Retiring the runner is for a runner that cannot answer. Nothing else runs inside this try:
      // the cache write cannot throw, so a failure here is the worker's own.
      remote = null;
    }
  }
  return previewMacro(ctx, id, opts);
}

export function previewMacro(ctx: MacroContext, id: MacroId, opts: MacroOpts): MacroPreview {
  const key = cacheKey(ctx.state, id, opts);
  const hit = cacheFor(ctx.state).get(key);
  if (hit) return hit;

  const state = cloneGridState(ctx.state);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), ctx.registry, roadLookup(state), catalogLoadValue);
  // THE REAL PRESS, on a copy. A macro is more than its builder — it is the builder, the replay,
  // and the post-stroke commit that can revert all of it — so running `applyMacro` itself is what
  // keeps the shape shown from disagreeing with the shape laid.
  const outcome = applyMacro({ state, executor, registry: ctx.registry }, id, opts);

  const added: MacroCoord[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number): void => {
    const cellKey = `${x},${y}`;
    if (seen.has(cellKey)) return;
    seen.add(cellKey);
    added.push({ x, y });
  };

  // Only the cells the run's own history touched are compared, never the whole grid: the collapsed
  // entries carry every coordinate the commands and their auto-repairs reached, and a cell outside
  // them cannot differ. Compared against the LIVE state per cell, because the auto-revert can put
  // a touched cell back exactly as it was.
  const differs = (x: number, y: number): boolean => {
    const was = ctx.state.cells[y]?.[x]?.terrain;
    const now = state.cells[y]?.[x]?.terrain;
    return JSON.stringify(was) !== JSON.stringify(now);
  };
  for (const entry of executor.getUndoEntries()) {
    for (const snap of entry.after) {
      if (!seen.has(`${snap.coord.x},${snap.coord.y}`) && differs(snap.coord.x, snap.coord.y)) {
        const shift = id === 'raise' || id === 'stream' ? 0 : -0.5;
        add(snap.coord.x + shift, snap.coord.y + shift);
      }
    }
  }
  // Compare object IDs in the input and preview maps to include placements and replaced coatings.
  const before = new Set(ctx.state.objects.keys());
  const after = new Set(state.objects.keys());
  for (const [objectId, obj] of state.objects) {
    if (!before.has(objectId)) {
      const rect = objectRect(obj);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) add(x, y);
    }
  }
  const removed: MacroCoord[] = [];
  for (const [objectId, obj] of ctx.state.objects) {
    if (!after.has(objectId)) {
      const rect = objectRect(obj);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) removed.push({ x, y });
    }
  }

  // The macro's own report rides on the outcome of the very run this preview already made — the
  // same `landMacroRun` that threads it onto a real press's `MacroOutcome` — so a route's blocked
  // cells and offers, and a raise's refused cells and reachable tier, cost nothing beyond the one
  // scratch run every preview already pays for.
  const preview: MacroPreview = {
    valid: outcome.changes > 0,
    added, removed, blocked: outcome.blocked ?? [], offers: outcome.offers ?? [],
    ...(outcome.peak !== undefined ? { peak: outcome.peak } : {}),
  };
  cachePut(ctx.state, key, preview);
  return preview;
}

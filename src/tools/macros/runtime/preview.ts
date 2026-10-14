/** Preview the actual committed macro on a detached map. Calls share a bounded per-map cache. */
import { cloneGridState, mapVersionKey } from '../../../core/model/grid-model';
import { hashJSON } from '../../../core/base/hash';
import { boundedMap, type BoundedMap } from '../../../core/base/bounded-map';
import type { GridState } from '../../../core/model/types';
import { objectRect } from '../../../state/object-geometry';
import type { MacroContext } from '../context';
import { applyMacro, MACROS, retireOn, type MacroId, type MacroOpts } from '../run';
import { detachedContext } from './scratch';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import type { GridId, GridCellRef } from '../../../core/grid/grids';

/** A preview cell on the grid it lies on: a terrain cell or an object footprint cell. One run
 *  changes both, and the two grids lie apart. */
export type MacroPreviewCell = GridCellRef;

/** Final cell and object footprints, including removals and refusal evidence. */
export interface MacroPreview {
  valid?: boolean;
  added: MacroPreviewCell[];
  removed: MacroPreviewCell[];
  /** Cells the run needed and a decoration holds, on the macro's own grid. Left standing; the ghost
   *  marks them. */
  blocked: MacroPreviewCell[];
  /** The route profiles drafted, in offer order. */
  offers: readonly string[];
  /** The built terrain height, when the macro reports one. */
  peak?: number;
}

/** Recent answers, keyed by everything that decides one — the macro, its options and the map's
 *  versions — so re-hovering a cell costs a lookup, not a run. Bounded FIFO: a hover trail is
 *  short, and an unbounded map would hold every cell ever visited. */
const CACHE_MAX = 64;
const caches = new WeakMap<GridState, BoundedMap<string, MacroPreview>>();
function cacheFor(state: GridState): BoundedMap<string, MacroPreview> {
  let cache = caches.get(state);
  if (!cache) { cache = boundedMap(CACHE_MAX); caches.set(state, cache); }
  return cache;
}

const cacheKey = (state: GridState, id: MacroId, opts: MacroOpts): string => (
  `${id}|${hashJSON(opts)}|${mapVersionKey(state)}`
);

function cachePut(state: GridState, key: string, preview: MacroPreview): void {
  cacheFor(state).set(key, preview);
}

/**
 * `previewMacro`, preferring the context's off-thread runner (`MacroContext.offThread`), with the
 * cache here on the asking side whichever runner answers: the run costs what the macro costs,
 * and on the main thread that cost is a hitch under a moving pointer. A failed job is answered by
 * the synchronous run below — same code, same cells — and only a runner that can no longer answer
 * (`MacroRunnerUnavailable`) is dropped.
 */
export async function previewMacroAsync<K extends MacroId>(ctx: MacroContext, id: K, opts: MacroOpts<K>): Promise<MacroPreview> {
  const key = cacheKey(ctx.state, id, opts);
  const hit = cacheFor(ctx.state).get(key);
  if (hit) return hit;
  const port = ctx.offThread;
  if (port?.preview) {
    try {
      const preview = await port.preview(ctx.state, id, opts, ctx.registry);
      cachePut(ctx.state, key, preview);
      return preview;
    } catch (err) {
      retireOn(err, () => { port.preview = null; });
    }
  }
  return previewMacro(ctx, id, opts);
}

export function previewMacro<K extends MacroId>(ctx: MacroContext, id: K, opts: MacroOpts<K>): MacroPreview {
  const key = cacheKey(ctx.state, id, opts);
  const hit = cacheFor(ctx.state).get(key);
  if (hit) return hit;

  const scratch = detachedContext(cloneGridState(ctx.state), ctx.registry);
  const { state, executor } = scratch;
  // The real press, on a copy. A macro is more than its builder — it is the builder, the replay,
  // and the post-stroke commit that can revert all of it — so running `applyMacro` itself is what
  // keeps the shape shown from disagreeing with the shape laid.
  const outcome = applyMacro(scratch, id, opts);

  const added: MacroPreviewCell[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number, grid: GridId): void => {
    const cellKey = `${grid}${x},${y}`;
    if (seen.has(cellKey)) return;
    seen.add(cellKey);
    added.push({ x, y, grid });
  };

  // Only the cells the run's own history touched are compared, never the whole grid: the collapsed
  // entries carry every coordinate the commands and their auto-repairs reached, and a cell outside
  // them cannot differ. Compared against the live state per cell, because the auto-revert can put
  // a touched cell back exactly as it was.
  const differs = (x: number, y: number): boolean => {
    const was = ctx.state.cells[y]?.[x]?.terrain;
    const now = state.cells[y]?.[x]?.terrain;
    return JSON.stringify(was) !== JSON.stringify(now);
  };
  for (const entry of executor.getUndoEntries()) {
    for (const snap of entry.after) {
      if (differs(snap.coord.x, snap.coord.y)) add(snap.coord.x, snap.coord.y, TERRAIN_GRID);
    }
  }
  // Compare object IDs in the input and preview maps to include placements and replaced coatings.
  const before = new Set(ctx.state.objects.keys());
  const after = new Set(state.objects.keys());
  for (const [objectId, obj] of state.objects) {
    if (!before.has(objectId)) {
      const rect = objectRect(obj);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) add(x, y, PLACEMENT_GRID);
    }
  }
  const removed: MacroPreviewCell[] = [];
  for (const [objectId, obj] of ctx.state.objects) {
    if (!after.has(objectId)) {
      const rect = objectRect(obj);
      for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) removed.push({ x, y, grid: PLACEMENT_GRID });
    }
  }
  const grid = MACROS[id].grid;

  // The macro's own report rides on the outcome of the very run this preview already made — the
  // same `landMacroRun` that threads it onto a real press's `MacroOutcome` — so a route's blocked
  // cells and offers, and a raise's refused cells and reachable tier, cost nothing beyond the one
  // scratch run every preview already pays for.
  const preview: MacroPreview = {
    valid: outcome.changes > 0,
    added, removed, blocked: (outcome.blocked ?? []).map(({ x, y }) => ({ x, y, grid })), offers: outcome.offers ?? [],
    peak: outcome.peak,
  };
  cachePut(ctx.state, key, preview);
  return preview;
}

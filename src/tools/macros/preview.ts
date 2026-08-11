/**
 * What a macro WOULD build, as cells, without building it.
 *
 * A macro is a small generation, so what it produces is not predictable from its aim point: a hill
 * reads the ground under it, a stream walks downhill until it finds water or gives up, and planting
 * asks the ecology what will grow. That is what makes them worth having and it is also what makes
 * them hard to aim — before this, the only way to find out what a press would do was to press.
 *
 * So the preview runs the REAL macro on a detached clone (`runOnScratch`, the same path
 * `applyMacro` takes) and reports the cells its accepted commands touch. Nothing is committed,
 * nothing is undone, and the live map is never written to, so an interrupted preview cannot leave
 * anything behind.
 *
 * IT IS NOT FREE. The run costs what the macro costs — tens of milliseconds, most of it the
 * whole-map post-stroke validation each terrain step asks for — so a caller must not ask on every
 * pointer move. `SmartBuild` asks once the pointer has settled, and throws the answer away when it
 * moves again.
 */
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { cloneGridState } from '../../core/model/grid-model';
import { hashJSON } from '../../core/model/hash';
import type { EditorEvents, GridState, MacroCoord } from '../../core/model/types';
import { roadLookup } from '../../state/object-index';
import type { MacroContext } from './context';
import { applyMacro, type MacroId, type MacroOpts } from './index';

/**
 * What the macro WOULD build, and what it would COST.
 *
 * `added` is measured AFTER THE POST-STROKE COMMIT, not from the commands. The commands are only
 * what pre-command validation accepted, and a post-stroke rule can still take them back: the
 * stream's reverts a course that cannot reach open water, so on flat ground it accepts seventeen
 * cells and keeps none of them.
 *
 * `removed` is what it takes: the cells a coating stands on today that this run would replace, read
 * off the object diff rather than declared by the builder, so it is true of every macro and cannot
 * drift from what actually happens.
 *
 * An empty `added` is an ANSWER — no coast to reach, no ground that would carry a planting — and the
 * caller should say so rather than treating it as a failure to compute.
 */
export interface MacroPreview {
  added: MacroCoord[];
  removed: MacroCoord[];
  /** Cells the run needed and a decoration holds. Left standing; the ghost marks them. */
  blocked: MacroCoord[];
  /** The offers a two-tap route drafted, in offer order. */
  offers: readonly string[];
  /** raise only: the tier the ground under the aim would carry. Absent for every other macro, which
   *  has no height to promise. */
  peak?: number;
}

/** Recent answers, keyed by everything that decides one — the macro, its options and the map's
 *  versions — so re-hovering a cell costs a lookup, not a run. Bounded FIFO: a hover trail is
 *  short, and an unbounded map would hold every cell ever visited. */
const CACHE_MAX = 64;
const cache = new Map<string, MacroPreview>();

const cacheKey = (state: GridState, id: MacroId, opts: MacroOpts): string => (
  `${id}|${hashJSON(opts)}|${state.cellsVersion ?? 0}|${state.objectsVersion ?? 0}`
);

function cachePut(key: string, preview: MacroPreview): void {
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
  const hit = cache.get(key);
  if (hit) return hit;
  if (remote) {
    try {
      const preview = await remote(ctx.state, id, opts);
      cachePut(key, preview);
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
  const hit = cache.get(key);
  if (hit) return hit;

  const state = cloneGridState(ctx.state);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), ctx.registry, roadLookup(state));
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
    return (was?.type ?? null) !== (now?.type ?? null) || (was?.elevation ?? 0) !== (now?.elevation ?? 0);
  };
  for (const entry of executor.getUndoEntries()) {
    for (const snap of entry.after) {
      if (!seen.has(`${snap.coord.x},${snap.coord.y}`) && differs(snap.coord.x, snap.coord.y)) {
        add(snap.coord.x, snap.coord.y);
      }
    }
  }
  // What it PLANTS is part of what it builds, and a planting is nothing else. `objects` is a Map,
  // so it is walked as one.
  //
  // `removed`, the mirror walk: every id the LIVE map holds that the run's own copy no longer does —
  // a coating this run replaced. Both walks read the SAME two object maps, so `added`/`removed` can
  // never disagree about which side an id fell on.
  const before = new Set(ctx.state.objects.keys());
  const after = new Set(state.objects.keys());
  for (const [objectId, obj] of state.objects) {
    if (!before.has(objectId)) add(obj.position.x, obj.position.y);
  }
  const removed: MacroCoord[] = [];
  for (const [objectId, obj] of ctx.state.objects) {
    if (!after.has(objectId)) removed.push(obj.position);
  }

  // The macro's own report rides on the outcome of the very run this preview already made — the
  // same `landMacroRun` that threads it onto a real press's `MacroOutcome` — so a route's blocked
  // cells and offers, and a raise's refused cells and reachable tier, cost nothing beyond the one
  // scratch run every preview already pays for.
  const preview: MacroPreview = {
    added, removed, blocked: outcome.blocked ?? [], offers: outcome.offers ?? [],
    ...(outcome.peak !== undefined ? { peak: outcome.peak } : {}),
  };
  cachePut(key, preview);
  return preview;
}

/**
 * Runs macros through the ordinary pointer-tool lifecycle. Each press advances the seed and creates
 * one undo entry. Held planting emits ordered succession bursts that collapse into one undo step;
 * moving far enough starts a new stand. Previews run one at a time and discard stale results.
 * `road-link` uses two taps, then keeps draggable endpoints and cycles alternative routes by rolling
 * back and replaying the same seed as a single undo entry.
 */
import type { MacroCoord, MicroCoord } from '../../core/model/types';
import { ItemCategory, ToolType } from '../../core/model/types';
import { isBuildableZone } from '../../core/model/grid-model';
import type { CursorId } from '../../core/runtime/cursor-spec';
import type { PreviewCell } from '../../core/runtime/preview-cell';
import { showToast } from '../../core/runtime/toast-bus';
import { categoryOf } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import { getObjectIndex, objectAt } from '../../state/object-index';
import type { RouteProfile } from '../placement/route';
import type { Tool, ToolContext } from '../runtime/types';
import {
  applyMacro, applyMacroAsync, EMPTY_KEY, hasMacroBuildRunner, MACRO_IDS, patchScope,
  type MacroId, type MacroOpts, type MacroOutcome,
} from './run';
import { previewMacroAsync } from './preview';
import { closeRouteMarks, keepRouteMarks, openRouteMarks, resetRouteMarks } from './route-session';

/** The label key for a drafted route's PROFILE, so a cycle tap can name what it just chose. */
const OFFER_LABEL: Record<RouteProfile, string> = {
  short: 'smart.offer_short', straight: 'smart.offer_straight', scenic: 'smart.offer_scenic',
};

/** "{n} of {total}: {name}" for the offer a cycle tap just landed on. */
function offerLine(ctx: ToolContext, offer: number, offers: readonly string[]): string {
  const profile = (offers[offer] ?? 'short') as RouteProfile;
  return ctx.t('smart.route_offer', { n: offer + 1, total: offers.length, name: ctx.t(OFFER_LABEL[profile]) });
}

/** Report when preserved plantings narrow a multi-cell route. */
function narrateNeck(ctx: ToolContext, outcome: MacroOutcome): void {
  if (outcome.narrowedByPlanting) showToast(ctx.t('smart.road_necked'), 'info');
}

/** Fresh commits and their previews use the first drafted route. */
const COMMIT_OFFER = 0;

/** Held-planting cadence and movement threshold. */
const SPRAY_MS = 350;
const SPRAY_STEP = 3;

/** Macro previews combine multiple materials, so their card has no single-material glyph. */
const GHOST_CARD: PreviewCell = { icon: null, valid: true };

/** Narrow the core-owned armed string to an implemented macro id. */
export function armedMacroId(ctx: ToolContext): MacroId | null {
  const armed = ctx.armedMacro;
  return armed !== null && (MACRO_IDS as readonly string[]).includes(armed) ? (armed as MacroId) : null;
}

/** Replay state for a committed route while its endpoint controls remain active. */
interface NudgeableRoute {
  from: MacroCoord;
  to: MacroCoord;
  offer: number;
  offers: readonly string[];
  cells: ReadonlySet<string>;
  seed: number;
  watermark: number;
  epoch: number;
  ctx: ToolContext;
}

/** The cells covered by every object added since `before` — footprints, so a tap on a bridge deck
 *  counts as a tap on the route that laid it. */
function laidCells(state: ToolContext['gridState'], before: ReadonlySet<string>): Set<string> {
  const cells = new Set<string>();
  for (const [id, obj] of state.objects) {
    if (before.has(id)) continue;
    const r = objectRect(obj);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.add(`${x},${y}`);
  }
  return cells;
}

/** The armed macro's working radius, from the bar's own size slider: sizes 1..5 land radii 4..8, so the
 *  smallest setting is still a recognisable hill. ONE function, so the burst, the ghost's cache key and
 *  the ghost's own preview ask the SAME radius by construction rather than by three literals agreeing. */
export function macroRadius(ctx: ToolContext): number {
  return ctx.brushSize + 3;
}

/** The road surface a run is TOLD to lay, or undefined to let it read the map's own
 *  (`road-style.ts:readRoadStyle`). A pick from the bar is a decision and wins; the catalog's first
 *  road, sitting in the store because something had to be armed, is not one and would otherwise
 *  override the street a new lane grows out of on every press. */
export function armedMaterial(ctx: ToolContext): string | undefined {
  return ctx.tileMaterialPicked ? ctx.tileMaterial : undefined;
}

export class MacroTool implements Tool {
  id = ToolType.Macro;
  cursor: CursorId = 'place';

  /** Advances per press so repeated presses can produce different seeded layouts. */
  private seed = 1;
  /** What the standing ghost answers, so a re-sample at the same cell with the same seed is free. */
  private ghostKey: string | null = null;
  /** Bumped whenever the ghost's question changes, so an answer that comes back off-thread for a
   *  question no longer asked is dropped instead of drawn. */
  private ghostToken = 0;
  /** The newest cell the pointer has reached while a preview is in flight — what the pump asks
   *  next, superseding anything it skipped on the way. */
  private wanted: { coord: MacroCoord; key: string } | null = null;
  private previewing = false;
  /** In-progress held planting, including ordered work and the undo watermark for the whole hold. */
  private spray: {
    id: MacroId; at: MacroCoord; last: MacroCoord; watermark: number; changes: number;
    pending: number; done: boolean; ctx: ToolContext;
    anchor: MacroCoord; stage: number; anchorSeed: number;
    /** Object ids present at the current anchor; succession may age only objects added by this hold. */
    baseIds: ReadonlySet<string>;
    timer: ReturnType<typeof setInterval>;
  } | null = null;
  /** Serializes presses and bursts so each build reads the prior landing. */
  private applying: Promise<void> = Promise.resolve();

  /** First `road-link` tap; no map edit occurs until the second tap commits. */
  private mark: {
    from: MacroCoord;
    /** `ToolContext.armingEpoch` when the tap landed. See `armedNow`. */
    epoch: number;
  } | null = null;
  /** The route whose marks are standing, or null. THIS TOOL'S ONE CLAIM ON A GESTURE: it must be null
   *  whenever there is no session, since `cancelPending` reads nothing else. */
  private route: NudgeableRoute | null = null;
  /** A mark drag is in flight, so the pointer belongs to the marks and the tool's own hover ghost
   *  must not fight the nudge preview for the overlay. */
  private nudging = false;
  /**
   * The armed macro, having first dropped whatever the hand has moved on from.
   *
   * Every armed macro shares `ToolType.Macro`, so switching cards fires no `onDeactivate` and the
   * tool is asked nothing at all until the pointer comes back. That rules out watching the id for a
   * change: `road-link` to another card and back leaves the id where it started, so the tool sees
   * ONE unchanged value across the whole round trip, and the next single tap would commit a route
   * from a gesture abandoned two clicks ago. `armingEpoch` COUNTS the changes instead, and each
   * piece of held state carries the count it was laid at, so there is no edge to be away for.
   *
   * A ROUTE'S MARKS GO THE SAME WAY, for the same reason: they offer a nudge to a route the hand has
   * moved on from, and the card that would run it is no longer armed.
   *
   * Both pointer entry points ask here rather than reading the context directly.
   */
  private armedNow(ctx: ToolContext): MacroId | null {
    if (this.mark && this.mark.epoch !== ctx.armingEpoch) { this.mark = null; this.clearGhost(ctx); }
    if (this.route && this.route.epoch !== ctx.armingEpoch) this.dropRoute();
    return armedMacroId(ctx);
  }

  /**
   * Put the marks away and drop this tool's claim on the route.
   *
   * The field is cleared HERE as well as by the session's own `finalize`, because it is the only thing
   * `cancelPending` reads: a claim left standing with nothing on screen is Escape never disarming the
   * road card again, for the life of the tool.
   */
  private dropRoute(): void {
    closeRouteMarks();
    this.nudging = false;
    this.route = null;
  }

  /**
   * Write a landed nudge back onto the route, and ONLY while the marks it belongs to are still the ones
   * standing.
   *
   * A build lands a worker round trip after the drop that asked for it, and a second drop inside that
   * window is refused and closes the marks. Without this identity check the late callback re-creates
   * `route` with no session behind it, and `closeRouteMarks` returns early with nothing to close, so
   * `finalize` never runs and the field is never cleared again.
   */
  private keepRoute(owned: NudgeableRoute, next: Partial<NudgeableRoute>): void {
    if (this.route !== owned) return;
    this.route = { ...owned, ...next };
  }

  canActAt(coord: MacroCoord, ctx: ToolContext): boolean {
    const cell = ctx.gridState.cells[coord.y]?.[coord.x];
    return !!cell && isBuildableZone(cell.zone);
  }

  /**
   * Queue one landing behind those already in flight, and never hand a thrown one on to the next
   * press.
   *
   * `landMacroRun` rolls its own work back and RETHROWS on purpose, so a rule or executor fault is
   * not read as a broken worker. It arrives here as a rejection, and a rejected promise is SKIPPED
   * by every `.then` chained onto it afterwards: unguarded, one faulted landing stops this tool
   * building for the rest of the session and hangs a held planting with it, since `pending` never
   * falls and the clock only sprays at zero.
   *
   * Nothing reached the map, so `nothing` is the caller's own "this press built nothing" path — the
   * same one an empty run takes, which is what keeps the fault's bookkeeping and its report the
   * ordinary ones rather than a second set to maintain.
   */
  private chain(work: () => Promise<void>, nothing: (outcome: MacroOutcome) => void): void {
    this.applying = this.applying.then(async () => {
      try {
        await work();
      } catch (err) {
        console.error('[macro] the landing failed', err);
        nothing({ changes: 0 });
      }
    });
  }

  /** Land one macro at `cell` — synchronously without a build runner (tests, headless), else on
   *  the ordered off-thread chain — and hand the outcome back either way. A tool with a context has
   *  a map, so `ctx.macroContext` needs no null guard. */
  private runApply(
    ctx: ToolContext, cell: MacroCoord, id: MacroId, stage: number, after: (outcome: MacroOutcome) => void,
    anchorSeed?: number, heldIds?: readonly string[],
  ): void {
    const seed = this.seed;
    this.seed += 1;
    const radius = macroRadius(ctx);
    // The anchor seed rides along only where it differs, so a short press asks the question the
    // ghost previewed, byte for byte.
    const opts = {
      seed, at: cell, radius,
      ...(stage > 1 ? { stage } : {}),
      ...(anchorSeed !== undefined && anchorSeed !== seed ? { anchorSeed } : {}),
      ...(heldIds && heldIds.length > 0 ? { heldIds } : {}),
    };
    if (!hasMacroBuildRunner()) {
      after(applyMacro(ctx.macroContext, id, opts));
      return;
    }
    this.chain(async () => {
      after(await applyMacroAsync(ctx.macroContext, id, opts));
    }, after);
  }

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const id = this.armedNow(ctx);
    // road-link owns the standing route's lifetime, because one of its presses (a cycle) keeps it.
    if (id === 'road-link' && this.canActAt(coord, ctx)) { this.linkDown(coord, ctx); return; }
    // Whatever this press turns out to be, the last route's moment is over: a press on the map is the
    // next thing being built. A press ON a mark never reaches here (`RouteMarks` swallows it).
    this.dropRoute();
    if (!id || !this.canActAt(coord, ctx)) return;
    this.clearGhost(ctx);
    if (patchScope(id)) {
      // The spray: the first burst lands now, the clock and the pointer lay the rest until release.
      // The armed id rides in the spray itself, so a burst replants with whichever of the two
      // planting cards was pressed, never a fixed one.
      this.spray = {
        id, at: coord, last: coord, watermark: ctx.getUndoStackSize(), changes: 0,
        pending: 0, done: false, ctx, anchor: coord, stage: 0, anchorSeed: this.seed,
        baseIds: new Set(ctx.gridState.objects.keys()),
        // A tick sprays only when the last burst has landed — a slow build must never pile a
        // backlog of puffs behind itself.
        timer: setInterval(() => { const s = this.spray; if (s && s.pending === 0) this.burst(s.at); }, SPRAY_MS),
      };
      this.burst(coord);
      return;
    }
    this.runApply(ctx, coord, id, 1, (outcome) => {
      // What landed is its own feedback, like any stroke; the one thing the map cannot show is a
      // press that built NOTHING, and that is the one case a toast reports (in the toast
      // standard's own "Category: reason" shape).
      if (outcome.changes === 0) showToast(ctx.t('smart.empty'), 'warning');
    });
  }

  /**
   * THE TWO TAPS.
   *
   * With a route standing, a tap on ITS OWN CELLS cycles the offers and nothing else about the press
   * happens. Otherwise: no mark yet, a tap on a BUILDING is the whole gesture (gesture 2 — one spur
   * from its gate) and a tap on ground is mark 1; mark standing, the tap is mark 2 and commits
   * WHEREVER it lands.
   */
  private linkDown(coord: MacroCoord, ctx: ToolContext): void {
    const mark = this.mark;
    if (!mark && this.cycleRoute(coord)) return;
    this.dropRoute();
    if (!mark) {
      if (buildingAt(ctx.gridState, coord)) { this.runLink(ctx, coord, null, COMMIT_OFFER); return; }
      this.mark = { from: coord, epoch: ctx.armingEpoch };
      return;
    }
    this.mark = null;
    this.runLink(ctx, coord, mark.from, COMMIT_OFFER);
  }

  /**
   * A TAP ON THE ROUTE IT JUST LAID: lay it again at the same ends under the next offer.
   *
   * Answers whether this press was a cycle at all; false leaves the press to be whatever else it is,
   * which is what makes every way of not being a cycle fall back to an ordinary tap rather than to a
   * special case of its own. There are four, each a plain fact: no route is standing, the route
   * drafted only ONE way to go, the tap missed its pavement, or the route is no longer the top undo
   * entry — where a nudge refuses and closes the marks (`relayRoute`), a tap can simply be a tap,
   * since taking the route back would take whatever is newer with it.
   */
  private cycleRoute(coord: MacroCoord): boolean {
    const route = this.route;
    if (!route || route.offers.length < 2) return false;
    if (!route.cells.has(`${coord.x},${coord.y}`)) return false;
    if (route.ctx.getUndoStackSize() !== route.watermark + 1) return false;
    route.ctx.overlay.clearGhost();
    keepRouteMarks();
    this.relay(route, route.from, route.to, (route.offer + 1) % route.offers.length, true);
    return true;
  }

  /** The bar's own material/width/trim around one route's own seed and ends, exactly as the
   *  single-press macros read them from the context. ONE builder, so the commit, the nudge and the
   *  nudge's restore cannot ask three subtly different questions. */
  private linkOpts(ctx: ToolContext, seed: number, to: MacroCoord, from: MacroCoord | null, offer: number): MacroOpts {
    return {
      seed, at: to,
      ...(from ? { from, offer } : {}),
      ...(armedMaterial(ctx) ? { material: armedMaterial(ctx) } : {}),
      width: ctx.brushSize, trim: ctx.autoEdgeCut,
    };
  }

  /** Land one road-link — synchronously without a build runner (tests, headless), else on the ordered
   *  off-thread chain, as `runApply` does for the aimed macros. `after` is handed the undo depth the
   *  run was laid OVER and the object ids standing before it, both of which are only knowable inside
   *  the chain: at queue time an earlier press may still be airborne. */
  private layLink(
    ctx: ToolContext, opts: MacroOpts,
    after: (outcome: MacroOutcome, watermark: number, before: ReadonlySet<string>) => void,
  ): void {
    if (!hasMacroBuildRunner()) {
      const watermark = ctx.getUndoStackSize();
      const before = new Set(ctx.gridState.objects.keys());
      after(applyMacro(ctx.macroContext, 'road-link', opts), watermark, before);
      return;
    }
    this.chain(async () => {
      const watermark = ctx.getUndoStackSize();
      const before = new Set(ctx.gridState.objects.keys());
      after(await applyMacroAsync(ctx.macroContext, 'road-link', opts), watermark, before);
    }, (outcome) => {
      // Read AFTER the run took its own work back: the depth and the objects standing are the ones
      // the caller's refusal path has to re-lay the standing route over.
      after(outcome, ctx.getUndoStackSize(), new Set(ctx.gridState.objects.keys()));
    });
  }

  /** THE COMMIT: lay the route between the two taps (`from` present), or the one tap's door spur
   *  (`from` null). A two-tap route leaves its ends on the map as marks; a door spur has no `from` a
   *  hand chose, so there is nothing to nudge and nothing is offered. */
  private runLink(ctx: ToolContext, to: MacroCoord, from: MacroCoord | null, offer: number): void {
    this.clearGhost(ctx);
    const seed = this.seed;
    this.seed += 1;
    this.layLink(ctx, this.linkOpts(ctx, seed, to, from, offer), (outcome, watermark, before) => {
      // A refusal names its OWN kind (no ground between the taps, a door with no way through, a
      // planting left standing, or the door already served) rather than the single generic line
      // every other macro's empty press shares.
      if (outcome.changes === 0) { showToast(ctx.t(EMPTY_KEY[outcome.code ?? 'no-route']), 'warning'); return; }
      narrateNeck(ctx, outcome);
      if (from) {
        this.openMarks(ctx, {
          from, to, offer, seed, watermark,
          offers: outcome.offers ?? [], cells: laidCells(ctx.gridState, before),
        });
      }
    });
  }

  /** Offer the route's two ends as marks. `this.route` is set AFTER the session opens, because opening
   *  closes any marks already standing and that close runs the previous route's `finalize`. */
  private openMarks(ctx: ToolContext, route: Omit<NudgeableRoute, 'epoch' | 'ctx'>): void {
    openRouteMarks(route.from, route.to, {
      preview: (from, to) => this.previewRelay(from, to),
      relay: (from, to) => this.relayRoute(from, to),
      finalize: () => {
        this.nudging = false;
        this.route?.ctx.overlay.clearGhost();
        this.route = null;
      },
    }, ctx.armingEpoch);
    this.route = { ...route, ctx: { ...ctx }, epoch: ctx.armingEpoch };
  }

  /** The ghost under a mark being dragged. It is drawn against the map AS IT STANDS, route included,
   *  so what it shows is the pavement the drop would ADD: the standing route is not taken back until
   *  the drop, and a preview that took it back would be an edit. */
  private previewRelay(from: MacroCoord, to: MacroCoord): void {
    const route = this.route;
    if (!route) return;
    const { ctx } = route;
    this.nudging = true;
    const token = ++this.ghostToken;
    const opts = this.linkOpts(ctx, route.seed, to, from, route.offer);
    void previewMacroAsync(ctx.macroContext, 'road-link', opts).then((preview) => {
      if (token !== this.ghostToken) return;
      const losses = [...preview.removed, ...preview.blocked];
      if (preview.added.length === 0 && losses.length === 0) ctx.overlay.clearGhost();
      else ctx.overlay.showGhost(preview.added, GHOST_CARD, true, undefined, losses);
    });
  }

  /**
   * THE NUDGE: take the standing route back and lay it again at the moved ends, as ONE undo entry.
   *
   * Restore-then-relay rather than patching the difference, exactly as a curve tweak is: a route
   * reuses pavement it finds, so laying the moved one over the old would leave the old line under it
   * and the two would read as a fork nobody drew.
   *
   * The depth having moved at all means the route is no longer the top entry, so there is something
   * newer to take back with it: the nudge is refused and the marks go instead. A CYCLE meets the same
   * check in `cycleRoute` and answers it by not being a cycle, since a tap that cannot cycle is still
   * a perfectly good tap.
   */
  private relayRoute(from: MacroCoord, to: MacroCoord): void {
    const route = this.route;
    if (!route) return;
    this.nudging = false;
    if (route.ctx.getUndoStackSize() !== route.watermark + 1) { this.dropRoute(); return; }
    route.ctx.overlay.clearGhost();
    this.relay(route, from, to, route.offer, false);
  }

  /**
   * RESTORE THEN RELAY, the one body a nudge (moved ends, same offer) and a cycle (same ends, next
   * offer) share. Whichever asked, the map ends up holding exactly one route under exactly one undo
   * entry, and a run that lays nothing puts the standing route back.
   *
   * `rollbackTo` rather than `undo`: it takes the stack back to a KNOWN depth instead of popping
   * whatever is on top, it leaves the redo stack alone, and it does not emit `history-applied` — the
   * one signal the marks read as "the visitor stepped through history", which their own relay must not
   * trip.
   *
   * `announce` names the offer that landed, which is a cycle's whole visible result: a nudge is its
   * own feedback (the line moved) and a cycle's line may differ only in where it bends.
   */
  private relay(
    route: NudgeableRoute, from: MacroCoord, to: MacroCoord, offer: number, announce: boolean,
  ): void {
    const { ctx } = route;
    ctx.rollbackTo(route.watermark);
    this.layLink(ctx, this.linkOpts(ctx, route.seed, to, from, offer), (outcome, watermark, before) => {
      if (ctx.getUndoStackSize() > watermark + 1) ctx.collapseHistory(watermark);
      if (outcome.changes > 0) {
        // The run CLAMPS an offer index into what it actually drafted, so what landed is named and
        // remembered by the run's own list rather than by the index this relay asked for.
        const offers = outcome.offers && outcome.offers.length > 0 ? outcome.offers : route.offers;
        const landed = Math.max(0, Math.min(offer, offers.length - 1));
        this.keepRoute(route, { from, to, offer: landed, offers, watermark, cells: laidCells(ctx.gridState, before) });
        if (announce) showToast(offerLine(ctx, landed, offers), 'info');
        // After the offer line, when there is one: a moved end or another way round can neck the
        // corridor where the route it replaced ran clear, so it is this landing's own news.
        narrateNeck(ctx, outcome);
        return;
      }
      showToast(ctx.t(EMPTY_KEY[outcome.code ?? 'no-route']), 'warning');
      // Nothing reached the map, so the route that stood is laid again at its own ends under its own
      // seed and its own offer over its own ground: the same four inputs, so the same route. It goes
      // back whether or not the marks are still there to describe it, since a refused nudge or cycle
      // must never be the press that deleted a route.
      this.layLink(ctx, this.linkOpts(ctx, route.seed, route.to, route.from, route.offer), (_again, mark, beforeAgain) => {
        if (ctx.getUndoStackSize() > mark + 1) ctx.collapseHistory(mark);
        this.keepRoute(route, { watermark: mark, cells: laidCells(ctx.gridState, beforeAgain) });
        resetRouteMarks(route.from, route.to);
      });
    });
  }

  /**
   * Escape and a nav TAP put mark 1 down. Nothing was laid, so there is nothing to undo and the macro
   * stays armed: this is abandoning a gesture, not disarming a tool.
   *
   * With no mark but THIS tool's route marks standing, Escape puts those away instead, exactly as it
   * dismisses the curve's handles: the route is real pavement by then and Escape is not an undo. So
   * the first Escape ends the moment and a second falls through to the disarm it has always done
   * (the disarm command in `kit/commands.ts`).
   */
  cancelPending(ctx: ToolContext): boolean {
    if (this.mark) {
      this.mark = null;
      this.clearGhost(ctx);
      return true;
    }
    if (this.route) { this.dropRoute(); return true; }
    return false;
  }

  /** Whether a gesture is standing. The pointer machine asks so a nav tap can end it: right-drag
   *  is the camera, and a right press that never moved is the one gesture the camera does not want. */
  hasPending(): boolean { return this.mark !== null; }

  /** `road-link`'s ghost key, self-contained: the map's versions, the seed, the standing mark (if
   *  any) and the bar's own knobs, so a re-sample of the same question at the same map costs a
   *  lookup rather than a run. */
  private linkGhostKey(ctx: ToolContext, coord: MacroCoord): string {
    const { cellsVersion = 0, objectsVersion = 0 } = ctx.gridState;
    const m = this.mark;
    return `road-link|${this.seed}|${m ? `${m.from.x},${m.from.y}` : '-'}|${armedMaterial(ctx) ?? '-'}|${ctx.brushSize}|${coord.x},${coord.y}|${cellsVersion}|${objectsVersion}`;
  }

  /** One planting at `cell`, seed advanced — a puff of the spray, or the whole of a click. The
   *  ground gate lives HERE because the clock's bursts fire off the spray's own stored ctx, not a
   *  fresh pointer event.
   *
   *  A burst on the spot the hold is resting on is the stand's NEXT year; a burst the pointer has
   *  carried clear of that spot re-anchors and starts a young one, which is what keeps a drag a band
   *  of plantings rather than a smear of old growth. The stage counts up without a ceiling here —
   *  `succession.ts` clamps it to the ladder, so a long hold settles rather than marching climax out
   *  to the rim. */
  private burst(cell: MacroCoord): void {
    const spray = this.spray;
    if (!spray) return;
    const { ctx } = spray;
    const ground = ctx.gridState.cells[cell.y]?.[cell.x];
    if (!ground || !isBuildableZone(ground.zone)) return;
    if (Math.hypot(cell.x - spray.anchor.x, cell.y - spray.anchor.y) >= SPRAY_STEP) {
      spray.anchor = cell;
      spray.stage = 0;
      // A new spot is a new press: the composition it may lay is drawn from the seed landing there,
      // and its ageing must not reach back into the stand the hold just left — the old stand joins
      // "everything else on the map" the moment the hold moves on.
      spray.anchorSeed = this.seed;
      spray.baseIds = new Set(ctx.gridState.objects.keys());
    }
    spray.stage += 1;
    spray.pending += 1;
    spray.last = cell;
    const heldIds = [...ctx.gridState.objects.keys()].filter((objId) => !spray.baseIds.has(objId));
    this.runApply(ctx, cell, spray.id, spray.stage, (outcome) => {
      spray.changes += outcome.changes;
      spray.pending -= 1;
      if (spray.done && spray.pending === 0) this.settleSpray(spray);
    }, spray.anchorSeed, heldIds);
  }

  /** The hold is over: once the last airborne burst lands, fold everything into ONE undo entry
   *  and report only a hold that grew nothing at all. */
  private finishSpray(): void {
    const spray = this.spray;
    if (!spray) return;
    this.spray = null;
    clearInterval(spray.timer);
    spray.done = true;
    if (spray.pending === 0) this.settleSpray(spray);
  }

  private settleSpray(spray: { watermark: number; changes: number; ctx: ToolContext }): void {
    const { ctx } = spray;
    if (ctx.getUndoStackSize() > spray.watermark + 1) ctx.collapseHistory(spray.watermark);
    if (spray.changes === 0) showToast(ctx.t('smart.empty'), 'warning');
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    // A mark drag is followed on the window, so these moves arrive here too — and the marks own the
    // pointer while one is held. Without this the hover ghost clears the nudge preview every frame.
    if (this.nudging) return;
    if (this.spray) {
      // The pointer aims the can; far enough from the last burst, the move itself sprays.
      this.spray.at = coord;
      const step = Math.hypot(coord.x - this.spray.last.x, coord.y - this.spray.last.y);
      if (step >= SPRAY_STEP && this.spray.pending === 0) this.burst(coord);
      return;
    }
    const id = this.armedNow(ctx);
    if (!id) { this.clearGhost(ctx); return; }
    // With no mark standing, road-link's ghost has nothing to ask about over bare ground — a route
    // needs a first tap, and a hovering pointer stays free until either that tap lands or the
    // pointer finds a building (gesture 2's pre-tap ghost, the door spur it would lay).
    if (id === 'road-link' && !this.mark && !buildingAt(ctx.gridState, coord)) { this.clearGhost(ctx); return; }
    // The map's versions are part of the question: an undo under a standing pointer changes the
    // answer at the same cell and seed.
    //
    // THE GHOST PREVIEWS THE SHORT PRESS, never the hold, for a planting or a single-press macro: no
    // stage rides in this key, so what is drawn is stage 1, what a click would lay. `road-link`'s own
    // key instead follows the standing MARK (`linkGhostKey`): with one down, the question is the
    // whole route to the pointer, which is exactly what the second tap commits.
    const { cellsVersion = 0, objectsVersion = 0 } = ctx.gridState;
    // Hand-enumerated to match the opts `pumpGhost` actually asks with (below): a field added to one
    // and not the other is a question the cache answers from a stale ghost instead of asking again.
    const key = id === 'road-link'
      ? this.linkGhostKey(ctx, coord)
      : `${id}|${this.seed}|${macroRadius(ctx)}|${coord.x},${coord.y}|${cellsVersion}|${objectsVersion}`;
    if (key === this.ghostKey) { this.wanted = null; return; }
    this.wanted = { coord, key };
    this.pumpGhost(ctx, id);
  }

  /** Ask the newest wanted cell, one preview in flight at a time. An answer draws, then pumps
   *  again if the pointer has moved on — the loop's own latency is the throttle. */
  private pumpGhost(ctx: ToolContext, id: MacroId): void {
    if (this.previewing) return;
    const ask = this.wanted;
    if (!ask) return;
    this.wanted = null;
    this.previewing = true;
    const token = ++this.ghostToken;
    const opts: MacroOpts = id === 'road-link'
      ? {
          seed: this.seed, at: ask.coord,
          ...(this.mark ? { from: this.mark.from, offer: COMMIT_OFFER } : {}),
          ...(armedMaterial(ctx) ? { material: armedMaterial(ctx) } : {}),
          width: ctx.brushSize,
        }
      : { seed: this.seed, at: ask.coord, radius: macroRadius(ctx) };
    void previewMacroAsync(ctx.macroContext, id, opts).then((preview) => {
      this.previewing = false;
      // The tool was put away, or the ghost cleared, while the answer was airborne.
      if (token !== this.ghostToken) return;
      this.ghostKey = ask.key;
      // An empty answer is an ANSWER — no coast to reach, no ground that would carry a planting —
      // so the ghost goes away rather than showing the last spot's shape at this one, UNLESS it
      // still has something to show as a LOSS (a run that only strips a coating).
      const losses = [...preview.removed, ...preview.blocked];
      if (preview.added.length === 0 && losses.length === 0) ctx.overlay.clearGhost();
      else ctx.overlay.showGhost(preview.added, GHOST_CARD, true, undefined, losses);
      this.pumpGhost(ctx, id);
    });
  }

  onPointerUp(_coord: MacroCoord, _micro: MicroCoord, _ctx: ToolContext): void {
    this.finishSpray();
  }

  onActivate(): void {
    this.seed = 1;
  }

  onDeactivate(ctx: ToolContext): void {
    // A hold the tool leaves mid-spray (Escape, a mode switch) still folds to one entry.
    this.finishSpray();
    // A road-link mark the tool leaves mid-gesture (a mode switch) is abandoned exactly as Escape
    // abandons it — nothing was laid, so there is nothing to undo. A route's marks go too: the tool
    // that would re-lay it is being put away.
    this.mark = null;
    this.dropRoute();
    this.clearGhost(ctx);
  }

  private clearGhost(ctx: ToolContext): void {
    this.wanted = null;
    this.ghostToken += 1;
    this.ghostKey = null;
    ctx.overlay.clearGhost();
  }
}

/** Whether a BUILDING stands at `coord` — a tap there, with no mark down, is gesture 2's whole
 *  gesture (one door spur) rather than the first mark of a route. */
function buildingAt(state: ToolContext['gridState'], coord: MacroCoord): boolean {
  const obj = objectAt(getObjectIndex(state), coord);
  return !!obj && categoryOf(obj) === ItemCategory.Building;
}

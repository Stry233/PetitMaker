/** Smart Build executes against a detached map, then replays accepted commands as one undo step. */
import { isInBounds } from '../../core/grid/rect';
import { hashJSON } from '../../core/base/hash';
import type { CategoryId, MacroCoord } from '../../core/model/types';
import { itemRole } from '../../state/catalog';
import { type AutoEdgeCut } from '../../state/editing/vocabulary';
import { ProvSource } from '../../core/provenance/types';
import { circleCells } from '../../core/grid/shapes';
import { layRoadLink } from './roads/road-link';
import type { MacroContext } from './context';
import { cellsChanged, objectsChanged } from './runtime/measure';
import { plantScopedPatch, type Planting } from './planting/patch';
import { raiseTerrain, type RaiseSteepness } from './terrain/raise';
import { layRoadNetwork } from './roads/roads';
import { runOnScratch, type ScratchRun } from './runtime/scratch';
import { mapFingerprint } from '../../core/model/fingerprint';
import { buildRiver } from './terrain/river';
import type { CurveAnchor } from '../../core/base/spline';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../core/game/profile';
import type { GridId } from '../../core/grid/grids';
import type { I18nKey } from '../../i18n/keys';

/** What the tools need to know about one macro. */
interface MacroSpec {
  /** The grid the macro's cells lie on. */
  grid: GridId;
  /** Builds where the user pointed; otherwise it works over the whole buildable region, which is
   *  why the shell offers a reroll for it. */
  aimed: boolean;
  /** A drag from a source to a target whose course stays adjustable as a curve once it lands. */
  adjustable: boolean;
  /** The refusal a drag reports when the run kept nothing and named no code of its own. */
  emptyCode: MacroRefusal;
  /** What to say when the macro ran and kept nothing. */
  emptyReason: string;
  /** What a planting card plants, or null for every other macro. Its lead names the object shelf tab
   *  whose card the macro is. */
  planting: Planting | null;
}

/** Available operations, including programmatic networks and category-specific planting. */
export const MACROS = {
  raise: { grid: TERRAIN_GRID, aimed: true, adjustable: false, emptyCode: 'terrain-blocked', emptyReason: 'no ground here would take a rise', planting: null },
  stream: { grid: TERRAIN_GRID, aimed: true, adjustable: true, emptyCode: 'river-blocked', emptyReason: 'no complete river can be built here', planting: null },
  'road-link': { grid: PLACEMENT_GRID, aimed: true, adjustable: true, emptyCode: 'no-route', emptyReason: 'no route could be planned between these points', planting: null },
  roads: { grid: PLACEMENT_GRID, aimed: false, adjustable: false, emptyCode: 'nothing-to-connect', emptyReason: 'nothing on the map to connect', planting: null },
  'patch-tree': { grid: PLACEMENT_GRID, aimed: true, adjustable: false, emptyCode: 'terrain-blocked', emptyReason: 'no ground here would take a planting', planting: { lead: 'canopy', floor: 'groundcover' } },
  'patch-flora': { grid: PLACEMENT_GRID, aimed: true, adjustable: false, emptyCode: 'terrain-blocked', emptyReason: 'no ground here would take a planting', planting: { lead: 'groundcover' } },
} as const satisfies Record<string, MacroSpec>;

export type MacroId = keyof typeof MACROS;
export const MACRO_IDS = Object.keys(MACROS) as readonly MacroId[];

/** The macro whose card stands in the object shelf tab of `category`: the planting led by the role
 *  that category plays, or null. */
export function macroForShelfCategory(category: CategoryId): MacroId | null {
  const role = itemRole({ category });
  return role === undefined ? null : MACRO_IDS.find((id) => plantingOf(id)?.lead === role) ?? null;
}

/** The macros the object shelf offers as cards. */
export const SHELF_MACRO_IDS: readonly MacroId[] = MACRO_IDS.filter((id) => plantingOf(id) !== null);

/** What a planting card plants, or null for every other macro. */
export function plantingOf(id: MacroId): Planting | null {
  return MACROS[id].planting;
}

/** What every macro's options carry. */
interface CommonOpts {
  seed: number;
  /** Target cell: the aim point of an aimed macro, the destination for road and river drags. */
  at?: MacroCoord;
  /** Editable region, including terrain support and road crossings. */
  region?: MacroCoord[];
  /** Corner treatment from the active Auto Trim setting. */
  trim?: AutoEdgeCut;
}

/** A press that grows under a hold: a raise or a planting. */
interface HeldOpts extends CommonOpts {
  radius?: number;
  /** How many bursts of one held press have landed at this spot. For a planting that is the
   *  stand's age (`succession.ts`); for a raise it is the rung of the ladder (`raise.ts:ladderPeak`).
   *  1, or absent, is a short press. */
  stage?: number;
  /** The seed of the first burst of the hold this press belongs to. What belongs to the hold rather
   *  than to the burst (a planting's composition, a raise's outline) is drawn from it rather than
   *  from `seed`, so one hold lays one of them however many bursts it fires. Absent on a short press,
   *  where the press's own seed is the hold's. */
  anchorSeed?: number;
}

interface RaiseOpts extends HeldOpts {
  /** Which step kind to terrace with. The bar's own setting; `'wide'` when absent, since a press
   *  whose steepness nobody chose should be the one a person can walk up. */
  steepness?: RaiseSteepness;
  /** The level the hold measured at its anchor (`raise.ts:raiseFooting`), which every burst of that
   *  hold builds from. A hold must pass it and a tap need not: by the second burst the ground under
   *  the disc is the mound itself, and a footing re-read then climbs with the mass. It resets on
   *  re-anchor, alongside `heldCells`. */
  footing?: number;
  /** The flat indices every earlier burst of this hold raised: a later burst grows only these and
   *  bare ground, never a hand-built mountain or an earlier knuckle of the same drag. A plain array
   *  (never a `Set`): this crosses the worker boundary as job data. It resets on re-anchor. */
  heldCells?: readonly number[];
}

interface PlantingOpts extends HeldOpts {
  /** The ids every earlier burst of this hold planted and left standing: a later burst ages only
   *  these (see `succession.ts`), never a hand-placed plant or another press's stand. A plain array
   *  (never a `Set`): this crosses the worker boundary as job data. Absent on a short press, which
   *  ages nothing regardless. */
  heldIds?: readonly string[];
}

/** A drag from a source to a target. A river or road link without `from` builds nothing, and a run
 *  given `from` replays atomically. */
interface CourseOpts extends CommonOpts {
  from?: MacroCoord;
  /** Channel or road width in cells; 1 when absent. */
  width?: number;
}

interface StreamOpts extends CourseOpts {
  /** Adjustable river guide, in terrain cells. */
  anchors?: CurveAnchor[];
}

interface RoadLinkOpts extends CourseOpts {
  /** The catalog id of the surface to lay. */
  material?: string;
  /** Which drafted offer to lay, clamped into range. 0 when absent. */
  offer?: number;
}

interface RoadsOpts extends CommonOpts {
  /** The catalog id of the surface to lay. */
  material?: string;
  /** Road width in cells; 1 when absent. */
  width?: number;
  /** The ids an earlier press of this gesture laid, which this one may take back before laying its
   *  own (see `roads.ts:RoadNetworkInput.replace`). A plain array, never a `Set`: this crosses the
   *  worker boundary as job data. Absent is a first press, which takes nothing back. */
  replace?: readonly string[];
}

/** Each macro's options. */
export interface MacroOptsById {
  raise: RaiseOpts;
  stream: StreamOpts;
  'road-link': RoadLinkOpts;
  roads: RoadsOpts;
  'patch-tree': PlantingOpts;
  'patch-flora': PlantingOpts;
}

/** The options of macro `K`; of any macro when `K` is left open. */
export type MacroOpts<K extends MacroId = MacroId> = MacroOptsById[K];

/** One macro and its options, as one value a switch on `id` narrows. */
type MacroRequest = { [K in MacroId]: { id: K; opts: MacroOptsById[K] } }[MacroId];

/** The request for `id` and `opts`. TypeScript cannot correlate a generic id with its options, so
 *  this is the one place the pair is asserted to belong together. */
function requestOf<K extends MacroId>(id: K, opts: MacroOpts<K>): MacroRequest {
  return { id, opts } as MacroRequest;
}

/**
 * What a macro has to say beyond what it built. Never localized here: a macro that spoke to the
 * user could only ever have one caller. `code` is what the shell narrates from, `reason` is what
 * the agent reads, and they are two audiences rather than two truths.
 */
export interface MacroReport {
  ends?: [MacroCoord, MacroCoord];
  reason?: string;
  code?: MacroRefusal;
  /** Where the report stands, when it is about one place: the door a spur could not reach. A toast
   *  that says "somewhere on this map" about a specific doorway is not a report. */
  at?: MacroCoord;
  /** Cells the run needed and a hand-placed decoration holds. Nothing here is removed: the ghost marks
   *  them, and the refusal is the whole of what the run does about them. */
  blocked?: MacroCoord[];
  /** How many cells a wide road's corridor lost to a standing planting it went around rather than
   *  removed. Present only above width 1, where it is the normal outcome rather than a corner: the
   *  road necks, and the caller is the only one that can say so. */
  narrowedByPlanting?: number;
  /** The profiles this run drafted between the endpoints, in offer order. The tool names them. */
  offers?: readonly string[];
  /** roads: everything this gesture's work now amounts to, for the caller to hand to the next
   *  press. Absent means the run had nothing to say about ownership, never "it owns nothing". */
  ownedIds?: readonly string[];
  /** The tier the ground under an aimed raise could carry, which is at or below the rung asked for.
   *  A hold reads it to know the ladder has topped out. */
  peak?: number;
}

export type MacroRefusal =
  | 'terrain-blocked'
  | 'river-blocked'
  | 'nothing-to-connect'    // no building or structure on open ground
  | 'no-route'              // ends found, no ground between them
  | 'already-connected'     // every building here already meets the network: this is the plan
  | 'unjoined'              // the pavement could not be made one piece, so none was kept
  | 'door-unreachable'      // this doorway has no way through
  | 'unrouted'              // doorsteps found, but no open ground routes between them
  | 'stranded'              // a network was laid, and this building stands where it cannot reach
  | 'blocked';              // a planting holds a cell the route needed, and it was left standing

/** The one toast key for each refusal a macro can report, so every tool that narrates a refusal
 *  agrees about what a code means. Never localized here (see `MacroReport`'s own header): the caller narrates. */
export const EMPTY_KEY: Record<MacroRefusal, I18nKey> = {
  'terrain-blocked': 'smart.terrain_blocked',
  'river-blocked': 'smart.river_blocked',
  'already-connected': 'smart.roads_settled',
  'no-route': 'smart.empty_link',
  unjoined: 'smart.unjoined',
  'door-unreachable': 'smart.no_door',
  unrouted: 'smart.unrouted',
  stranded: 'smart.stranded',
  blocked: 'smart.blocked',
  'nothing-to-connect': 'smart.empty_roads',
};

/** A run's result: its report, and what it changed. */
export interface MacroOutcome extends MacroReport {
  /** Cells plus objects the macro actually changed, measured off the map after the commit. Zero is
   *  a result, not a failure. */
  changes: number;
}

const DEFAULT_RADIUS = 6;
/** How densely a planting press fills its disc. */
const PLANTING_DENSITY = 0.6;

/** The radius a raise or a planting works over. Other macros carry none and read the default. */
function heldRadius(opts: MacroOpts): number {
  return Math.max(0, ('radius' in opts ? opts.radius : undefined) ?? DEFAULT_RADIUS);
}

/** The disc an aim macro works over, clamped to the map. Off-map cells would index the analysis
 *  grid at coordinates that belong to another row. */
function aimedCells(ctx: MacroContext, at: MacroCoord, radius: number): MacroCoord[] {
  const { width, height } = ctx.state.template;
  return circleCells(at, radius, radius).filter((c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height);
}

/**
 * The design a macro runs, as a function over whatever context it is handed. `buildMacroRun` runs
 * it on a clone for the press, the worker and the preview alike, so a preview is never a picture
 * of something the press does not do.
 *
 * `report` is how the road adapters say more than "how much changed" — why they laid nothing, or
 * what else the run drafted; a preview ignores it.
 */
function buildMacro(
  request: MacroRequest,
  report?: (r: MacroReport) => void,
): ((scratch: MacroContext) => void) | null {
  const at = request.opts.at;
  if (MACROS[request.id].aimed && !at) return null;

  return (scratch: MacroContext): void => {
    switch (request.id) {
      case 'raise': {
        const opts = request.opts, radius = heldRadius(opts);
        const out = raiseTerrain(scratch, {
          at: at!, radius, stage: opts.stage ?? 1, steepness: opts.steepness ?? 'wide',
          held: new Set(opts.heldCells ?? []),
          // The outline is the hold's, like a planting's composition: drawn from the anchor's seed
          // where there is one, so a mound climbing under a held press keeps the rim it started
          // with instead of spreading a new lump per burst.
          seed: opts.anchorSeed ?? opts.seed,
          region: opts.region, trim: opts.trim, footing: opts.footing,
        });
        report?.({
          ...(out.blocked.length > 0 ? { blocked: out.blocked, code: 'blocked' as const } : {}),
          peak: out.peak,
        });
        return;
      }
      case 'stream': {
        const opts = request.opts;
        if (opts.from) {
          const result = buildRiver(scratch, { from: opts.from, to: at!, width: opts.width ?? 1, anchors: opts.anchors, region: opts.region, trim: opts.trim });
          report?.(result);
        }
        return;
      }
      case 'patch-tree':
      case 'patch-flora': {
        const opts = request.opts, radius = heldRadius(opts);
        const cells = aimedCells(scratch, at!, radius);
        if (cells.length === 0) return;
        plantScopedPatch(scratch, {
          cells, density: PLANTING_DENSITY, seed: opts.seed, radius,
          ...(opts.stage ? { stage: opts.stage } : {}),
          anchorSeed: opts.anchorSeed,
          ...(opts.heldIds && opts.heldIds.length > 0 ? { heldIds: new Set(opts.heldIds) } : {}),
        }, plantingOf(request.id)!);
        return;
      }
      case 'roads': {
        const opts = request.opts;
        const routed = layRoadNetwork(scratch, {
          seed: opts.seed, material: opts.material, region: opts.region, trim: opts.trim, replace: opts.replace,
          ...(opts.width ? { width: opts.width } : {}),
        });
        // Always reported, unlike the refusals beside it: the caller needs the id list back from
        // every run, including the ones with nothing to complain about.
        report?.({
          ownedIds: routed.ownedIds,
          ...(routed.reason ? { reason: routed.reason } : {}),
          ...(routed.code ? { code: routed.code } : {}),
          ...(routed.at ? { at: routed.at } : {}),
          ...(routed.narrowedByPlanting ? { narrowedByPlanting: routed.narrowedByPlanting } : {}),
        });
        return;
      }
      case 'road-link': {
        const opts = request.opts;
        // A route needs both ends; without a start point there is nothing to plan.
        if (!opts.from) { report?.({ code: 'no-route' }); return; }
        const { report: rpt } = layRoadLink(scratch, {
          seed: opts.seed, to: at!, from: opts.from, offer: opts.offer, material: opts.material, region: opts.region, trim: opts.trim,
          ...(opts.width ? { width: opts.width } : {}),
        });
        report?.(rpt);
        return;
      }
    }
  };
}

/** The guard failures a macro can answer without building anything. Shared by the sync apply and
 *  the worker path, so an off-map press never costs a worker round trip. */
function guardMacro(ctx: MacroContext, id: MacroId, opts: MacroOpts): MacroOutcome | null {
  const at = opts.at;
  if (MACROS[id].aimed && !at) return { changes: 0, reason: `${id} needs an aim point` };

  if (plantingOf(id)) {
    if (aimedCells(ctx, at!, heldRadius(opts)).length === 0) return { changes: 0, reason: 'the aim point is off the map' };
  } else if (at) {
    const { width, height } = ctx.state.template;
    if (!isInBounds(at.x, at.y, width, height)) return { changes: 0, reason: 'the aim point is off the map' };
  }
  return null;
}

/** A macro's scratch run and what the road adapter reported, ready to be landed. */
export interface MacroBuild {
  run: ScratchRun;
  report?: MacroReport | undefined;
}

/** The build half of `applyMacro`, on whatever state it is handed: the design run on a scratch
 *  copy, nothing touched. This is what the worker executes; `applyMacro` runs the same body
 *  in-process. Null when the macro has nothing to build (guards). */
export function buildMacroRun<K extends MacroId>(ctx: MacroContext, id: K, opts: MacroOpts<K>): MacroBuild | null {
  let report: MacroReport | undefined;
  const build = buildMacro(requestOf(id, opts), (r) => { report = r; });
  if (!build) return null;
  return { run: runOnScratch(ctx, build), report };
}

/**
 * The landing half of `applyMacro`: replay a build's accepted commands on the live map inside one
 * silenced stroke group, with the macro's provenance around it. Null when the build's base no
 * longer matches the live map — the caller's cue to build again, never to land a stale answer.
 *
 * `trustBase` skips the fingerprint compare: a caller that has proved the map unchanged (the
 * version counters have not moved since the state was handed to the builder) already knows the
 * answer, and the whole-map hash is the landing's single largest cost. The commands are still
 * validated one by one either way.
 */
export function landMacroRun(
  ctx: MacroContext, id: MacroId, opts: MacroOpts, built: MacroBuild,
  { trustBase = false }: { trustBase?: boolean } = {},
): MacroOutcome | null {
  const { executor } = ctx;
  if (!trustBase && mapFingerprint(ctx.state) !== built.run.base) return null;
  const atomic = 'from' in opts && opts.from !== undefined;
  const countCells = cellsChanged(ctx.state, atomic);
  const countObjects = objectsChanged(ctx.state);
  const source = {
    source: ProvSource.Procedural,
    tool: `macro:${id}`,
    procedural: { seed: opts.seed, algorithm: id, configHash: hashJSON(opts) },
  };
  return executor.transaction({ source }, (tx): MacroOutcome => {
    let landed = true;
    executor.transaction({ silent: true }, () => {
      for (const cmd of built.run.commands) {
        if (!executor.execute(cmd).success && atomic) { landed = false; break; }
      }
    });
    if (!landed) {
      tx.rollback();
      return { changes: 0, reason: 'the complete build could not be replayed', code: built.report?.code ?? 'blocked' };
    }
    const violations = tx.commit({ atomic });
    const changes = countCells() + countObjects();
    const report = built.report;
    const narrated: Pick<MacroOutcome, 'code' | 'at' | 'blocked' | 'narrowedByPlanting' | 'offers' | 'ownedIds' | 'peak' | 'ends'> = {
      ...(report?.ends ? { ends: report.ends } : {}),
      ...(report?.code ? { code: report.code } : {}),
      ...(report?.at ? { at: report.at } : {}),
      ...(report?.blocked && report.blocked.length > 0 ? { blocked: report.blocked } : {}),
      ...(report?.narrowedByPlanting ? { narrowedByPlanting: report.narrowedByPlanting } : {}),
      ...(report?.offers && report.offers.length > 0 ? { offers: report.offers } : {}),
      ...(report?.ownedIds ? { ownedIds: report.ownedIds } : {}),
      peak: report?.peak,
    };
    if (violations.length > 0) {
      return { changes, reason: changes === 0 ? 'post-stroke rules rolled the run back' : 'post-stroke rules rolled part of the run back', ...narrated };
    }
    return changes === 0
      ? { changes: 0, reason: report?.reason ?? MACROS[id].emptyReason, ...narrated }
      : { changes, ...narrated };
  });
}

/** What an off-thread runner rejects with when it can no longer answer at all (its worker
 *  pool is gone). Only this retires a runner; any other rejection is one failed job, which this call
 *  answers in-process while the runner stays for the next. */
export class MacroRunnerUnavailable extends Error {}

/** Clears `retire` when `err` says the runner can no longer answer. */
export function retireOn(err: unknown, retire: () => void): void {
  if (err instanceof MacroRunnerUnavailable) retire();
}

/** Whether presses on `ctx` can build off-thread (`MacroContext.offThread`): what the tool forks its
 *  sync/async plumbing on. */
export function hasMacroBuildRunner(ctx: MacroContext): boolean { return !!ctx.offThread?.build; }

/** Build without landing, so a gesture can cancel an outstanding worker request. */
export async function prepareMacro<K extends MacroId>(ctx: MacroContext, id: K, opts: MacroOpts<K>): Promise<MacroBuild | null> {
  const port = ctx.offThread;
  if (port?.build) {
    try {
      const built = await port.build(ctx.state, id, opts, ctx.registry);
      if (built) return built;
    } catch (err) { retireOn(err, () => { port.build = null; }); }
  }
  return buildMacroRun(ctx, id, opts);
}

/** `applyMacro`, with the expensive build off-thread when `ctx` carries a runner. Without one the whole
 *  body runs synchronously before the returned promise settles, so the no-worker path (tests, headless)
 *  behaves exactly as the synchronous call does. */
export async function applyMacroAsync<K extends MacroId>(ctx: MacroContext, id: K, opts: MacroOpts<K>): Promise<MacroOutcome> {
  const guarded = guardMacro(ctx, id, opts);
  if (guarded) return guarded;
  const port = ctx.offThread;
  if (port?.build) {
    const cv = ctx.state.cellsVersion;
    const ov = ctx.state.objectsVersion;
    const ignoreLoad = !!ctx.state.ignoreChunkLoad;
    let built: MacroBuild | null;
    // Only the build is guarded, and only an unavailable runner retires. The landing below stays
    // outside the guard: it runs on the main thread against the live map, and it rethrows after
    // rolling itself back (`landMacroRun`), so catching it here would read a rule or executor fault
    // as a failed build and re-run the whole macro in-process on the way past.
    try {
      built = await port.build(ctx.state, id, opts, ctx.registry);
    } catch (err) {
      retireOn(err, () => { port.build = null; });
      built = null;
    }
    if (built) {
      // Version counters unmoved since the state left for the builder ⇒ the map is the map the
      // build ran over, and the fingerprint compare has nothing left to ask.
      const trustBase = ctx.state.cellsVersion === cv && ctx.state.objectsVersion === ov && !!ctx.state.ignoreChunkLoad === ignoreLoad;
      const landed = landMacroRun(ctx, id, opts, built, { trustBase });
      if (landed) return landed;
      // Stale base: the map moved while the worker built. Rebuild in-process below.
    }
  }
  return applyMacro(ctx, id, opts);
}

export function applyMacro<K extends MacroId>(ctx: MacroContext, id: K, opts: MacroOpts<K>): MacroOutcome {
  const guarded = guardMacro(ctx, id, opts);
  if (guarded) return guarded;
  const built = buildMacroRun(ctx, id, opts);
  if (!built) return { changes: 0, reason: `${id} needs an aim point` };
  // Built on this map in this tick, so the base matches and the landing never refuses.
  return landMacroRun(ctx, id, opts, built, { trustBase: true })!;
}

/** Smart Build executes against a detached map, then replays accepted commands as one undo step. */
import { isInBounds } from '../../core/model/grid-model';
import { hashJSON } from '../../core/model/hash';
import type { AutoEdgeCut, GridState, ItemCategory, MacroCoord } from '../../core/model/types';
import { ProvSource } from '../../core/provenance/types';
import { circleCells } from '../paint/shapes';
import { layRoadLink } from './road-link';
import type { MacroContext } from './context';
import { cellsChanged, objectsChanged } from './measure';
import { plantPatchTiers, plantScopedPatch, type PatchScope } from './patch';
import { raiseTerrain, type RaiseSteepness } from './raise';
import { layRoadNetwork } from './roads';
import { detachCommand, mapFingerprint, runOnScratch, type ScratchRun } from './scratch';
import { carveStream } from './stream';
import { fillMountainArea } from './landform';
import { buildRiver } from './river';
import type { CurveAnchor } from '../../core/model/spline';

/** Available operations, including programmatic networks and category-specific planting. */
export const MACRO_IDS = ['raise', 'stream', 'road-link', 'roads', 'patch-tree', 'patch-flora'] as const;

export type MacroId = (typeof MACRO_IDS)[number];

/** Which of the two planting cards a macro id names, or null for every other macro. Exported so
 *  `macro-tool.ts` can gate the held spray on "is this id one of the planting cards" without
 *  hardcoding either one of them. */
export function patchScope(id: MacroId): PatchScope | null {
  if (id === 'patch-tree') return 'tree';
  if (id === 'patch-flora') return 'flora';
  return null;
}

export interface MacroOpts {
  seed: number;
  /** Mountain fill: the complete connected area, captured before the stroke. */
  area?: MacroCoord[];
  elevation?: number;
  /** Adjustable river guide, in terrain cells. */
  anchors?: CurveAnchor[];
  /** Target cell; the destination for road and river drags. */
  at?: MacroCoord;
  radius?: number;
  density?: number;
  /** roads/road-link: the catalog id of the surface to lay. */
  material?: string;
  /** Road or river channel width in cells; 1 when absent. */
  width?: number;
  /** Road or river source. A road with only `at` retains the programmatic door-spur operation. */
  from?: MacroCoord;
  /** road-link: which drafted offer to lay, clamped into range. 0 when absent. */
  offer?: number;
  /** Editable region, including terrain support and road crossings. */
  region?: MacroCoord[];
  /** Corner treatment from the active Auto Trim setting. */
  trim?: AutoEdgeCut;
  /** roads: the ids an EARLIER press of this gesture laid, which this one may take back before
   *  laying its own (see `roads.ts:RoadNetworkInput.replace`). A plain array, never a `Set`: this
   *  crosses the worker boundary as job data. Absent is a first press, which takes nothing back. */
  replace?: readonly string[];
  /** patch-tree/patch-flora: an explicit override of the id's own category scope — a bare filter,
   *  for a caller that isn't one of the shelf's two cards. The id's own scope when absent. */
  categories?: readonly ItemCategory[];
  /** patch-tree/patch-flora/raise: how many bursts of one HELD press have landed at this spot. For
   *  a planting that is the stand's AGE (`succession.ts`); for a raise it is the RUNG of the ladder
   *  (`raise.ts:ladderPeak`). 1, or absent, is a short press. Ignored on the planting's
   *  `categories` override path, which is a bare filter for a caller outside the shelf and has no
   *  hold behind it. */
  stage?: number;
  /** raise: which step kind to terrace with. The bar's own setting; `'wide'` when absent, since a
   *  press whose steepness nobody chose should be the one a person can walk up. */
  steepness?: RaiseSteepness;
  /** raise: the level the hold measured at its ANCHOR (`raise.ts:raiseFooting`), which every burst
   *  of that hold builds from. A hold MUST pass it and a tap need not: by the second burst the
   *  ground under the disc is the mound itself, and a footing re-read then climbs with the mass. It
   *  resets on re-anchor, alongside `heldCells`. */
  footing?: number;
  /** raise: the FLAT INDICES every earlier burst of this hold raised — a later burst grows only
   *  these and bare ground, never a hand-built mountain or an earlier knuckle of the same drag. A
   *  plain array (never a `Set`): this crosses the worker boundary as job data. The cell-shaped twin
   *  of `heldIds`, and it resets on re-anchor for the same reason. */
  heldCells?: readonly number[];
  /** patch-tree/patch-flora: the seed of the FIRST burst of the hold this press belongs to. A
   *  COMPOSITION — a garden-grammar bed, a rare delight — is drawn from it rather than from `seed`,
   *  so one hold lays one of them however many bursts it fires. Absent on a short press, where the
   *  press's own seed IS the hold's. */
  anchorSeed?: number;
  /** patch-tree/patch-flora: the ids every EARLIER burst of this hold planted and left standing —
   *  a later burst ages only these (see `succession.ts`), never a hand-placed plant or another
   *  press's stand. A plain array (never a `Set`): this crosses the worker boundary as job data.
   *  Absent on a short press, which ages nothing regardless. */
  heldIds?: readonly string[];
}

/**
 * WHAT A MACRO HAS TO SAY BEYOND WHAT IT BUILT. Never localized here: a macro that spoke to the
 * user could only ever have one caller. `code` is what the shell narrates from, `reason` is what
 * the agent reads, and they are two audiences rather than two truths.
 */
export interface MacroReport {
  ends?: [MacroCoord, MacroCoord];
  reason?: string;
  code?: MacroRefusal;
  /** Where the report stands, when it is about ONE place: the door a spur could not reach. A toast
   *  that says "somewhere on this map" about a specific doorway is not a report. */
  at?: MacroCoord;
  /** Cells the run NEEDED and a hand-placed decoration holds. Nothing here is removed: the ghost marks
   *  them, and the refusal is the whole of what the run does about them. */
  blocked?: MacroCoord[];
  /** How many cells a WIDE road's corridor lost to a standing planting it went around rather than
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
  | 'already-connected'     // every building here already meets the network: THIS is the plan
  | 'unjoined'              // gesture 1: the pavement could not be made one piece, so none was kept
  | 'door-unreachable'      // gesture 2: this doorway has no way through
  | 'unrouted'              // gesture 3: doorsteps found, but no open ground routes between them
  | 'stranded'              // gesture 3: a network WAS laid, and this building stands where it cannot reach
  | 'blocked';              // a planting holds a cell the route needed, and it was left standing

/** The one toast key for each refusal a road macro can report, so the whole-map press
 *  (`SmartBuild.tsx`) and the drag tool (`macro-tool.ts`) never disagree about what a code
 *  means. Never localized here (see `MacroReport`'s own header): the caller narrates. */
export const EMPTY_KEY: Record<MacroRefusal, string> = {
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

export interface MacroOutcome {
  ends?: [MacroCoord, MacroCoord];
  /** Cells plus objects the macro actually changed, measured off the map after the commit. Zero is
   *  a result, not a failure. */
  changes: number;
  /** Why nothing happened, or why less happened than was asked for. Data for the caller to narrate;
   *  never localized here, since a macro that spoke to the user could only ever have one caller. */
  reason?: string;
  /** road-link: which refusal this is, for a shell that narrates by kind rather than by sentence. */
  code?: MacroRefusal;
  /** road-link: where the refusal stands, when it is about one place (the door a spur could not
   *  reach). */
  at?: MacroCoord;
  /** road-link: cells the run needed and a hand-placed decoration holds, left standing. */
  blocked?: MacroCoord[];
  /** roads/road-link: how many cells a wide road's corridor lost to a planting it went round. */
  narrowedByPlanting?: number;
  /** road-link: the offers this run drafted between the endpoints, in offer order. */
  offers?: readonly string[];
  /** roads: everything this gesture's work now amounts to. The caller keeps it and hands it back on
   *  the next press, which is what makes a re-press a candidate rather than an addition. */
  ownedIds?: readonly string[];
  /** raise: the tier the ground carried, at or below the rung this press asked for. */
  peak?: number;
}

const DEFAULT_RADIUS = 6;
const DEFAULT_DENSITY = 0.6;

/** The macros that build where the user pointed. `roads` is the one that works over the whole
 *  buildable region instead, which is why it is the one the shell offers a reroll for. */
const AIMED: ReadonlySet<MacroId> = new Set<MacroId>(['raise', 'stream', 'road-link', 'patch-tree', 'patch-flora']);

/** What to say when the macro ran and kept nothing. */
const EMPTY_REASON: Record<MacroId, string> = {
  raise: 'no ground here would take a rise',
  stream: 'no complete river can be built here',
  'patch-tree': 'no ground here would take a planting',
  'patch-flora': 'no ground here would take a planting',
  'road-link': 'no route could be planned between these points',
  roads: 'nothing on the map to connect',
};

/** The disc an aim macro works over, clamped to the map. Off-map cells would index the analysis
 *  grid at coordinates that belong to another row. */
function aimedCells(ctx: MacroContext, at: MacroCoord, radius: number): MacroCoord[] {
  const { width, height } = ctx.state.template;
  return circleCells(at, radius, radius).filter((c) => c.x >= 0 && c.y >= 0 && c.x < width && c.y < height);
}

/**
 * The DESIGN a macro runs, as a function over whatever context it is handed.
 *
 * Exported because two callers need the same one and a second copy would drift: `applyMacro` runs
 * it on a clone and replays the result, and `preview.ts` runs it on a clone and reads the cells
 * without replaying anything. A preview that ran a different builder would be a picture of
 * something the press does not do.
 *
 * `report` is how the road adapters say more than "how much changed" — why they laid nothing, or
 * what else the run drafted; a preview ignores it.
 */
export function buildMacro(
  id: MacroId,
  opts: MacroOpts,
  report?: (r: MacroReport) => void,
): ((scratch: MacroContext) => void) | null {
  const radius = Math.max(0, opts.radius ?? DEFAULT_RADIUS);
  const density = opts.density ?? DEFAULT_DENSITY;
  const at = opts.at;
  if (AIMED.has(id) && !at) return null;

  let cells: MacroCoord[] | null = null;
  const scope = patchScope(id);
  if (scope && opts.categories && opts.categories.length === 0) return null;

  return (scratch: MacroContext): void => {
    if (scope) {
      cells = aimedCells(scratch, at!, radius);
      if (cells.length === 0) return;
    }
    switch (id) {
      case 'raise': {
        if (opts.area) {
          const result = fillMountainArea(scratch, { area: opts.area, elevation: opts.elevation ?? 1, region: opts.region, trim: opts.trim });
          report?.(result);
          return;
        }
        const out = raiseTerrain(scratch, {
          at: at!, radius, stage: opts.stage ?? 1, steepness: opts.steepness ?? 'wide',
          held: new Set(opts.heldCells ?? []),
          // The OUTLINE is the hold's, like a planting's composition: drawn from the anchor's seed
          // where there is one, so a mound climbing under a held press keeps the rim it started
          // with instead of spreading a new lump per burst.
          seed: opts.anchorSeed ?? opts.seed,
          region: opts.region, trim: opts.trim,
          ...(opts.footing !== undefined ? { footing: opts.footing } : {}),
        });
        report?.({
          ...(out.blocked.length > 0 ? { blocked: out.blocked, code: 'blocked' as const } : {}),
          peak: out.peak,
        });
        return;
      }
      case 'stream':
        if (opts.from) {
          const result = buildRiver(scratch, { from: opts.from, to: at!, width: opts.width ?? 1, anchors: opts.anchors, region: opts.region, trim: opts.trim });
          report?.(result);
        }
        else carveStream(scratch, { at: at!, radius, seed: opts.seed });
        return;
      case 'patch-tree':
      case 'patch-flora':
        // Per-tier planting over ONE shared analysis — see `plantPatchTiers`. An explicit
        // `opts.categories` overrides the card's own scope with a bare filter (a caller outside
        // the shelf's two cards); absent, the id's own scope decides (`plantScopedPatch`).
        if (opts.categories) plantPatchTiers(scratch, { cells: cells!, density, seed: opts.seed, categories: opts.categories });
        else {
          plantScopedPatch(scratch, {
            cells: cells!, density, seed: opts.seed, radius,
            ...(opts.stage ? { stage: opts.stage } : {}),
            ...(opts.anchorSeed !== undefined ? { anchorSeed: opts.anchorSeed } : {}),
            ...(opts.heldIds && opts.heldIds.length > 0 ? { heldIds: new Set(opts.heldIds) } : {}),
          }, scope!);
        }
        return;
      case 'roads': {
        const routed = layRoadNetwork(scratch, {
          seed: opts.seed,
          ...(opts.material ? { material: opts.material } : {}),
          ...(opts.width ? { width: opts.width } : {}),
          ...(opts.region ? { region: opts.region } : {}),
          ...(opts.trim ? { trim: opts.trim } : {}),
          ...(opts.replace ? { replace: opts.replace } : {}),
        });
        // ALWAYS reported, unlike the refusals beside it: the caller needs the id list back from
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
        const { report: rpt } = layRoadLink(scratch, {
          seed: opts.seed, to: at!,
          ...(opts.from ? { from: opts.from } : {}),
          ...(opts.offer !== undefined ? { offer: opts.offer } : {}),
          ...(opts.material ? { material: opts.material } : {}),
          ...(opts.width ? { width: opts.width } : {}),
          ...(opts.region ? { region: opts.region } : {}),
          ...(opts.trim ? { trim: opts.trim } : {}),
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
  const radius = Math.max(0, opts.radius ?? DEFAULT_RADIUS);
  const at = opts.at;
  if (AIMED.has(id) && !at) return { changes: 0, reason: `${id} needs an aim point` };

  if (patchScope(id)) {
    // An empty list is a refusal, not the absence of a restriction: `placeNature` reads it as "no
    // category may be planted", and reading it as "both" instead would plant a forest for a caller
    // whose category list came out empty by accident.
    if (opts.categories && opts.categories.length === 0) return { changes: 0, reason: 'no category was left to plant' };
    if (aimedCells(ctx, at!, radius).length === 0) return { changes: 0, reason: 'the aim point is off the map' };
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

/** The BUILD half of `applyMacro`, on whatever state it is handed: the design run on a scratch
 *  copy, nothing touched. This is what the worker executes; `applyMacro` runs the same body
 *  in-process. Null when the macro has nothing to build (guards). */
export function buildMacroRun(ctx: MacroContext, id: MacroId, opts: MacroOpts): MacroBuild | null {
  let report: MacroReport | undefined;
  const build = buildMacro(id, opts, (r) => { report = r; });
  if (!build) return null;
  return { run: runOnScratch(ctx, build), report };
}

/**
 * The LANDING half of `applyMacro`: replay a build's accepted commands on the live map inside one
 * silenced stroke group, with the macro's provenance around it. Null when the build's base no
 * longer matches the live map — the caller's cue to build again, never to land a stale answer.
 *
 * `trustBase` skips the fingerprint compare: a caller that HAS proved the map unchanged (the
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
  const watermark = executor.getUndoStackSize();
  const atomic = opts.area !== undefined || opts.from !== undefined;
  const countCells = cellsChanged(ctx.state, atomic);
  const countObjects = objectsChanged(ctx.state);
  executor.pushSource({
    source: ProvSource.Procedural,
    tool: `macro:${id}`,
    procedural: { seed: opts.seed, algorithm: id, configHash: hashJSON(opts) },
  });

  try {
    let landed = true;
    executor.runSilently(() => {
      for (const cmd of built.run.commands) {
        if (!executor.execute(detachCommand(cmd)).success && atomic) { landed = false; break; }
      }
    });
    if (!landed) {
      executor.rollbackTo(watermark);
      return { changes: 0, reason: 'the complete build could not be replayed', code: built.report?.code ?? 'blocked' };
    }
    const violations = executor.commitStrokeGroup(watermark);
    if (violations.length > 0 && atomic) executor.rollbackTo(watermark);
    const changes = countCells() + countObjects();
    const report = built.report;
    const narrated: Pick<MacroOutcome, 'code' | 'at' | 'blocked' | 'narrowedByPlanting' | 'offers' | 'peak' | 'ends'> = {
      ...(report?.ends ? { ends: report.ends } : {}),
      ...(report?.code ? { code: report.code } : {}),
      ...(report?.at ? { at: report.at } : {}),
      ...(report?.blocked && report.blocked.length > 0 ? { blocked: report.blocked } : {}),
      ...(report?.narrowedByPlanting ? { narrowedByPlanting: report.narrowedByPlanting } : {}),
      ...(report?.offers && report.offers.length > 0 ? { offers: report.offers } : {}),
      ...(report?.ownedIds ? { ownedIds: report.ownedIds } : {}),
      ...(report?.peak !== undefined ? { peak: report.peak } : {}),
    };
    if (violations.length > 0) {
      return { changes, reason: changes === 0 ? 'post-stroke rules rolled the run back' : 'post-stroke rules rolled part of the run back', ...narrated };
    }
    return changes === 0
      ? { changes: 0, reason: report?.reason ?? EMPTY_REASON[id], ...narrated }
      : { changes, ...narrated };
  } catch (err) {
    executor.rollbackTo(watermark);
    throw err;
  } finally {
    executor.popSource();
  }
}

/**
 * A runner that BUILDS the macro off this thread — installed by the layer that owns the worker
 * pool, declared here because this layer cannot import it. `applyMacroAsync` prefers it and lands
 * the returned commands; absent, broken, or answering for a map that has since changed, the
 * in-process path below is the same run.
 */
type MacroBuildRunner = (state: GridState, id: MacroId, opts: MacroOpts) => Promise<MacroBuild | null>;
let buildRunner: MacroBuildRunner | null = null;

export function installMacroBuildRunner(fn: MacroBuildRunner | null): void { buildRunner = fn; }

/** Whether presses can build off-thread — what the tool forks its sync/async plumbing on. */
export function hasMacroBuildRunner(): boolean { return buildRunner !== null; }

/** Build without landing, so a gesture can cancel an outstanding worker request. */
export async function prepareMacro(ctx: MacroContext, id: MacroId, opts: MacroOpts): Promise<MacroBuild | null> {
  if (buildRunner) {
    try {
      const built = await buildRunner(ctx.state, id, opts);
      if (built) return built;
    } catch { buildRunner = null; }
  }
  return buildMacroRun(ctx, id, opts);
}

/** `applyMacro`, with the expensive build off-thread when a runner is installed. Without one the whole
 *  body runs synchronously before the returned promise settles, so the no-worker path (tests, headless)
 *  behaves exactly as the synchronous call does. */
export async function applyMacroAsync(ctx: MacroContext, id: MacroId, opts: MacroOpts): Promise<MacroOutcome> {
  const guarded = guardMacro(ctx, id, opts);
  if (guarded) return guarded;
  if (buildRunner) {
    const cv = ctx.state.cellsVersion ?? 0;
    const ov = ctx.state.objectsVersion ?? 0;
    let built: MacroBuild | null;
    // Only the BUILD is guarded, and only a build failure retires the runner. The landing below stays
    // outside the guard: it runs on the main thread against the live map, and it rethrows after
    // rolling itself back (`landMacroRun`), so catching it here would read a rule or executor fault
    // as a broken worker — retiring off-thread building for the rest of the session and re-running
    // the whole macro in-process on the way past.
    try {
      built = await buildRunner(ctx.state, id, opts);
    } catch {
      buildRunner = null;
      built = null;
    }
    if (built) {
      // Version counters unmoved since the state left for the builder ⇒ the map is the map the
      // build ran over, and the fingerprint compare has nothing left to ask.
      const trustBase = (ctx.state.cellsVersion ?? 0) === cv && (ctx.state.objectsVersion ?? 0) === ov;
      const landed = landMacroRun(ctx, id, opts, built, { trustBase });
      if (landed) return landed;
      // Stale base: the map moved while the worker built. Rebuild in-process below.
    }
  }
  return applyMacro(ctx, id, opts);
}

export function applyMacro(ctx: MacroContext, id: MacroId, opts: MacroOpts): MacroOutcome {
  const guarded = guardMacro(ctx, id, opts);
  if (guarded) return guarded;
  const built = buildMacroRun(ctx, id, opts);
  if (!built) return { changes: 0, reason: `${id} needs an aim point` };
  // Built on this map in this tick, so the base always matches and the landing never refuses.
  return landMacroRun(ctx, id, opts, built)!;
}

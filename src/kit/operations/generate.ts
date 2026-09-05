/**
 * Runs generation as one silent stroke after clearing its scope. Clear removes only work attributed
 * to the last run and preserves authored cells and objects. Candidates are generated on detached
 * cleared maps and retain the accepted build commands plus a fingerprint of that cleared base.
 * Landing re-clears the live scope, verifies the fingerprint, and replays those commands through the
 * live executor instead of regenerating.
 */
import { CommandExecutor } from '../../core/commands/command-executor';
import { applyCommand } from '../../core/commands/command-apply';
import { EventBus } from '../../core/commands/event-bus';
import { cloneGridState } from '../../core/model/grid-model';
import { hashJSON } from '../../core/model/hash';
import { ProvSource } from '../../core/provenance/types';
import type {
  Command, EditorEvents, GenerateConfig, GridState, MacroCoord, ValidationResult,
} from '../../core/model/types';
import { createDefaultRegistry } from '../../rules';
import { roadLookup } from '../../state/object-index';
import { catalogLoadValue } from '../../state/catalog';
import { poolAvailable, runCandidateInPool } from './candidate-pool';
import { clearAllObjects, clearAllTerrain, generateTerrain } from '../../tools/generation/terrain-generator';
import { readRegionBase, regionUnbuilt, repairRegionSeam } from '../../tools/generation/core';
import type { KitContext } from '../context';
import { detachCommand as detach, mapFingerprint } from '../../tools/macros';
import type { Outcome } from './outcome';

/** A cooperative cancel flag: the caller flips `cancelled` (e.g. when the user closes the shelf) and
 *  a run bails at its next yield point, leaving the partial work for the caller to roll back. */
export interface GenSignal { cancelled: boolean }

/** Yield to the event loop so the browser can paint (the busy state) and process input (a cancel)
 *  between a run's heavy stages — a macrotask, not a microtask, so rendering actually happens. */
export const yieldFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The scope of the last generation. A finished run drops the painted region, so without this
 *  Clear straight after a scoped generate would wipe the rest of the map. */
let lastRunRegion: MacroCoord[] | null = null;

export function forgetGenerationScope(): void { lastRunRegion = null; }

/**
 * A generation that has already happened, on a copy of the map, ready to be landed on the real one.
 *
 * It carries the map for the picture, what the run reported, and the run itself as commands. The
 * recipe and the scope come along too: what lands has to be what was photographed, not whatever the
 * settings say by the time the click arrives.
 */
export interface Candidate {
  /** The map the recipe built, which is what the card paints. */
  state: GridState;
  /** What the run reported, so landing it can say the same thing without running again. */
  outcome: Outcome;
  /** The commands the copy's executor ACCEPTED for the BUILD, oldest first. The generator offers
   *  many it rejects by design, and those never reached the stack, so they are not here; neither is
   *  the clearing the build stands on, which names the copy's own objects and is re-derived against
   *  the live map at landing time. */
  commands: Command[];
  config: GenerateConfig;
  region: MacroCoord[] | null;
  /** `mapFingerprint` of the map the build was validated against: the copy AFTER its own clearing. */
  base: string;
}

/** `[]` means "nothing painted" the same as `null` does (the UI's region state IS `[]` at rest) —
 *  collapse it here once so an empty array can't be read as "scope to zero cells" downstream. */
function normalizeRegion(region: MacroCoord[] | null): MacroCoord[] | null {
  return region && region.length > 0 ? region : null;
}

/** The run and the commands that were it. */
interface Run {
  outcome: Outcome;
  commands: Command[];
  /** The map the commands were validated against: this copy after its own clearing. */
  bare: string;
}

/** The clearing every run opens with. Its own commands are never part of a run's record — they name
 *  the objects standing on THAT map, and the map a replay lands on has its own. */
function clearScope(
  state: GridState,
  execute: (cmd: Command) => ValidationResult,
  region: MacroCoord[] | null,
): void {
  clearAllObjects(state, execute, region ?? undefined);
  clearAllTerrain(state, execute, region ?? undefined);
}

/**
 * The fingerprint the live map WOULD carry once a run had cleared it, without touching it.
 *
 * Read before anything is decided, so the map stands unchanged while a candidate is looked up or
 * built. It is a prediction rather than a proof: the clearing is applied to a copy directly, so a
 * locked layer (which would refuse the erase on the real map) makes it read barer than the truth.
 * `generateMap` compares the real thing after clearing for that reason.
 */
function predictBare(state: GridState, region: MacroCoord[] | null): string {
  const copy = cloneGridState(state);
  const bus = new EventBus<EditorEvents>();
  clearScope(copy, (cmd) => {
    applyCommand(cmd, copy, bus);
    return { success: true, errors: [] };
  }, region);
  return mapFingerprint(copy);
}

/** The run itself, on a detached copy. `generateMap` keeps the record of it. */
async function runGeneration(
  ctx: KitContext,
  opts: { config: GenerateConfig; region: MacroCoord[] | null; signal?: GenSignal },
): Promise<Run> {
  const { state, executor } = ctx;
  const signal = opts.signal ?? { cancelled: false };
  const region = normalizeRegion(opts.region);
  const config: GenerateConfig = { ...opts.config, region };
  const seed = typeof config.seed === 'number' ? config.seed : 0;
  const watermark = executor.getUndoStackSize();

  /**
   * The run, as the commands that were it.
   *
   * Each one is kept AS THE GENERATOR BUILT IT, before the executor saw it, and only if the
   * executor accepted it. Validation SNAPS a bridge or a ramp onto the map by writing position,
   * rotation, span and elevation back onto the command, so the command left in the history is a
   * post-snap one, and validating THAT again snaps it a second time from an anchor that has already
   * moved: a four-cell bridge at (138,111) came back a six-cell bridge at (137,111), and six later
   * placements were refused around it. The pre-image is the command that replays to the same map.
   */
  const commands: Command[] = [];
  const apply = (cmd: Command): ValidationResult => {
    const pristine = detach(cmd);
    const result = executor.execute(cmd);
    if (result.success) commands.push(pristine);
    return result;
  };

  executor.pushSource({
    source: ProvSource.Procedural,
    tool: 'generate',
    procedural: { seed, algorithm: config.algorithm, configHash: hashJSON(config) },
  });

  try {
    await yieldFrame();   // let a caller's spinner paint before the first synchronous chunk
    // The ground the region is about to lose, read BEFORE the clearing: the map as it stands is
    // legal, so what a cell holds now is what the ground outside the region can be given back if it
    // turns out to have been leaning on it.
    const seamBase = region ? readRegionBase(state, region) : null;
    // Cleared through the executor, so a locked layer refuses the erase here exactly as it would on
    // the live map — and not through `apply`, since the clearing is not part of what a replay lands.
    clearScope(state, (cmd) => executor.execute(cmd), region);
    const bare = mapFingerprint(state);

    const result = await executor.runSilentlyAsync(async () =>
      generateTerrain(config, state, apply, executor.getRegistry()));

    if (signal.cancelled) {
      executor.commitStrokeGroup(watermark);
      if (executor.getUndoStackSize() > watermark) executor.undo();
      return {
        outcome: { cells: [], placed: 0, removedCells: 0, removedObjects: 0, violations: [], cancelled: true },
        commands: [],
        bare,
      };
    }

    // A SCOPED RUN SETTLES ITS SEAM BEFORE THE COMMIT. The island is planned whole and cropped to the
    // region, and neither the plan nor the crop knows what the terrain OUTSIDE the region needs from
    // the cells inside it — a 3x3 base, a pond's cap. Left to the commit, one such cell reverts the
    // whole run, the clearing included, and the visitor sees nothing happen at all. Recorded through
    // `apply`, so a candidate replays the settled seam rather than re-deriving it.
    const seam = seamBase
      ? executor.runSilently(() =>
        repairRegionSeam({ state, execute: apply, reg: executor.getRegistry() }, seamBase))
      : null;

    // The commit's own auto-reverts and edge-cut repairs are not in `commands` and do not need to
    // be: replaying it and committing again puts the same state in front of the same post-stroke
    // rules, which revert and repair it the same way.
    const violations = executor.commitStrokeGroup(watermark);
    // Only a FULL run is reproducible from (seed, config); a scoped one depends on prior state.
    state.generation = region ? undefined : config;

    const cells: MacroCoord[] = region ? [...region] : [];
    if (cells.length === 0) {
      for (let y = 0; y < state.template.height; y++) {
        for (let x = 0; x < state.template.width; x++) cells.push({ x, y });
      }
    }
    // WHY A SCOPED RUN CAN BUILD NOTHING, read off the settled map rather than guessed at. Nothing of
    // the run left standing in its region has two readings, and the seam's own ledger separates them:
    // ground the outside was leaning on was CLAIMED and handed back, and where the outside wanted all
    // of it (a region painted inside a tall massif) the run had nowhere to build at all; a region the
    // seam never claimed was the run's to build on, and the design put nothing in it. Reported either
    // way, since a press that appears to do nothing and says nothing reads as a broken button.
    const scopeEmpty = seamBase && regionUnbuilt(state, seamBase)
      ? (seam && seam.claimed > 0 ? 'reclaimed' as const : 'empty' as const)
      : undefined;

    return {
      outcome: {
        cells, placed: result.placed, removedCells: 0, removedObjects: 0, violations, cancelled: false,
        ...(result.mazeGates ? { mazeGates: result.mazeGates } : {}),
        ...(result.mazeWalk ? { mazeWalk: result.mazeWalk } : {}),
        ...(result.stencil ? { stencil: result.stencil } : {}),
        ...(scopeEmpty ? { scopeEmpty } : {}),
      },
      commands,
      bare,
    };
  } catch (err) {
    executor.rollbackTo(watermark);
    throw err;
  } finally {
    executor.popSource();
  }
}

/** Commands replayed between yields. A candidate's list is thousands of placements long, so
 *  replaying it in one breath freezes the page and stops the card's own landing overlay. */
const REPLAY_CHUNK = 250;

const CANCELLED: Outcome = {
  cells: [], placed: 0, removedCells: 0, removedObjects: 0, violations: [], cancelled: true,
};

/**
 * Run the recipe onto the live map, as one stroke group and one undo entry.
 *
 * The order is: read what the map WILL be once cleared, find or build the run for that ground, then
 * clear and replay. Reading first keeps the map standing while a run is built, and a map emptied for
 * the length of a generation is a map that looks broken.
 *
 * Every replayed command is validated again. Nothing is trusted about them beyond the map they were
 * built on being the map they are landing on, and the fingerprint taken after the real clearing is
 * what proves that rather than assumes it.
 *
 * ID SAFETY RIDES ON THE FINGERPRINT HASHING OBJECT IDS (`scratch.ts:mapFingerprint` mixes
 * `obj.id`): a replay lands ids minted on the copy, and a matching fingerprint proves the SURVIVOR
 * SET — a clear-refused generated object included — is byte-identical to what the run was built
 * over, so a replayed id can only ever land on the cell that already carries it. Dropping ids from
 * the fingerprint reopens that collision.
 */
export async function generateMap(
  ctx: KitContext,
  opts: {
    config: GenerateConfig;
    region: MacroCoord[] | null;
    signal?: GenSignal;
    /** A run of this recipe already performed on a copy. Landed instead of generated when the map
     *  clears to the ground it was built on. */
    candidate?: Candidate | null;
  },
): Promise<Outcome> {
  const { state, executor } = ctx;
  const signal = opts.signal ?? { cancelled: false };
  const region = normalizeRegion(opts.region);
  const config: GenerateConfig = { ...opts.config, region };
  const seed = typeof config.seed === 'number' ? config.seed : 0;
  const build = { config, region, signal };

  await yieldFrame();   // let a caller's busy state paint before the first synchronous chunk
  if (signal.cancelled) return CANCELLED;

  // An unusable (or absent) candidate is not a reason to generate on THIS thread: the same run
  // built through `generateCandidate` rides the worker pool and the cache.
  const offered = opts.candidate ?? null;
  const predicted = predictBare(state, region);
  const known = offered !== null && offered.base === predicted
    ? offered
    : candidateCache.get(recipeKey(predicted, config)) ?? null;
  let candidate = known ?? await buildCandidate(ctx, build);
  if (!candidate || signal.cancelled) return CANCELLED;

  const watermark = executor.getUndoStackSize();
  executor.pushSource({
    source: ProvSource.Procedural,
    tool: 'generate',
    procedural: { seed, algorithm: config.algorithm, configHash: hashJSON(config) },
  });

  try {
    // Silenced for the reason the run itself is: the generator's rejected commands are not in this
    // list, but a replay that hit one would be reporting the same non-event to the user.
    executor.runSilently(() => clearScope(state, (cmd) => executor.execute(cmd), region));
    // The prediction applies the clearing without the rules; a locked layer refuses an erase on the
    // real map and leaves ground the build was never validated against. The build this falls back
    // to is cached under the true ground for the next press.
    if (mapFingerprint(state) !== candidate.base) {
      const real = await buildCandidate(ctx, build);
      if (!real) { executor.rollbackTo(watermark); return CANCELLED; }
      candidate = real;
    }
    const landing = candidate;
    await executor.runSilentlyAsync(async () => {
      let n = 0;
      for (const cmd of landing.commands) {
        executor.execute(detach(cmd));
        if (++n % REPLAY_CHUNK === 0) await yieldFrame();
      }
    });
    const violations = executor.commitStrokeGroup(watermark);
    // Only a FULL run is reproducible from (seed, config); a scoped one depends on prior state.
    state.generation = region ? undefined : config;
    lastRunRegion = region ? [...region] : null;
    return { ...landing.outcome, cells: [...landing.outcome.cells], violations };
  } catch (err) {
    executor.rollbackTo(watermark);
    throw err;
  } finally {
    executor.popSource();
  }
}

/** The run a worker performs on the grid it was handed: a fresh executor, the default rules (the
 *  same set every live registry holds), and the generation itself. Exported for the worker entry
 *  alone — everything else goes through `generateCandidate`. */
export async function runCandidateOn(
  state: GridState,
  opts: { config: GenerateConfig; region: MacroCoord[] | null; signal?: GenSignal },
): Promise<Run> {
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state), catalogLoadValue);
  return runGeneration({ state, executor, registry: executor.getRegistry() }, opts);
}

/**
 * Candidates already built, keyed by the GROUND they were built on plus the recipe and scope they
 * were built FOR. Daily use walks the same ground repeatedly — a slider nudged and nudged back, the
 * same seed typed twice, a card landed and another card pressed — and every one of those is a full
 * generation this cache answers instead. The ground is the map after a run's own clearing, so what
 * changes the key is what SURVIVES clearing. The cap bounds what a session holds (each entry carries
 * a whole grid).
 *
 * A candidate is filed under two keys: the ground it landed on (what `generateMap` asks for) and,
 * where they differ, the map it was ASKED about (what the shelf asks for while it photographs a
 * batch, which it can read without clearing anything).
 */
// Three shelf batches (6 cards + the custom one each): a tab left and returned to hits whole,
// and the tab BETWEEN the two does not evict either of them.
const CANDIDATE_CACHE_MAX = 24;
const candidateCache = new Map<string, Candidate>();

/** Test hook, matching `__resetMotionState` and friends: module state survives between tests
 *  otherwise. */
export function __resetCandidateCache(): void { candidateCache.clear(); }

function cacheCandidate(key: string, candidate: Candidate): void {
  if (candidateCache.size >= CANDIDATE_CACHE_MAX && !candidateCache.has(key)) {
    candidateCache.delete(candidateCache.keys().next().value!);
  }
  candidateCache.set(key, candidate);
}

function recipeKey(fingerprint: string, config: GenerateConfig): string {
  return `${fingerprint}|${hashJSON(config)}`;
}

/**
 * The map as one short string, remembered per grid.
 *
 * `mapFingerprint` walks every cell and every object, which is milliseconds on a real map, and a
 * shelf asks for it once per card in a batch while nothing between the asks has touched the map.
 * The version counters move on every mutation, so a matching pair is proof the content is the one
 * measured — the same discipline `state/object-index` and `state/map-stats` cache under.
 */
const fingerprints = new WeakMap<GridState, { cells: number; objects: number; fp: string }>();

function fingerprintOf(state: GridState): string {
  const cells = state.cellsVersion ?? 0;
  const objects = state.objectsVersion ?? 0;
  const seen = fingerprints.get(state);
  if (seen && seen.cells === cells && seen.objects === objects) return seen.fp;
  const fp = mapFingerprint(state);
  fingerprints.set(state, { cells, objects, fp });
  return fp;
}

/**
 * The map a recipe would build, built on a copy and handed back.
 *
 * A candidate picture is a picture of a real generation, because the generator is the only thing
 * that knows what a recipe produces. It is not a picture of the LIVE map: the run happens on a
 * detached grid with its own executor, its own event bus and no provenance ledger, so the live
 * cells, objects, undo stack and Clear scope are not reachable from here at all. Generating into the
 * real map and undoing afterwards also restores it, right up until something interrupts the sequence
 * (a crash, a reload, a post-stroke revert that stops early, a user reaching for Ctrl+Z mid-run),
 * and what is left then is the user's map replaced by a generated island.
 *
 * The copy starts as the live map rather than as a blank template, so a region-scoped candidate
 * shows the map the click would leave, not a patch of island floating on empty ground.
 *
 * THE RUN LEAVES THE MAIN THREAD where it can: with workers available the grid is structured-cloned
 * into the pool and built there, so a batch of six neither blocks the page nor runs one at a time.
 * The pool breaking (or absent, as in tests) falls back to the same run on this thread.
 *
 * Returns null when the run was cancelled.
 */
export async function generateCandidate(
  ctx: KitContext,
  opts: { config: GenerateConfig; region: MacroCoord[] | null; signal?: GenSignal },
): Promise<Candidate | null> {
  const region = normalizeRegion(opts.region);
  const config = { ...opts.config, region };
  const hit = peekCandidate(ctx, { config, region });
  if (hit) return hit;
  // The map AS IT STANDS, which is what this caller can read without touching it. A batch asks the
  // same question of the same map card after card, and this is the key that answers those.
  const asked = recipeKey(fingerprintOf(ctx.state), config);
  return buildCandidate(ctx, { config, region, signal: opts.signal }, asked);
}

/**
 * The cached candidate for this recipe on the map AS IT STANDS, or null — a synchronous read with
 * no build behind it, so a caller can tell "already answered" from "worth a pending face" before
 * it blanks anything. The key is the same one `generateCandidate` files under (the live map's
 * fingerprint plus the whole config, region included), and a hit refreshes LRU recency the same
 * way.
 */
export function peekCandidate(
  ctx: KitContext,
  opts: { config: GenerateConfig; region: MacroCoord[] | null },
): Candidate | null {
  const region = normalizeRegion(opts.region);
  const config = { ...opts.config, region };
  const asked = recipeKey(fingerprintOf(ctx.state), config);
  const hit = candidateCache.get(asked);
  if (!hit) return null;
  // Refresh recency: the Map's insertion order is the LRU order.
  candidateCache.delete(asked);
  candidateCache.set(asked, hit);
  return hit;
}

/** Build the recipe on a copy and file it. `asked` is an extra key to file it under — the caller's
 *  own view of the map, which is not the ground the run ends up standing on. */
async function buildCandidate(
  ctx: KitContext,
  opts: { config: GenerateConfig; region: MacroCoord[] | null; signal?: GenSignal },
  asked?: string,
): Promise<Candidate | null> {
  const { config, region } = opts;
  if (opts.signal?.cancelled) return null;

  let built: { state: GridState; outcome: Outcome; commands: Command[]; bare: string } | null = null;
  if (poolAvailable()) {
    try {
      const run = await runCandidateInPool({ state: ctx.state, config, region }, opts.signal);
      if (run) built = run;
      else return null;   // cancelled before a worker picked it up
    } catch {
      built = null;       // pool broke — the main-thread path below is the same run
    }
  }
  if (!built) {
    const state = cloneGridState(ctx.state);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), ctx.registry, roadLookup(state), catalogLoadValue);
    const run = await runGeneration({ state, executor, registry: ctx.registry }, opts);
    built = { state, outcome: run.outcome, commands: run.commands, bare: run.bare };
  }
  if (built.outcome.cancelled) return null;

  const candidate: Candidate = {
    state: built.state,
    outcome: built.outcome,
    commands: built.commands,
    config,
    region,
    base: built.bare,
  };
  // Cached even when the caller has stopped waiting: the work is done, and the next batch over
  // the same ground collects it.
  cacheCandidate(recipeKey(candidate.base, config), candidate);
  if (asked && asked !== recipeKey(candidate.base, config)) cacheCandidate(asked, candidate);
  return opts.signal?.cancelled ? null : candidate;
}

export function clearGenerated(ctx: KitContext, opts: { region: MacroCoord[] | null }): Outcome {
  const { state, executor } = ctx;
  const watermark = executor.getUndoStackSize();
  const region = normalizeRegion(opts.region) ?? lastRunRegion ?? undefined;
  const prov = executor.getProvenanceTracker();

  // Seam repairs belong to procedural cleanup so a later clear can remove them with the run.
  executor.pushSource({ source: ProvSource.Procedural, tool: 'clear-generated' });
  try {
    // A BOUNDED CLEAR OWES THE SAME SEAM A GENERATION DOES: erasing terrain inside the scope can take
    // the 3x3 base or the cap that ground outside it stands on, and that violation reverts the whole
    // Clear at commit time. Read before anything is taken, so the repair has ground to give back.
    const seamBase = region ? readRegionBase(state, [...region]) : null;
    // Objects first: a placement blocks erasing the terrain beneath it.
    const removedObjects = clearAllObjects(state, (cmd) => executor.execute(cmd), region, (o) => prov.objectAuthor(o.id) === 'human');
    const removedCells = clearAllTerrain(state, (cmd) => executor.execute(cmd), region, (x, y) => prov.cellAuthor(x, y) === 'human');
    if (seamBase) {
      executor.runSilently(() => repairRegionSeam(
        { state, execute: (cmd) => executor.execute(cmd), reg: executor.getRegistry() },
        seamBase,
        // The person's own work is spared here for the same reason the erase spared it, and the cell
        // under it was never erased, so the seam has no call on it.
        { spare: (obj) => prov.objectAuthor(obj.id) === 'human' },
      ));
    }
    state.generation = undefined;
    const violations = executor.commitStrokeGroup(watermark);
    return { cells: region ? [...region] : [], placed: 0, removedCells, removedObjects, violations, cancelled: false };
  } catch (err) {
    executor.rollbackTo(watermark);
    throw err;
  } finally {
    executor.popSource();
  }
}

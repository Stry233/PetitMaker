/**
 * Generation candidates: a recipe built on a copy of the map, ahead of the press that lands it, and
 * the cache that answers the same recipe on the same ground again. A candidate is built in the
 * worker pool where there is one and on this thread otherwise.
 */
import { cloneGridState } from '../../../core/model/grid-model';
import { decodeGridState, encodeGridState } from '../../../core/model/grid-wire';
import type { Command, GridState, MacroCoord } from '../../../core/model/types';
import { recipeHash, type GenerateConfig } from '../recipe';
import { poolAvailable, runCandidateInPool } from './candidate-pool';
import type { EditContext } from '../../../core/commands/edit-context';
import { detachedContext } from '../../macros/runtime/scratch';
import { mapFingerprint } from '../../../core/model/fingerprint';
import type { Outcome } from './outcome';
import { runGeneration, runScope } from './generation-run';

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
  /** The commands the copy's executor accepted for the build, oldest first. The generator offers
   *  many it rejects by design, and those never reached the stack, so they are not here; neither is
   *  the clearing the build stands on, which names the copy's own objects and is re-derived against
   *  the live map at landing time. */
  commands: Command[];
  config: GenerateConfig;
  region: MacroCoord[] | null;
  /** `mapFingerprint` of the map the build was validated against: the copy after its own clearing. */
  base: string;
}

// Three shelf batches (6 cards + the custom one each): a tab left and returned to hits whole,
// and the tab between the two does not evict either of them.
const CANDIDATE_CACHE_MAX = 24;
/** The heap the cache may hold, in bytes: three batches of the largest built-in planet's candidates
 *  fit, and a session on bigger ground keeps fewer rather than more memory. */
const CANDIDATE_CACHE_BYTES = 128 * 1024 * 1024;
/** What one cell, object and replay command cost a held candidate in V8, in bytes. */
const CELL_BYTES = 48;
const OBJECT_BYTES = 256;
const COMMAND_BYTES = 600;
/**
 * Candidates already built, keyed by the ground they were built on plus the recipe and scope they
 * were built for. Daily use walks the same ground repeatedly — a slider nudged and nudged back, the
 * same seed typed twice, a card landed and another card pressed — and every one of those is a full
 * generation this cache answers instead. The ground is the map after a run's own clearing, so what
 * changes the key is what survives clearing. The cap bounds what a session holds (each entry carries
 * a whole grid).
 *
 * A candidate is filed under two keys: the ground it landed on (what `generateMap` asks for) and,
 * where they differ, the map it was asked about (what the shelf asks for while it photographs a
 * batch, which it can read without clearing anything).
 */
const candidateCache = new Map<string, Candidate>();
/** Each held candidate's key count and estimated size: one candidate may be filed under two keys. */
const held = new Map<Candidate, { keys: number; bytes: number }>();
let heldBytes = 0;

/** Test hook, matching `__resetMotionState` and friends: module state survives between tests
 *  otherwise. */
export function __resetCandidateCache(): void {
  candidateCache.clear();
  held.clear();
  heldBytes = 0;
}

function candidateBytes(c: Candidate): number {
  const { width, height } = c.state.template;
  return width * height * CELL_BYTES + c.state.objects.size * OBJECT_BYTES + c.commands.length * COMMAND_BYTES;
}

function release(candidate: Candidate): void {
  const h = held.get(candidate);
  if (!h || --h.keys > 0) return;
  held.delete(candidate);
  heldBytes -= h.bytes;
}

function evictOldest(): void {
  const [key, candidate] = candidateCache.entries().next().value!;
  candidateCache.delete(key);
  release(candidate);
}

function cacheCandidate(key: string, candidate: Candidate): void {
  if (candidateCache.size >= CANDIDATE_CACHE_MAX && !candidateCache.has(key)) evictOldest();
  const prev = candidateCache.get(key);
  if (prev !== candidate) {
    if (prev) release(prev);
    const h = held.get(candidate);
    if (h) h.keys++;
    else {
      const bytes = candidateBytes(candidate);
      held.set(candidate, { keys: 1, bytes });
      heldBytes += bytes;
    }
  }
  candidateCache.set(key, candidate);
  // The newest entry always stays: a candidate over the whole budget is still the one asked for.
  while (heldBytes > CANDIDATE_CACHE_BYTES && candidateCache.size > 1 && candidateCache.keys().next().value !== key) evictOldest();
}

/** The cached candidate filed under the ground `bare` and `config`, without refreshing recency. */
export function cachedCandidate(bare: string, config: GenerateConfig): Candidate | null {
  return candidateCache.get(recipeKey(bare, config)) ?? null;
}

function recipeKey(fingerprint: string, config: GenerateConfig): string {
  return `${fingerprint}|${recipeHash(config)}`;
}

/**
 * The map as one short string, remembered per grid.
 *
 * `mapFingerprint` walks every cell and every object, which is milliseconds on a real map, and a
 * shelf asks for it once per card in a batch while nothing between the asks has touched the map.
 * The version counters move on every mutation, so a matching pair is proof the content is the one
 * measured — the same discipline `state/object-index` and `state/map-stats` cache under.
 */
const fingerprints = new WeakMap<GridState, { cells: number; objects: number; ignoreLoad: boolean; fp: string }>();

function fingerprintOf(state: GridState): string {
  const cells = state.cellsVersion;
  const objects = state.objectsVersion;
  const seen = fingerprints.get(state);
  if (seen && seen.cells === cells && seen.objects === objects && seen.ignoreLoad === !!state.ignoreChunkLoad) return seen.fp;
  const fp = mapFingerprint(state);
  fingerprints.set(state, { cells, objects, ignoreLoad: !!state.ignoreChunkLoad, fp });
  return fp;
}

/**
 * The map a recipe would build, built on a copy and handed back.
 *
 * A candidate picture is a picture of a real generation, run on a detached grid with its own
 * executor, its own event bus and no provenance ledger, so the live cells, objects, undo stack and
 * Clear scope are not reachable from here. Generating into the real map and undoing would leave the
 * user's map replaced by a generated planet whenever the sequence is interrupted.
 *
 * The copy starts as the live map, so a region-scoped candidate shows the map the click would leave.
 * With workers available the grid is cloned into the pool and built there; a broken or absent pool
 * runs the same build on this thread. Returns null when the run was aborted.
 */
export async function generateCandidate(
  ctx: EditContext,
  opts: { config: GenerateConfig; region: MacroCoord[] | null; signal?: AbortSignal },
): Promise<Candidate | null> {
  const { region, config } = runScope(opts);
  const hit = peekCandidate(ctx, { config, region });
  if (hit) return hit;
  // The map as it stands, which is what this caller can read without touching it. A batch asks the
  // same question of the same map card after card, and this is the key that answers those.
  const asked = recipeKey(fingerprintOf(ctx.state), config);
  return buildCandidate(ctx, { config, region, signal: opts.signal }, asked);
}

/**
 * The cached candidate for this recipe on the map as it stands, or null — a synchronous read with
 * no build behind it, so a caller can tell "already answered" from "worth a pending face" before
 * it blanks anything. The key is the same one `generateCandidate` files under (the live map's
 * fingerprint plus the whole config, region included), and a hit refreshes LRU recency the same
 * way.
 */
export function peekCandidate(
  ctx: EditContext,
  opts: { config: GenerateConfig; region: MacroCoord[] | null },
): Candidate | null {
  const { config } = runScope(opts);
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
export async function buildCandidate(
  ctx: EditContext,
  opts: { config: GenerateConfig; region: MacroCoord[] | null; signal?: AbortSignal },
  asked?: string,
): Promise<Candidate | null> {
  const { config, region } = opts;
  if (opts.signal?.aborted) return null;

  let built: { state: GridState; outcome: Outcome; commands: Command[]; bare: string } | null = null;
  if (poolAvailable()) {
    try {
      const run = await runCandidateInPool({ state: ctx.state, config, region, rules: ctx.registry }, opts.signal);
      if (run) built = run;
      else return null;   // cancelled before a worker picked it up
    } catch {
      built = null;       // pool broke — the main-thread path below is the same run
    }
  }
  if (!built) {
    const copy = detachedContext(cloneGridState(ctx.state), ctx.registry);
    const run = await runGeneration(copy, opts);
    // Held as the worker's answer is, through the wire form: the run's own grid carries the side
    // caches its stages built, several times the map's own size.
    const state = decodeGridState(encodeGridState(copy.state), copy.state.template);
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
  return opts.signal?.aborted ? null : candidate;
}

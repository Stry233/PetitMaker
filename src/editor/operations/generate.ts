/**
 * Runs generation as one silent stroke after clearing its scope. Clear removes only work attributed
 * to the last run and preserves authored cells and objects. Candidates are generated on detached
 * cleared maps and retain the accepted build commands plus a fingerprint of that cleared base.
 * Landing re-clears the live scope, verifies the fingerprint, and replays those commands through the
 * live executor instead of regenerating.
 */
import { applyCommand } from '../../core/commands/command-apply';
import { applyTrim } from '../../core/domain/edge-cut/trim-apply';
import { EventBus } from '../../core/commands/event-bus';
import { cloneGridState } from '../../core/model/grid-model';
import { ProvSource } from '../../core/provenance/types';
import type { GridState, MacroCoord } from '../../core/model/types';
import type { GenerateConfig } from '../../tools/generation/recipe';
import type { EditorEvents } from '../../state/editing/events';
import { clearAllObjects, clearAllTerrain, clearForRun } from '../../tools/generation';
import { readRegionBase, repairRegionSeam } from '../../tools/generation/terrain-plan';
import { commandSink, type EditContext } from '../../core/commands/edit-context';
import { mapFingerprint } from '../../core/model/fingerprint';
import { nextMacrotask } from '../../platform/async/abort';
import {
  budgetBlocked, buildCandidate, cachedCandidate, CANCELLED, normalizeRegion, procSource, recipeOf, runScope,
  type Candidate, type Outcome,
} from '../../tools/generation/run';

/** Drops `state`'s generation scope; loading a map calls it, since a scope describes the map that
 *  was there before. The scope lives on the map (`GridState.generationScope`): a finished run drops
 *  the painted region, so without it Clear straight after a scoped generate would wipe the rest of
 *  the map. */
export function forgetGenerationScope(state: GridState): void { delete state.generationScope; }

/**
 * The fingerprint the live map would carry once a run had cleared it, without touching it.
 *
 * Read before anything is decided, so the map stands unchanged while a candidate is looked up or
 * built. It is a prediction rather than a proof: the clearing is applied to a copy directly, so a
 * locked layer (which would refuse the erase on the real map) makes it read barer than the truth.
 * `generateMap` compares the real thing after clearing for that reason.
 */
function predictBare(state: GridState, region: MacroCoord[] | null, config: GenerateConfig): string {
  const copy = cloneGridState(state);
  const bus = new EventBus<EditorEvents>();
  clearForRun({
    state: copy,
    execute: (cmd) => {
      applyCommand(cmd, copy, bus, applyTrim);
      return { success: true, errors: [] };
    },
  }, region, config);
  return mapFingerprint(copy);
}

/** Commands replayed between yields. A candidate's list is thousands of placements long, so
 *  replaying it in one breath freezes the page and stops the card's own landing overlay. */
const REPLAY_CHUNK = 250;

/**
 * Run the recipe onto the live map, as one stroke group and one undo entry.
 *
 * It reads what the map will be once cleared, finds or builds the run for that ground, then clears
 * and replays, so the map stays standing while a run is built. Every replayed command is validated
 * again, and the fingerprint taken after the real clearing proves the run was built on this ground.
 *
 * The fingerprint hashes object ids (`core/model/fingerprint.ts:mapFingerprint` mixes `obj.id`): a
 * replay lands ids minted on the copy, and a matching fingerprint proves the surviving objects, a
 * clear-refused generated one included, are the ones the run was built over, so a replayed id can
 * only land on the cell that already carries it.
 */
export async function generateMap(
  ctx: EditContext,
  opts: {
    config: GenerateConfig;
    region: MacroCoord[] | null;
    /** Aborted when the caller no longer wants the run: a generation in progress finishes before
     *  the abort is read, and a landing stops at its next replay chunk and is taken back whole. */
    signal?: AbortSignal;
    /** A run of this recipe already performed on a copy. Landed instead of generated when the map
     *  clears to the ground it was built on. */
    candidate?: Candidate | null;
  },
): Promise<Outcome> {
  const { state, executor } = ctx;
  const signal = opts.signal;
  const { region, config, seed } = runScope(opts);
  const build = { config, region, signal };

  await nextMacrotask();   // let a caller's busy state paint before the first synchronous chunk
  if (signal?.aborted) return CANCELLED;

  // An unusable (or absent) candidate is not a reason to generate on this thread: the same run
  // built through `generateCandidate` rides the worker pool and the cache.
  const offered = opts.candidate ?? null;
  const predicted = predictBare(state, region, config);
  const known = offered !== null && offered.base === predicted
    ? offered
    : cachedCandidate(predicted, config);
  const found = known ?? await buildCandidate(ctx, build);
  if (!found || signal?.aborted) return CANCELLED;
  if (budgetBlocked(found.outcome)) return found.outcome;

  return executor.transactionAsync({ source: procSource(config, seed) }, async (tx): Promise<Outcome> => {
    // Silenced for the reason the run itself is: the generator's rejected commands are not in this
    // list, but a replay that hit one would be reporting the same non-event to the user.
    executor.transaction({ silent: true }, () => clearForRun(commandSink(ctx), region, config));
    // The prediction applies the clearing without the rules; a locked layer refuses an erase on the
    // real map and leaves ground the build was never validated against. The build this falls back
    // to is cached under the true ground for the next press.
    let landing = found;
    if (mapFingerprint(state) !== landing.base) {
      const real = await buildCandidate(ctx, build);
      if (!real) { tx.rollback(); return CANCELLED; }
      landing = real;
    }
    if (budgetBlocked(landing.outcome)) { tx.rollback(); return landing.outcome; }
    if (signal?.aborted) { tx.rollback(); return CANCELLED; }
    // A cancel between replay chunks takes the whole landing back, the cleared scope included.
    await executor.transactionAsync({ silent: true }, async () => {
      let n = 0;
      for (const cmd of landing.commands) {
        executor.execute(cmd);
        if (++n % REPLAY_CHUNK === 0) await nextMacrotask();
        if (signal?.aborted) return;
      }
    });
    if (signal?.aborted) { tx.rollback(); return CANCELLED; }
    const violations = tx.commit();
    const record = recipeOf(config, region);
    tx.setGeneration({ ...(record ? { record } : {}), ...(region ? { scope: [...region] } : {}) });
    return { ...landing.outcome, cells: [...landing.outcome.cells], violations };
  });
}

export function clearGenerated(ctx: EditContext, opts: { region: MacroCoord[] | null }): Outcome {
  const { state, executor } = ctx;
  const region = normalizeRegion(opts.region) ?? state.generationScope ?? null;
  const prov = executor.getAuthorship();

  // Seam repairs belong to procedural cleanup so a later clear can remove them with the run.
  return executor.transaction({ source: { source: ProvSource.Procedural, tool: 'clear-generated' } }, (tx): Outcome => {
    // A bounded clear owes the same seam a generation does: erasing terrain inside the scope can take
    // the 3x3 base or the cap that ground outside it stands on, and that violation reverts the whole
    // Clear at commit time. Read before anything is taken, so the repair has ground to give back.
    const seamBase = region ? readRegionBase(state, [...region]) : null;
    // Objects first: a placement blocks erasing the terrain beneath it.
    const removedObjects = clearAllObjects(commandSink(ctx), { region, spare: (o) => prov.objectAuthor(o.id) === 'human' });
    const removedCells = clearAllTerrain(commandSink(ctx), { region, spare: (x, y) => prov.cellAuthor(x, y) === 'human' });
    if (seamBase) {
      executor.transaction({ silent: true }, () => repairRegionSeam(
        { ...commandSink(ctx), reg: executor.getRegistry() },
        seamBase,
        // The person's own work is spared here for the same reason the erase spared it, and the cell
        // under it was never erased, so the seam has no call on it.
        { spare: (obj) => prov.objectAuthor(obj.id) === 'human' },
      ));
    }
    const violations = tx.commit();
    tx.setGeneration(state.generationScope ? { scope: state.generationScope } : {});
    return { cells: region ? [...region] : [], placed: 0, removedCells, removedObjects, violations, cancelled: false };
  });
}

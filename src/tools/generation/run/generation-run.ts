/**
 * One generation run on the map it is handed, as one stroke group after clearing its scope: the
 * outcome it reports and the commands the executor accepted, oldest first, with a fingerprint of the
 * cleared ground they were validated against. The live landing (`generate.ts`), the candidate cache
 * (`candidates.ts`) and the generation worker all run it.
 */
import { ProvSource } from '../../../core/provenance/types';
import type { Command, GridState, MacroCoord, ValidationResult } from '../../../core/model/types';
import { recipeHash, withoutPicture, type GenerateConfig, type RecordedRecipe } from '../recipe';
import { createRuleRegistry, type RuleSetName } from '../../../rules';
import { clearForRun, generateTerrain, type GenerateResult } from '../generate';
import { isPrintGeneration } from '../stencil/print-clear';
import { readRegionBase, regionUnbuilt, repairRegionSeam } from '../terrain-plan';
import { commandSink, type EditContext } from '../../../core/commands/edit-context';
import { detachedContext } from '../../macros/runtime/scratch';
import { mapFingerprint } from '../../../core/model/fingerprint';
import type { Outcome, OutcomeDetail } from './outcome';
import { nextMacrotask } from '../../../platform/async/abort';


/** `[]` means "nothing painted" the same as `null` does (the UI's region state is `[]` at rest) —
 *  collapse it here once so an empty array can't be read as "scope to zero cells" downstream. */
export function normalizeRegion(region: MacroCoord[] | null): MacroCoord[] | null {
  return region && region.length > 0 ? region : null;
}

/** A run's scope as every run reads it: the region normalised, the config carrying it, and the seed
 *  (0 when the recipe names none). */
export function runScope(opts: { config: GenerateConfig; region: MacroCoord[] | null }): { region: MacroCoord[] | null; config: GenerateConfig; seed: number } {
  const region = normalizeRegion(opts.region);
  const config: GenerateConfig = { ...opts.config, region };
  return { region, config, seed: typeof config.seed === 'number' ? config.seed : 0 };
}

/** The run and the commands that were it. */
export interface Run {
  outcome: Outcome;
  commands: Command[];
  /** The map the commands were validated against: this copy after its own clearing. */
  bare: string;
}

/** The run itself, on a detached copy. `generateMap` keeps the record of it. */
export async function runGeneration(
  ctx: EditContext,
  opts: { config: GenerateConfig; region: MacroCoord[] | null; signal?: AbortSignal },
): Promise<Run> {
  const { state, executor } = ctx;
  const { region, config, seed } = runScope(opts);

  /** The run, as the commands that were it: each as the generator built it, kept only if the
   *  executor accepted it. Replayed on the same base, each resolves as it did here. */
  const commands: Command[] = [];
  const apply = (cmd: Command): ValidationResult => {
    const result = executor.execute(cmd);
    if (result.success) commands.push(cmd);
    return result;
  };

  return executor.transactionAsync({ source: procSource(config, seed) }, async (tx): Promise<Run> => {
    await nextMacrotask();   // let a caller's spinner paint before the first synchronous chunk
    // The ground the region is about to lose, read before the clearing: the map as it stands is
    // legal, so what a cell holds now is what the ground outside the region can be given back if it
    // turns out to have been leaning on it.
    const seamBase = region ? readRegionBase(state, region) : null;
    // Cleared through the executor, so a locked layer refuses the erase here exactly as it would on
    // the live map — and not through `apply`, since the clearing is not part of what a replay lands.
    clearForRun(commandSink(ctx), region, config);
    const bare = mapFingerprint(state);

    const result = await executor.transactionAsync({ silent: true }, async () =>
      generateTerrain({ state, execute: apply, reg: executor.getRegistry() }, config));

    if (result.stencilBudget === 'blocked') {
      tx.rollback();
      return { outcome: { ...CANCELLED, cancelled: false, detail: { kind: 'stencil', budget: 'blocked' } }, commands: [], bare };
    }

    // generateTerrain does not yield, so an abort during it is read only here, once it returns:
    // the abort saves no generation work, and what the run laid rolls back.
    if (opts.signal?.aborted) {
      tx.rollback();
      return {
        outcome: CANCELLED,
        commands: [],
        bare,
      };
    }

    // A scoped run settles its seam before the commit. The planet is planned whole and cropped to the
    // region, and neither the plan nor the crop knows what the terrain outside the region needs from
    // the cells inside it — a 3x3 base, a pond's cap. Left to the commit, one such cell reverts the
    // whole run, the clearing included, and the visitor sees nothing happen at all. Recorded through
    // `apply`, so a candidate replays the settled seam rather than re-deriving it.
    const seam = seamBase
      ? executor.transaction({ silent: true }, () =>
        repairRegionSeam({ state, execute: apply, reg: executor.getRegistry() }, seamBase))
      : null;

    // The commit's own auto-reverts and edge-cut repairs are not in `commands` and do not need to
    // be: replaying it and committing again puts the same state in front of the same post-stroke
    // rules, which revert and repair it the same way.
    const violations = tx.commit();

    const cells: MacroCoord[] = region ? [...region] : [];
    if (cells.length === 0) {
      for (let y = 0; y < state.template.height; y++) {
        for (let x = 0; x < state.template.width; x++) cells.push({ x, y });
      }
    }
    // Why a scoped run can build nothing, read off the settled map rather than guessed at. Nothing of
    // the run left standing in its region has two readings, and the seam's own ledger separates them:
    // ground the outside was leaning on was claimed and handed back, and where the outside wanted all
    // of it (a region painted inside a tall massif) the run had nowhere to build at all; a region the
    // seam never claimed was the run's to build on, and the design put nothing in it. Reported either
    // way, since a press that appears to do nothing and says nothing reads as a broken button.
    const scopeEmpty = seamBase && regionUnbuilt(state, seamBase)
      ? (seam && seam.claimed > 0 ? 'reclaimed' as const : 'empty' as const)
      : undefined;

    const detail = detailOf(result);
    return {
      outcome: {
        cells, placed: result.placed, removedCells: 0, removedObjects: 0, violations, cancelled: false,
        ...(detail ? { detail } : {}),
        ...(scopeEmpty ? { scopeEmpty } : {}),
      },
      commands,
      bare,
    };
  });
}

/** What the generator reported beyond its counts, as the outcome carries it. */
function detailOf(result: GenerateResult): OutcomeDetail | undefined {
  if (result.mazeGates) return { kind: 'maze', gates: result.mazeGates, ...(result.mazeWalk ? { walk: result.mazeWalk } : {}) };
  if (!result.stencil && !result.stencilBudget) return undefined;
  return {
    kind: 'stencil',
    ...(result.stencil ? { landing: result.stencil } : {}),
    ...(result.stencilBudget ? { budget: result.stencilBudget } : {}),
  };
}

/** The authorship a generation run records. */
export function procSource(config: GenerateConfig, seed: number) {
  return {
    source: ProvSource.Procedural,
    tool: 'generate',
    procedural: { seed, algorithm: config.algorithm, configHash: recipeHash(config) },
  };
}

/** Scoped and road-preserving runs depend on existing content and cannot be replayed from a recipe alone.
 *  A stencil's picture arrays stay out of the recipe, as they stay out of the share code: they are
 *  the source image, not a setting, and would add tens of kilobytes to every save. */
export function recipeOf(config: GenerateConfig, region: readonly MacroCoord[] | null): RecordedRecipe | undefined {
  if (region || isPrintGeneration(config)) return undefined;
  return withoutPicture(config);
}

export const CANCELLED: Outcome = {
  cells: [], placed: 0, removedCells: 0, removedObjects: 0, violations: [], cancelled: true,
};

/** The run a worker performs on the grid it was handed: a fresh executor, the rule set the asking
 *  map runs under, and the generation itself. Exported for the worker entry alone; everything else
 *  goes through `candidates.ts:generateCandidate`. */
export async function runCandidateOn(
  state: GridState,
  opts: { config: GenerateConfig; region: MacroCoord[] | null; rules: RuleSetName; signal?: AbortSignal },
): Promise<Run> {
  return runGeneration(detachedContext(state, createRuleRegistry(opts.rules)), opts);
}

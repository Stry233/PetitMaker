/**
 * The shape every editor verb returns. A leaf module, so every operation (including `generate.ts`)
 * can import it directly instead of through the `index.ts` barrel that re-exports them.
 */
import type { MacroCoord, ValidationError } from '../../../core/model/types';
import type { ResolvedMazeGates, StencilBudgetOutcome } from '../recipe';

export interface Outcome {
  /** The cells the operation touched, for the caller's flash. */
  cells: MacroCoord[];
  placed: number;
  /** Cells and objects are counted apart: the Clear message names both. */
  removedCells: number;
  removedObjects: number;
  /** Post-stroke violations that survived the commit. Empty on success. */
  violations: ValidationError[];
  cancelled: boolean;
  /** What the generator that ran reports beyond these counts, keyed on its kind. Absent on a run
   *  whose generator has nothing more to say and on every verb that is not a generation. */
  detail?: OutcomeDetail;
  /**
   * Why a run confined to a region built nothing, on a run that built nothing. Absent otherwise, and
   * absent on an unconfined run, which has no surroundings to answer to.
   *
   * `reclaimed`: the terrain outside the region was leaning on the ground inside it (a mountain's 3x3
   * base, a pond's cap), so the run had to hand that ground back and had nothing left to build on. A
   * region painted inside a tall massif is the clear case, and there is nothing to fix: flat ground is
   * not legal there. `empty`: the ground was the run's to build on and the design put nothing in it.
   *
   * Either makes a press look as if it did nothing, so the caller says which.
   */
  scopeEmpty?: 'reclaimed' | 'empty';
}

/** One generator's own report. */
export type OutcomeDetail = MazeDetail | StencilDetail;

export interface MazeDetail {
  kind: 'maze';
  /** Where the gates landed after snapping to the border ring. A caller that marks them cannot use
   *  the coordinates it passed in, which need not sit on the border. */
  gates: ResolvedMazeGates;
  /** The one walk between the gates, over the run's own carved corridors and filling their whole
   *  width. Computed by the generator because only it knows the carve: the finished map cannot tell a
   *  carved connector from a wall the coast refused, and a route recomputed over all open ground can
   *  slip through such gaps and skirt the maze along its rim. */
  walk?: MacroCoord[];
}

export interface StencilDetail {
  kind: 'stencil';
  /**
   * Text generation only: what a glyph did with the ground it was written on.
   *
   * A word arriving shorter than it was typed has a reason, and it is always one of these three:
   * `offBase` cells crossed a step or a pond, `unsupported` cells reached the edge of the ground the
   * word stands on, `atCeiling` cells stood on the tallest layer the grid has and had nowhere above
   * to go. `base` is the tier the glyph stands one layer above. The caller reports them rather than
   * letting a letter go quietly missing.
   */
  landing?: StencilOutcome;
  /** How an object picture met its regional load budget; absent when it fit. */
  budget?: StencilBudgetOutcome;
}

export interface StencilOutcome {
  base: number;
  offBase: number;
  unsupported: number;
  atCeiling: number;
}

/** The stencil's report on `outcome`, or undefined on any other run. */
export const stencilDetail = (outcome: Outcome): StencilDetail | undefined =>
  outcome.detail?.kind === 'stencil' ? outcome.detail : undefined;

/** Whether a picture's structural minimum could not fit its load budget, so nothing landed. */
export const budgetBlocked = (outcome: Outcome): boolean => stencilDetail(outcome)?.budget === 'blocked';

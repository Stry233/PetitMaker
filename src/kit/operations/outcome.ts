/**
 * The shape every editor verb returns. A leaf module, so every operation (including `generate.ts`)
 * can import it directly instead of through the `index.ts` barrel that re-exports them.
 */
import type { MacroCoord, ResolvedMazeGates, ValidationError } from '../../core/model/types';

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
  /** Maze generation only: where the gates landed after snapping to the border ring. A caller that
   *  marks them cannot use the coordinates it passed in, which need not sit on the border. */
  mazeGates?: ResolvedMazeGates;
  /** Maze generation only: the one walk between the gates, over the run's OWN carved corridors and
   *  filling their whole width. Computed by the generator because only it knows the carve — the
   *  finished map cannot tell a carved connector from a wall the coast refused, and a route
   *  recomputed over all open ground can slip through such gaps and skirt the maze along its rim. */
  mazeWalk?: MacroCoord[];
  /**
   * Text generation only: what a glyph did with the ground it was written on.
   *
   * A word arriving shorter than it was typed has a reason, and it is always one of these three:
   * `offBase` cells crossed a step or a pond, `unsupported` cells reached the edge of the ground the
   * word stands on, `atCeiling` cells stood on the tallest layer the grid has and had nowhere above
   * to go. `base` is the tier the glyph stands one layer above. The caller reports them rather than
   * letting a letter go quietly missing.
   */
  stencil?: StencilOutcome;
  /**
   * Why a run confined to a REGION built nothing, on a run that built nothing. Absent otherwise, and
   * absent on an unconfined run, which has no surroundings to answer to.
   *
   * `reclaimed`: the terrain outside the region was leaning on the ground inside it (a mountain's 3x3
   * base, a pond's cap), so the run had to hand that ground back and had nothing left to build on. A
   * region painted inside a tall massif is the clear case, and there is nothing to fix: flat ground is
   * not legal there. `empty`: the ground was the run's to build on and the design put nothing in it.
   *
   * Both are honest answers to a press that appears to do nothing, which is why they are reported at
   * all: the caller says which rather than leaving the button looking broken.
   */
  scopeEmpty?: 'reclaimed' | 'empty';
}

export interface StencilOutcome {
  base: number;
  offBase: number;
  unsupported: number;
  atCeiling: number;
}

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
  /** Maze generation only: the one walk between the gates, over the run's OWN carved corridors.
   *  Computed by the generator because only it knows the carve — the finished map cannot tell a
   *  carved connector from a wall the coast refused, and a route recomputed over all open ground
   *  can slip through such gaps and skirt the maze along its rim. */
  mazeWalk?: MacroCoord[];
}

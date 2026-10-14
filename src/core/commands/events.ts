import type { PlacedObject, Refusal } from '../model/types';
import type { CellSet } from '../grid/grids';

/** What the command kernel announces: the map's cells and objects changed, a command was refused,
 *  and the undo history moved. A change a command makes carries the `cause` its caller named with
 *  `CommandExecutor.withCause`; undo, redo and rollback carry none. */
export type KernelEvents = {
  /** The cells a command, a revert or a rollback touched, each set on the grid it lies on: terrain
   *  cells for terrain, an object's anchor on the placement grid for an object edit. */
  'cells-changed': { cells: CellSet[]; cause?: string };
  /** Removed objects by id, since they have left the map, and added ones whole. A listener applies
   *  the removals first: an object edited in place is removed and added under one id. */
  'objects-changed': { added?: PlacedObject[]; removed?: string[]; cause?: string };
  'validation-failed': Refusal;
  'history-changed': { canUndo: boolean; canRedo: boolean };
  /** Fired by undo()/redo() with the terrain cells they restored, so the renderer can flash the
   *  reverted or reapplied region without flashing normal edits. `objects` holds the objects the
   *  step added or removed, flashed at their own footprints on the placement grid. */
  'history-applied': { cells: CellSet[]; objects?: PlacedObject[] };
};

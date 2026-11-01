/**
 * The objects module's door: editing the objects already standing, with no pointer in it.
 *
 * `actions.ts` holds the single-object edits (move, rotate, remove, peel the terrain out from
 * under) and `group-actions.ts` their group forms, each one stroke group; `arrangement.ts` copies a
 * selection and plans and places its copies; `batch-slots.ts` lays out a Paint stroke's spots;
 * `candidate.ts` is the object a placement would stand. The probes and the coating strip they land through are
 * `placement/`'s; the placer tool and the drag session are `pointer/objects/`'s. The chrome offers
 * the edits, `editor` plays their feedback and the Help figures run them on their own world.
 */
export { moveObject, rotateObject, peelTerrain, type RotateResult } from './actions';
export {
  groupBounds, moveGroup, rotateGroup, deleteGroup,
  type DeleteGroupResult, type QuarterTurn,
} from './group-actions';
export type { GroupRotation } from './group-rotation';
export { candidateObject } from './candidate';
export {
  copyArrangement, arrangementOf, pasteArrangement, pasteAt, pasteKeyAim,
  type CopyResult, type PasteAim, type PasteDoor, type PasteOutcome, type PasteResult,
} from './arrangement';

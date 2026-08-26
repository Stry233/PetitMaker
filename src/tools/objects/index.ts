/**
 * THE OBJECTS MODULE'S DOOR: placing one object, and editing the ones already standing.
 *
 * Behind it:
 *
 *   object-placer.ts  the placer tool, and the command builders every other path places through
 *   actions.ts        the singular edits — rotate, remove, peel the terrain out from under
 *   group-actions.ts  their plural siblings, each one stroke group, all-or-nothing where a partial
 *                     result would not be coherent
 *
 * WHAT CROSSES IT. The pointer machine drags a selection, the chrome offers the edits, `kit` plays
 * their toast/animation side, and the agent and the API place through the same command builders the
 * tool does — which is the point of exporting them: there is ONE way an object reaches the map.
 * Modules inside `tools/` import these files directly (see the paint door for why), and
 * `ObjectPlacerTool` stays behind the door with them: `tools/runtime` constructs it.
 */
export {
  objectPlacementCommand, removeObjectCommand, movedObject, planObjectMove,
  stripCoatingsFor, GHOST_VALID, GHOST_INVALID,
} from './object-placer';
export { rotateObject, peelTerrain, type RotateResult } from './actions';
export {
  groupMembers, groupBounds, moveGroup, previewGroupMove, rotateGroup, deleteGroup,
  type DeleteGroupResult, type QuarterTurn,
} from './group-actions';

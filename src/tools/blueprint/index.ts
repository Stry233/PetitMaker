/**
 * The blueprint module's door: capture a framed region of a map into a body held apart from any map,
 * turn it by quarter turns or mirror it, lay it where it fits, and take back, turn, flip, move, copy or
 * paste a placed one whole by its group, with no pointer or store in it. The body's types are the kernel's
 * (`core/model/blueprint.ts`), so the store and the pointer tools can hold one. Peers import these
 * files directly.
 */
export type { BlueprintBody, BlueprintCell, BlueprintObject } from '../../core/model/blueprint';
export { BLUEPRINT_MAX_SIDE, captureBlueprint, type CaptureRefusal } from './capture';
export { orientBody, orientedFacing, turnBody } from './turn';
export { layBlueprintDetached, layBlueprintWith, placeBlueprint, previewBlueprint, type BlueprintLaid, type BlueprintPlacement, type BlueprintPreview, type PlacementSkips } from './place';
export { copyGroup, flippedPlacement, groupFlip, groupTurn, mapWithout, movedPlacement, previewGroupAt, relayGroup, takeBackGroup, turnedPlacement } from './group';
export { layGroupCopy, pasteGroupAt } from './paste';

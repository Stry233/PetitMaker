/**
 * Public placement surface for analyzing existing ground, validating object placement and sizing
 * crossings. Internal placement modules import one another directly.
 */
export {
  makeCtx, tryPlace, tryDecorate, placeFloorTile, removePlaced, buildingGate,
  type PlaceCtx,
} from './object';
export { bridgeSpanRange, crossingPool, narrowestBridgeId } from './crossings';
export { movedObject, planObjectMove, planObjectPlacement, planObjectRotation } from './probe';
export { overlappingCoatings, coatingStripFor } from './coatings';
export { peelCommand } from './terrain-peel';

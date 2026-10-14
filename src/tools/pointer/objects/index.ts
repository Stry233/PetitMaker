/**
 * The pointer side of object edits: the placer tool (`object-placer.ts`, which `pointer/runtime`
 * constructs) and drag-to-move's preview and drop (`drag-session.ts`), which the view's pointer
 * machine feeds with the map point under the pointer.
 */
export { ObjectDragSession, type ObjectDragPort, type ObjectDragView } from './drag-session';
export { showPlacementHover, type PlacementGhostPlan } from './object-placer';

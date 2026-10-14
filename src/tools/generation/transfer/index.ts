/**
 * Landing a build on a planet's template, and the door to it. `transfer.ts` carries a build onto
 * another planet, laid over by their anchor landmarks; `landmark-clearance.ts` repairs a loaded build
 * whose landmarks now stand over its content. Both work on a detached `GridState` and reach no live
 * editor, so the generation worker runs the carry preview.
 */
export { anchorOffset, buildTransfer, hasCarriableContent, type BuiltTransfer, type TransferCounts } from './transfer';
export { clearUnderLandmarks, type LandmarkClearance } from './landmark-clearance';

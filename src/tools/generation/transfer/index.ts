/**
 * Landing a build on a planet's template, and the door to it. `transfer.ts` carries a build onto
 * another planet, laid over by their anchor landmarks, on a detached `GridState` that reaches no live
 * editor, so the generation worker runs the carry preview.
 */
export { anchorOffset, buildTransfer, hasCarriableContent, type BuiltTransfer, type TransferCounts } from './transfer';

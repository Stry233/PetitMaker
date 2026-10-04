/**
 * The editor's verbs.
 *
 * Each one is a plain function that takes a KitContext, performs one stroke group, and RETURNS its
 * result. None of them speaks to the user: a toast, a modal or a translation would tie the verb to
 * a single caller, and these have three.
 */
export type { Outcome } from './outcome';
export { newMap, loadMap } from './map';
export { generateMap, generateCandidate, peekCandidate, clearGenerated } from './generate';
export type { Candidate } from './generate';
export { plazaOffset, hasCarriableContent } from './transfer';
export { transferMap } from './transfer-map';
export type { TransferCounts } from './transfer';
export type { TransferOutcome, TransferOptions } from './transfer-map';
export { previewTransfer, requestTransferPreview } from './planet-preview';
export type { TransferPreview, TransferPreviewRequest } from './planet-preview';
export {
  enterPlanetSession, leavePlanetSession, finishPlanetSession, sessionTemplate,
  placeSessionPlaza, rotateSessionPlaza, removeSessionPlaza,
} from './planet-session';
export type { SessionPlazaResult } from './planet-session';

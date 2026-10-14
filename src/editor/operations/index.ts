/**
 * The editor's verbs.
 *
 * Each one is a plain function that takes an `EditContext`, performs one stroke group, and returns its
 * result. None of them speaks to the user: a toast, a modal or a translation would tie the verb to
 * a single caller, and these have three.
 */
export { newMap, loadMap } from './map';
export { rewindTo, watchUndoDepth } from './undo-depth';
export { generateMap, clearGenerated } from './generate';
export { transferMap } from './transfer-map';
export type { TransferOutcome, TransferOptions } from './transfer-map';
export {
  enterPlanetSession, leavePlanetSession, finishPlanetSession,
  rotateSessionLandmark,
} from './planet-session';
export type { SessionLandmarkResult } from './planet-session';
// The run these verbs land, its candidates and the carry preview live in `tools/generation/run`;
// the shell reaches them beside the verbs.
export {
  generateCandidate, peekCandidate, requestTransferPreview,
  type Candidate, type Outcome, type TransferPreview, type TransferPreviewRequest,
} from '../../tools/generation/run';

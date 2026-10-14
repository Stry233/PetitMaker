/**
 * The door to running generation on a map that is not the live one: one run on a handed map
 * (`generation-run.ts`), the bounded candidate cache (`candidates.ts`), the worker pool that builds
 * candidates, Smart Build previews and the carry preview off the main thread (`candidate-pool.ts`
 * with `candidate.worker.ts`), and what a run reports (`outcome.ts`). Landing a run on the live map
 * is `editor/operations/generate.ts`.
 */
export {
  budgetBlocked, stencilDetail,
  type Outcome, type StencilOutcome,
} from './outcome';
export { CANCELLED, normalizeRegion, procSource, recipeOf, runScope } from './generation-run';
export { buildCandidate, cachedCandidate, generateCandidate, peekCandidate, type Candidate } from './candidates';
export { poolAvailable, warmPool, runMacroBuildInPool, runPreviewInPool } from './candidate-pool';
export {
  requestTransferPreview, type TransferPreview, type TransferPreviewRequest,
} from './planet-preview';
export { PLANET_CANVAS_ID_PREFIX } from './planet-canvas';

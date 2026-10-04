/** Offline containers run generation through the caller's synchronous fallback. */
export function poolAvailable(): boolean { return false; }
export const runCandidateInPool: typeof import('./candidate-pool').runCandidateInPool = async () => {
  throw new Error('Worker pool unavailable');
};
export const runTransferPreviewInPool: typeof import('./candidate-pool').runTransferPreviewInPool = async () => {
  throw new Error('Worker pool unavailable');
};

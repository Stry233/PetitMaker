/** Offline containers run generation through the caller's synchronous fallback. */
export function poolAvailable(): boolean { return false; }
export function warmPool(): void {}
export const runCandidateInPool: typeof import('./candidate-pool').runCandidateInPool = async () => {
  throw new Error('Worker pool unavailable');
};
export const runTransferPreviewInPool: typeof import('./candidate-pool').runTransferPreviewInPool = async () => {
  throw new Error('Worker pool unavailable');
};
export const runPreviewInPool: typeof import('./candidate-pool').runPreviewInPool = async () => {
  throw new Error('Worker pool unavailable');
};
export const runMacroBuildInPool: typeof import('./candidate-pool').runMacroBuildInPool = async () => {
  throw new Error('Worker pool unavailable');
};

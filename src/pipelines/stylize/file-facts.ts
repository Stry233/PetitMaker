// What the warm schedule fetches for the on-device illustration: its worker's entry and the URLs of
// its runtime and weights. Kept apart from `facts.ts` because importing a file URL emits the file
// into the bundle that imports it.
export { NEURAL_WORKER_ENTRY, neuralWarmUrls } from './neural/warm';

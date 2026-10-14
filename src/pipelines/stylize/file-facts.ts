// The URLs of the illustration service's model and runtime files, for the warm schedule. Kept apart
// from `facts.ts` because importing a file URL emits the file into the bundle that imports it.
export { ORT_FILES } from './neural/runtime-files';
export { MODEL_URLS } from './neural/models';

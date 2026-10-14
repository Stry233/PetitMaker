// The illustration pipeline's lazy loaders, for the warm schedule in the eager bundle: each names
// its chunk only through a dynamic import, so importing this file loads none of the pipeline.
import { memoLoad } from '../../platform/async/memo-load';

/** The procedural pack renderer, loaded once by its first use or the warm schedule. */
export const loadProcRenderer = memoLoad(() => import('./proc/render'));
export { loadNeuralSession } from './neural/load-session';

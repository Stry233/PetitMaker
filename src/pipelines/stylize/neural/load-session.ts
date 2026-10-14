import { memoLoad } from '../../../platform/async/memo-load';

/** The on-device illustration session, in its own chunk: loaded once, by its first draw or the warm
 *  schedule. Loading it starts no worker. */
export const loadNeuralSession = memoLoad(() => import('./session'));

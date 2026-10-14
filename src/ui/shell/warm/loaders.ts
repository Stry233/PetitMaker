/**
 * One memoized loader per lazy frame chunk, shared by its `React.lazy` site and the warm schedule.
 * Window chunks load through `chrome/loaders.ts`; the web edition's own chunks (the assistant panel,
 * the illustration window) through `edition-surfaces`, so the offline edition, which inlines every
 * reachable chunk, never carries them; a lower layer's chunks (the 3D scene, the road clipper, the
 * stylize renderer) through that layer.
 */
import { memoLoad } from '../../../platform/async/memo-load';

export const loadNewTagCard = memoLoad(() => import('../bars/annotation/NewTagCard'));

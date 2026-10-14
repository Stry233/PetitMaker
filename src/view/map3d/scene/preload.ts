/**
 * The 3D scene chunk (three.js and, through the model registry, the catalog's model table), loaded
 * once for every caller: the 3D view, the export stills and the startup warm schedule.
 *
 * When it matters most is a cold load with 3D as the saved view. `Editor3DCanvas`'s own effect
 * cannot start the fetch any earlier than it runs, and it is a later sibling than `PixiCanvas`,
 * whose mount effect synchronously builds the whole 2D renderer first, so a fetch started there
 * queues behind work that session was never going to show. `preloadScene3D` from the entry point
 * overlaps React's first mount and everything the 2D side does. A session opening in 2D gets the
 * chunk from the warm schedule right after its first paint.
 */
import { memoLoad } from '../../../platform/async/memo-load';

export const loadScene3D = memoLoad(() => import('./map-renderer'));

/** Start fetching the scene now; the real load reports any failure. */
export function preloadScene3D(): void {
  void loadScene3D().catch(() => {});
}

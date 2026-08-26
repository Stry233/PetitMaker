/**
 * "The freshly loaded map is on screen" — one signal, both views.
 *
 * Loading a map is not one moment. From the click that commits a restore to the first frame that
 * shows it, the real order is:
 *
 *   1. the store swaps `gridState` (one React commit, together with whatever chrome reacts to it);
 *   2. the CHILD canvas effect runs first: PixiCanvas re-inits the 2D renderer (synchronously) and
 *      re-fits the camera; Editor3DCanvas starts an ASYNC scene rebuild (a dynamic import, then a
 *      whole-map mesh build) and keeps the previous scene registered meanwhile;
 *   3. the PARENT effect (App) applies the saved camera — deliberately after step 2, so the 2D
 *      fitToMap cannot clobber it. Until here the view is at the WRONG camera;
 *   4. the renderer draws. Both views render ON DEMAND, so this is a frame or more later, and in 3D
 *      it cannot happen at all until the rebuild lands and the new scene registers itself.
 *
 * So neither "a commit happened" nor "a frame passed" means the map is visible. Anything that has to
 * wait for the real thing (the resume-from-last fade) asks here: this waits for the ACTIVE view to
 * be one that renders `state`, then for that view's next painted frame, then for the frame boundary
 * after it — the draw lands inside a frame's rAF phase, so it is composited by that frame's paint,
 * and one more boundary is what makes it visible before the caller acts.
 *
 * A view that cannot report either fact (a synthetic view in a test, a future renderer) falls back
 * to a single frame: this can be early, never a hang.
 */
import type { GridState } from '../core/model/types';
import type { ActiveView } from './view-projection';
import { getActiveView, onActiveViewChange } from './active-view';

/** Call `done` once the active view has painted `state`. Returns a cancel (never calls `done`). */
export function whenActiveViewPainted(state: GridState, done: () => void): () => void {
  let finished = false;
  let raf = 0;
  let armed: ActiveView | null = null;
  let unsubscribe: (() => void) | null = null;

  // One flag for both endings: a cancelled gate must go inert even though a paint waiter it already
  // handed the renderer will still fire (waiters are one-shot, not revocable).
  const stop = (): void => {
    finished = true;
    unsubscribe?.();
    unsubscribe = null;
    cancelAnimationFrame(raf);
  };

  const finish = (): void => {
    if (finished) return;
    stop();
    done();
  };

  const arm = (view: ActiveView | null): void => {
    if (finished || !view || view === armed) return;
    // A view still rendering the previous map has not caught up (the 3D rebuild is async): its next
    // frame would show the OLD map, so wait for the registration of the one that renders `state`.
    if (view.rendersState && view.rendersState() !== state) return;
    armed = view;
    if (!view.onNextPaint) {
      raf = requestAnimationFrame(finish);
      return;
    }
    view.onNextPaint(() => {
      if (finished) return;
      const live = getActiveView();
      if (live !== view || (view.rendersState && view.rendersState() !== state)) {
        armed = null;            // swapped (or reloaded) under us — follow the live view instead
        arm(live);
        return;
      }
      raf = requestAnimationFrame(finish);
    });
  };

  unsubscribe = onActiveViewChange((view) => arm(view));
  arm(getActiveView());
  return stop;
}

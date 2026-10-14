/**
 * "The freshly loaded map is on screen", one signal for both views. Loading runs in order:
 *
 *   1. the store swaps `gridState` in one React commit;
 *   2. the child canvas effect runs: PixiCanvas re-inits the 2D renderer and re-fits the camera;
 *      Editor3DCanvas starts an async scene rebuild and keeps the previous scene registered;
 *   3. the parent effect (App) applies the saved camera, after step 2 so fitToMap cannot clobber it;
 *   4. the renderer draws on demand, a frame or more later, and in 3D only once the rebuild lands.
 *
 * So this waits for the active view to be one that renders `state`, then its next painted frame,
 * then one more frame boundary, since the draw lands in a frame's rAF phase and is composited by
 * that frame's paint.
 */
import type { GridState } from '../core/model/types';
import type { ActiveView } from '../tools/pointer/runtime';
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
    // frame would show the old map, so wait for the registration of the one that renders `state`.
    if (view.rendersState() !== state) return;
    armed = view;
    view.onNextPaint(() => {
      if (finished) return;
      const live = getActiveView();
      if (live !== view || view.rendersState() !== state) {
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

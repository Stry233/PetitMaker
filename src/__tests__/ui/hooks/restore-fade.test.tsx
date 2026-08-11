/**
 * The resume-from-last fade, which is an ORDER: a restore is not one commit. The map swap, the
 * camera apply (a later effect) and the first painted frame (later still, and in 3D behind an async
 * scene rebuild) are three separate moments, and the fade has to stay engaged across all of them.
 * Releasing on a frame count instead showed the EMPTY map fading in and left the camera to snap
 * afterwards — the discontinuity the fade exists to hide.
 *
 * These pin the sequence, the deferred 3D view, and the two safety nets: a restore that throws and a
 * view that never reports a paint both still release (a canvas parked at opacity 0 is the one
 * unacceptable outcome). Reduced motion skips the hide entirely.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { useRestoreFade } from '../../../ui/hooks/useRestoreFade';
import { setReducedMotion, __resetMotionState } from '../../../canvas/map2d/motion-state';
import { setActiveView } from '../../../canvas/active-view';
import type { ActiveView } from '../../../canvas/view-projection';
import type { GridState } from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';

let begin: () => void;
let settle: (state: GridState) => void;

function Host() {
  const fade = useRestoreFade();
  begin = fade.begin;
  settle = fade.settle;
  return <div data-testid="view" style={{ opacity: fade.hidden ? 0 : 1 }} />;
}

const opacity = () => screen.getByTestId('view').style.opacity;
const shown = () => (opacity() === '0' ? 'hidden' : 'visible');

/** A view double reporting the two facts the gate asks for: which map it renders, and when it drew. */
function makeView(renders: GridState | null) {
  const waiters: Array<() => void> = [];
  const view = {
    rendersState: () => renders,
    onNextPaint: (cb: () => void) => { waiters.push(cb); },
  } as unknown as ActiveView;
  return {
    view,
    /** The renderer drew a frame. */
    paint: () => { for (const cb of waiters.splice(0)) cb(); },
    pending: () => waiters.length,
  };
}

/** Let one animation frame pass (the gate hands off across a frame boundary). */
async function nextFrame(): Promise<void> {
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
}

afterEach(() => {
  cleanup();
  setActiveView(null);
  __resetMotionState();
  vi.useRealTimers();
});

describe('useRestoreFade', () => {
  it('stays engaged through the map, the camera and the paint, and releases only after', async () => {
    const restored = makeState(8, 8) as GridState;
    const view = makeView(restored);
    render(<Host />);
    const order: string[] = [];
    order.push(`start: ${shown()}`);

    // 1. the commit that swaps the map also hides the view
    act(() => { begin(); });
    order.push(`map applied: ${shown()}`);

    // 2. the canvas re-inits for the new map and re-registers its view (the child effect)
    act(() => { setActiveView(view.view); });
    order.push(`view caught up: ${shown()}`);

    // 3. the saved camera lands in App's effect, which then arms the release
    act(() => { settle(restored); });
    order.push(`camera applied: ${shown()}`);

    // 4. the renderer draws the restored map at that camera
    act(() => { view.paint(); });
    order.push(`painted: ${shown()}`);

    // 5. one frame boundary later it is composited, so the fade has something to fade in
    await nextFrame();
    order.push(`on screen: ${shown()}`);

    expect(order).toEqual([
      'start: visible',
      'map applied: hidden',
      'view caught up: hidden',
      'camera applied: hidden',
      'painted: hidden',
      'on screen: visible',
    ]);
  });

  it('waits for the view that renders the RESTORED map, not the one still showing the old one', async () => {
    // The 3D case: the scene is rebuilt behind an async import, so the registered view keeps
    // rendering the previous map for a while. Its frames must not count.
    const previous = makeState(8, 8) as GridState;
    const restored = makeState(8, 8) as GridState;
    const stale = makeView(previous);
    const rebuilt = makeView(restored);
    render(<Host />);

    act(() => { setActiveView(stale.view); });
    act(() => { begin(); });
    act(() => { settle(restored); });
    expect(stale.pending()).toBe(0);       // never armed: it shows the wrong map
    act(() => { stale.paint(); });
    await nextFrame();
    expect(opacity()).toBe('0');           // still covered — the empty map must not fade in

    act(() => { setActiveView(rebuilt.view); });  // the rebuilt scene registers itself
    act(() => { rebuilt.paint(); });
    expect(opacity()).toBe('0');
    await nextFrame();
    expect(opacity()).toBe('1');
  });

  it('under reduced motion the view never hides: the restore simply arrives', async () => {
    setReducedMotion(true);
    const restored = makeState(8, 8) as GridState;
    render(<Host />);
    act(() => { begin(); });
    expect(opacity()).toBe('1');
    act(() => { settle(restored); });      // nothing to release, nothing to gate
    expect(opacity()).toBe('1');
    await nextFrame();
    expect(opacity()).toBe('1');
  });

  it('releases even if the restore throws before the map changes', async () => {
    render(<Host />);
    act(() => {
      try {
        begin();
        throw new Error('restore failed');
      } catch { /* the release is the effect's job, not the caller's */ }
    });
    expect(opacity()).toBe('0');
    // No settle() followed, so there is no restored state to wait for: the next frame releases.
    await nextFrame();
    expect(opacity()).toBe('1');
  });

  it('releases on the safety bound when the view never reports a paint', () => {
    vi.useFakeTimers();
    const restored = makeState(8, 8) as GridState;
    const view = makeView(restored);
    render(<Host />);
    act(() => { setActiveView(view.view); });
    act(() => { begin(); });
    act(() => { settle(restored); });
    expect(opacity()).toBe('0');
    act(() => { vi.advanceTimersByTime(3999); });
    expect(opacity()).toBe('0');
    act(() => { vi.advanceTimersByTime(1); });
    expect(opacity()).toBe('1');           // a hidden canvas is never the resting state
  });

  it('falls back to one frame for a view that cannot report paints', async () => {
    const restored = makeState(8, 8) as GridState;
    render(<Host />);
    act(() => { setActiveView({} as unknown as ActiveView); });
    act(() => { begin(); });
    act(() => { settle(restored); });
    expect(opacity()).toBe('0');
    await nextFrame();
    expect(opacity()).toBe('1');
  });
});

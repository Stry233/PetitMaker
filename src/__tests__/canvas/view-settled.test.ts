/**
 * `whenActiveViewPainted`: the "the freshly loaded map is on screen" signal both views feed.
 *
 * The gate has to survive the view being SWAPPED mid-wait (a 2D↔3D toggle, or the 3D scene handing
 * over to a rebuilt one) and has to be cancellable, since the caller that waits on it — the restore
 * fade — can be unmounted before the frame ever lands.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { whenActiveViewPainted } from '../../canvas/view-settled';
import { setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import type { GridState } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

function makeView(renders: GridState | null) {
  const waiters: Array<() => void> = [];
  const view = {
    rendersState: () => renders,
    onNextPaint: (cb: () => void) => { waiters.push(cb); },
  } as unknown as ActiveView;
  return { view, paint: () => { for (const cb of waiters.splice(0)) cb(); }, pending: () => waiters.length };
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

afterEach(() => setActiveView(null));

describe('whenActiveViewPainted', () => {
  it('resolves one frame after the active view paints the state', async () => {
    const state = makeState(8, 8) as GridState;
    const view = makeView(state);
    setActiveView(view.view);
    const done = vi.fn();
    whenActiveViewPainted(state, done);
    view.paint();
    expect(done).not.toHaveBeenCalled();   // drawn, not yet composited
    await frame();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('ignores a view rendering another map until the right one registers', async () => {
    const previous = makeState(8, 8) as GridState;
    const state = makeState(8, 8) as GridState;
    const stale = makeView(previous);
    const fresh = makeView(state);
    setActiveView(stale.view);
    const done = vi.fn();
    whenActiveViewPainted(state, done);
    expect(stale.pending()).toBe(0);
    stale.paint();
    await frame();
    expect(done).not.toHaveBeenCalled();

    setActiveView(fresh.view);
    fresh.paint();
    await frame();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('follows the live view when the one it armed is no longer active', async () => {
    const state = makeState(8, 8) as GridState;
    const first = makeView(state);
    const second = makeView(state);
    setActiveView(first.view);
    const done = vi.fn();
    whenActiveViewPainted(state, done);
    setActiveView(second.view);   // the view was swapped for another rendering the same map
    first.paint();                // the outgoing one's frame does not count
    await frame();
    expect(done).not.toHaveBeenCalled();
    second.paint();
    await frame();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('cancel stops it for good', async () => {
    const state = makeState(8, 8) as GridState;
    const view = makeView(state);
    setActiveView(view.view);
    const done = vi.fn();
    const cancel = whenActiveViewPainted(state, done);
    cancel();
    view.paint();
    await frame();
    expect(done).not.toHaveBeenCalled();
  });
});

/** The stills a surface shows by camera angle: each angle is captured once for a map and kept. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStillShelf } from '../../../../view/map3d/capture/stills';
import type { CameraAngle } from '../../../../state/view-camera';
import { makeState } from '../../../_support/map-state';

const A = (az: number): CameraAngle => ({ az, el: 40, dist: 0.9 });
const still = (angle: CameraAngle): string => `still:${angle.az}`;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function shelfOver() {
  const capture = vi.fn(async (_state: unknown, angles?: unknown[]) => (angles as CameraAngle[]).map(still));
  return { capture, shelf: createStillShelf({ maxPx: 64, aspect: 1, settleMs: 100, capture: capture as never }) };
}

describe('the still shelf', () => {
  it('captures only the angles it has not kept, after the list has settled', async () => {
    const { capture, shelf } = shelfOver();
    const map = makeState(8, 8);
    shelf.show(map, [A(0), A(40)]);
    expect(shelf.snapshot()).toEqual({ urls: ['', ''], loading: true });
    expect(capture).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(shelf.snapshot()).toEqual({ urls: ['still:0', 'still:40'], loading: false });

    // A shot dropped and the rest reordered: nothing is captured, and the stills stand at once.
    shelf.show(map, [A(40)]);
    expect(shelf.snapshot()).toEqual({ urls: ['still:40'], loading: false });
    shelf.show(map, [A(40), A(0), A(80)]);
    expect(shelf.snapshot()).toEqual({ urls: ['still:40', 'still:0', ''], loading: true });
    await vi.runAllTimersAsync();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[1]![1]).toEqual([A(80)]);
    expect(shelf.snapshot().urls).toEqual(['still:40', 'still:0', 'still:80']);
  });

  it('forgets every still for another map, and shows none without one', async () => {
    const { capture, shelf } = shelfOver();
    shelf.show(makeState(8, 8), [A(0)]);
    await vi.runAllTimersAsync();
    shelf.show(makeState(8, 8), [A(0)]);
    expect(shelf.snapshot()).toEqual({ urls: [''], loading: true });
    await vi.runAllTimersAsync();
    expect(capture).toHaveBeenCalledTimes(2);
    shelf.show(null, [A(0)]);
    expect(shelf.snapshot()).toEqual({ urls: [], loading: false });
  });
});

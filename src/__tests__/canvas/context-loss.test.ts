import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchContextLoss } from '../../canvas/context-loss';

/** A canvas whose context reports lost on demand. */
function rig(lost = false) {
  const canvas = document.createElement('canvas');
  const state = { lost };
  const onUnrecovered = vi.fn();
  const stop = watchContextLoss(canvas, { isLost: () => state.lost, onUnrecovered, graceMs: 1000 });
  return { canvas, state, onUnrecovered, stop };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('watching a WebGL context', () => {
  it('reports a loss the engine never gives back once the grace runs out', () => {
    const { canvas, state, onUnrecovered } = rig();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    state.lost = true;
    vi.advanceTimersByTime(999);
    expect(onUnrecovered).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onUnrecovered).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the context is restored within the grace', () => {
    const { canvas, state, onUnrecovered } = rig();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    state.lost = true;
    vi.advanceTimersByTime(400);
    state.lost = false;
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    vi.advanceTimersByTime(2000);
    expect(onUnrecovered).not.toHaveBeenCalled();
  });

  it('reports a context found lost when the page comes back into view', () => {
    const { state, onUnrecovered } = rig();
    state.lost = true;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onUnrecovered).toHaveBeenCalledTimes(1);
  });

  it('reports once and stops listening after stop()', () => {
    const { canvas, state, onUnrecovered, stop } = rig();
    canvas.dispatchEvent(new Event('webglcontextlost'));
    state.lost = true;
    vi.advanceTimersByTime(1000);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    vi.advanceTimersByTime(1000);
    expect(onUnrecovered).toHaveBeenCalledTimes(1);
    stop();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onUnrecovered).toHaveBeenCalledTimes(1);
  });
});

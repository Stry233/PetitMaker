/** The development check warns once a rested scene draws differently from its last painted frame. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MissedRenderCheck } from '../../../../view/map2d/scene/missed-render-check';

/** A frame read that returns whatever `frame.value` holds. */
function fakeFrame(frame: { value: number }): () => Uint8Array {
  return () => new Uint8Array([frame.value, 0, 0, 255]);
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('MissedRenderCheck', () => {
  it('warns when the scene changed at rest without a request', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frame = { value: 1 };
    // The scene changed unannounced: only the check's own redraw shows it.
    const draw = vi.fn(() => { frame.value = 2; });
    const check = new MissedRenderCheck(fakeFrame(frame), draw);
    check.rested();
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('stays quiet for an unchanged scene and for a paint that cancels it', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const frame = { value: 1 };
    const draw = vi.fn();
    const check = new MissedRenderCheck(fakeFrame(frame), draw);
    check.rested();
    vi.advanceTimersByTime(1000);
    check.rested();
    frame.value = 2;
    check.cancel();
    vi.advanceTimersByTime(1000);
    expect(draw).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });
});

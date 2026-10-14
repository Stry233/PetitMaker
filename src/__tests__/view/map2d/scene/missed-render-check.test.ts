/** The development check warns once a rested scene draws differently from its last painted frame. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MissedRenderCheck, viewFrameReader } from '../../../../view/map2d/scene/missed-render-check';

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
    const draw = vi.fn();
    const check = new MissedRenderCheck(fakeFrame(frame), draw);
    check.rested();
    frame.value = 2;
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

  it('reads the view through a copy, so the view itself never answers a readback', () => {
    const view = { width: 2, height: 1, getContext: vi.fn() } as unknown as HTMLCanvasElement;
    const pixels = new Uint8ClampedArray(8).fill(7);
    const ctx = { clearRect: vi.fn(), drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: pixels })) };
    const scratch = { width: 0, height: 0, getContext: vi.fn(() => ctx) } as unknown as HTMLCanvasElement;
    const read = viewFrameReader(view, scratch);
    expect(read()).toBe(pixels);
    expect(read()).toBe(pixels);
    expect(view.getContext).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(view, 0, 0);
    expect(scratch.getContext).toHaveBeenCalledOnce();
    expect(scratch.getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect([scratch.width, scratch.height]).toEqual([2, 1]);
  });
});

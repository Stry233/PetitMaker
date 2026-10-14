/**
 * The region-selection channel is a channel, not a global: the screen that arms it registers what
 * to do with a painted cell and with the two whole-region edits, and the pointer machine reports
 * cells without knowing who is listening.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  clearRegionSelection, finishRegionStroke, paintRegionCell, setRegionBrushHandler, type RegionBrushHandler,
} from '../../../../tools/pointer/region/channel';

const handler = (): RegionBrushHandler => ({
  paint: vi.fn(), done: vi.fn(), clear: vi.fn(),
});

describe('region selection channel', () => {
  it('painting with nothing registered is a no-op', () => {
    expect(() => paintRegionCell({ x: 1, y: 1 })).not.toThrow();
    expect(() => clearRegionSelection()).not.toThrow();
  });

  it('delivers painted cells to the registered handler', () => {
    const h = handler();
    const off = setRegionBrushHandler(h);
    paintRegionCell({ x: 3, y: 4 });
    finishRegionStroke();
    expect(h.paint).toHaveBeenCalledWith({ x: 3, y: 4 });
    expect(h.done).toHaveBeenCalled();
    off();
  });

  /** The whole-region edit goes the same way, and it has to: the collector owns the buffer and
   *  its own undo stack, so a screen that wrote the store directly would leave both behind. */
  it('delivers the whole-region clear to the same handler', () => {
    const h = handler();
    const off = setRegionBrushHandler(h);
    clearRegionSelection();
    expect(h.clear).toHaveBeenCalled();
    off();
  });

  it('a stale unregister cannot revoke a newer handler', () => {
    const offFirst = setRegionBrushHandler(handler());
    const second = handler();
    setRegionBrushHandler(second);
    offFirst();
    paintRegionCell({ x: 0, y: 0 });
    expect(second.paint).toHaveBeenCalled();
  });
});

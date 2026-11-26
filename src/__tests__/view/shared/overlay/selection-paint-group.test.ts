/** A placed blueprint's selection is its frame in brackets, never the exact flat rectangle. */
import { describe, it, expect, vi } from 'vitest';
import { paintSelection } from '../../../../view/shared/overlay/selection-paint';
import { makeState } from '../../../_support/map-state';
import type { ToolOverlay } from '../../../../tools/pointer/runtime';

describe('paintSelection of a placed blueprint', () => {
  it('draws its frame once as brackets, not as an exact rectangle', () => {
    const showSelection = vi.fn();
    const overlay = { showSelection, clearSelection: vi.fn() } as unknown as ToolOverlay;
    const frame = { x: 4, y: 5, w: 6, h: 7 };
    paintSelection(overlay, makeState(20, 20), [], false, { outline: frame });
    expect(showSelection).toHaveBeenCalledTimes(1);
    expect(showSelection).toHaveBeenCalledWith(frame, 'object');
  });
});

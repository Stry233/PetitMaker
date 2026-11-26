/**
 * One step of the interface scale, as the Settings slider's arrows and the scale keys take it (UI-34):
 * on the scale's stops up to the slider's reach, and never up toward the reach from a preference
 * saved past it.
 */
import { describe, expect, it } from 'vitest';
import { uiZoomStep } from '../../../platform/storage/prefs';

const pc = (uiZoom: number) => ({ uiZoom, inputMode: 'pc' as const, layoutShape: 'landscape' as const });

describe('a step of the interface scale', () => {
  it('moves one stop either way within the reach', () => {
    expect(uiZoomStep(pc(1), 1.5, 1)).toBe(1.05);
    expect(uiZoomStep(pc(1), 1.5, -1)).toBe(0.95);
  });

  it('changes nothing past the reach', () => {
    expect(uiZoomStep(pc(1.5), 1.5, 1)).toBeNull();
  });

  it('steps a preference saved past the reach down from the reach, and never lowers it on a step up', () => {
    expect(uiZoomStep(pc(1.8), 1.5, 1)).toBeNull();
    expect(uiZoomStep(pc(1.8), 1.5, -1)).toBe(1.45);
  });
});

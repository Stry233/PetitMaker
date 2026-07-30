/**
 * The selection ring's pop must weigh the same whatever it surrounds.
 *
 * It animates a SCALE, so a fixed fraction moves a big box's edges proportionally further: at
 * the original 0.2, a 1x1 tree's ring travelled ~13px while the 9x9 plaza's travelled ~115px
 * with an overshoot to match, which read as a lurch on one and a tick on the other.
 */
import './_pixi-env'; // object-animations reaches PIXI, which needs jsdom's missing 2D context
import { describe, it, expect } from 'vitest';
import { selectionPopAmplitude } from '../../canvas/map2d/layers/object-animations';
import { animConfig } from '../../core/runtime/anim-config';
import { TILE_SIZE } from '../../core/model/constants';

const travel = (cells: number) => selectionPopAmplitude(cells * TILE_SIZE) * cells * TILE_SIZE;

describe('selection pop amplitude', () => {
  it('moves the ring the same distance for a 1x1 and for a plaza-sized box', () => {
    expect(travel(9)).toBeCloseTo(travel(2), 5);
    expect(travel(9)).toBeCloseTo(animConfig.selectionPop.travelPx, 5);
  });

  it('never exceeds the amplitude a 1x1 has always had', () => {
    // travelPx / 64 would be a big fraction of a sub-tile box, so the clamp holds the ceiling.
    expect(selectionPopAmplitude(TILE_SIZE)).toBeLessThanOrEqual(animConfig.selectionPop.maxAmp);
    expect(selectionPopAmplitude(4)).toBe(animConfig.selectionPop.maxAmp);
  });

  it('shrinks the fraction as the box grows, which is what keeps the travel constant', () => {
    expect(selectionPopAmplitude(9 * TILE_SIZE)).toBeLessThan(selectionPopAmplitude(TILE_SIZE));
  });

  it('is finite and positive for a degenerate box, so the ring can never vanish', () => {
    for (const span of [0, -1, Number.NaN]) {
      const amp = selectionPopAmplitude(span);
      expect(Number.isFinite(amp) || Number.isNaN(span)).toBe(true);
      if (!Number.isNaN(span)) expect(amp).toBeGreaterThan(0);
    }
  });
});

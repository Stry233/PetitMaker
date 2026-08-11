// V1 PRESENTATION: pins the spotlight ring's corner-radius formula; expected to be removed with
// the v1 tour visuals.
/**
 * The tour spotlight's corner radius. It is drawn in unzoomed screen px over controls that ARE
 * zoomed, so a constant radius is only ever right at one scale — and on a phone, where the whole UI
 * is scaled well down, it is wider than the target it is meant to be tracing.
 */
import { describe, it, expect } from 'vitest';
import { spotlightRx } from '../../../ui/chrome/tour/TourOverlay';
import { radii } from '../../../ui/design/styles';

describe('spotlightRx', () => {
  it('matches the traced control: the css radius, scaled by the chrome zoom', () => {
    expect(spotlightRx(400, 200, 1)).toBe(radii.lg);
    expect(spotlightRx(400, 200, 0.5)).toBe(radii.lg * 0.5);
    expect(spotlightRx(400, 200, 1.4)).toBe(radii.lg * 1.4);
  });

  it('never exceeds half the box, so a small target is not rounded into a pill', () => {
    // A phone's scaled-down UI puts real targets well under the design radius. Reported as
    // highlights with far too much corner, and unreproducible on a desktop for exactly that reason.
    expect(spotlightRx(20, 12, 1)).toBe(6);
    expect(spotlightRx(12, 40, 1)).toBe(6);
  });

  it('keeps a corner rather than collapsing to a sharp rect on a sliver', () => {
    expect(spotlightRx(2, 1, 1)).toBe(2);
    expect(spotlightRx(0, 0, 1)).toBe(2);
  });

  it('is the smaller of the two constraints, whichever binds', () => {
    // Small box, large zoom: the box wins. Large box, small zoom: the zoom wins.
    expect(spotlightRx(30, 30, 4)).toBe(15);
    expect(spotlightRx(900, 900, 0.25)).toBe(radii.lg * 0.25);
  });
});

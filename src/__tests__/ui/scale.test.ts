import { describe, it, expect } from 'vitest';
import { computeScale, chromeScaleOf, DESIGN_VH_CAP } from '../../ui/menu/scale';
import { CANVAS } from '../../ui/menu/metrics';

/**
 * The menu scale maps the 1918px design canvas onto the viewport height, but the
 * mapped height is CAPPED at DESIGN_VH_CAP: past ~1440p-css the UI stops growing
 * with the viewport (a 4K/100% desktop otherwise renders every panel ~2x its
 * laptop size). Modals follow the SAME factor via chromeScaleOf (normalized to 1
 * at a 1080-tall viewport), so the modal:menu size ratio is monitor-independent.
 */
describe('computeScale', () => {
  it('is vh-proportional below the cap (1080p ≈ 0.563)', () => {
    expect(computeScale(1080)).toBeCloseTo(1080 / CANVAS.h, 5);
    expect(computeScale(1440)).toBeCloseTo(1440 / CANVAS.h, 5);
  });

  it('stops growing past the cap (4K@100% maps like 1440p, not 2160)', () => {
    expect(computeScale(2160)).toBeCloseTo(DESIGN_VH_CAP / CANVAS.h, 5);
    expect(computeScale(2160)).toBeCloseTo(computeScale(1440), 5);
  });
});

/**
 * Page zoom divides the CSS viewport and multiplies devicePixelRatio by the same
 * factor, so scale × dpr — the UI's size in real screen pixels — is what must not
 * move when the user zooms. Below the cap that falls out of the vh-proportional
 * mapping; the cap is a CSS-px threshold, so zooming OUT used to push the viewport
 * past it and shrink the UI on screen, which is backwards.
 */
describe('computeScale under page zoom', () => {
  const onScreen = (vh: number, dpr: number) => computeScale(vh, dpr) * dpr;

  it('holds the on-screen size when zooming OUT past the cap', () => {
    const base = onScreen(1080, 1); // 1080p at 100%
    expect(onScreen(2160, 0.5)).toBeCloseTo(base, 5);  // 50% zoom: vh doubles, dpr halves
    expect(onScreen(1543, 0.7)).toBeCloseTo(base, 2);  // 70%
    expect(onScreen(3273, 0.33)).toBeCloseTo(base, 2); // 33%
  });

  it('holds it when zooming IN too (already below the cap there)', () => {
    const base = onScreen(1080, 1);
    expect(onScreen(864, 1.25)).toBeCloseTo(base, 5);
    expect(onScreen(720, 1.5)).toBeCloseTo(base, 5);
    expect(onScreen(540, 2)).toBeCloseTo(base, 5);
  });

  it('leaves every real display alone: dpr >= 1 keeps the plain cap', () => {
    // A display's device-pixel-ratio is never below 1, so only a zoomed-out page
    // reaches the branch. At dpr >= 1 zoom and display scale are the same number
    // and cannot be separated, so the cap must not be second-guessed there.
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      expect(computeScale(2160, dpr)).toBeCloseTo(DESIGN_VH_CAP / CANVAS.h, 5);
      expect(computeScale(1080, dpr)).toBeCloseTo(1080 / CANVAS.h, 5);
      expect(computeScale(1800, dpr)).toBeCloseTo(DESIGN_VH_CAP / CANVAS.h, 5); // HiDPI laptop
      expect(computeScale(900, dpr)).toBeCloseTo(900 / CANVAS.h, 5);
    }
  });
});

describe('chromeScaleOf', () => {
  it('is ~1 at a 1080p-css viewport (current chrome sizes preserved)', () => {
    expect(chromeScaleOf(computeScale(1080))).toBeCloseTo(1, 5);
  });

  it('tracks the menu scale EXACTLY — one scaling logic for the whole UI', () => {
    for (const h of [500, 1067, 1440, 2160]) {
      const menu = computeScale(h);
      expect(chromeScaleOf(menu) / chromeScaleOf(computeScale(1080))).toBeCloseTo(
        menu / computeScale(1080), 5,
      );
    }
  });

  it('caps with the menu on 4K@100% instead of doubling (1440/1080 ≈ 1.33)', () => {
    expect(chromeScaleOf(computeScale(2160))).toBeCloseTo(DESIGN_VH_CAP / 1080, 5);
  });

  it('includes the user UI zoom (the menu scale already carries it)', () => {
    const base = computeScale(1080);
    expect(chromeScaleOf(base * 1.2)).toBeCloseTo(1.2, 2);
  });
});

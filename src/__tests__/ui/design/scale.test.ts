import { describe, it, expect } from 'vitest';
import {
  CANVAS, CONTENT_BOTTOM_Y, computeScale, chromeScaleOf, DESIGN_VH_CAP, touchBoost, TOUCH_BOOST_MAX,
} from '../../../ui/design/scale';
import { pageZoom } from '../../../core/runtime/page-zoom';

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

  it('holds it past the cap in BOTH directions, which the css-px cap could not', () => {
    // The cap is now compared against the unzoomed height, so a viewport that is over it stays over
    // it at every zoom and the UI keeps one physical size throughout. Each pair below is the same
    // physical viewport (vh x dpr constant), well past the cap.
    const capped = onScreen(2160, 1);
    expect(onScreen(1080, 2)).toBeCloseTo(capped, 5);
    expect(onScreen(1728, 1.25)).toBeCloseTo(capped, 5);
    expect(onScreen(4320, 0.5)).toBeCloseTo(capped, 5);
  });

  it('still caps: a huge viewport does not grow the UI without limit', () => {
    // The whole point of the cap survives the change — it just measures in a unit zoom cannot move.
    expect(computeScale(2160, 1)).toBeCloseTo(DESIGN_VH_CAP / CANVAS.h, 5);
    expect(computeScale(1080, 1)).toBeCloseTo(1080 / CANVAS.h, 5);
    expect(computeScale(900, 1)).toBeCloseTo(900 / CANVAS.h, 5);
  });

  it('treats the dpr the page LOADED at as its zero, so a HiDPI display is not read as zoom', () => {
    // pageZoom is relative to the load-time ratio, so an unzoomed page reports 1 whatever the
    // display's own scaling is. Under jsdom that baseline is 1.
    expect(pageZoom(window.devicePixelRatio || 1)).toBeCloseTo(1, 5);
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

describe('touch boost', () => {
  it('leaves a desktop alone at every viewport height', () => {
    // Gated on the POINTER, not on size: a narrow desktop window is normal and must keep desktop
    // proportions. A boost keyed on height alone would fire for every half-screen browser.
    for (const vh of [320, 500, 700, 1080, 2160]) expect(touchBoost(vh, false)).toBe(1);
  });

  it('gives a phone the full boost', () => {
    // A phone in landscape is ~390 css px tall, where the design canvas maps to ~20% and the card
    // lands at barely an inch and a half.
    expect(touchBoost(390, true)).toBeGreaterThan(TOUCH_BOOST_MAX * 0.97);
    expect(touchBoost(380, true)).toBe(TOUCH_BOOST_MAX);
    expect(touchBoost(300, true)).toBe(TOUCH_BOOST_MAX);   // clamped, never past the ceiling
  });

  it('leaves a large tablet alone, so only the devices that need it are changed', () => {
    expect(touchBoost(820, true)).toBe(1);
    expect(touchBoost(700, true)).toBe(1);
  });

  it('ramps between the two rather than stepping', () => {
    const mid = touchBoost(540, true);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(TOUCH_BOOST_MAX);
    expect(touchBoost(450, true)).toBeGreaterThan(mid);
  });

  it('never draws the UI past the bottom of the screen', () => {
    // The ceiling is the room the layout has: the plain mapping fits the whole design canvas, and
    // the boost may only spend what the UI leaves empty below itself. This is the property the
    // number exists for — a phone whose Generate panel hangs off the bottom is worse than a
    // small card.
    for (const vh of [300, 340, 390, 430, 500, 620, 700]) {
      const lowest = computeScale(vh, 1, true) * CONTENT_BOTTOM_Y;
      expect(lowest, `UI bottom at vh=${vh}`).toBeLessThanOrEqual(vh);
    }
  });

  it('reaches the scale itself, and only for touch', () => {
    expect(computeScale(380, 1, true) / computeScale(380, 1, false)).toBeCloseTo(TOUCH_BOOST_MAX, 5);
    expect(computeScale(1080, 1, true)).toBe(computeScale(1080, 1, false));
  });
});

import { describe, it, expect } from 'vitest';
import { FIT_FLOOR, FIT_REF, fittedUiScale, frameFit } from '../../../ui/design/scale';
import { ZOOM } from '../../../ui/shell/units';

/**
 * ONE factor sizes the interface: `frameFit`. The frame draws at `ZOOM × fit`, the chrome (modals,
 * toasts, corner controls) at `fit`, so the icons and the words cannot disagree about how big the
 * window is. Mapping the chrome's design canvas onto viewport HEIGHT instead draws the frame at full
 * size and Settings at 0.80 on a maximized-but-not-fullscreen 1080p Chrome, whose viewport is 869 css
 * px tall.
 */
describe('frameFit', () => {
  it('is 1 at and above the reference window', () => {
    expect(frameFit(FIT_REF.w, FIT_REF.h)).toBe(1);
    expect(frameFit(3840, 2160)).toBe(1);
    expect(frameFit(1600, 900)).toBe(1);
  });

  it('follows the tighter axis below it', () => {
    expect(frameFit(1280, 720)).toBeCloseTo(720 / FIT_REF.h, 6);
    expect(frameFit(1024, 800)).toBeCloseTo(1024 / FIT_REF.w, 6);
  });

  it('never goes under the tap floor', () => {
    expect(frameFit(844, 390)).toBe(FIT_FLOOR);
    expect(frameFit(1, 1)).toBe(FIT_FLOOR);
  });
});

describe('chrome and frame agree at every window shape', () => {
  /** What the two hooks compute, without React: the frame's zoom and the chrome's `zoom`. */
  const frameZoom = (vw: number, vh: number, uiZoom = 1) => ZOOM * fittedUiScale(vw, vh, uiZoom);
  const chromeZoom = (vw: number, vh: number, uiZoom = 1) => fittedUiScale(vw, vh, uiZoom);

  const SHAPES: [number, number, string][] = [
    [1920, 869, 'maximized 1080p Chrome on Windows'],
    [1920, 1080, 'fullscreen 1080p'],
    [2560, 1440, '1440p'],
    [3840, 2160, '4K at 100%'],
    [1366, 768, 'laptop'],
    [1280, 800, 'the reference window'],
    [1100, 700, 'a small window'],
    [844, 390, 'a phone in landscape'],
  ];

  it('holds one chrome:frame ratio, whatever the window', () => {
    for (const [vw, vh, what] of SHAPES) {
      expect(chromeZoom(vw, vh) / frameZoom(vw, vh), what).toBeCloseTo(1 / ZOOM, 6);
    }
  });

  it('holds it through the user UI zoom as well', () => {
    for (const uiZoom of [0.7, 1, 1.4]) {
      for (const [vw, vh, what] of SHAPES) {
        expect(chromeZoom(vw, vh, uiZoom) / frameZoom(vw, vh, uiZoom), `${what} @ ${uiZoom}`)
          .toBeCloseTo(1 / ZOOM, 6);
      }
    }
  });

  it('draws the chrome at its designed size in any window at or above the reference', () => {
    // 1 is where the modals' fixed-px designs read right, and it is what a 1080-tall viewport gives:
    // the shape everything was judged in is the shape every window at or above the reference gets.
    for (const [vw, vh] of SHAPES.filter(([w, h]) => w >= FIT_REF.w && h >= FIT_REF.h)) {
      expect(chromeZoom(vw, vh)).toBe(1);
    }
  });

  it('shrinks chrome and frame TOGETHER below the reference', () => {
    const small = chromeZoom(1100, 700);
    expect(small).toBeLessThan(1);
    expect(small).toBeCloseTo(1100 / FIT_REF.w, 6); // width is the tighter axis here
    expect(frameZoom(1100, 700)).toBeCloseTo(ZOOM * small, 6);
  });

  it('carries the user UI zoom straight through', () => {
    expect(chromeZoom(1920, 1080, 1.2)).toBeCloseTo(1.2, 6);
  });
});

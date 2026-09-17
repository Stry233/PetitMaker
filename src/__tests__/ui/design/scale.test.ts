import { describe, it, expect } from 'vitest';
import { FIT_FLOOR, FIT_FLOOR_TOUCH, FIT_REF, MIN_UI_ROOM, UI_ZOOM_MAX, fitFloorFor, fittedUiScale, frameFit, reachableUiZoom } from '../../../ui/design/scale';
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

describe('the touch floor', () => {
  it('is lower than the pointer floor and chosen by the primary pointer', () => {
    expect(FIT_FLOOR_TOUCH).toBeLessThan(FIT_FLOOR);
    expect(fitFloorFor(true)).toBe(FIT_FLOOR_TOUCH);
    expect(fitFloorFor(false)).toBe(FIT_FLOOR);
  });

  it('lets a landscape phone fit smaller than the pointer floor', () => {
    expect(frameFit(844, 390, 0, FIT_FLOOR_TOUCH)).toBe(FIT_FLOOR_TOUCH);
    expect(fittedUiScale(780, 300, 1, 0, FIT_FLOOR_TOUCH)).toBe(FIT_FLOOR_TOUCH);
  });

  it('gives the UI scale preference room to act on a phone', () => {
    expect(fittedUiScale(844, 390, 1.2, 0, FIT_FLOOR_TOUCH)).toBeCloseTo(0.6, 6);
  });

  it('changes nothing where the window fits above the pointer floor', () => {
    expect(frameFit(1024, 768, 0, FIT_FLOOR_TOUCH)).toBe(frameFit(1024, 768));
    expect(fittedUiScale(1280, 800, 1, 0, FIT_FLOOR_TOUCH)).toBe(1);
  });
});

describe('reachableUiZoom', () => {
  it('is the whole range where the workspace minimum never caps the scale', () => {
    expect(reachableUiZoom(1920, 1080)).toBe(UI_ZOOM_MAX);
    expect(reachableUiZoom(2560, 1440)).toBe(UI_ZOOM_MAX);
  });

  it('stops where the workspace minimum caps a short window', () => {
    const reach = reachableUiZoom(844, 390);
    expect(reach).toBeCloseTo((390 / MIN_UI_ROOM.h) / FIT_FLOOR, 3);
    expect(fittedUiScale(844, 390, reach + 0.1)).toBeCloseTo(fittedUiScale(844, 390, reach), 6);
    expect(fittedUiScale(844, 390, reach - 0.1)).toBeLessThan(fittedUiScale(844, 390, reach));
  });

  it('reads the touch floor', () => {
    expect(reachableUiZoom(844, 390, 0, FIT_FLOOR_TOUCH)).toBeCloseTo((390 / MIN_UI_ROOM.h) / FIT_FLOOR_TOUCH, 3);
  });
});

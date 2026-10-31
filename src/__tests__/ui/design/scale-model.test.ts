/**
 * The one scale model (`ui/design/scale-model.ts`): one function of the view sizes the frame, the
 * chrome and every lifted surface, and the reach, the hit-area spacing and the frame's zoom are read
 * off it. Each property is checked across one grid of windows, both input modes and both arrangements.
 */
import { describe, expect, it } from 'vitest';
import {
  FINGERTIP_SCALE, FIT_FLOOR, FIT_REF, MIN_UI_ROOM, NO_DOCK, TOUCH_LINE, TOUCH_TARGET, fingertipLift,
  frameFit, liftOf, sideDockFits, reachOf, reachShareOf, spacedOf, touchReachPx, uiScaleOf, type ScaleView,
} from '../../../ui/design/scale-model';
import { UI_ZOOM_MAX, UI_ZOOM_MIN } from '../../../platform/storage/prefs';
import { ARRANGEMENT_ROOM, PINNED_DOCK_REF_W, frameZoomFor } from '../../../ui/shell/panel-frame';
import { ZOOM } from '../../../ui/shell/units';

const WINDOWS: [number, number, string][] = [
  [1920, 869, 'maximized 1080p Chrome'],
  [2560, 1440, '1440p'],
  [1366, 768, 'laptop'],
  [1280, 800, 'the reference window'],
  [1100, 700, 'a small window'],
  [1180, 820, 'a sideways tablet'],
  [820, 1180, 'an upright tablet'],
  [915, 412, 'a sideways phone'],
  [780, 360, 'a sideways phone with its bars'],
  [412, 915, 'an upright phone'],
  [360, 740, 'a small upright phone'],
];
const ZOOMS = [UI_ZOOM_MIN, 0.75, 1, 1.05, 1.25, 1.5, UI_ZOOM_MAX];

const viewOf = (vw: number, vh: number, touch: boolean, uiZoom: number): ScaleView => ({
  vw, vh, dock: NO_DOCK, touch, upright: vh > vw, uiZoom, room: touch ? ARRANGEMENT_ROOM : null,
});

/** Every view in the grid, labelled. */
function* views(): Generator<[ScaleView, string]> {
  for (const [vw, vh, what] of WINDOWS) for (const touch of [false, true]) for (const z of ZOOMS) {
    yield [viewOf(vw, vh, touch, z), `${what} ${touch ? 'touch' : 'pc'} @ ${z}`];
  }
}

describe('the window fit', () => {
  it('is 1 at and above the reference window and follows the tighter axis below it', () => {
    expect(frameFit(FIT_REF.w, FIT_REF.h)).toBe(1);
    expect(frameFit(3840, 2160)).toBe(1);
    expect(frameFit(1280, 720)).toBeCloseTo(720 / FIT_REF.h, 6);
    expect(frameFit(1024, 800)).toBeCloseTo(1024 / FIT_REF.w, 6);
  });

  it('never goes under its floor', () => {
    expect(frameFit(844, 390)).toBe(FIT_FLOOR);
    expect(frameFit(1, 1)).toBe(FIT_FLOOR);
  });
});

describe('the one scale', () => {
  it('draws the frame at ZOOM times the chrome in every view', () => {
    for (const [v, what] of views()) {
      const frame = frameZoomFor(v.vw, v.vh, v.uiZoom, 0, { touch: v.touch, upright: v.upright });
      expect(frame / uiScaleOf(v), what).toBeCloseTo(ZOOM, 9);
    }
  });

  it('never shrinks as the UI zoom grows', () => {
    for (const [vw, vh, what] of WINDOWS) for (const touch of [false, true]) {
      let last = 0;
      for (let z = UI_ZOOM_MIN; z <= UI_ZOOM_MAX + 1e-9; z += 0.05) {
        const s = uiScaleOf(viewOf(vw, vh, touch, z));
        expect(s, `${what} ${touch} @ ${z}`).toBeGreaterThanOrEqual(last - 1e-12);
        last = s;
      }
    }
  });

  it('is the fit times the UI zoom in PC mode on a window with room', () => {
    expect(uiScaleOf(viewOf(1920, 1080, false, 1.2))).toBeCloseTo(1.2, 9);
    expect(uiScaleOf(viewOf(1100, 700, false, 1))).toBeCloseTo(1100 / FIT_REF.w, 9);
  });

  it('in PC mode leaves the map its workspace minimum', () => {
    for (const [v, what] of views()) {
      if (v.touch || v.vw < MIN_UI_ROOM.w || v.vh < MIN_UI_ROOM.h) continue;
      const s = uiScaleOf(v);
      expect(v.vw / s, what).toBeGreaterThanOrEqual(MIN_UI_ROOM.w - 1e-6);
      expect(v.vh / s, what).toBeGreaterThanOrEqual(MIN_UI_ROOM.h - 1e-6);
    }
  });

  it('in touch mode draws on the touch line where the window is small, as on a phone', () => {
    expect(uiScaleOf(viewOf(412, 915, true, 1))).toBeCloseTo(TOUCH_LINE, 9);
    expect(uiScaleOf(viewOf(412, 915, true, 1.25))).toBeCloseTo(TOUCH_LINE * 1.25, 9);
    expect(uiScaleOf(viewOf(915, 412, true, 1.05))).toBeCloseTo(TOUCH_LINE * 1.05, 9);
  });

  it('in touch mode keeps the arrangement within its room', () => {
    for (const [v, what] of views()) {
      if (!v.touch) continue;
      const s = uiScaleOf(v);
      if (v.upright) expect(v.vw / s, what).toBeGreaterThanOrEqual(ARRANGEMENT_ROOM.uprightLeastW - 1e-6);
      else expect(v.vh / s, what).toBeGreaterThanOrEqual(ARRANGEMENT_ROOM.wideLeastH - 1e-6);
    }
  });
});

describe('the lift', () => {
  const CONTROLS = [24, 32, 34, 40, 80];

  it('never draws a surface under the scale, and in PC mode is the scale', () => {
    for (const control of CONTROLS) for (const [v, what] of views()) {
      const lift = liftOf(v, control);
      if (v.touch) expect(lift, what).toBeGreaterThanOrEqual(uiScaleOf(v) - 1e-12);
      else expect(lift, what).toBe(uiScaleOf(v));
    }
  });

  it('keeps one proportion to the frame wherever the touch line leads, as on a phone', () => {
    for (const control of CONTROLS) for (const [v, what] of views()) {
      if (!v.touch || uiScaleOf(v) > TOUCH_LINE * v.uiZoom + 1e-12) continue;
      expect(liftOf(v, control) / uiScaleOf(v), `${what} control ${control}`).toBeCloseTo(fingertipLift(control), 9);
    }
  });

  it('grows with every step of the UI zoom until the room stops the frame too', () => {
    for (const control of [32, 34]) for (const [vw, vh, what] of WINDOWS) {
      let last = 0;
      for (let z = UI_ZOOM_MIN; z <= UI_ZOOM_MAX + 1e-9; z += 0.05) {
        const v = viewOf(vw, vh, true, z);
        const lift = liftOf(v, control);
        if (uiScaleOf(v) > uiScaleOf({ ...v, uiZoom: z - 0.05 }) + 1e-9) expect(lift, `${what} @ ${z}`).toBeGreaterThan(last);
        last = lift;
      }
    }
  });

  it('draws a control a fingertip across at touch mode\'s default on the touch line', () => {
    const phone = viewOf(412, 915, true, 1.25);
    expect(uiScaleOf(phone)).toBeCloseTo(FINGERTIP_SCALE, 9);
    for (const control of [24, 32, TOUCH_TARGET]) expect(liftOf(phone, control) * control, `control ${control}`).toBeCloseTo(Math.max(TOUCH_TARGET, control * FINGERTIP_SCALE), 9);
    expect(fingertipLift(200)).toBe(1);
  });
});

describe('the reach', () => {
  it('is the largest UI zoom that still changes the scale', () => {
    for (const [vw, vh, what] of WINDOWS) for (const touch of [false, true]) {
      const v = viewOf(vw, vh, touch, 1);
      const reach = reachOf(v);
      const at = (z: number) => uiScaleOf({ ...v, uiZoom: z });
      expect(reach, what).toBeGreaterThanOrEqual(UI_ZOOM_MIN);
      expect(reach, what).toBeLessThanOrEqual(UI_ZOOM_MAX);
      expect(at(UI_ZOOM_MAX), what).toBeCloseTo(at(reach), 6);
      if (reach - 0.05 >= UI_ZOOM_MIN) expect(at(reach - 0.05), what).toBeLessThan(at(reach) - 1e-6);
    }
  });

  it('stops where a side dock would no longer stand beside the interface', () => {
    for (const [vw, vh, what] of WINDOWS) for (const touch of [false, true]) {
      if (!sideDockFits(vw, PINNED_DOCK_REF_W, UI_ZOOM_MIN)) continue;
      const reach = reachOf({ ...viewOf(vw, vh, touch, 1), upright: false, dock: { axis: 'x', size: PINNED_DOCK_REF_W } });
      expect(sideDockFits(vw, PINNED_DOCK_REF_W, reach), what).toBe(true);
      if (reach < UI_ZOOM_MAX - 1e-6) expect(sideDockFits(vw, PINNED_DOCK_REF_W, reach + 0.01), what).toBe(false);
    }
  });

  it('is the whole range on a large window', () => {
    expect(reachOf(viewOf(1920, 1080, false, 1))).toBeCloseTo(UI_ZOOM_MAX, 6);
  });
});

describe('the hit-area spacing', () => {
  it('is a fingertip at and over 100%, and under it the span controls spaced for 100% stand apart', () => {
    for (const [v, what] of views()) {
      if (!v.touch) continue;
      for (const multiple of [1, ZOOM, fingertipLift(32)]) {
        const zoom = multiple * uiScaleOf(v);
        const own = touchReachPx(zoom, reachShareOf(v));
        if (v.uiZoom >= 1) expect(own * zoom, what).toBeCloseTo(TOUCH_TARGET, 6);
        else expect(own, what).toBeCloseTo(TOUCH_TARGET / (multiple * spacedOf(v)), 6);
      }
    }
  });
});

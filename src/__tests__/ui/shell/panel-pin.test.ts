/**
 * THE DOCK'S ARITHMETIC: one fit for the whole interface, the window it stops fitting in, and the
 * room the docked column then has.
 *
 * The dock takes a strip of the viewport for itself and the frame stands in what is left, so the two
 * are sized by one number or they disagree about how big the window is. These are the readings that
 * number is judged by — the strip's own width included, since it is drawn at the fit it helped
 * decide.
 */
import { describe, it, expect } from 'vitest';
import { FIT_FLOOR, FIT_REF, frameFit } from '../../../ui/design/scale';
import {
  DOCK_CHROME, DOCK_CHROME_W, DOCK_PARALLAX, DOCK_PARALLAX_SHARE, dockEdge, dockTravelSign,
  hasPinRoom, PANEL_COLUMN_W, PINNED_COLUMN_W, PINNED_DOCK_REF_W, PINNED_PANEL, pinRoomFloor,
} from '../../../ui/shell/panel-frame';
import { ZOOM } from '../../../ui/shell/units';
import { resolveCss } from './_resolve-css';

/** The fit while the dock stands, at a window and a UI zoom. */
const dockedFit = (vw: number, vh: number, uiZoom = 1) =>
  frameFit(vw, vh, PINNED_DOCK_REF_W * uiZoom);

/** The dock's own width in css px at that fit: the column drawn at the frame's live zoom. */
const dockWidth = (vw: number, vh: number, uiZoom = 1) =>
  PINNED_COLUMN_W * ZOOM * dockedFit(vw, vh, uiZoom) * uiZoom;

describe('the dock and the interface beside it are one size', () => {
  it('leaves the reference window exactly its own width beside the dock', () => {
    // The whole point of widening the reference rather than iterating: whatever is left of the
    // window after the dock is the reference window at the fit the dock was drawn at.
    for (const [vw, vh] of [[1280, 800], [1600, 900], [1440, 810], [1100, 700]] as const) {
      const fit = dockedFit(vw, vh);
      if (fit === FIT_FLOOR || fit === 1) continue;
      expect(vw - dockWidth(vw, vh)).toBeCloseTo(FIT_REF.w * fit, 6);
    }
  });

  it('is 1 only in a window wide enough for both', () => {
    expect(dockedFit(FIT_REF.w + PINNED_DOCK_REF_W, 800)).toBe(1);
    expect(dockedFit(FIT_REF.w, 800)).toBeLessThan(1);
    // The height axis is the dock's business too: it stands the whole window tall either way, so a
    // short window binds the fit exactly as it does with no dock at all.
    expect(dockedFit(3840, 600)).toBeCloseTo(600 / FIT_REF.h, 6);
  });

  it('costs the interface a real step at the reference window', () => {
    // Recorded because it is the shape of the trade: docking at 1280x800 draws everything at ~0.73.
    expect(dockedFit(1280, 800)).toBeCloseTo(1280 / (FIT_REF.w + PINNED_DOCK_REF_W), 6);
    expect(dockedFit(1280, 800)).toBeCloseTo(0.7111, 3);
  });
});

describe('the window the dock stops fitting in', () => {
  it('is where the interface beside it would have to shrink past the floor', () => {
    expect(pinRoomFloor()).toBeCloseTo(FIT_FLOOR * (FIT_REF.w + PINNED_DOCK_REF_W), 6);
    expect(pinRoomFloor()).toBeCloseTo(1080, 1);
    expect(hasPinRoom(pinRoomFloor())).toBe(true);
    expect(hasPinRoom(pinRoomFloor() - 1)).toBe(false);
  });

  it('moves with the UI zoom, because the dock is drawn at it', () => {
    expect(pinRoomFloor(1.8)).toBeGreaterThan(pinRoomFloor(1));
    expect(hasPinRoom(1200, 1.8)).toBe(false);
    expect(hasPinRoom(1200, 1)).toBe(true);
  });

  it('never offers a dock that would starve the frame beside it', () => {
    for (let vw = 700; vw <= 2600; vw += 7) {
      if (!hasPinRoom(vw)) continue;
      expect(dockedFit(vw, 1200), `${vw}px`).toBeGreaterThanOrEqual(FIT_FLOOR);
      expect(vw - dockWidth(vw, 1200), `${vw}px`).toBeGreaterThanOrEqual(FIT_REF.w * FIT_FLOOR - 1e-6);
    }
  });
});

describe('the docked column', () => {
  it('stands on the window from top to bottom', () => {
    for (const vh of [800, 700, 1080]) {
      const zoom = ZOOM * dockedFit(1600, vh);
      expect(resolveCss(PINNED_PANEL.height, vh, zoom) * zoom).toBeCloseTo(vh, 6);
    }
    expect(PINNED_PANEL.top).toBe(0);
  });

  it('stands at the window\'s own side edge and meets the sheet at the other', () => {
    // It is the GROUND: it never moves, so its near edge is the window's own corner and its far edge
    // is exactly where the sheet of interface is inset to — no gap and no overlap.
    expect(PINNED_PANEL.edge).toBe(0);
    expect(PINNED_PANEL.edge + PINNED_COLUMN_W).toBe(PINNED_COLUMN_W);
    // The dock is the free column plus the gutter its two controls stand in, which is the one way it
    // is wider: the content column is the same width in both modes.
    expect(PINNED_COLUMN_W).toBe(PANEL_COLUMN_W + DOCK_CHROME_W);
    expect(DOCK_CHROME_W).toBe(DOCK_CHROME.size + DOCK_CHROME.lane);
  });

  it('is placed by the side it is at, on either side', () => {
    expect(dockEdge('left')).toBe('left');
    expect(dockEdge('right')).toBe('right');
    // A dock at the left is revealed by a sheet travelling right, and one at the right by one
    // travelling left. The ground's own drift takes the same sign.
    expect(dockTravelSign('left')).toBe(1);
    expect(dockTravelSign('right')).toBe(-1);
  });

  /**
   * THE DRIFT IS A SHARE OF THE SHEET'S OWN TRAVEL, and the share has two bounds it must sit between.
   *
   * BELOW, it has to be separable from the slide it runs under: a share of a few hundredths is a dozen
   * px of ground moving under a sheet crossing the dock's whole width, beside an interface rescaling
   * into the room the dock takes, and that reads as nothing at all.
   *
   * ABOVE, the bound is geometric: the strip the sheet has uncovered is `aside` of the dock's width and
   * the ground trails `1 - aside` of the drift behind, so a drift past the dock's own width would leave
   * the far end of the uncovered strip showing the page.
   */
  it('drifts the ground a share of the sheet\'s travel, and one a viewer can separate', () => {
    expect(DOCK_PARALLAX).toBeCloseTo(PINNED_COLUMN_W * DOCK_PARALLAX_SHARE, 10);
    expect(DOCK_PARALLAX_SHARE).toBeGreaterThan(1 / 10);
    expect(DOCK_PARALLAX_SHARE).toBeLessThan(1);
    // The ground covers the uncovered strip at every point of the slide, which is that bound made
    // pointwise rather than argued: sampled across the whole travel, on both sides.
    for (let step = 0; step <= 20; step += 1) {
      const aside = step / 20;
      const trailing = (1 - aside) * DOCK_PARALLAX;
      expect(PINNED_COLUMN_W - trailing).toBeGreaterThanOrEqual(aside * PINNED_COLUMN_W);
    }
  });
});

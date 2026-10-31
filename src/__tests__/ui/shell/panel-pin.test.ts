/**
 * The dock's arithmetic: one fit for the whole interface, the window it stops fitting in, and the
 * room the docked column has. The dock and the frame beside it are sized by one number, or they
 * disagree about how big the window is.
 */
import { describe, it, expect } from 'vitest';
import { FIT_FLOOR, FIT_REF, fittedUiScale } from '../../../ui/design/scale';
import {
  DOCK_CHROME_W, DOCK_PARALLAX, dockDrift,
  hasPinRoom, PANEL_COLUMN_W, PINNED_COLUMN_W, PINNED_DOCK_REF_W, PINNED_PANEL,
} from '../../../ui/shell/panel-frame';
import { ZOOM } from '../../../ui/shell/units';
import { resolveCss } from './_resolve-css';

/** The fit while the dock stands, at a window and a UI zoom. */
const dockedFit = (vw: number, vh: number, uiZoom = 1) =>
  fittedUiScale(vw, vh, uiZoom, PINNED_DOCK_REF_W) / uiZoom;

/** The dock's own width in css px at that fit: the column drawn at the frame's live zoom. */
const dockWidth = (vw: number, vh: number, uiZoom = 1) =>
  PINNED_COLUMN_W * ZOOM * dockedFit(vw, vh, uiZoom) * uiZoom;

describe('the dock and the interface beside it are one size', () => {
  it('leaves the reference window exactly its own width beside the dock', () => {
    // The reference is widened by the dock, so what is left beside it is the reference at that fit.
    for (const [vw, vh] of [[1280, 800], [1600, 900], [1440, 810], [1100, 700]] as const) {
      const fit = dockedFit(vw, vh);
      if (fit === FIT_FLOOR || fit === 1) continue;
      expect(vw - dockWidth(vw, vh)).toBeCloseTo(FIT_REF.w * fit, 6);
    }
  });

  it('is 1 only in a window wide enough for both', () => {
    expect(dockedFit(FIT_REF.w + PINNED_DOCK_REF_W, 800)).toBe(1);
    expect(dockedFit(FIT_REF.w, 800)).toBeLessThan(1);
    // The dock stands the whole window tall, so a short window binds the fit as without a dock.
    expect(dockedFit(3840, 600)).toBeCloseTo(600 / FIT_REF.h, 6);
  });

  it('costs the interface a real step at the reference window', () => {
    // Docking at 1280x800 draws everything at about 0.71.
    expect(dockedFit(1280, 800)).toBeCloseTo(1280 / (FIT_REF.w + PINNED_DOCK_REF_W), 6);
    expect(dockedFit(1280, 800)).toBeCloseTo(0.7111, 3);
  });
});

describe('the window the dock stops fitting in', () => {
  it('is where the interface beside it would have to shrink past the floor', () => {
    const floor = FIT_FLOOR * (FIT_REF.w + PINNED_DOCK_REF_W);
    expect(floor).toBeCloseTo(1080, 1);
    expect(hasPinRoom(floor)).toBe(true);
    expect(hasPinRoom(floor - 1)).toBe(false);
  });

  it('moves with the UI zoom, because the dock is drawn at it', () => {
    const floorAt = (uiZoom: number) => FIT_FLOOR * (FIT_REF.w + PINNED_DOCK_REF_W * uiZoom);
    expect(hasPinRoom(floorAt(1.8), 1.8)).toBe(true);
    expect(hasPinRoom(floorAt(1.8) - 1, 1.8)).toBe(false);
    expect(hasPinRoom(floorAt(1.8) - 1, 1)).toBe(true);
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
    // It never moves: its near edge is the window's, its far edge exactly the sheet's inset.
    expect(PINNED_PANEL.edge).toBe(0);
    // The free column plus the gutter its two controls stand in; content width is the same docked.
    expect(PINNED_COLUMN_W).toBe(PANEL_COLUMN_W + DOCK_CHROME_W);
  });

  it('starts its drift toward its own edge on either side, and rests once the sheet has cleared it', () => {
    expect(dockDrift(0, 'left')).toBe(`translateX(${-DOCK_PARALLAX}px)`);
    expect(dockDrift(0, 'right')).toBe(`translateX(${DOCK_PARALLAX}px)`);
    expect(dockDrift(0, 'bottom')).toBe(`translateY(${DOCK_PARALLAX}px)`);
    for (const edge of ['left', 'right', 'bottom'] as const) expect(dockDrift(1, edge)).toBe('');
  });

  /**
   * The drift's share of the sheet's travel: a few hundredths reads as nothing beside the slide, and
   * a drift past the dock's own width would leave the far end of the uncovered strip showing the page.
   */
  it('drifts the ground a share of the sheet\'s travel, and one a viewer can separate', () => {
    const share = DOCK_PARALLAX / PINNED_COLUMN_W;
    expect(share).toBeGreaterThan(1 / 10);
    expect(share).toBeLessThan(1);
    // The ground covers the uncovered strip at every sampled point of the slide.
    for (let step = 0; step <= 20; step += 1) {
      const aside = step / 20;
      const trailing = (1 - aside) * DOCK_PARALLAX;
      expect(PINNED_COLUMN_W - trailing).toBeGreaterThanOrEqual(aside * PINNED_COLUMN_W);
    }
  });
});

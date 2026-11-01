/**
 * The room the frame gives the assistant's column. `panelTop` and `panelMaxHeight` answer in CSS that
 * jsdom never lays out, so `_resolve-css.ts` evaluates them at the windows and zooms the app is judged
 * in. The frame's zoom is `units.ts:ZOOM` (1.25) times the window's fit times the UI zoom (0.6 to 1.8).
 */
import { describe, it, expect } from 'vitest';
import type { BuildMode } from '../../../state/editing/edit-mode';
import { footReserve, PANEL_TOP, panelMaxHeight, panelTop } from '../../../ui/shell/panel-frame';
import { EDGE_TOP, ZOOM } from '../../../ui/shell/units';
import { GATE_BORROW, JOB_ZONE_FLOOR, PINNED_HEIGHT } from '../../../ui/agent/desk/plate';
import { resolveCss } from './_resolve-css';

/** The panel's pinned furniture plus the least job zone, from the constants `PanelColumn` uses. */
const LEAST = PINNED_HEIGHT + JOB_ZONE_FLOOR;

/** The taste trim the courteous cap gives up, in frame px. */
const PANEL_CAP_TRIM = 24;

/** Top and height together, since the cap is measured from the top. `borrow` is what an unanswered
 *  plan gate asks for on top of the skeleton. */
function box(mode: BuildMode, vh: number, zoom: number, borrow = 0): { top: number; height: number } {
  return {
    top: resolveCss(panelTop(LEAST), vh, zoom),
    height: resolveCss(panelMaxHeight(mode, LEAST, borrow), vh, zoom),
  };
}

describe('the panel keeps the least room it can work in', () => {
  /** At the reference window with no bottom bar both clearances are paid and the trim comes off. */
  it('pays both clearances in full wherever there is room for them', () => {
    const { top, height } = box(null, 800, ZOOM);
    expect(top).toBeCloseTo(PANEL_TOP, 3);
    expect(height).toBeCloseTo(800 / ZOOM - PANEL_TOP - footReserve(null) - PANEL_CAP_TRIM, 3);
    expect(height).toBeGreaterThan(LEAST);
  });

  /** The trim comes off the roomy cap only; taken off the least workable height it would clip the
   *  composer. */
  it('spends the trim on the roomy cap and never on the least workable height', () => {
    const roomy = box(null, 800, ZOOM).height;
    expect(roomy).toBeCloseTo(800 / ZOOM - PANEL_TOP - footReserve(null) - PANEL_CAP_TRIM, 3);
    // At a larger UI scale the floor answers, untrimmed.
    expect(box('generate', 800, ZOOM * 1.2).height).toBeCloseTo(LEAST, 3);
  });

  it('lets the foot reserve give way rather than clip the composer, at every common height', () => {
    for (const [w, h] of [[1280, 800], [1366, 768], [1440, 810], [1280, 700]] as const) {
      const fit = Math.max(0.6, Math.min(1, w / 1280, h / 800));
      const { top, height } = box('generate', h, ZOOM * fit * 1.2);
      expect(height, `${w}x${h}`).toBeCloseTo(LEAST, 3);
      expect(top, `${w}x${h}`).toBeCloseTo(PANEL_TOP, 3);
      // Wholly on screen: it overlaps the bar but not the window's edge.
      expect(top + height, `${w}x${h}`).toBeLessThanOrEqual(h / (ZOOM * fit * 1.2) + 0.001);
    }
  });

  /** At UI zoom 1.8 the reference window holds 355 frame px, of which a standing head clearance would
   *  take 198; the head yields last, and only as far as it must. */
  it('slides the column up rather than empty it, at the top of the uiZoom range', () => {
    const zoom = ZOOM * 1.8;
    const { top, height } = box(null, 800, zoom);
    expect(height).toBeCloseTo(LEAST, 3);
    expect(top).toBeLessThan(PANEL_TOP);
    expect(top).toBeGreaterThanOrEqual(EDGE_TOP);
    expect(top + height).toBeCloseTo(800 / zoom, 3);
  });

  /** The panel is never shorter than its furniture unless the window is, and never runs off the
   *  bottom. */
  it('holds both invariants across the pref range, every mode and every judged window', () => {
    const modes: BuildMode[] = [null, 'mountain', 'water', 'road', 'object', 'generate'];
    for (const [w, h] of [[1280, 800], [1366, 768], [1440, 810], [1280, 700], [1024, 768], [1920, 1080]] as const) {
      for (const ui of [0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8]) {
        const zoom = ZOOM * Math.max(0.6, Math.min(1, w / 1280, h / 800)) * ui;
        const room = h / zoom;
        for (const mode of modes) {
          const at = `${w}x${h} ui${ui} ${String(mode)}`;
          const { top, height } = box(mode, h, zoom);
          expect(top + height, at).toBeLessThanOrEqual(room + 0.001);
          expect(height, at).toBeGreaterThanOrEqual(Math.min(LEAST, room - EDGE_TOP) - 0.001);
        }
      }
    }
  });
});

/**
 * In Object mode at the reference window the cap that clears the bottom bar leaves a plan card 53 px.
 * While a plan gate stands unanswered, the foot reserve gives way, the head stays, and the panel
 * paints over the bar.
 */
describe('an unanswered plan gate borrows the room to be read in', () => {
  /** The zone a borrowing panel offers the card: the cap less everything pinned. */
  const zone = (mode: BuildMode, h: number, zoom: number) =>
    box(mode, h, zoom, GATE_BORROW).height - PINNED_HEIGHT;

  /** The room under the entrance block, in frame px: the most a borrow can reach, since the head
   *  does not move. */
  const room = (h: number, zoom: number) => h / zoom - PANEL_TOP;

  it('spends the foot reserve down to nothing, in every mode and at every judged window', () => {
    const modes: BuildMode[] = [null, 'mountain', 'water', 'road', 'object', 'generate'];
    for (const [w, h] of [[1280, 800], [1366, 768], [1440, 810], [1280, 700]] as const) {
      const zoom = ZOOM * Math.max(0.6, Math.min(1, w / 1280, h / 800));
      for (const mode of modes) {
        const at = `${w}x${h} ${String(mode)}`;
        expect(zone(mode, h, zoom), at).toBeCloseTo(
          Math.min(JOB_ZONE_FLOOR + GATE_BORROW, room(h, zoom) - PINNED_HEIGHT), 3,
        );
      }
    }
  });

  /**
   * The tallest plan card (four stages, both notes, the answer pair) is about 293 frame px. The
   * borrowed foot gives 261 in both modes, all but one note line; the head clearance stays so the
   * panel never covers the mode row and the character's entrance.
   */
  it('stands a real plan card in the two modes with the least room', () => {
    for (const mode of ['object', 'generate'] as const) {
      expect(zone(mode, 800, ZOOM), mode).toBeGreaterThan(250);
      // Without the borrow the zone is short.
      expect(box(mode, 800, ZOOM).height - PINNED_HEIGHT, mode).toBeLessThan(160);
    }
  });

  it('spends the borrow at the FOOT: the head clearance does not move', () => {
    for (const mode of ['object', 'generate'] as const) {
      const plain = box(mode, 800, ZOOM);
      const borrowed = box(mode, 800, ZOOM, GATE_BORROW);
      expect(borrowed.top, mode).toBe(plain.top);
      expect(borrowed.height, mode).toBeGreaterThan(plain.height);
    }
  });

  it('is still wholly on screen, across the whole pref range', () => {
    const modes: BuildMode[] = [null, 'object', 'generate'];
    for (const [w, h] of [[1280, 800], [1366, 768], [1024, 768], [1920, 1080], [1280, 700]] as const) {
      for (const ui of [0.6, 1, 1.4, 1.8]) {
        const zoom = ZOOM * Math.max(0.6, Math.min(1, w / 1280, h / 800)) * ui;
        for (const mode of modes) {
          const at = `${w}x${h} ui${ui} ${String(mode)}`;
          const { top, height } = box(mode, h, zoom, GATE_BORROW);
          expect(top + height, at).toBeLessThanOrEqual(h / zoom + 0.001);
        }
      }
    }
  });

  it('gives the room back the moment there is nothing to answer', () => {
    const modes: BuildMode[] = [null, 'mountain', 'water', 'road', 'object', 'generate'];
    for (const mode of modes) {
      expect(box(mode, 800, ZOOM, 0), String(mode)).toEqual(box(mode, 800, ZOOM));
    }
  });
});

/**
 * The room the frame gives the assistant's column, RESOLVED — not the string that expresses it.
 *
 * `panelTop`/`panelMaxHeight` answer in css, so jsdom can hold the strings but never lays them out
 * (`_resolve-css.ts` evaluates them). The failure shape here is arithmetic rather than wiring (a cap
 * that falls below the panel's own furniture, at a zoom a user reaches with Ctrl +/-), so the
 * expressions are evaluated here at the windows and zooms the app is actually judged in and the
 * READINGS are what is asserted, against the same table the live-app measurements were taken as.
 *
 * The frame's zoom is `units.ts:ZOOM` times the window's fit times the user's UI zoom, so 1.25 is the
 * reference window at uiZoom 1 and 2.25 is that same window at the pref's top of range.
 */
import { describe, it, expect } from 'vitest';
import type { BuildMode } from '../../../core/model/edit-mode';
import { footReserve, PANEL_CAP_TRIM, PANEL_TOP, panelMaxHeight, panelTop } from '../../../ui/shell/panel-frame';
import { EDGE_TOP, ZOOM } from '../../../ui/shell/units';
import { GATE_BORROW, JOB_ZONE_FLOOR, PINNED_HEIGHT } from '../../../ui/agent/PanelShell';
import { resolveCss } from './_resolve-css';

/** The panel's own pinned furniture plus a record worth the name, as `PanelColumn` derives it —
 *  taken from the same two constants rather than typed, so a taller dock moves this with it. */
const LEAST = PINNED_HEIGHT + JOB_ZONE_FLOOR;

/** Top and height together, since neither reads alone: the cap is measured from wherever the top is.
 *  `borrow` is what an unanswered plan gate asks for on top of the skeleton. */
function box(mode: BuildMode, vh: number, zoom: number, borrow = 0): { top: number; height: number } {
  return {
    top: resolveCss(panelTop(LEAST), vh, zoom),
    height: resolveCss(panelMaxHeight(mode, LEAST, borrow), vh, zoom),
  };
}

describe('the panel keeps the least room it can work in', () => {
  /** The reading the live app was measured at: at the reference window with no bottom bar there is
   *  room to spare, so both clearances are paid in full, the taste trim comes off the top of what is
   *  left, and nothing yields. */
  it('pays both clearances in full wherever there is room for them', () => {
    const { top, height } = box(null, 800, ZOOM);
    expect(top).toBeCloseTo(PANEL_TOP, 3);
    expect(height).toBeCloseTo(800 / ZOOM - PANEL_TOP - footReserve(null) - PANEL_CAP_TRIM, 3);
    expect(height).toBeGreaterThan(LEAST);
  });

  /**
   * THE TRIM IS A TASTE TUNE AND IT COMES OFF THE COURTEOUS CAP ALONE. A panel with room to spare
   * stands one step shorter than the room allows; a panel with no room to spare is already at the
   * least height it can work in, and taking a step off THAT is what leaves a plate with the composer
   * clipped off its bottom.
   */
  it('spends the trim on the roomy cap and never on the least workable height', () => {
    const roomy = box(null, 800, ZOOM).height;
    expect(roomy).toBeCloseTo(800 / ZOOM - PANEL_TOP - footReserve(null) - PANEL_CAP_TRIM, 3);
    expect(PANEL_CAP_TRIM).toBeGreaterThan(0);
    // Generate mode at the reference window has nothing to spare: the floor answers, untrimmed.
    expect(box('generate', 800, ZOOM).height).toBeCloseTo(LEAST, 3);
  });

  /**
   * GENERATE MODE, the tightest overlap. Its shelf reserve leaves ~159 frame px against a 252px
   * skeleton at every common laptop height — honoured, that would slice the composer off flush with
   * the plate's bottom and leave the record a 2.5px band. The foot gives way; the head does not have
   * to.
   */
  it('lets the foot reserve give way rather than clip the composer, at every common height', () => {
    for (const [w, h] of [[1280, 800], [1366, 768], [1440, 810], [1280, 700]] as const) {
      const fit = Math.max(0.6, Math.min(1, w / 1280, h / 800));
      const { top, height } = box('generate', h, ZOOM * fit);
      expect(height, `${w}x${h}`).toBeCloseTo(LEAST, 3);
      expect(top, `${w}x${h}`).toBeCloseTo(PANEL_TOP, 3);
      // And the panel is still wholly on screen: it overlaps the bar, it does not run off the window.
      expect(top + height, `${w}x${h}`).toBeLessThanOrEqual(h / (ZOOM * fit) + 0.001);
    }
  });

  /**
   * THE UI-ZOOM TOP OF RANGE. `uiZoom` is a persisted preference on Ctrl +/- (0.6..1.8), and at 1.8
   * the reference window holds 355 frame px in total: a standing head clearance alone would take 198
   * of them and leave the panel a plate carrying the dock and nothing else. The head yields last, and
   * only as far as it must.
   */
  it('slides the column up rather than empty it, at the top of the uiZoom range', () => {
    const zoom = ZOOM * 1.8;
    const { top, height } = box(null, 800, zoom);
    expect(height).toBeCloseTo(LEAST, 3);
    expect(top).toBeLessThan(PANEL_TOP);
    expect(top).toBeGreaterThanOrEqual(EDGE_TOP);
    expect(top + height).toBeCloseTo(800 / zoom, 3);
  });

  /** The whole pref range, every mode, the windows the frame is judged in: the panel is never
   *  shorter than its own furniture unless the WINDOW itself is, and never runs off the bottom. */
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
 * AN UNANSWERED PLAN GATE BORROWS THE ROOM IT NEEDS.
 *
 * The courtesy to the bottom bar is worth having while the panel is only reporting. It is not worth a
 * question the user cannot read: in Object mode at the reference window the courteous cap leaves 233
 * frame px against a 180px skeleton, so the plan card would have 53px to stand in — the Approve pair
 * showing with the plan itself scrolled off above it. So the FOOT gives the room, the head does
 * not move, and the panel paints over the bar for exactly as long as the question stands.
 */
describe('an unanswered plan gate borrows the room to be read in', () => {
  /** The zone a borrowing panel actually offers the card: the cap less everything pinned. */
  const zone = (mode: BuildMode, h: number, zoom: number) =>
    box(mode, h, zoom, GATE_BORROW).height - PINNED_HEIGHT;

  /** What the window has under the entrance block, in frame px. The head does not move for a borrow
   *  (see `panelMaxHeight`), so this is the ceiling the foot can give up to. */
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
   * THE FLOOR THAT MATTERS, said as the card it is for. A plan gate's own parts measure ~293 frame px
   * at four stages with both notes and the answer pair (12+12 card padding, an 18px head, an 18px row
   * per stage, two 2-line 13.5/1.4 notes, the 39px action pair, 8px between each), and the courteous
   * cap gave it 53 in Object mode and 159 in Generate. The foot alone brings both to 261: the head,
   * the note, four stages and the pair, all but a note line of the tallest card the panel can be
   * holding a question on. The head clearance is left standing deliberately — yielding it too would
   * put the panel over the mode row and the character's own entrance, which the bar below never
   * covered either.
   */
  it('stands a real plan card in the two modes with the least room', () => {
    for (const mode of ['object', 'generate'] as const) {
      expect(zone(mode, 800, ZOOM), mode).toBeGreaterThan(250);
      // And the courteous cap alone gives less than a band, which is what the borrow is for.
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

  /** ANSWERED, THE ROOM GOES BACK. Nothing beneath the panel was moved or disabled while it stood
   *  over the bar, and the moment the borrow is not asked for the readings are the plain ones. */
  it('gives the room back the moment there is nothing to answer', () => {
    const modes: BuildMode[] = [null, 'mountain', 'water', 'road', 'object', 'generate'];
    for (const mode of modes) {
      expect(box(mode, 800, ZOOM, 0), String(mode)).toEqual(box(mode, 800, ZOOM));
    }
  });
});

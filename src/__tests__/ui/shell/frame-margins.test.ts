/**
 * The frame's arithmetic, which jsdom cannot lay out: margins measured to the ink on the three edges
 * the chrome stands on (the left one wide enough for a selected block's plate overhang), the rows and
 * the right-hand column, and the hairline edge a drawing wears on the map.
 */
import { describe, it, expect } from 'vitest';
import {
  ASSISTANT_BLOCK, ASSISTANT_INK, ASSISTANT_ROW_TOP, HISTORY_BUTTONS, KIT_BUTTONS,
  MODES, MODE_PLATE, MODE_ROW_BASE, MODE_ROW_LEFT, MODE_ROW_TOP, railStack,
  RAIL_TOP, TOP_RIGHT, TOP_RIGHT_H, TOP_RIGHT_TOP, topRightHeight, topRightSlack,
} from '../../../ui/shell/frame';
import { planRail, RAIL_FOLDS, type RailPlan } from '../../../ui/shell/frame-plan';
import { plateDepth, plateMinDepth } from '../../../ui/shell/controls/layer-plate';
import { SHAPE_EDGE_FILTER } from '../../../ui/design/tokens';
import {
  EDGE, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, LABEL_INK_DEPTH, MODE, MODE_SCALE,
  RAIL, RAIL_FLOOR, ZOOM,
} from '../../../ui/shell/units';

/** The open square plate's depth, the deepest the layer control draws. */
const PLATE_DEPTH = plateDepth('grid');

/** The top margin is its own number, and the margins are measured to the mode row's ink. */
describe('the frame\'s margins', () => {
  /**
   * The top margin costs the right-hand column its run, so raising it to the side gutter leaves the
   * column's three groups too little room on a 900px window. If that ever stops being true, this fails
   * and the two edges can be reconsidered together.
   */
  it('do not include the top, because the right-hand column cannot pay for it', () => {
    expect(EDGE_TOP).toBeLessThan(EDGE_LEFT);
    /** The smallest separation the column's three groups get, with the mode row hung at `top`. */
    const groupSpacing = (top: number): number => {
      const viewport = 900 / ZOOM;
      // Only the margin varies; the column keeps its offset from it.
      const layerBottom = top + (RAIL_TOP - EDGE_TOP) + RAIL.layer.h;
      const kitH = 6 * RAIL.button + 5 * RAIL.gap;
      const kitTop = Math.max(viewport - RAIL_FLOOR - kitH, 0);
      const historyH = 2 * RAIL.button + RAIL.gap;
      return (kitTop - layerBottom) / 2 - historyH / 2;
    };
    expect(groupSpacing(EDGE_TOP)).toBeGreaterThanOrEqual(RAIL.groupMin);
    expect(groupSpacing(EDGE_LEFT)).toBeLessThan(RAIL.groupMin);
  });

  it('are measured to the ink, so choosing a mode cannot eat the top one', () => {
    // The row's box is as deep as a selected mode's drawing, so its top is that drawing's ink top.
    expect(MODE_ROW_TOP).toBe(EDGE_TOP);
    expect(MODE.height).toBe(Math.round(Math.max(...MODES.map((a) => a.selected.h)) * MODE_SCALE));
  });

  it('keep the selected block\'s whole plate on screen', () => {
    const overhang = (MODE_PLATE.w * MODE_SCALE - MODE.size) / 2;
    expect(overhang).toBeGreaterThan(0);
    expect(MODE_ROW_LEFT - overhang).toBeGreaterThan(0);
    // The plate stands proud above the block too, and the row hangs from the window's top edge.
    expect(MODE_ROW_BASE + (MODE_PLATE.drop - MODE_PLATE.h) * MODE_SCALE).toBeGreaterThan(0);
  });
});

/**
 * The two rows' separation is derived from the drawings' own sizes in the tightest state, since a
 * box carries slack and the row above hangs a name into the gap only sometimes.
 */
describe('the assistant stands under the row above it', () => {
  /** Where the character's own ink starts, in css px from the top of the window, per state. */
  const inkTop = (open: boolean) => ASSISTANT_ROW_TOP + MODE.height
    - (open ? ASSISTANT_BLOCK.selected.h : ASSISTANT_BLOCK.h) * MODE_SCALE;
  /** Where the selected block's name stops. */
  const nameBottom = MODE_ROW_BASE + MODE.label.gap + LABEL_INK_DEPTH * MODE.label.size;

  it('never reaches the row above, in any of the four states the two can be in', () => {
    for (const open of [false, true]) {
      expect(inkTop(open)).toBeGreaterThan(MODE_ROW_BASE);
      expect(inkTop(open)).toBeGreaterThanOrEqual(nameBottom);
      // It clears the splat, which hangs under a selected block whether or not it is named.
      expect(inkTop(open)).toBeGreaterThan(MODE_ROW_BASE + MODE_PLATE.drop * MODE_SCALE);
    }
  });
});

describe('the edge a drawing wears on the map', () => {
  it('reaches the same distance whichever way the shape\'s edge turns', () => {
    const { blur, slope } = SHAPE_EDGE_FILTER;
    // A Gaussian is isotropic: the grown alpha at distance d from a straight edge is
    // erfc(d / (sigma * root 2)) / 2 in any direction, and the ramp turns everything above 1/slope solid.
    const erfc = (x: number): number => {
      // Abramowitz and Stegun 7.1.26, enough for a threshold this coarse.
      const t = 1 / (1 + 0.3275911 * x);
      const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741
        + t * (-1.453152027 + t * 1.061405429))));
      return y * Math.exp(-x * x);
    };
    let lo = 0;
    let hi = 4;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (erfc(mid / (blur * Math.SQRT2)) / 2 > 1 / slope) lo = mid; else hi = mid;
    }
    // Half a css px, within a tenth.
    expect(lo).toBeCloseTo(0.5, 1);
  });

});

describe('the top of the window is one band', () => {
  /**
   * The two sides share a line through the middle of the resting ink: on the baseline the shorter
   * corner reads low, and centred in `MODE.height` (sized for the selected drawing) it reads high.
   */
  it('centres the corner ON THE INK it faces, not in the box behind it', () => {
    const restingCentres = MODES.map((art) => MODE_ROW_BASE - (art.h * MODE_SCALE) / 2);
    const mean = restingCentres.reduce((sum, c) => sum + c, 0) / restingCentres.length;
    expect(TOP_RIGHT_TOP + TOP_RIGHT_H / 2).toBeCloseTo(mean, 6);
    // The corner is far shallower than the row.
    expect(MODE.height - TOP_RIGHT_H).toBeGreaterThan(20);
    expect(TOP_RIGHT_TOP).not.toBeCloseTo(EDGE_TOP + (MODE.height - TOP_RIGHT_H) / 2, 1);
  });

  it('keeps the corner\'s own three on one line, which is what makes them a group', () => {
    // The cluster's depth is the deepest ink on the line; each drawing hangs its own slack below it
    // (`src/ui/shell/controls/CornerActions.tsx:Piece`).
    expect(TOP_RIGHT_H).toBeCloseTo(
      Math.max(...TOP_RIGHT.map((art) => topRightHeight(art) - topRightSlack(art))), 6,
    );
    expect(TOP_RIGHT.every((art) => art.botSlack !== undefined)).toBe(true);
    expect(TOP_RIGHT_TOP).toBeGreaterThan(EDGE_TOP);
  });

  /**
   * The corner's three and the rail's buttons are one family. At one box height a filled circle, a
   * notched shape and a filled square read as three sizes, and `apparentSize` alone overcorrects an
   * open shape, so each carries a `trim` judged by eye.
   */
  it('brings the corner\'s three to one SIZE, by three corrections that are not equal', () => {
    // Derived from a rail button, so neither group copies the other's number.
    const b = RAIL.button;
    expect(RAIL.topRight).toBeCloseTo(Math.sqrt(Math.hypot(b, b) * Math.sqrt((Math.PI * b * b) / 4)), 6);
    for (const art of TOP_RIGHT) {
      expect(Math.abs(topRightHeight(art) - RAIL.button)).toBeLessThan(1);
    }
    // Untrimmed, the formula gives three sizes spread by more than a tenth; the trims differ per drawing.
    const untrimmed = TOP_RIGHT.map((art) => (RAIL.topRight * art.h) / (art.apparent ?? art.h));
    expect(Math.max(...untrimmed) / Math.min(...untrimmed)).toBeGreaterThan(1.1);
    expect(new Set(TOP_RIGHT.map((art) => art.trim ?? 1)).size).toBe(TOP_RIGHT.length);
    expect(TOP_RIGHT.every((art) => art.apparent !== undefined)).toBe(true);
    // Each drawing is scaled by a different amount.
    const scales = TOP_RIGHT.map((art) => topRightHeight(art) / art.h);
    expect(Math.max(...scales) / Math.min(...scales)).toBeGreaterThan(1.1);
  });
});

describe('the right-hand column', () => {
  it('separates its groups by several times the gap inside one', () => {
    expect(RAIL.groupGap).toBeGreaterThan(2 * RAIL.gap);
    expect(RAIL.groupMin).toBeGreaterThan(RAIL.gap);
    expect(RAIL.groupMin).toBeLessThan(RAIL.groupGap);
  });

  /** The rail and the assistant are the frame's second row, one at each edge, so they start together. */
  it('starts level with the assistant on the other side of the window', () => {
    expect(RAIL_TOP).toBe(ASSISTANT_INK.top);
    // Ink to ink: the plate is a filled pill, so its box is its ink; the resting character is matched.
    expect(ASSISTANT_INK.top).toBeCloseTo(
      ASSISTANT_ROW_TOP + MODE.height - ASSISTANT_BLOCK.h * MODE_SCALE, 6,
    );
    expect(RAIL_TOP).toBeGreaterThan(TOP_RIGHT_TOP + TOP_RIGHT_H);
  });

  describe('and the layer stack takes its turn among them', () => {
    const layerBottom = RAIL_TOP + RAIL.layer.h;
    const plan = (vh: number, open: boolean) => planRail(vh / ZOOM, {
      open, plateDepth: PLATE_DEPTH, plateMinDepth: plateMinDepth('grid'),
    });
    /** How deep the pair stands in a given plan; it folds on a short window. */
    const pairDepth = (p: RailPlan) => railStack(Math.ceil(HISTORY_BUTTONS / p.historyFiles));
    /** The least of the plate worth showing: its head, padding and one whole row of floors. */
    const PLATE_FIRST_ROW = plateMinDepth('grid');
    /** The three windows the arrangement is judged on. */
    const WINDOWS = [720, 900, 1440];

    it('declares the plate\'s depth the browser draws, so the plan is planning the real thing', () => {
      // Localized floor names widen their tracks without adding a line.
      expect(PLATE_DEPTH).toBeCloseTo(359, 6);
    });

    it('limits the view kit to four files and history to one pair', () => {
      for (const f of RAIL_FOLDS) {
        expect(f.kit, 'the kit').toBeLessThanOrEqual(4);
        expect(f.history, 'the pair').toBeLessThanOrEqual(2);
      }
      for (let vh = 400; vh <= 2160; vh += 4) {
        for (const open of [false, true]) {
          const p = plan(vh, open);
          expect(p.kitFiles, `${vh}px, ${open ? 'open' : 'at rest'}`).toBeLessThanOrEqual(4);
          expect(p.historyFiles, `${vh}px, ${open ? 'open' : 'at rest'}`).toBeLessThanOrEqual(2);
        }
      }
    });

    it('only ever moves the pair DOWN, at every window a person works at', () => {
      for (let vh = 600; vh <= 2160; vh += 20) {
        expect(plan(vh, true).historyTop, `${vh}px`)
          .toBeGreaterThanOrEqual(plan(vh, false).historyTop - 1e-9);
      }
    });

    it('still leaves a group\'s separation at both ends of the pair, wherever it put it', () => {
      for (const vh of WINDOWS) {
        const p = plan(vh, true);
        expect(p.historyTop - layerBottom, `${vh}px, under the layer control`)
          .toBeGreaterThanOrEqual(RAIL.groupMin - 1e-9);
        expect(p.kitTop - (p.historyTop + pairDepth(p)), `${vh}px, over the kit`)
          .toBeGreaterThanOrEqual(RAIL.groupMin - 1e-9);
      }
    });

    it('keeps a scrollable plate on the right until a complete floor row cannot fit', () => {
      for (const vh of [720, 900]) {
        const p = plan(vh, true);
        expect(p.plateInLane).toBe(true);
        expect(p.plateRight).toBe(EDGE_RIGHT);
        expect(p.plateMaxH).toBeGreaterThanOrEqual(PLATE_FIRST_ROW);
      }
      const short = plan(525, true);
      expect(short.plateInLane).toBe(false);
      expect(short.plateRight).toBeGreaterThan(EDGE_RIGHT + railStack(short.kitFiles));
      expect(short.historyTop).toBeGreaterThanOrEqual(plan(525, false).historyTop);
    });

      it('folds a group to seat the open plate, and only as far as seating it takes', () => {
      const rung = (p: RailPlan) =>
        RAIL_FOLDS.findIndex((f) => f.kit === p.kitFiles && f.history === p.historyFiles);
      expect(rung(plan(1080, false)), '1080px at rest folds nothing').toBe(0);
      expect(plan(1080, true).kitFiles, '1080px folds the kit to make room').toBe(2);
      expect(plan(1080, true).plateInLane).toBe(true);
      expect(plan(1244, true).kitFiles, '1244px open puts the kit in two files').toBe(2);
      expect(plan(1244, true).plateInLane).toBe(true);
      expect(rung(plan(1440, true)), '1440px needs no fold').toBe(0);
      expect(plan(1440, true).plateInLane).toBe(true);
      for (let vh = 600; vh <= 2160; vh += 4) {
        const closed = rung(plan(vh, false));
        const open = plan(vh, true);
        expect(rung(open), `${vh}px`).toBeGreaterThanOrEqual(closed);
        if (open.plateInLane) expect(open.plateMaxH, `${vh}px keeps one complete floor row`).toBeGreaterThanOrEqual(PLATE_FIRST_ROW);
      }
    });

    /**
     * Whether the plate is seated is asked of the lowest the pair can stand; where the pair then
     * stands is only as low as the plate needs, so it keeps its distance from the view kit.
     */
    it('does make room for it on a tall one, and steps down by exactly what the plate needs', () => {
      const p = plan(1440, true);
      expect(p.plateInLane).toBe(true);
      expect(p.plateRight, 'flush with the buttons').toBeCloseTo(EDGE_RIGHT, 6);
      expect(p.historyTop).toBeCloseTo(RAIL_TOP + PLATE_DEPTH + RAIL.groupMin, 6);
      expect(p.historyTop, 'a step DOWN, though').toBeGreaterThan(plan(1440, false).historyTop);
      expect(p.kitTop - (p.historyTop + pairDepth(p)), 'and it keeps its distance from the kit')
        .toBeGreaterThan(RAIL.button);
    });

      it('keeps every group on screen and clear of its neighbours while allowing bottom margin compression', () => {
      for (const vh of WINDOWS) {
        for (const open of [false, true]) {
          const p = plan(vh, open);
          const viewport = vh / ZOOM;
          const kitH = railStack(Math.ceil(KIT_BUTTONS / p.kitFiles));
          const what = `${vh}px, ${open ? 'open' : 'at rest'}`;
          expect(p.kitTop + kitH, what).toBeLessThanOrEqual(viewport - (open ? EDGE : RAIL_FLOOR));
          expect(p.historyTop - layerBottom, `${what}, under the layer control`)
            .toBeGreaterThanOrEqual(RAIL.groupMin - 1e-9);
          expect(p.kitTop - (p.historyTop + pairDepth(p)), `${what}, over the kit`)
            .toBeGreaterThanOrEqual(RAIL.groupMin - 1e-9);
          // An open plate in the lane stands above the pair and the kit.
          if (open && p.plateInLane) {
            expect(p.historyTop, what).toBeGreaterThanOrEqual(RAIL_TOP + Math.min(PLATE_DEPTH, p.plateMaxH) + RAIL.groupMin);
          }
        }
      }
    });

    it('breaks the kit into files only where one file will not fit', () => {
      // Seven buttons, the hide toggle included, fit one file from about 965 px of window height.
      expect(plan(720, false).kitFiles, 'a laptop cannot hold the seven in one').toBe(2);
      expect(plan(900, false).kitFiles, 'nor can a 900px window').toBe(2);
      expect(plan(965, false).kitFiles, 'and just above the fold').toBe(1);
      expect(plan(1440, false).kitFiles).toBe(1);
      expect(railStack(2)).toBe(2 * RAIL.button + RAIL.gap);
    });

      it('folds the pair after the kit, and only where a folded kit is not enough', () => {
      // A folded kit of seven stops being enough below about 766 px.
      for (const vh of WINDOWS.filter((h) => h > 766)) {
        expect(plan(vh, false).historyFiles, `${vh}px keeps the pair in one file`).toBe(1);
      }
      expect(plan(770, false).historyFiles, 'and just above the fold').toBe(1);
      expect(plan(720, false).historyFiles, 'and a 1366x768 laptop is under it').toBe(2);
      const folded = plan(660, false);
      expect(folded.historyFiles, 'a 660px window folds it into a 2x1 row').toBe(2);
      expect(folded.kitFiles, 'a third kit file preserves the preferred bottom clearance').toBe(3);
      for (let vh = 400; vh <= 2160; vh += 20) {
        expect(plan(vh, false).historyFiles, `${vh}px`).toBeLessThanOrEqual(HISTORY_BUTTONS);
      }
    });

    /** At each window the plan takes the unfolded rung or one whose predecessor does not fit the run. */
    it('never folds a group the window had room to leave alone', () => {
      const depth = (f: { kit: number; history: number }) => railStack(Math.ceil(KIT_BUTTONS / f.kit))
        + railStack(Math.ceil(HISTORY_BUTTONS / f.history));
      // Read from `RAIL_FOLDS` itself, ordered by how much each rung gives up.
      expect(RAIL_FOLDS[0], 'the first rung folds nothing').toEqual({ kit: 1, history: 1 });
      for (let i = 1; i < RAIL_FOLDS.length; i++) {
        expect(depth(RAIL_FOLDS[i]!), `rung ${i} is shallower than the one before`)
          .toBeLessThan(depth(RAIL_FOLDS[i - 1]!));
      }
      for (let vh = 600; vh <= 2160; vh += 20) {
        const p = plan(vh, false);
        const run = vh / ZOOM - RAIL_FLOOR - layerBottom - 2 * RAIL.groupMin;
        const at = RAIL_FOLDS.findIndex((f) => f.kit === p.kitFiles && f.history === p.historyFiles);
        expect(at, `${vh}px stands on a rung of the ladder`).toBeGreaterThanOrEqual(0);
        if (at === RAIL_FOLDS.length - 1) continue; // the last rung is taken even when it does not fit
        expect(depth(RAIL_FOLDS[at]!), `${vh}px, the rung chosen fits`).toBeLessThanOrEqual(run);
        if (at > 0) {
          expect(depth(RAIL_FOLDS[at - 1]!), `${vh}px, and the rung before it does not`)
            .toBeGreaterThan(run);
        }
      }
    });
  });
});

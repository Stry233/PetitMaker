/**
 * The frame's margins, and the one shadow it is allowed.
 *
 * Two facts a rendering test cannot reach, since jsdom lays nothing out and the margins are what a
 * drawing STANDS IN rather than something a component reports.
 *
 * The margins are ONE number on the three edges the chrome stands on, measured to the ink that is
 * always there. What the left one has to survive is the splat behind a selected block, which is drawn
 * wider than the block and centred on it: it hangs into the margin, and a margin narrower than that
 * overhang cuts it off at the window.
 *
 * The shadow rule comes from the design source, which has no gradient, no pattern, no layer effect
 * and not one stroke. So no control and no line of type casts anything; what separates the chrome
 * from the map is the viewport's own vignette.
 *
 * No token in `tokens.ts` carries a shadow property. The vignette is a gradient, since a shadow casts
 * from a whole box and the map is shaded at the bottom only, so the one name exempt is the hairline
 * edge a drawing standing on the map wears, which is an SVG dilation rather than an offset copy, and
 * the two tests below are what keep it one.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import {
  ASSISTANT_BLOCK, ASSISTANT_INK, ASSISTANT_ROW_TOP, HISTORY_BUTTONS, KIT_BUTTONS, LAYER_STEP_RIGHT,
  MODES, MODE_PLATE, MODE_ROW_BASE, MODE_ROW_LEFT, MODE_ROW_TOP, planRail, RAIL_FOLDS, railStack,
  RAIL_TOP, TOP_RIGHT, TOP_RIGHT_H, TOP_RIGHT_TOP, topRightHeight, topRightSlack, type RailPlan,
} from '../../../ui/shell/frame';
import { PLATE_DEPTH } from '../../../ui/shell/windows/LayerPanel';
import {
  INK, MAP_EDGE_ALPHA, MAP_LABEL, MAP_SHAPE_EDGE, SHAPE_EDGE, SHAPE_EDGE_FILTER, SHAPE_EDGE_ID,
} from '../../../ui/design/tokens';
import {
  EDGE, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, FRAME_MARGIN, LABEL_INK_DEPTH, MODE, MODE_SCALE,
  PLATE_BAND, RAIL, RAIL_FLOOR, SHELF_TABS, ZOOM,
} from '../../../ui/shell/units';

const SHELL = 'src/ui/shell';

function sources(dir: string): { path: string; text: string }[] {
  return (readdirSync(dir) as string[]).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [{ path: full, text: readFileSync(full, 'utf8') }] : [];
  });
}

/** The side margins align visible ink; the selected mode plate overhang makes their box gaps differ. */
describe('the frame\'s margins', () => {
  it('put the two sides\' outermost ink on one line, which is not the same margin', () => {
    expect(EDGE_LEFT).toBe(FRAME_MARGIN);
    // The gutter is where a NAME's ink starts, not where its box does: a tab carries `padX` either
    // side of its word. Derived in `units.ts`, so the two cannot drift; asserted here so the
    // relation survives someone writing either number down as a literal.
    expect(SHELF_TABS.left + SHELF_TABS.padX).toBe(FRAME_MARGIN);
    // The line itself: the splat's own left edge with a mode selected, and the right margin.
    const overhang = (MODE_PLATE.w * MODE_SCALE - MODE.size) / 2;
    expect(EDGE_LEFT - overhang).toBeCloseTo(EDGE_RIGHT, 6);
    // The selected plate's overhang makes the right box margin visibly tighter.
    expect(EDGE_RIGHT).toBeLessThan(EDGE_LEFT - 8);
    // The bottom is its own: what stands there is a full-width shelf whose plate runs off the
    // window, not a cluster the frame has to hold clear of an edge.
    expect(EDGE).toBeLessThan(FRAME_MARGIN);
  });

  /**
   * The top is its own number, and this is the arithmetic that says why rather than prose saying so.
   *
   * A side gutter costs width, which the frame has. The top costs the RIGHT-HAND COLUMN its run: the
   * column hangs from the line the mode row and the corner share down to the shelf's plate, and its
   * three groups take what is left in the middle. Raise the top to the gutter and that middle is
   * gone — so the test does exactly that, on the window the interface is judged on, and checks that
   * it breaks. If a future change makes the top affordable (a shorter mode row, a shorter column),
   * this fails and the two edges can be reconsidered together.
   */
  it('do not include the top, because the right-hand column cannot pay for it', () => {
    expect(EDGE_TOP).toBeLessThan(FRAME_MARGIN);
    /** The smallest separation the column's three groups get, with the mode row hung at `top`. */
    const groupSpacing = (top: number): number => {
      const viewport = 900 / ZOOM;
      // The column hangs off the assistant's own row, so its offset from the top margin is
      // whatever `RAIL_TOP` works out to; only the margin itself is varied here.
      const layerBottom = top + (RAIL_TOP - EDGE_TOP) + RAIL.layer.h;
      const kitH = 6 * RAIL.button + 5 * RAIL.gap;
      const kitTop = Math.max(viewport - RAIL_FLOOR - kitH, 0);
      const historyH = 2 * RAIL.button + RAIL.gap;
      return (kitTop - layerBottom) / 2 - historyH / 2;
    };
    expect(groupSpacing(EDGE_TOP)).toBeGreaterThanOrEqual(RAIL.groupMin);
    expect(groupSpacing(FRAME_MARGIN)).toBeLessThan(RAIL.groupMin);
  });

  it('are measured to the ink, so choosing a mode cannot eat the top one', () => {
    // The row's box is exactly as deep as the tallest drawing it holds, which is a SELECTED mode, so
    // the box top IS that drawing's ink top. Placed on the RESTING drawings instead,
    // choosing a mode grows its art up out of the row and leaves 9 px over it: the tightest gap in
    // the frame, and one that only appears once somebody uses the thing.
    expect(MODE_ROW_TOP).toBe(EDGE_TOP);
    expect(MODE.height).toBe(Math.round(Math.max(...MODES.map((a) => a.selected.h)) * MODE_SCALE));
  });

  it('keep the selected block\'s whole plate on screen', () => {
    const overhang = (MODE_PLATE.w * MODE_SCALE - MODE.size) / 2;
    expect(overhang).toBeGreaterThan(0);
    expect(MODE_ROW_LEFT - overhang).toBeGreaterThan(0);
    // The plate stands proud ABOVE the block too, and the row hangs from the window's top edge.
    expect(MODE_ROW_BASE + (MODE_PLATE.drop - MODE_PLATE.h) * MODE_SCALE).toBeGreaterThan(0);
  });
});

/**
 * The two rows' separation is DERIVED, and from the state where they are tightest.
 *
 * Set as a constant to the BOX, 31 is 47 px of seen air at rest and 15 in the tight
 * state, because a box carries slack over the drawing standing in it and the row above hangs a name
 * into the gap only sometimes. One number cannot be judged in two states at once, so the only thing
 * chosen here is the clearance and the rest falls out of the drawings' own sizes.
 */
describe('the assistant stands under the row above it', () => {
  /** Where the character's own ink starts, in css px from the top of the window, per state. */
  const inkTop = (open: boolean) => ASSISTANT_ROW_TOP + MODE.height
    - (open ? ASSISTANT_BLOCK.selected.h : ASSISTANT_BLOCK.h) * MODE_SCALE;
  /** Where the selected block's name stops. */
  const nameBottom = MODE_ROW_BASE + MODE.label.gap + LABEL_INK_DEPTH * MODE.label.size;

  it('clears the selected block\'s name by the clearance it declares, at its own biggest', () => {
    expect(inkTop(true) - nameBottom).toBeCloseTo(MODE.rowClearance, 6);
  });

  it('never reaches the row above, in any of the four states the two can be in', () => {
    for (const open of [false, true]) {
      expect(inkTop(open)).toBeGreaterThan(MODE_ROW_BASE);
      expect(inkTop(open)).toBeGreaterThanOrEqual(nameBottom);
      // And it clears the splat, which hangs under a selected block whether or not it is named.
      expect(inkTop(open)).toBeGreaterThan(MODE_ROW_BASE + MODE_PLATE.drop * MODE_SCALE);
    }
  });
});

describe('nothing in the frame casts a shadow', () => {
  it('except the screen\'s own vignette and the edge a drawing wears on the map', () => {
    const offender = /box-?[Ss]hadow|text-?[Ss]hadow|drop-shadow/;
    // The vignette is a gradient rather than a shadow, since a shadow cannot be given to a single
    // edge, so the only names exempt here are the hairline every drawing wears: the dilation
    // (`MAP_SHAPE_EDGE`) and the spread-only ring a radius-box plate carries instead
    // (`plateShapeEdge` — zero offset, zero blur, so an outline and not a shadow).
    const exempt = ['MAP_SHAPE_EDGE', 'plateShapeEdge'];
    // A line is allowed if it NAMES one of the two (a place that applies the treatment) or if it is
    // written inside one's declaration (the treatment's own body, which is built out of a list, so
    // the name is not on the line the property is on).
    const found = sources(SHELL).flatMap(({ path, text }) => {
      let declaring = '';
      return text.split('\n').flatMap((line, i) => {
        declaring = /^export (?:const|function) (\w+)/.exec(line)?.[1] ?? declaring;
        const allowed = exempt.includes(declaring) || exempt.some((name) => line.includes(name));
        return offender.test(line) && !allowed ? [`${path}:${i + 1}${line}`] : [];
      });
    });
    expect(found).toEqual([]);
  });

  /**
   * The edge is a DILATION, and the two tests below are what that has to keep meaning.
   *
   * A stack of offset copies is the usual way to fake an outline, and it fails here for a reason no
   * arrangement of offsets can fix: at this width every copy sits under a third of a device pixel
   * from the original, so each one rasterizes as a partial-coverage smear rather than as the shape,
   * and eight smears land differently depending on where a given edge falls on the pixel grid.
   * Growing the alpha instead has no sub-pixel step in it at all.
   */
  it('and that edge is an outline: grown from the shape, not offset from it', () => {
    expect(MAP_SHAPE_EDGE).toBe(`url(#${SHAPE_EDGE_ID})`);
    // No offset anywhere in it, which is what separates an edge from a shadow.
    expect(MAP_SHAPE_EDGE).not.toMatch(/drop-shadow|px/);
  });

  it('reaches the same distance whichever way the shape\'s edge turns', () => {
    const { blur, slope } = SHAPE_EDGE_FILTER;
    // A Gaussian is isotropic, so the grown alpha at distance d out from a straight edge is
    // erfc(d / (sigma * root 2)) / 2 whichever way that edge runs. The ramp turns everything above
    // 1/slope solid, so the edge lands where the blurred alpha has fallen to exactly that.
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
    // The one number the pair exists to produce, within a tenth of a pixel.
    expect(lo).toBeCloseTo(SHAPE_EDGE, 1);
  });

  /**
   * A word and a drawing stand in the same row, so they wear one edge or they wear two. A solid
   * edge on the drawing beside a translucent one on the word is what made the drawing the thing
   * you look at, and nothing in the code says the two belong together except this.
   */
  it('and it is the same ink a word\'s edge is drawn in', () => {
    const alphaHex = Math.round(MAP_EDGE_ALPHA * 255).toString(16).padStart(2, '0');
    expect(MAP_LABEL.WebkitTextStroke).toBe(`0.075em ${INK}${alphaHex}`);
    // The filter is JSX, so the flood is read from the source the way the shadow rule above is.
    // The alpha rides the FLOOD: putting it on the ramp instead would soften the boundary back
    // into the gradient the dilation exists to avoid.
    const shell = sources(SHELL).find(({ path }) => path.endsWith('Shell.tsx'));
    expect(shell?.text).toMatch(/<feFlood floodColor=\{INK\} floodOpacity=\{MAP_EDGE_ALPHA\}/);
  });
});

describe('the top of the window is one band', () => {
  /**
   * THE TWO SIDES SHARE A LINE THROUGH THE MIDDLE OF WHAT IS DRAWN, and neither box edge.
   *
   * Either box edge reads wrong. Hung off the row's BASELINE the corner is 44 of ink
   * against a block's 55 to 64, so its top falls far below theirs and it reads low. Centred in
   * `MODE.height` it reads HIGH, because that band is sized for the SELECTED drawing and no resting
   * block fills it — the five rest with their ink centres at 67 to 71 while the corner's landed at
   * 63.5, nearly 6 px up.
   *
   * So the assertion is on the CENTRES, which is the alignment a person actually reads across the
   * top of the window. A consequence worth stating, since it looks wrong in isolation: the corner's
   * top sits BELOW every resting block's top and its bottom above their baseline. That is what
   * centring a shorter shape on a taller one does, and chasing either edge back would misalign it
   * again.
   */
  it('centres the corner ON THE INK it faces, not in the box behind it', () => {
    const restingCentres = MODES.map((art) => MODE_ROW_BASE - (art.h * MODE_SCALE) / 2);
    const mean = restingCentres.reduce((sum, c) => sum + c, 0) / restingCentres.length;
    expect(TOP_RIGHT_TOP + TOP_RIGHT_H / 2).toBeCloseTo(mean, 6);
    // It genuinely cannot fill the row: the corner is a good deal shallower, which is why the
    // question is where its middle goes rather than which edge it meets.
    expect(MODE.height - TOP_RIGHT_H).toBeGreaterThan(20);
    // Centring in the BOX would put it here, which is not where it goes.
    expect(TOP_RIGHT_TOP).not.toBeCloseTo(EDGE_TOP + (MODE.height - TOP_RIGHT_H) / 2, 1);
  });

  it('keeps the corner\'s own three on one line, which is what makes them a group', () => {
    // Measured to the INK. The cluster's depth is the deepest ink standing on that line rather than
    // a box height the three do not share: each hangs its own slack below the line instead
    // (`Shell.tsx:Piece`), which is what puts three different drawings on one line.
    expect(TOP_RIGHT_H).toBeCloseTo(
      Math.max(...TOP_RIGHT.map((art) => topRightHeight(art) - topRightSlack(art))), 6,
    );
    // Every drawing declares where its ink stops, or that line is measured off a guess.
    expect(TOP_RIGHT.every((art) => art.botSlack !== undefined)).toBe(true);
    // It still hangs below the margin the row's own box keeps.
    expect(TOP_RIGHT_TOP).toBeGreaterThan(EDGE_TOP);
  });

  /**
   * The corner's three and the rail's ten are ONE family of utilities, and sized apart they read as
   * two: 58 against 44, on the argument that a corner control is a whole drawing where a rail one is
   * a glyph on a plate, compares the two at different parts of themselves — a rail control IS its
   * plate.
   *
   * Within the corner, box-height sizing makes three sizes as well: at one box height a filled
   * circle, a shape that is mostly a notch and a square filled corner to corner read 62, 54 and 65,
   * the same mistake box-height sizing makes in the rail without `apparentSize`.
   *
   * `apparentSize` alone makes the opposite one. Normalising all three onto its own number renders
   * the share anchor 53 css tall against 44 for the two discs, because the formula discounts area
   * and an open shape is mostly not there — and the corner reads as one big control and two small
   * ones. So each carries a `trim` judged by eye at rendered size, and this holds the SHAPE of that
   * answer: three unequal corrections that land the three drawings within a pixel of the family's
   * own size. Setting the trims equal fails the second assertion, which is the point of it.
   */
  it('brings the corner\'s three to one SIZE, by three corrections that are not equal', () => {
    // A rail button's own reading, so the two groups are one size without either holding a copy of
    // the other's number.
    const b = RAIL.button;
    expect(RAIL.topRight).toBeCloseTo(Math.sqrt(Math.hypot(b, b) * Math.sqrt((Math.PI * b * b) / 4)), 6);
    // What the eye was asked to settle: how tall each drawing comes out. All three within a pixel
    // of a rail button's diameter, which is where looking at them landed.
    for (const art of TOP_RIGHT) {
      expect(Math.abs(topRightHeight(art) - RAIL.button)).toBeLessThan(1);
    }
    // And not by matching the numbers. The formula's own answers are still three different sizes,
    // spread by more than a tenth: the trims are what closes that, and they differ per drawing.
    const untrimmed = TOP_RIGHT.map((art) => (RAIL.topRight * art.h) / (art.apparent ?? art.h));
    expect(Math.max(...untrimmed) / Math.min(...untrimmed)).toBeGreaterThan(1.1);
    expect(new Set(TOP_RIGHT.map((art) => art.trim ?? 1)).size).toBe(TOP_RIGHT.length);
    // Every drawing still declares the MEASUREMENT its correction is a correction to.
    expect(TOP_RIGHT.every((art) => art.apparent !== undefined)).toBe(true);
    // Sized by the BOX they still are not. Three boxes of three heights come out one height, so
    // each is being scaled by a different amount — which is the whole apparatus doing its job.
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

  /** Hanging a group's gap under the line the mode row and the corner share places the rail against
   *  what stands above it and leaves it 9 px higher than the assistant across the window. The two
   *  are the frame's second row, one at each edge, so they start together. */
  it('starts level with the assistant on the other side of the window', () => {
    expect(RAIL_TOP).toBe(ASSISTANT_INK.top);
    // Ink to ink: the plate is a filled pill, so its own ink is its box and nothing is subtracted
    // on this side. It is the RESTING character that is matched, the one normally there.
    expect(ASSISTANT_INK.top).toBeCloseTo(
      ASSISTANT_ROW_TOP + MODE.height - ASSISTANT_BLOCK.h * MODE_SCALE, 6,
    );
    // And it is still well below the corner cluster, so the column reads as the next thing down.
    expect(RAIL_TOP).toBeGreaterThan(TOP_RIGHT_TOP + TOP_RIGHT_H);
  });

  it('stops above the bottom shelf\'s plate, whichever bar is open', () => {
    expect(RAIL_FLOOR).toBeGreaterThan(PLATE_BAND.top);
  });

  /**
   * THE STEPPER IS CENTRED ON THE BUTTONS, NOT SQUARED WITH THEIR RIGHT EDGE.
   *
   * Both are filled drawings whose ink is their own box — a disc fills its square and the stepper is
   * a stadium — so the line a person reads down the column is the two shapes' middles, and squaring
   * the right edges left the narrower one half the difference off it. The buttons still keep the
   * frame's margin, since centring puts the pill entirely inside their span rather than past it.
   */
  it('centres the layer stepper on the buttons under it', () => {
    expect(LAYER_STEP_RIGHT + RAIL.layer.w / 2).toBeCloseTo(EDGE_RIGHT + RAIL.button / 2, 6);
    expect(LAYER_STEP_RIGHT, 'and the margin is still the buttons\'').toBeGreaterThan(EDGE_RIGHT);
    expect(LAYER_STEP_RIGHT + RAIL.layer.w).toBeLessThan(EDGE_RIGHT + RAIL.button);
  });

  /**
   * THE PLATE IS PLACED WITH THE GROUPS, AND WHAT IT COSTS THEM IS WHAT THIS HOLDS.
   *
   * The open plate is 331 deep and the eight round buttons come to 424 with their separations, so a
   * lane 489 long — a 1600x900 window — cannot hold both. Two things can give and the plan picks
   * per window: the pair steps down and the plate takes the room above it, or the plate steps out of
   * the lane and the column is untouched. What may NOT happen is the plate standing over a button:
   * a plate is opaque, and a covered control is a control nobody can press.
   */
  describe('and the layer stack takes its turn among them', () => {
    const layerBottom = RAIL_TOP + RAIL.layer.h;
    const plan = (vh: number, open: boolean) => planRail(vh / ZOOM, { open, plateDepth: PLATE_DEPTH });
    /** How deep the pair stands in a given plan. It FOLDS on a short window, so it is not a
     *  constant, and reading it off the plan is what keeps every separation below measured against
     *  the arrangement the plan actually chose. */
    const pairDepth = (p: RailPlan) => railStack(Math.ceil(HISTORY_BUTTONS / p.historyFiles));
    /** The least of the plate worth showing: its head, its own padding, and one whole row of the
     *  SQUARE's floors, which is the size these plans are made for. A plate cut above this is a head
     *  with no stack under it. */
    const PLATE_FIRST_ROW = 142;
    /** The three windows the arrangement is judged on. */
    const WINDOWS = [720, 900, 1440];

    it('declares the plate\'s depth the browser draws, so the plan is planning the real thing', () => {
      // It does not vary with the language: a longer floor name widens a tile's equal track, it
      // does not add a line to it. Measured in the browser at 322.6 css px over a generated island,
      // three rows of the square's three-line tile: a floor's name, its count with the eye and the
      // lock, and its bar.
      expect(PLATE_DEPTH).toBeCloseTo(359, 6);
    });

    /** TWO FILES IS THE CAP, and it is a property of the ladder rather than of any window. A group
     *  three buttons wide is a block sitting where a column was, so no arrangement of the kit or of
     *  the pair may reach one — which also means a window too short for the last rung has to land
     *  somewhere, and where it lands is the plate stepping aside (the test above). */
    it('never runs either group in more than two files', () => {
      for (const f of RAIL_FOLDS) {
        expect(f.kit, 'the kit').toBeLessThanOrEqual(2);
        expect(f.history, 'the pair').toBeLessThanOrEqual(2);
      }
      for (let vh = 400; vh <= 2160; vh += 4) {
        for (const open of [false, true]) {
          const p = plan(vh, open);
          expect(p.kitFiles, `${vh}px, ${open ? 'open' : 'at rest'}`).toBeLessThanOrEqual(2);
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

    it('cannot make room for the plate on a short window, which is why the plate steps aside there', () => {
      // Both of these are here again. The square is 323 deep rather than 193.5 — it kept the roomy
      // three-line tile the file traded away — and the ladder stops at two files a group, so
      // neither of these windows has a rung that seats it. This is the case that lands the plate
      // beside the lane, which is what happens wherever the ladder does not reach.
      const roomAt = (vh: number) => {
        const p = plan(vh, true);
        // The room the lane could offer, if the pair were pushed as low as the column allows.
        return p.kitTop - pairDepth(p) - 2 * RAIL.groupMin - RAIL_TOP;
      };
      // On the shorter of the two there is not one floor's worth of lane, let alone a plate.
      expect(roomAt(720), '720px cannot show one floor').toBeLessThan(PLATE_FIRST_ROW);
      for (const vh of [720, 900]) {
        const p = plan(vh, true);
        expect(roomAt(vh), `${vh}px cannot hold the plate`).toBeLessThan(PLATE_DEPTH);
        // So it stands one file of buttons and a separation out of the lane, and the pair is left
        // at the place it keeps with nothing open.
        expect(p.plateInLane).toBe(false);
        expect(p.plateRight).toBeCloseTo(EDGE_RIGHT + railStack(p.kitFiles) + RAIL.groupMin, 6);
        expect(p.historyTop).toBeCloseTo(plan(vh, false).historyTop, 6);
        // And nothing was folded for it, since folding would not have seated it either.
        expect(p.kitFiles).toBe(plan(vh, false).kitFiles);
        expect(p.historyFiles).toBe(plan(vh, false).historyFiles);
      }
    });

    /**
     * THE OPEN PLATE IS WHAT ASKS THE COLUMN TO FOLD, and on the windows people have it is the only
     * thing that does.
     *
     * Read off the window's height alone the ladder is nearly dead: the kit only breaks up under
     * about 900 device px and the pair only under 700, and almost nobody works at a window that
     * short. What every window has is the plate, and the plate wants the column's own lane. Folding
     * is what buys it: a shallower group hangs lower, so more of the run is left above it.
     *
     * What it costs is the arrangement of the column's own buttons, which stay on screen and stay
     * pressable either way — against the plate stepping out over the map and standing a button's
     * width off the line the rest of the right-hand side is squared to.
     */
    it('folds a group to seat the open plate, and only as far as seating it takes', () => {
      const rung = (p: RailPlan) =>
        RAIL_FOLDS.findIndex((f) => f.kit === p.kitFiles && f.history === p.historyFiles);
      // The band where the fold is what buys the lane: the square seats from about 1092 device px,
      // and up to about 1352 it takes a second kit file to do it. Below the band even a full fold
      // cannot seat it, so nothing folds and the plate steps out over the map.
      expect(rung(plan(1080, false)), '1080px at rest folds nothing').toBe(0);
      expect(rung(plan(1080, true)), '1080px open folds nothing either — folding would not seat it').toBe(0);
      expect(plan(1080, true).plateInLane).toBe(false);
      expect(plan(1244, true).kitFiles, '1244px open puts the kit in two files').toBe(2);
      expect(plan(1244, true).plateInLane).toBe(true);
      // A tall window is asked for nothing: its lane is long enough as it stands.
      expect(rung(plan(1440, true)), '1440px needs no fold').toBe(0);
      expect(plan(1440, true).plateInLane).toBe(true);
      // Across the range: an open plate never folds LESS than the window itself required, and a
      // fold it did ask for always seats the plate. A column rearranged for a plate that still ends
      // up out over the map has paid for nothing.
      for (let vh = 600; vh <= 2160; vh += 4) {
        const closed = rung(plan(vh, false));
        const open = plan(vh, true);
        expect(rung(open), `${vh}px`).toBeGreaterThanOrEqual(closed);
        if (rung(open) > closed) expect(open.plateInLane, `${vh}px folded, so it is seated`).toBe(true);
      }
    });

    /**
     * AND THE STEP IS THE PLATE'S DEPTH, NOT EVERYTHING THE PAIR COULD GIVE.
     *
     * Whether the plate is seated at all is asked of the room the pair COULD yield, which is the
     * lowest it can stand. Where it then stands is a different question with a smaller answer: it
     * steps down until the plate clears it and stops. Answering both with one number pushes undo and
     * redo down against the view kit on a window with 170 px of slack left in the lane, and three
     * groups read as two.
     */
    it('does make room for it on a tall one, and steps down by exactly what the plate needs', () => {
      const p = plan(1440, true);
      expect(p.plateInLane).toBe(true);
      expect(p.plateRight, 'flush with the buttons').toBeCloseTo(EDGE_RIGHT, 6);
      // Clear of the plate by a group's separation, and no lower than that.
      expect(p.historyTop).toBeCloseTo(RAIL_TOP + PLATE_DEPTH + RAIL.groupMin, 6);
      expect(p.historyTop, 'a step DOWN, though').toBeGreaterThan(plan(1440, false).historyTop);
      // So the separation it keeps from the kit is the slack the lane still had, not the minimum.
      expect(p.kitTop - (p.historyTop + pairDepth(p)), 'and it keeps its distance from the kit')
        .toBeGreaterThan(RAIL.button);
    });

    /**
     * THE HARD FLOOR, AND IT IS WHY THE KIT BREAKS INTO FILES.
     *
     * A 720-tall window leaves 345 css px of column against the 452 the three groups take at their
     * own spacing, so the six camera buttons cannot be one file there: they hung 143 px below the
     * window's bottom edge, the last two off the screen and the one before it on the shelf's band.
     * The plan gives them a second file instead, which is 150 deep rather than 309.
     */
    it('keeps every group off the bottom shelf and clear of its neighbours, at all three windows', () => {
      for (const vh of WINDOWS) {
        for (const open of [false, true]) {
          const p = plan(vh, open);
          const viewport = vh / ZOOM;
          const kitH = railStack(Math.ceil(KIT_BUTTONS / p.kitFiles));
          const what = `${vh}px, ${open ? 'open' : 'at rest'}`;
          // The 3D kit, which is the tall one, stays off the shelf's plate and on the screen.
          expect(p.kitTop + kitH, what).toBeLessThanOrEqual(viewport - PLATE_BAND.top);
          // The groups read as groups: every separation at least the squeezed one.
          expect(p.historyTop - layerBottom, `${what}, under the layer control`)
            .toBeGreaterThanOrEqual(RAIL.groupMin - 1e-9);
          expect(p.kitTop - (p.historyTop + pairDepth(p)), `${what}, over the kit`)
            .toBeGreaterThanOrEqual(RAIL.groupMin - 1e-9);
          // And nothing the plate does reaches a button: either it is out of the lane, or the pair
          // and the kit both start below it.
          if (open && p.plateInLane) {
            expect(p.historyTop, what).toBeGreaterThanOrEqual(RAIL_TOP + PLATE_DEPTH + RAIL.groupMin);
          }
        }
      }
    });

    it('breaks the kit into files only where one file will not fit', () => {
      // SEVEN buttons, the hide toggle included: a single file is 362 css px against 309, and the
      // run only reaches that from about 965 device px of window height.
      expect(plan(720, false).kitFiles, 'a laptop cannot hold the seven in one').toBe(2);
      expect(plan(900, false).kitFiles, 'nor can a 900px window').toBe(2);
      expect(plan(965, false).kitFiles, 'and just above the fold').toBe(1);
      expect(plan(1440, false).kitFiles).toBe(1);
      // A file is as wide as it is deep in buttons, which is what the plate steps aside by.
      expect(railStack(2)).toBe(2 * RAIL.button + RAIL.gap);
    });

    /**
     * AND THE PAIR FOLDS THE SAME WAY, SECOND.
     *
     * The two groups that can fold are worth different amounts: the kit is six buttons, so a second
     * file buys the column 159 css px, where folding two buttons into a row buys 53. So the order is
     * not arbitrary and this is what holds it — the expensive group first, the pair only once that
     * is not enough, and the kit's third file last of all, since three buttons abreast has stopped
     * being a file.
     *
     * The window it bites on is a real one: a 1366x768 laptop with browser chrome lands near 660.
     */
    it('folds the pair after the kit, and only where a folded kit is not enough', () => {
      // Not every window in the set: with seven in the kit, a folded kit stops being enough at about
      // 766 device px, and the smallest of the three is below that.
      for (const vh of WINDOWS.filter((h) => h > 766)) {
        expect(plan(vh, false).historyFiles, `${vh}px keeps the pair in one file`).toBe(1);
      }
      expect(plan(770, false).historyFiles, 'and just above the fold').toBe(1);
      expect(plan(720, false).historyFiles, 'and a 1366x768 laptop is under it').toBe(2);
      const folded = plan(660, false);
      expect(folded.historyFiles, 'a 660px window folds it into a 2x1 row').toBe(2);
      // The kit went first, and it is still two rather than three: the pair is what gave next.
      expect(folded.kitFiles).toBe(2);
      // Two buttons have one fold in them and no more, whatever the window does.
      for (let vh = 400; vh <= 2160; vh += 20) {
        expect(plan(vh, false).historyFiles, `${vh}px`).toBeLessThanOrEqual(HISTORY_BUTTONS);
      }
    });

    /**
     * A FOLD IS A LAST RESORT, NOT A SAVING. Every arrangement the plan reaches for is one it could
     * not avoid: at each window, the arrangement chosen is either the unfolded one or one whose
     * predecessor genuinely does not fit the run. Without this the ladder could quietly start one
     * rung down and nothing on screen would say so.
     */
    it('never folds a group the window had room to leave alone', () => {
      const depth = (f: { kit: number; history: number }) => railStack(Math.ceil(KIT_BUTTONS / f.kit))
        + railStack(Math.ceil(HISTORY_BUTTONS / f.history));
      // The ladder is ordered by how much each rung gives up, so a rung is only right if the one
      // before it does not fit. Asked of the LADDER rather than of a copy of it here: two spellings
      // of the order would let the plan drift from what this pins.
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
        if (at === RAIL_FOLDS.length - 1) continue; // the last rung is taken whether it fits or not
        expect(depth(RAIL_FOLDS[at]!), `${vh}px, the rung chosen fits`).toBeLessThanOrEqual(run);
        if (at > 0) {
          expect(depth(RAIL_FOLDS[at - 1]!), `${vh}px, and the rung before it does not`)
            .toBeGreaterThan(run);
        }
      }
    });
  });
});

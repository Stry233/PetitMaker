/**
 * How the frame sizes the drawings that stand in a row together: the rail's glyphs, and the blocks
 * of the top-left row.
 *
 * The drawings come from the design source at whatever size and offset the artist worked at, and
 * those are not comparable: a dense ring and an open arrow of the same span do not read as the same
 * size, and a shape is rarely centred in its own box. The two functions here turn a measured ink
 * into the one number and the one point the rail uses, and what this pins is that the FAMILY comes
 * out even — which is the thing a reader sees, and the thing box-height sizing got wrong.
 *
 * The rule holds for solid drawings. One glyph is an outline, and it takes its own correction on
 * top; that exception is pinned here too, so it cannot quietly become a second rule.
 *
 * The block row is the same question with a better answer available: five of its six drawings share
 * a grass cube, so they are held to one WIDTH, which is what a cube's size is. The sixth has no cube
 * and falls back to the ink rule.
 */
import { describe, it, expect } from 'vitest';
import {
  apparentSize, opticalCentre, ASSISTANT_BLOCK, FIT_INK, FIT_TRIM, GLYPHS, MODES, MODE_ROW_BASE,
  type GlyphInk,
} from '../../../ui/shell/frame';
import { BLOCK_W, BLOCK_W_ON, EDGE_TOP, MODE, MODE_SCALE, RAIL } from '../../../ui/shell/units';

/** The four drawings the design source made: solid shapes, comparable to each other by weight. */
const DRAWN_FAMILY: Record<string, GlyphInk> = {
  undo: GLYPHS.undo.ink,
  rotate: GLYPHS.rotate.ink,
  zoomIn: GLYPHS.zoomIn.ink,
  zoomOut: GLYPHS.zoomOut.ink,
};

/** Every glyph the rail draws, including the one icon the design source never drew. */
const FAMILY: Record<string, GlyphInk> = { ...DRAWN_FAMILY, fit: FIT_INK };

/** What each drawing's ink measures on screen once the rail has sized it. `trim` is a glyph's own
 *  correction, which only the fit icon carries. */
function drawn(ink: GlyphInk, trim = 1): { w: number; h: number; area: number } {
  const k = (RAIL.glyph * trim) / apparentSize(ink);
  return { w: ink.w * k, h: ink.h * k, area: ink.area * k * k };
}

const span = (g: { w: number; h: number }) => Math.hypot(g.w, g.h);

describe('sizing a glyph by what it reads as', () => {
  it('brings the drawn family within a quarter of one size and one weight', () => {
    const sizes = Object.values(DRAWN_FAMILY).map((ink) => span(drawn(ink)));
    const areas = Object.values(DRAWN_FAMILY).map((ink) => drawn(ink).area);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(1.25);
    expect(Math.max(...areas) / Math.min(...areas)).toBeLessThan(1.5);
  });

  it('needs its own correction for the icon that is an outline', () => {
    // The fit icon is four corner brackets: a fifth of the solid drawings' ink over the same span.
    // The area term reads that as small and scales it up, so the rule alone hands the rail its
    // widest glyph. What an outline is read by is its span, and `FIT_TRIM` is what puts that span
    // back inside the family — the WEIGHT stays low, because a hollow square has no more ink to
    // give.
    const sizes = Object.values(DRAWN_FAMILY).map((ink) => span(drawn(ink)));
    expect(span(drawn(FIT_INK))).toBeGreaterThan(Math.max(...sizes));
    expect(span(drawn(FIT_INK, FIT_TRIM))).toBeLessThan(Math.max(...sizes));
    expect(span(drawn(FIT_INK, FIT_TRIM))).toBeGreaterThan(Math.min(...sizes) * 0.95);
  });

  it('is the improvement over drawing each glyph to its own box', () => {
    // What the rail used to do: every glyph scaled so its BOX was one height.
    const byBox = (ink: GlyphInk, boxH: number) => {
      const k = RAIL.glyph / boxH;
      return Math.hypot(ink.w * k, ink.h * k);
    };
    const old = [byBox(GLYPHS.undo.ink, 63), byBox(GLYPHS.rotate.ink, 61), byBox(GLYPHS.zoomIn.ink, 82)];
    const now = [GLYPHS.undo.ink, GLYPHS.rotate.ink, GLYPHS.zoomIn.ink]
      .map((ink) => Math.hypot(drawn(ink).w, drawn(ink).h));
    expect(Math.max(...old) / Math.min(...old)).toBeGreaterThan(Math.max(...now) / Math.min(...now));
  });

  it('reads a taller-than-wide drawing as no bigger than a wide one', () => {
    // The magnifier is 82 design px tall against the rotate arrow's 61, which is exactly why box
    // height cannot be the measure.
    expect(apparentSize(GLYPHS.zoomIn.ink)).toBeCloseTo(apparentSize(GLYPHS.rotate.ink), -1);
  });
});

describe('centring a glyph on where it balances', () => {
  it('lands between the middle of the ink and its centre of mass', () => {
    for (const ink of Object.values(FAMILY)) {
      const c = opticalCentre(ink);
      const mid = { x: ink.x + ink.w / 2, y: ink.y + ink.h / 2 };
      expect(c.x).toBeGreaterThanOrEqual(Math.min(mid.x, ink.gx));
      expect(c.x).toBeLessThanOrEqual(Math.max(mid.x, ink.gx));
      expect(c.y).toBeGreaterThanOrEqual(Math.min(mid.y, ink.gy));
      expect(c.y).toBeLessThanOrEqual(Math.max(mid.y, ink.gy));
    }
  });

  it('moves the magnifier down, because its weight is all in the lens', () => {
    // Its box centre is 41 of 82; its ink balances well above that, so centring the box leaves the
    // lens riding high in the button.
    expect(opticalCentre(GLYPHS.zoomIn.ink).y).toBeLessThan(41);
  });

  it('leaves a drawing that is already centred where it is', () => {
    const c = opticalCentre(FIT_INK);
    expect(c.x).toBeCloseTo(12, 1);
    expect(c.y).toBeCloseTo(12, 1);
  });
});

describe('sizing the block row by the cube its drawings share', () => {
  /** What the design source exports each mode drawing at: resting w/h, then selected w/h. */
  const DRAWN: Record<string, readonly [number, number, number, number]> = {
    object: [172, 184, 207, 212],
    road: [172, 190, 207, 200],
    mountain: [172, 165, 207, 187],
    water: [172, 168, 207, 200],
    generate: [176, 174, 208, 180],
  };

  it('lays every mode drawing out at one width, whatever it was exported at', () => {
    // The generator's cube is drawn 2.3% bigger than its four neighbours', which is the one place
    // the row was uneven: the same cube at two sizes, in a row read by that cube.
    expect(DRAWN.generate![0]).toBeGreaterThan(DRAWN.object![0]);
    for (const art of MODES) {
      expect(art.w).toBe(BLOCK_W);
      expect(art.selected.w).toBe(BLOCK_W_ON);
    }
  });

  it('scales rather than squashes: each keeps the proportions it was drawn at', () => {
    for (const art of MODES) {
      const [w, h, ow, oh] = DRAWN[art.id]!;
      expect(art.h / art.w).toBeCloseTo(h / w, 9);
      expect(art.selected.h / art.selected.w).toBeCloseTo(oh / ow, 9);
    }
  });

  it('falls back to the ink rule for the assistant, which has no cube to hold to', () => {
    // A solid character at the blocks' own width carries a third more ink than a diorama does and
    // reads correspondingly bigger, so it is drawn under that width in both states.
    expect(ASSISTANT_BLOCK.w).toBeLessThan(BLOCK_W);
    expect(ASSISTANT_BLOCK.selected.w).toBeLessThan(BLOCK_W_ON);
    // By different fractions: the design's pressed blocks are airier than its resting ones, and the
    // character is one picture in both.
    expect(ASSISTANT_BLOCK.selected.w / BLOCK_W_ON).toBeLessThan(ASSISTANT_BLOCK.w / BLOCK_W);
    // Still the design's own picture, at 153 x 150.
    expect(ASSISTANT_BLOCK.h / ASSISTANT_BLOCK.w).toBeCloseTo(150 / 153, 9);
    expect(ASSISTANT_BLOCK.selected.h / ASSISTANT_BLOCK.selected.w).toBeCloseTo(150 / 153, 9);
  });

  it('keeps the line the top of the window shares off the assistant', () => {
    // The top-right cluster is placed to end on `MODE_ROW_BASE`, so anything that line is derived
    // from can move a cluster in the opposite corner. It is derived from the mode row's own box:
    // the margin, plus room for the tallest drawing that box has to hold, which is a SELECTED mode.
    // The character is not in it at all, so resizing that block cannot reach the other corner.
    const tallestSelected = Math.max(...MODES.map((art) => art.selected.h));
    expect(MODE.height).toBe(Math.round(tallestSelected * MODE_SCALE));
    expect(MODE_ROW_BASE).toBeCloseTo(EDGE_TOP + MODE.height, 9);
    // And it still fits in that box, which is what lets the two rows share one block size.
    expect(ASSISTANT_BLOCK.selected.h * MODE_SCALE).toBeLessThanOrEqual(MODE.height);
  });
});

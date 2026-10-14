/**
 * The landmark's ink: the glyph bank and phrase list a banner or a field writes, their
 * rasterization at a scale, and the court patterns a terrace court draws.
 */
import type { Stencil } from '../../recipe';

// --- the glyph bank ------------------------------------------------------------------------------

/**
 * The alphabet, 5 cells wide and 6 tall: the letter size of a ground field, and half the size of a
 * banner's, which `SCALES` reaches by doubling.
 *
 * A `#` is ink. Every row of a glyph is the same length as its first, which `landmark.test.ts`
 * holds, so a typo in a drawing fails the build rather than shifting a letter.
 */
const LETTERS: Readonly<Record<string, readonly string[]>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#'],
  B: ['####.', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '.####'],
  H: ['#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '....#', '....#', '....#', '#...#', '.###.'],
  K: ['#...#', '#..#.', '###..', '###..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#..#.', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '...#.', '..#..', '.#...', '#....', '#####'],
};

/** The figures, drawn a little wider than a letter so a lone one still fills a panel. */
const FIGURES: Readonly<Record<string, readonly string[]>> = {
  HEART: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  STAR: ['...#...', '..###..', '#######', '.#####.', '..###..', '.##.##.', '##...##'],
  PAW: ['.##.##.', '.##.##.', '##...##', '.#####.', '#######', '.#####.'],
};

export const GLYPHS: Readonly<Record<string, readonly string[]>> = { ...LETTERS, ...FIGURES };

/** One thing the map can be made to say. Adding a row is the whole of extending the bank, provided
 *  every glyph it names is drawn above. */
export interface Phrase {
  id: string;
  /** Keys into `GLYPHS`, in reading order. */
  glyphs: readonly string[];
  /** Draw weight. A word is the landmark's own grammar and a lone figure is the cheap version of
   *  it, so the words are drawn oftener — and a figure fits almost any panel, which without a
   *  weight would make it the answer nearly every time. */
  weight: number;
}

export const PHRASE_BANK: readonly Phrase[] = [
  { id: 'home', glyphs: ['H', 'O', 'M', 'E'], weight: 3 },
  { id: 'i-love-you', glyphs: ['I', 'HEART', 'U'], weight: 3 },
  { id: 'heart', glyphs: ['HEART'], weight: 1 },
  { id: 'star', glyphs: ['STAR'], weight: 1 },
  { id: 'paw', glyphs: ['PAW'], weight: 1 },
];

// --- rasterizing a phrase --------------------------------------------------------------------------

/**
 * A phrase as a `Stencil`: the same structure the browser rasterizer hands the generator, so the two
 * ways of drawing a shape read identically downstream. Colour is unused here — the glyph is built out
 * of terrain, which has its own — and every cell's four quadrants carry its own coverage, since a
 * cell mask has no sub-cell detail to report.
 *
 * `scale` multiplies both axes, which is what makes the stroke 2 cells wide at scale 2: a banner's
 * strokes measure 1 to 2 cells and a ground field's letters 1.
 */
export function rasterizePhrase(
  glyphs: readonly string[], scale: number, axis: 'h' | 'v',
): Stencil | null {
  const drawings = glyphs.map((key) => GLYPHS[key]).filter((rows): rows is readonly string[] => !!rows);
  if (drawings.length !== glyphs.length || drawings.length === 0 || scale < 1) return null;
  const sizes = drawings.map((rows) => ({ w: (rows[0]?.length ?? 0) * scale, h: rows.length * scale }));
  // One cell of air per unit of scale, so the letters of a doubled phrase do not touch.
  const gap = scale;
  const across = Math.max(...sizes.map((s) => (axis === 'h' ? s.h : s.w)));
  const along = sizes.reduce((a, s) => a + (axis === 'h' ? s.w : s.h), 0) + gap * (sizes.length - 1);
  const width = axis === 'h' ? along : across;
  const height = axis === 'h' ? across : along;

  const coverage = new Uint8Array(width * height);
  let cursor = 0;
  for (const [k, rows] of drawings.entries()) {
    const size = sizes[k]!;
    // Centred on the cross axis, so a figure taller than the letters beside it sits on their middle
    // rather than on their baseline.
    const offX = axis === 'h' ? cursor : Math.floor((width - size.w) / 2);
    const offY = axis === 'h' ? Math.floor((height - size.h) / 2) : cursor;
    for (let y = 0; y < size.h; y++) {
      const row = rows[Math.floor(y / scale)]!;
      for (let x = 0; x < size.w; x++) {
        if (row[Math.floor(x / scale)] !== '#') continue;
        coverage[(offY + y) * width + offX + x] = 255;
      }
    }
    cursor += (axis === 'h' ? size.w : size.h) + gap;
  }
  const quad = new Uint8Array(width * height * 4);
  for (let i = 0; i < coverage.length; i++) {
    const v = coverage[i]!;
    quad[i * 4] = v; quad[i * 4 + 1] = v; quad[i * 4 + 2] = v; quad[i * 4 + 3] = v;
  }
  return { width, height, coverage, color: new Uint32Array(width * height), quad };
}

/**
 * The patterns a court's dry mass can be drawn as, and the whole of the court's vocabulary.
 *
 * One form repeated is the tell: a map whose water is 85% to 95% one stamped rectangle reads as
 * wallpaper, and a figure pass answering every planet with the same medallion would put that fault back
 * at set-piece scale. So a court draws its pattern from this bank by seed, and every entry is
 * symmetric in both axes — nothing about the drawing depends on which way round the panel was found.
 */
export const COURT_PATTERNS = ['medallion', 'rings', 'bars', 'islets', 'cross'] as const;
export type CourtPattern = (typeof COURT_PATTERNS)[number];

/** How many cells of a stencil carry ink. */
export const inkOf = (s: Stencil): number => s.coverage.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);

/** The least mass a court's pattern may draw. Under this the panel reads as a pool rather than as a
 *  figure, and the pattern the seed drew is not one this panel can carry. */
export const COURT_INK_MIN = 9;

/** How many nested rectangles the `rings` pattern draws, and how often a `bars` tooth stands. */
const RING_BANDS = 3;
const BAR_PITCH = 4;

/** The court's pattern as a stencil: the strokes are what stands dry inside the flooded panel. */
export function courtInk(width: number, height: number, pattern: CourtPattern): Stencil {
  const w = Math.max(1, width), h = Math.max(1, height);
  const coverage = new Uint8Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const block = Math.max(1, Math.round(Math.min(w, h) / 6));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Distance measured on the shorter axis's scale in both, so a long panel carries the figure at
      // its own proportions rather than one stretched to the ends.
      const dx = Math.abs(x - cx) * (h / w), dy = Math.abs(y - cy);
      const corner = (x < block || x >= w - block) && (y < block || y >= h - block);
      // The rings are normalized to the panel, not counted in from its edge. `min(x, w-1-x, y, h-1-y)`
      // is the distance to the nearest side, so on the long panels a real planet most often offers
      // (46x8, 52x7, 60x6) it never passes 3 and the pattern came out as one or two lines running the
      // whole width — a stripe. Scaled to each axis's own half-span it draws `RING_BANDS` nested
      // rectangles at any aspect, which is the figure the name promises.
      const ring = Math.round(RING_BANDS * Math.max(
        Math.abs(x - cx) / Math.max(1, cx), Math.abs(y - cy) / Math.max(1, cy),
      ));
      // And the bars run across the long axis with a spine down it. Drawn as `x % 3` they are parallel
      // lines whichever way the panel lies, the same silhouette as the rings — two of the bank's five
      // entries reading as one. Across the long axis with a spine they are a comb, a shape of its own and
      // the one water gardens carry.
      const alongX = w >= h;
      const teeth = (alongX ? x : y) % BAR_PITCH === 1;
      const spine = alongX ? Math.abs(y - cy) <= block : Math.abs(x - cx) <= block;
      let ink = false;
      switch (pattern) {
        case 'medallion': ink = dx + dy <= Math.max(2, Math.min(w, h) / 2 - 1) / 2 || corner; break;
        case 'rings': ink = ring % 2 === 1; break;
        case 'bars': ink = teeth || spine; break;
        case 'islets': ink = x % 5 < 2 && y % 4 < 2; break;
        case 'cross': ink = Math.abs(x - cx) <= block || Math.abs(y - cy) <= block || corner; break;
      }
      if (ink) coverage[y * w + x] = 255;
    }
  }
  const quad = new Uint8Array(w * h * 4);
  for (let i = 0; i < coverage.length; i++) {
    const v = coverage[i]!;
    quad[i * 4] = v; quad[i * 4 + 1] = v; quad[i * 4 + 2] = v; quad[i * 4 + 3] = v;
  }
  return { width: w, height: h, coverage, color: new Uint32Array(w * h), quad };
}

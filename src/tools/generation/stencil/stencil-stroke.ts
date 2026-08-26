/*
 * stencil-stroke.ts — how thick a letter is drawn, and the passes that keep what was drawn.
 *
 * A GLYPH IS QUANTISED TO CELLS, so its weight is not a matter of taste: a stroke and the gap beside
 * it are each a whole number of cells, and once the gap rounds to nothing the letter has closed up.
 * The old rasterizer asked for the heaviest weight there is at every size, which is why an E in a
 * modest region arrived four cells thick with its two counters filled in.
 *
 * THE WEIGHT IS THE WHOLE OF THE CONTROL. It is chosen so the face draws near the width the region
 * can carry — thin in a small region, bold in a large one — and never thinner than the one cell a
 * grid can hold, which is what lets a small region carry text at all. The rest of this file only
 * REPAIRS what quantising a curve does: it joins a diagonal that came out as a chain of corners, takes
 * off the lone cell an edge left standing, and never reshapes a stroke the face drew.
 *
 * Everything here is plain arithmetic over a `Stencil`, so it is testable with no browser — the
 * rasterizer is the only part that needs one.
 */
import { bridgesDaylight, COVERAGE_ON, sealsGround, scriptOf, smoothShape, type Stencil } from './stencil';

/** The region a glyph is fitted into, in cells. */
export interface GlyphBox { width: number; height: number }

/** How many characters a string draws, counted in CODE POINTS so one emoji is one of them. */
function glyphCount(text: string): number {
  return Math.max(1, [...text].length);
}

/**
 * What one glyph gets, in cells: the shorter side of the room it is fitted to, less the cell of air
 * the rasterizer leaves around the ink.
 *
 * The rasterizer fits the INK to the box on both axes, so a row of characters divides the width
 * between them while each still has the whole height to stand in — the binding one is whichever
 * runs out first.
 */
export function glyphExtent(text: string, box: GlyphBox): number {
  const n = glyphCount(text);
  return Math.max(1, Math.min(box.height - 1, (box.width - 1) / n));
}

/**
 * How wide a stroke may be, as a share of the glyph's own extent.
 *
 * IT GROWS WITH THE ROOM, and that is the whole of the "smart" switch. A stroke drawn at a fixed
 * share of the glyph is the same picture at every size — but the picture is quantised, so at 12
 * cells a fifth of the glyph is 2 cells of stroke against 2 of counter, and the letter closes. The
 * share therefore starts near the lightest a face draws and climbs to a proper bold by the size at
 * which a bold reads as one: a small region gets a wire letter, a large one gets a heavy one.
 *
 * A dense script runs the same curve lower: a 谷 spends its square on seven stroke rows where an E
 * spends it on three, so it needs its counters kept open far more than it needs weight.
 *
 * THE SIMPLE CURVE TOPS OUT AT WHAT THE FACE'S MEDIUM INSTANCE DRAWS (0.080 em of stem over a 0.700
 * em cap, so 0.115 of the glyph), and that is the whole of "bold in a large region" now. The idea
 * needed a face with somewhere to go, and the Latin face ships TWO instances: Medium and Bold. On
 * this grid the Bold one is a slab — measured over the matrix, it takes an M at eight cells from a
 * readable letter to a solid block, and at sixty-four cells it puts half the region under ink where
 * Medium puts a third. A visitor asked for a thinner letter and a clearer path, and the honest answer
 * is that the heavier instance never served either.
 */
const SHARE = {
  simple: { thin: 0.09, bold: 0.115 },
  dense: { thin: 0.06, bold: 0.13 },
  picture: { thin: 0, bold: 0 },
} as const;
// BOTH SIMPLE ENDS NOW RESOLVE TO THE SAME INSTANCE, and the pair is kept rather than collapsed to
// one number. 0.09 and 0.115 of the glyph are 0.063 and 0.081 of the em against a Medium stem of
// 0.080 and a Bold of 0.125, so every extent between them lands on Medium and the curve is inert for
// Latin: what decides a Latin weight now is the floor under it. It stays a curve because the face is
// what flattened it — one with three instances would use the range again, and a table of two numbers
// per script is where that would be said.

/** The least of a cell a stroke may be drawn at before the weight reaches for a heavier instance.
 *  Three quarters: the placement search lands that much on a whole cell, and less than it falls
 *  between two rows and disappears. */
const DRAWABLE_STEM = 0.75;

/** The extents between which the share climbs: below the first every letter is a wire, above the
 *  second the room no longer changes what is legible. */
const THIN_AT = 10;
const BOLD_AT = 48;

function strokeShare(text: string, box: GlyphBox): number {
  const script = scriptOf(text);
  if (script === 'picture') return 0;
  const { thin, bold } = SHARE[script];
  const t = Math.min(1, Math.max(0, (glyphExtent(text, box) - THIN_AT) / (BOLD_AT - THIN_AT)));
  return thin + (bold - thin) * t;
}

/**
 * The stroke width the region is meant to carry, in whole cells. 0 for a picture, which is not made
 * of strokes at all.
 *
 * IT IS WHAT THE WEIGHT IS CHOSEN AGAINST, not something imposed on the drawing afterwards. A
 * quantised letter has one honest way to be lighter — be drawn lighter — and the face ships two
 * instances of the Latin and four of the CJK, so the share behind this number picks between them and
 * the drawing is then kept as it came.
 *
 * NOTHING IN THE ENGINE CALLS THIS. The pass that held a stroke to it was removed on measurement, so
 * what remains is a reading of the design intent for the evaluation harness to report a built letter
 * against — kept because a weight table that has drifted from the faces it describes shows up here
 * first, and it is already telling: the table predicts a 5-cell stroke at 47 cells where the built
 * letters carry 7 to 8. `stencil-stroke.test.ts` holds it to the shape of the curve; if a round ever
 * finds nothing to say with it, the honest move is to delete it rather than to keep it current.
 */
export function strokeTarget(text: string, box: GlyphBox): number {
  const share = strokeShare(text, box);
  if (share === 0) return 0;
  return Math.max(1, Math.round(glyphExtent(text, box) * share));
}

/**
 * WHAT THE SHIPPED FACES ACTUALLY DRAW, measured rather than assumed.
 *
 * These are read off the shipped files themselves, by rendering each face at every CSS weight and
 * measuring the ink runs across a scanline clear of the crossbars, since
 * those runs ARE the stems. The answer is that a ladder of nine weights does not exist, and the table
 * below is the measurement. The Latin face ships two instances, so 100-500 draw one stem
 * and 600-900 the other; the CJK face ships four. Asking for a weight between them changes nothing,
 * and a table that believed otherwise chose a face that drew 60% heavier than the number it was
 * reading.
 *
 * CAP is measured too, and the two faces disagree by a tenth: the rasterizer fits the INK to the box,
 * so the em a stem is a share of is `extent / cap`, and using one face's cap for the other misreads
 * every stroke by that much.
 */
interface Face { cap: number; stems: readonly (readonly [number, number])[] }
const FACE: Record<'simple' | 'dense', Face> = {
  simple: { cap: 0.700, stems: [[500, 0.0800], [700, 0.1250]] },
  dense: { cap: 0.775, stems: [[400, 0.0750], [500, 0.0900], [700, 0.1100], [900, 0.1350]] },
};

/** Every weight the derivation may ask for — what the rasterizer preloads, since a face that has not
 *  arrived is drawn as the fallback and read back as a different letter. */
export const GLYPH_WEIGHTS: readonly number[] = [
  ...new Set([...FACE.simple.stems, ...FACE.dense.stems].map(([w]) => w)),
].sort((a, b) => a - b);

/**
 * The CSS weight to draw `text` at inside `box`: of the weights its face actually draws, the one
 * whose stems land nearest the width the region can carry.
 *
 * NEAREST, not "the lightest that is heavy enough". The two Latin instances are half again apart, so
 * reaching for the heavier one every time a target sits between them asks the face for nearly twice
 * the ink the region was judged to carry, and the letter arrives bold where the curve wanted it
 * middling. Nothing downstream takes a stroke back down, so this choice is the whole of the weight.
 *
 * WITH ONE FLOOR UNDER IT, and it is what makes the smallest regions work at all. A cell is on or
 * off, so a stroke the face draws far under a cell has no way to be drawn: it lands as two rows of
 * half coverage, both below the threshold, and the bar is simply not there. At five cells the
 * Medium instance draws 0.46 of a cell and an E arrives with no middle bar at all, so the heavier
 * instance wins there whatever the curve wanted.
 *
 * THREE QUARTERS OF A CELL, not a whole one, and the difference is a letter. The placement search
 * lands a stroke on the grid rather than between two rows (`stencil-raster.ts:gridFit`), so a stem of
 * 0.8 cells comes out as one solid cell — measured, an E at eight cells keeps every bar at Medium.
 * Asking for a whole cell there reaches for Bold instead, and Bold at eight cells is an M with its
 * two stems and its middle V fused into one block. Above the floor the nearest choice stands.
 *
 * A picture takes the middle of the range, since a colour emoji ignores weight entirely.
 */
export function glyphWeight(text: string, box: GlyphBox): number {
  const script = scriptOf(text);
  if (script === 'picture') return 400;
  const face = FACE[script];
  const want = strokeShare(text, box) * face.cap;
  // The stem the face draws, in CELLS: the rasterizer fits the ink to the box, so a cap of `extent`
  // cells draws its stems at the same share of that as the face draws them of its em.
  const cells = (stem: number): number => glyphExtent(text, box) * stem / face.cap;
  let best = face.stems[0]!, bestD = Infinity;
  for (const stem of face.stems) {
    const d = Math.abs(stem[1] - want);
    if (d < bestD) { bestD = d; best = stem; }
  }
  if (cells(best[1]) >= DRAWABLE_STEM) return best[0];
  const drawable = face.stems.find((stem) => cells(stem[1]) >= DRAWABLE_STEM);
  return (drawable ?? face.stems[face.stems.length - 1]!)[0];
}

/**
 * Take the lone bumps and bites out of the outline, in place. Returns how many cells moved.
 *
 * WHAT MAKES A LARGE LETTER LOOK CHEWED. A glyph's curve crosses a cell boundary at some fraction of
 * a cell, and the repair pass promotes a half-covered cell only where two of its neighbours happened
 * to land over the threshold — so a slowly turning edge comes out with single cells sticking out and
 * single cells bitten in, on what should be a monotone staircase. The corner trim then treats each of
 * those as a real corner of the drawing: a bevel on the bump, a Γ fillet in the bite. One cell of
 * noise arrives on the map as a decorated lump, and an O comes out looking gnawed.
 *
 * So a lone deviation goes back where it came from: a hole with three ink sides fills, a bump with
 * three empty sides is carved away. TWO GUARDS on the carve, and both are the difference between
 * tidying an outline and eating a letter — the one cell it hangs off must be part of a BODY (three
 * ink sides of its own), since on a wire stroke every cell has three empty sides and its tip has
 * three, and the bump's ink neighbours must form one run around it, the standard test for a cell no
 * shape depends on.
 *
 * ONE GUARD ON THE FILL, and it is the same thought from the other side: a cell with three ink sides
 * has one way out, so filling it CLOSES that way — and where the way out was a character's own gap
 * between two strokes, an ideograph gains a sealed pocket where a reader expects daylight. So the
 * fill is refused wherever the ground beyond that one open side cannot reach the outside by any other
 * route. A letter's counter is left as the face drew it; only a dead-end dent fills.
 *
 * Run to a fixpoint, which it reaches: a fill needs three ink sides and a carve three empty ones, so
 * neither can undo the other at the same cell.
 */
/** Whether the one ink cell (x, y) touches is part of a body rather than the next link of a wire:
 *  three ink sides of its own. A wire's cells have two and its tip has one, so a stroke one cell wide
 *  is never read as a row of bumps. */
function hangsOffABody(at: (x: number, y: number) => number, x: number, y: number): boolean {
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const nx = x + dx, ny = y + dy;
    if (!at(nx, ny)) continue;
    return at(nx, ny - 1) + at(nx + 1, ny) + at(nx, ny + 1) + at(nx - 1, ny) >= 3;
  }
  return false;
}

export function smoothOutline(s: Stencil): number {
  const { width: w, height: h, coverage } = s;
  const on = new Uint8Array(w * h);
  for (let i = 0; i < on.length; i++) on[i] = coverage[i]! >= COVERAGE_ON ? 1 : 0;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : on[y * w + x]!);
  let moved = 0;
  for (let pass = 0; pass < w + h; pass++) {
    let changed = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const sides = at(x, y - 1) + at(x + 1, y) + at(x, y + 1) + at(x - 1, y);
        if (!on[i]) {
          if (sides < 3 || bridgesDaylight(s, x, y) || sealsGround(s, x, y)) continue;
          on[i] = 1; coverage[i] = 255; changed++;
          continue;
        }
        if (sides !== 1) continue;
        if (!hangsOffABody(at, x, y)) continue;
        const ring = [
          at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
          at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1),
        ];
        let runs = 0;
        for (let k = 0; k < 8; k++) if (ring[k] === 0 && ring[(k + 1) % 8] === 1) runs++;
        if (runs !== 1) continue;
        on[i] = 0; coverage[i] = 0; changed++;
      }
    }
    moved += changed;
    if (changed === 0) break;
  }
  return moved;
}

/**
 * Make the shape hold together the way the MAP holds together: every cell that touches its stroke
 * only at a corner gets one cell of neighbour, so the letter is one piece under 4-connectivity.
 * Returns how many cells were added.
 *
 * A CORNER TOUCH IS NOT A JOIN HERE. The map is built of whole blocks, so two cells meeting at a
 * point are two separate blocks with ground between them, and a quantised diagonal — which is a chain
 * of exactly those — arrives on the map as a dotted line: strokes that disconnect at small sizes, and it
 * is invisible in any raster dump, where the chain looks like a diagonal.
 *
 * WHICH of the two cells is added is decided by the SOURCE, not by a rule of thumb: `ink` is the
 * coverage as the face drew it, before any of the processing, so the cell the stroke actually leaned
 * into is the one that joins.
 *
 * ONE ANSWER PER RUN, and this is what keeps a diagonal STRAIGHT. A 45° stroke is a chain of corner
 * touches, and deciding each of them on its own cell of evidence lets the choice flip partway down a
 * line the face drew perfectly straight: the staircase then steps out on one side, back on the other,
 * and reads as a wobble rather than as a slope. So the chain is followed to its ends and the evidence
 * summed over the whole of it, and every step of one run joins on the same side. A tie goes to the
 * horizontal neighbour, which keeps the pass a function of the picture rather than of iteration order.
 */
export function bridgeDiagonals(s: Stencil, ink: Uint8Array): number {
  const { width: w, height: h, coverage } = s;
  const on = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && coverage[y * w + x]! >= COVERAGE_ON;
  /** A corner touch: the cell (x, y) and the cell one row down, `dx` to the side, with neither of the
   *  two cells between them covered. */
  const touching = (x: number, y: number, dx: number): boolean =>
    on(x, y) && on(x + dx, y + 1) && !on(x + dx, y) && !on(x, y + 1);

  const done = new Set<string>();
  let added = 0;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      for (const dx of [1, -1]) {
        if (!touching(x, y, dx) || done.has(`${x},${y},${dx}`)) continue;
        // The whole run this touch belongs to: back to where the chain starts, then forward, weighing
        // the source's own ink on each side as it goes.
        let sx = x, sy = y;
        while (touching(sx - dx, sy - 1, dx)) { sx -= dx; sy -= 1; }
        const chain: [number, number][] = [];
        let side = 0, below = 0;
        for (let cx = sx, cy = sy; touching(cx, cy, dx); cx += dx, cy += 1) {
          chain.push([cx, cy]);
          side += ink[cy * w + cx + dx] ?? 0;
          below += ink[(cy + 1) * w + cx] ?? 0;
        }
        const takeSide = side >= below;
        for (const [cx, cy] of chain) {
          done.add(`${cx},${cy},${dx}`);
          const [bx, by] = takeSide ? [cx + dx, cy] : [cx, cy + 1];
          if (bx < 0 || bx >= w) continue;
          coverage[by * w + bx] = 255;
          added++;
        }
      }
    }
  }
  return added;
}

/**
 * Everything a freshly drawn glyph goes through before it is a stencil: the repair that joins a
 * quantised diagonal back up, the cleanup that takes the lone bumps off what it left, and the join
 * that makes the result one piece on a grid of whole blocks. The order is the dependency: a repair
 * can leave a bump, and a bump carved away can leave a corner touch.
 *
 * NOTHING HERE RESHAPES A STROKE, and that is measured. A peel holding every stroke to the width the
 * design asked for costs more than it buys at every size on the matrix: at a corner it takes the cell that
 * squared the corner, at a junction it moves a straight stem a cell sideways for the few rows the junction
 * is wide — a step in a line that should not have one — and where it has to take a two-cell stroke down to
 * one it walks the ends of the strokes back with it, which is a broken N rather than a light one. A quantised letter has ONE honest way to be lighter, and that is to be
 * drawn lighter (`glyphWeight`); what the face then draws is kept.
 *
 * IT TAKES NO TEXT AND NO BOX, which is the same finding stated in the signature: what a letter
 * should weigh is settled before it is drawn, and what arrives here is a picture to repair.
 *
 * ONE PATH, called by the rasterizer and by anything that reads a stored raster (the evaluation
 * harness and its tests work from committed font rasters, so the processing has to be reachable
 * without a canvas or the two would drift).
 */
export function finishGlyph(s: Stencil): void {
  const ink = Uint8Array.from(s.coverage);
  smoothShape(s);
  smoothOutline(s);
  bridgeDiagonals(s, ink);
}

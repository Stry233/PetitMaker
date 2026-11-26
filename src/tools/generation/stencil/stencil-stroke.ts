/** Font-weight selection and topology-preserving cleanup for text stencils. */
import { bridgesDaylight, COVERAGE_ON, TOUCHED_INK, scriptOf, type Stencil } from './stencil';
import { glyphExtent, strokeShare, type GlyphBox } from './stencil-stem';
import { NEIGHBORS4_NESW } from '../../../core/grid/directions';
import { enclosedPieces, labelComponents, outsideClear } from '../../../core/grid/cell-sets';
import { IndexHeap } from '../../../core/base/heap';

/** Minimum stem coverage in cell units before selecting a heavier face. */
const DRAWABLE_STEM = 0.75;

/** Cap height and stem width are fractions of an em, measured from the shipped faces. */
interface Face { cap: number; stems: readonly (readonly [number, number])[] }
const FACE: Record<'simple' | 'dense', Face> = {
  simple: { cap: 0.700, stems: [[500, 0.0800], [700, 0.1250]] },
  dense: { cap: 0.775, stems: [[400, 0.0750], [500, 0.0900], [700, 0.1100], [900, 0.1350]] },
};

export const GLYPH_WEIGHTS: readonly number[] = [
  ...new Set([...FACE.simple.stems, ...FACE.dense.stems].map(([w]) => w)),
].sort((a, b) => a - b);

export function glyphWeight(text: string, box: GlyphBox): number {
  const script = scriptOf(text);
  if (script === 'picture') return 400;
  const face = FACE[script];
  const want = strokeShare(text, box) * face.cap;
  // The stem the face draws, in cells: the rasterizer fits the ink to the box, so a cap of `extent`
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

/** A wire tip has no neighboring body and must survive outline cleanup. */
function hangsOffABody(at: (x: number, y: number) => number, x: number, y: number): boolean {
  for (const [dx, dy] of NEIGHBORS4_NESW) {
    const nx = x + dx, ny = y + dy;
    if (!at(nx, ny)) continue;
    return at(nx, ny - 1) + at(nx + 1, ny) + at(nx, ny + 1) + at(nx - 1, ny) >= 3;
  }
  return false;
}

const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]] as const;

/** A simple point preserves corner-connected ink and edge-connected background. */
function simpleNeighborhood(bits: number): boolean {
  const ring = RING.map((_, i) => Boolean(bits & (1 << i)));
  const count = (filled: boolean): number => {
    let visited = 0, groups = 0;
    for (let start = 0; start < 8; start++) {
      if (ring[start] !== filled || (visited & (1 << start))) continue;
      const todo = [start]; visited |= 1 << start;
      let adjacent = false;
      for (let head = 0; head < todo.length; head++) {
        const i = todo[head]!; adjacent ||= i % 2 === 0;
        for (let j = 0; j < 8; j++) {
          if (ring[j] !== filled || (visited & (1 << j))) continue;
          const dx = Math.abs(RING[i]![0] - RING[j]![0]), dy = Math.abs(RING[i]![1] - RING[j]![1]);
          if (filled ? Math.max(dx, dy) !== 1 : dx + dy !== 1) continue;
          visited |= 1 << j; todo.push(j);
        }
      }
      if (filled || adjacent) groups++;
    }
    return groups;
  };
  return count(true) === 1 && count(false) === 1;
}

const SIMPLE_NEIGHBORHOODS = Uint8Array.from({ length: 256 }, (_, bits) => simpleNeighborhood(bits) ? 1 : 0);

function simplePoint(s: Stencil, x: number, y: number): boolean {
  let bits = 0;
  for (let i = 0; i < RING.length; i++) {
    const nx = x + RING[i]![0], ny = y + RING[i]![1];
    if (nx >= 0 && ny >= 0 && nx < s.width && ny < s.height && s.coverage[ny * s.width + nx]! >= COVERAGE_ON) bits |= 1 << i;
  }
  return SIMPLE_NEIGHBORHOODS[bits] === 1;
}

/** Counter interiors retain their full area, including a one-cell counter. */
function outsideGround(s: Stencil): Uint8Array {
  const { width, height, coverage } = s;
  const outside = new Uint8Array(coverage.length), todo: number[] = [];
  const add = (x: number, y: number) => {
    const i = y * width + x;
    if (x < 0 || y < 0 || x >= width || y >= height || outside[i] || coverage[i]! >= COVERAGE_ON) return;
    outside[i] = 1; todo.push(i);
  };
  for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
  for (let y = 0; y < height; y++) { add(0, y); add(width - 1, y); }
  for (let head = 0; head < todo.length; head++) {
    const i = todo[head]!, x = i % width, y = Math.floor(i / width);
    add(x - 1, y); add(x + 1, y); add(x, y - 1); add(x, y + 1);
  }
  return outside;
}

/** Restore partly covered corners without merging marks or enclosing a gap. */
function smoothTextShape(s: Stencil): void {
  const { width: w, height: h, coverage } = s;
  const outside = outsideGround(s);
  let changed: boolean;
  do {
    changed = false;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, value = coverage[i]!;
      if (value >= COVERAGE_ON || value < TOUCHED_INK || !outside[i]) continue;
      let sides = 0;
      for (let d = 0; d < 8; d += 2) {
        const nx = x + RING[d]![0], ny = y + RING[d]![1];
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && coverage[ny * w + nx]! >= COVERAGE_ON) sides++;
      }
      if (sides < (value >= COVERAGE_ON / 2 ? 2 : 3) || bridgesDaylight(s, x, y) || !simplePoint(s, x, y)) continue;
      coverage[i] = 255; changed = true;
    }
  } while (changed);
}

/** Remove outline nubs and dents without altering topology or thinning a wire. */
function smoothOutline(s: Stencil): number {
  const { width: w, height: h, coverage } = s;
  const outside = outsideGround(s);
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
          if (sides < 3 || !outside[i] || bridgesDaylight(s, x, y) || !simplePoint(s, x, y)) continue;
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
        if (runs !== 1 || !simplePoint(s, x, y)) continue;
        on[i] = 0; coverage[i] = 0; changed++;
      }
    }
    moved += changed;
    if (changed === 0) break;
  }
  return moved;
}

/** Use one bridge side along each diagonal chain, keeping room for counters and nearby strokes. */
function bridgeDiagonals(s: Stencil, ink: Uint8Array): number {
  const { width: w, height: h, coverage } = s;
  const outside = outsideGround(s);
  const on = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && coverage[y * w + x]! >= COVERAGE_ON;

  const touching = (x: number, y: number, dx: number): boolean =>
    on(x, y) && on(x + dx, y + 1) && !on(x + dx, y) && !on(x, y + 1);
  const canBridge = (x: number, y: number) =>
    x >= 0 && x < w && Boolean(outside[y * w + x]) && simplePoint(s, x, y);

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
        const sideRoom = chain.filter(([cx, cy]) => canBridge(cx + dx, cy)).length;
        const belowRoom = chain.filter(([cx, cy]) => canBridge(cx, cy + 1)).length;
        const takeSide = sideRoom === belowRoom ? side >= below : sideRoom > belowRoom;
        for (const [cx, cy] of chain) {
          done.add(`${cx},${cy},${dx}`);
          const [bx, by] = takeSide ? [cx + dx, cy] : [cx, cy + 1];
          if (!canBridge(bx, by)) continue;
          coverage[by * w + bx] = 255;
          added++;
        }
      }
    }
  }
  return added;
}

/** Native text needs connected diagonals; grid-fitted text bypasses these passes. */
export function finishGlyph(s: Stencil): void {
  const ink = Uint8Array.from(s.coverage);
  smoothTextShape(s);
  smoothOutline(s);
  bridgeDiagonals(s, ink);
}

/** A drawing of the glyph laid over its cells: `cell` holds the cell each pixel falls in, or -1 off the grid. */
export interface GlyphSource { width: number; height: number; on: Uint8Array; cell: Int32Array }

/** The pieces and counters a glyph's cells are held to. */
interface GlyphStructure { pieces: number; counters: number }

const inkOf = (s: Stencil): Uint8Array => Uint8Array.from(s.coverage, v => v >= COVERAGE_ON ? 1 : 0);

/** Per cell, the labels the source pixels over it hold, each with its pixel count. */
function labelsPerCell(labels: Int32Array, source: GlyphSource, w: number, h: number): Map<number, number>[] {
  const out = Array.from({ length: w * h }, () => new Map<number, number>());
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!, at = source.cell[i]!;
    if (!label || at < 0) continue;
    const cell = out[at]!;
    cell.set(label, (cell.get(label) ?? 0) + 1);
  }
  return out;
}

/** Labels of `mask`'s pieces (ink, 8-connected) or of its ground (4-connected, every piece touching the border one label). */
function regionsOf(mask: Uint8Array, w: number, h: number, ink: boolean): Int32Array {
  if (ink) return labelComponents(mask, w, h, true).labels;
  const { labels } = labelComponents(Uint8Array.from(mask, v => v ? 0 : 1), w, h);
  const border = new Set<number>();
  for (let x = 0; x < w; x++) border.add(labels[x]!).add(labels[(h - 1) * w + x]!);
  for (let y = 0; y < h; y++) border.add(labels[y * w]!).add(labels[y * w + w - 1]!);
  border.delete(0);
  const outside = Math.min(...border);
  if (border.size > 1) for (let i = 0; i < labels.length; i++) if (border.has(labels[i]!)) labels[i] = outside;
  return labels;
}

/** The pieces and counters of a cell mask. */
function structureOf(mask: Uint8Array, w: number, h: number): GlyphStructure {
  return { pieces: labelComponents(mask, w, h, true).sizes.length - 1, counters: enclosedPieces(mask, w, h) };
}

/** The side a join works on: ink pieces or ground, the cells' mask and regions, and the source region it follows. */
interface JoinSide { ink: boolean; mask: Uint8Array; regions: Int32Array; sourceIn: Map<number, number>[]; label: number }

/**
 * The fewest cells, 4-connected, that join region `from` to any region in `to` through cells the
 * source region `label` passes through and the cells hold on the other side; ties go to the cells
 * whose coverage leans furthest toward the joining side.
 */
function shortestJoin(s: Stencil, join: JoinSide, from: number, to: ReadonlySet<number>): number[] | null {
  const { width: w, height: h, coverage } = s;
  const { ink, mask, regions, sourceIn, label } = join;
  const side = (i: number) => Boolean(mask[i]) === ink;
  // A cell costs more than any coverage discount can win back, so the count of cells decides.
  const cost = new Float64Array(w * h).fill(Infinity), prev = new Int32Array(w * h).fill(-1), done = new Uint8Array(w * h);
  const open = new IndexHeap();
  const passable = (i: number) => !side(i) && sourceIn[i]!.has(label);
  const relax = (i: number, base: number, from: number) => {
    const next = base + 1024 - (ink ? coverage[i]! : 255 - coverage[i]!);
    if (next < cost[i]!) { cost[i] = next; prev[i] = from; open.push(next, i); }
  };
  const around = (i: number, visit: (j: number) => void) => {
    const x = i % w, y = (i - x) / w;
    for (const [dx, dy] of NEIGHBORS4_NESW) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) visit(ny * w + nx);
    }
  };
  for (let i = 0; i < mask.length; i++) if (side(i) && regions[i] === from) around(i, j => { if (passable(j)) relax(j, 0, -1); });
  while (open.size) {
    const i = open.pop();
    if (done[i]) continue;
    done[i] = 1;
    let reached = false;
    around(i, j => { if (side(j) && to.has(regions[j]!)) reached = true; });
    if (reached) {
      const path: number[] = [];
      for (let at = i; at >= 0; at = prev[at]!) path.push(at);
      return path;
    }
    around(i, j => { if (!done[j] && passable(j)) relax(j, cost[i]!, i); });
  }
  return null;
}

/**
 * Join cell regions that one source region holds, one join at a time: ink pieces the grid parted at
 * a joint (`ink`), or ground the grid sealed off where the source's daylight runs through (`!ink`).
 * Each region belongs to the source region most of its cells' pixels come from, so a mark the font
 * draws apart, grazing a body's pixels, is never joined to it. A join that leaves the other count
 * further from the target is undone.
 */
function joinRegions(s: Stencil, source: GlyphSource, target: GlyphStructure, ink: boolean): number {
  const { width: w, height: h, coverage } = s;
  const sourceIn = labelsPerCell(regionsOf(source.on, source.width, source.height, ink), source, w, h);
  const goal = ink ? target.pieces : target.counters;
  const failed = new Set<number>();
  let changed = 0;
  for (;;) {
    const mask = inkOf(s), now = structureOf(mask, w, h);
    if ((ink ? now.pieces : now.counters) <= goal) return changed;
    const regions = regionsOf(mask, w, h, ink);
    const tallies = new Map<number, Map<number, number>>();
    for (let i = 0; i < mask.length; i++) {
      if (!regions[i] || Boolean(mask[i]) !== ink) continue;
      let tally = tallies.get(regions[i]!);
      if (!tally) tallies.set(regions[i]!, tally = new Map());
      for (const [label, n] of sourceIn[i]!) tally.set(label, (tally.get(label) ?? 0) + n);
    }
    const owned = new Map<number, number[]>(), size = new Map<number, number>();
    for (const [region, tally] of tallies) {
      let label = 0, most = 0, total = 0;
      for (const [l, n] of tally) { total += n; if (n > most) { label = l; most = n; } }
      if (!label || failed.has(label)) continue;
      size.set(region, total);
      const list = owned.get(label);
      if (list) list.push(region); else owned.set(label, [region]);
    }
    const split = [...owned].find(([, list]) => list.length > 1);
    if (!split) return changed;
    const [label, list] = split;
    const from = list.reduce((a, b) => size.get(a)! <= size.get(b)! ? a : b);
    const path = shortestJoin(s, { ink, mask, regions, sourceIn, label }, from, new Set(list.filter(r => r !== from)));
    if (!path) { failed.add(label); continue; }
    const saved = path.map(i => coverage[i]!);
    for (const i of path) coverage[i] = ink ? 255 : 0;
    const after = structureOf(inkOf(s), w, h);
    const other = (t: GlyphStructure) => ink ? t.counters : t.pieces;
    if (Math.abs(other(after) - other(target)) > Math.abs(other(now) - other(target))) {
      path.forEach((i, k) => { coverage[i] = saved[k]!; });
      failed.add(label);
      continue;
    }
    changed += path.length;
  }
}

/**
 * Part cell pieces that hold several source pieces: where an ink cell owned by one source piece
 * touches one owned by another, the cell with less of its own piece's ink is cleared, so the font's
 * gap comes back as a cell of daylight. Each cell piece is parted whole or left as it was.
 */
function partPieces(s: Stencil, source: GlyphSource, target: GlyphStructure): number {
  const { width: w, height: h, coverage } = s;
  const sourceIn = labelsPerCell(regionsOf(source.on, source.width, source.height, true), source, w, h);
  let changed = 0;
  const mask = inkOf(s);
  if (structureOf(mask, w, h).pieces >= target.pieces) return 0;
  const owner = new Int32Array(w * h), own = new Int32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    for (const [label, n] of sourceIn[i]!) if (n > own[i]!) { owner[i] = label; own[i] = n; }
  }
  const { labels: pieces, sizes } = labelComponents(mask, w, h, true);
  for (let piece = 1; piece < sizes.length; piece++) {
    const now = structureOf(inkOf(s), w, h);
    if (now.pieces >= target.pieces) break;
    const clear: number[] = [];
    for (let i = 0; i < mask.length; i++) {
      if (pieces[i] !== piece || coverage[i]! < COVERAGE_ON) continue;
      const x = i % w, y = (i - x) / w;
      const touching = new Set<number>();
      for (const [dx, dy] of RING) {
        const nx = x + dx, ny = y + dy, j = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || coverage[j]! < COVERAGE_ON || !owner[j] || owner[j] === owner[i]) continue;
        if (!owner[i]) { touching.add(owner[j]!); continue; }
        const weaker = own[i]! < own[j]! || (own[i] === own[j] && i > j) ? i : j;
        coverage[weaker] = 0; clear.push(weaker);
        if (weaker === i) break;
      }
      // An ink cell holding no source ink goes when it touches two source pieces.
      if (touching.size > 1) { coverage[i] = 0; clear.push(i); }
    }
    if (!clear.length) continue;
    const after = structureOf(inkOf(s), w, h);
    if (after.pieces > target.pieces || after.pieces <= now.pieces || Math.abs(after.counters - target.counters) > Math.abs(now.counters - target.counters)) {
      for (const i of clear) coverage[i] = 255;
      continue;
    }
    changed += clear.length;
  }
  return changed;
}

/** Clear one cell of each counter the cells filled, largest source counter first, while counters fall short. */
function reopenCounters(s: Stencil, source: GlyphSource, target: GlyphStructure): number {
  const { width: w, height: h, coverage } = s;
  const outside = outsideClear(source.on, source.width, source.height);
  const enclosed = Uint8Array.from(source.on, (v, i) => !v && !outside[i] ? 1 : 0);
  const { labels, sizes } = labelComponents(enclosed, source.width, source.height);
  const holesIn = labelsPerCell(labels, source, w, h);
  const order = sizes.map((_, k) => k).slice(1).sort((a, b) => sizes[b]! - sizes[a]!);
  let cleared = 0;
  for (;;) {
    const ink = inkOf(s);
    if (enclosedPieces(ink, w, h) >= target.counters) return cleared;
    const ground = outsideClear(ink, w, h);
    const shown = new Set<number>();
    for (let i = 0; i < ink.length; i++) if (!ink[i] && !ground[i]) for (const k of holesIn[i]!.keys()) shown.add(k);
    let pick = -1;
    for (const k of order) {
      if (shown.has(k)) continue;
      // A cell inked on all four sides opens as a counter of its own without parting any stroke.
      let most = 0;
      for (let i = 0; i < ink.length; i++) {
        const n = holesIn[i]!.get(k) ?? 0;
        if (n <= most || !ink[i]) continue;
        const x = i % w, y = (i - x) / w;
        if (NEIGHBORS4_NESW.every(([dx, dy]) => x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h && ink[(y + dy) * w + x + dx])) { most = n; pick = i; }
      }
      if (pick >= 0) break;
    }
    if (pick < 0) return cleared;
    coverage[pick] = 0;
    cleared++;
  }
}

/**
 * Hold a native glyph's cells to the font's structure where the cell grid broke it: a joint the
 * source draws thinner than a cell is bridged with the fewest cells along the source's ink, pieces
 * the grid fused across a gap thinner than a cell are parted, ground sealed off across such a gap is
 * reopened along the source's daylight, and a counter the cells filled is reopened where the
 * source's counter is widest, never parting a stroke. Returns the cells changed; the caller checks
 * whether the target was reached.
 */
export function restoreStructure(s: Stencil, source: GlyphSource, target: GlyphStructure): number {
  return joinRegions(s, source, target, true) + partPieces(s, source, target)
    + joinRegions(s, source, target, false) + reopenCounters(s, source, target);
}

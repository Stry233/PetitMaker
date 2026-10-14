/** Font-weight selection and topology-preserving cleanup for text stencils. */
import { bridgesDaylight, COVERAGE_ON, TOUCHED_INK, scriptOf, type Stencil } from './stencil';
import { glyphExtent, strokeShare, type GlyphBox } from './stencil-stem';
import { NEIGHBORS4_NESW } from '../../../core/grid/directions';

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

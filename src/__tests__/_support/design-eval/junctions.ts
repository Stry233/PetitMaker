/**
 * The shape of the network: how its streets meet, how far they run, and which 1-wide pavement is a
 * garden path rather than a road. Straightness (`streets.ts`) cannot tell a grid of long streets
 * from a lattice of planet-spanning lines crossing at four-ways, so this measures how much pavement
 * stands in a planet-spanning line and how its junctions are shaped.
 *
 * A junction is counted by its arms: around a paved cell, the paved cells at Chebyshev distance
 * `RING_R` fall into cyclic runs, one per street leaving (two opposite pass through, two
 * perpendicular bend, three a T or Y, four a crossroads). A ratio of straight runs would miss a
 * short branch meeting a long trunk.
 *
 * Pure: masks in, numbers out, for both the rasterized plan and a finished map.
 */
import { openingWidths } from './grid';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { labelComponents } from '../../../core/grid/cell-sets';
import { anchorReach } from './reach';

/** How far from a cell the arms are counted. It must exceed the widest street's half-width, or the
 *  street's own width wraps the ring and a straight run reads as one arm; the map's widest pavement
 *  is the movement line's 4-cell leg. */
const RING_R = 4;

/** Pavement this wide is a square — an apron, a court, a paved figure — and not a street whose
 *  junctions can be read. Both references pave such ground, and every cell inside one presents arms
 *  in every direction. The terminus reading draws the same line at the same width. */
const COURT_WIDE = 6;

/** Two arms count as one street passing through when their directions are this opposed. */
const THROUGH_DOT = -0.5;

/** The share of the planet's own extent a straight run has to cover to be a lattice line: a street
 *  that crosses the whole map rather than serving a part of it. */
export const LATTICE_SPAN = 0.8;

/**
 * How much of a map's pavement may stand in such a line.
 *
 * Neither decoded reference carries a single straight run over `LATTICE_SPAN` of its own planet, so
 * both read zero. The cap is a hair over that rather than at it, because one street reaching the bar on a small planet is a
 * street and not a lattice, and a share this small cannot be more than one.
 */
export const LATTICE_SHARE_MAX = 0.02;

/** How far apart two T-junctions may stand along one street and still read as one staggered
 *  crossing (a Z), and how far their centres may sit across it. */
const OFFSET_APART = 16;
const OFFSET_ACROSS = 3;

/** The longest 1-wide path that can be a garden walk inside a region. Beyond it the pavement is
 *  going somewhere, and where it goes is between regions. */
const GARDEN_PATH_MAX = 24;

export interface NetworkShape {
  paved: number;
  /** Junctions proper: three arms or more. */
  junctions: number;
  tee: number;
  fourWay: number;
  /** Two arms meeting at a right angle: a street that bends rather than one that meets another. */
  bends: number;
  /** Paved squares and courts, which carry no junction reading. */
  squares: number;
  fourWayShare: number;
  /** Pairs of T-junctions on one street, facing opposite ways within `OFFSET_APART` of each other:
   *  two streets that would have crossed, staggered into a Z. */
  offsetPairs: number;
  /** Share of pavement standing in a straight run that spans `LATTICE_SPAN` of the planet. */
  fullSpanShare: number;
  /** The longest straight run on the map, as a share of the planet's extent along its axis. */
  longestSpan: number;
}

/** One junction, as the arm reading found it. */
interface Node {
  x: number; y: number;
  arms: { dx: number; dy: number }[];
}

/** Cyclic ring offsets at Chebyshev distance `RING_R`, walked once around. */
const RING: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let x = -RING_R; x < RING_R; x++) out.push([x, -RING_R]);
  for (let y = -RING_R; y < RING_R; y++) out.push([RING_R, y]);
  for (let x = RING_R; x > -RING_R; x--) out.push([x, RING_R]);
  for (let y = RING_R; y > -RING_R; y--) out.push([-RING_R, y]);
  return out;
})();

const unit = (x: number, y: number): { dx: number; dy: number } => {
  const m = Math.hypot(x, y) || 1;
  return { dx: x / m, dy: y / m };
};

/** The arms leaving a cell: one per cyclic run of paved ring cells, each as the unit direction its
 *  run sits in. An empty answer means the ring is all paved (the cell is inside a square) or all
 *  bare (the pavement does not reach this far). */
function armsAt(paved: Uint8Array, W: number, H: number, cx: number, cy: number): { dx: number; dy: number }[] {
  const n = RING.length;
  const hit = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const x = cx + RING[k]![0], y = cy + RING[k]![1];
    hit[k] = x >= 0 && y >= 0 && x < W && y < H && paved[y * W + x] ? 1 : 0;
  }
  // The sweep starts at the first cell of a run, so the run that would have wrapped the end of the
  // array is walked whole and no run is counted twice.
  let start = -1;
  for (let k = 0; k < n; k++) if (hit[k] && !hit[(k + n - 1) % n]) { start = k; break; }
  if (start < 0) return [];
  const out: { dx: number; dy: number }[] = [];
  let sx = 0, sy = 0, cells = 0;
  for (let s = 0; s < n; s++) {
    const k = (start + s) % n;
    if (hit[k]) { sx += RING[k]![0]; sy += RING[k]![1]; cells++; continue; }
    if (cells > 0) { out.push(unit(sx, sy)); sx = 0; sy = 0; cells = 0; }
  }
  return out;
}

/** The straight paved run through every cell, along each axis. */
function straightRuns(paved: Uint8Array, W: number, H: number): { hr: Int32Array; vr: Int32Array } {
  const hr = new Int32Array(W * H), vr = new Int32Array(W * H);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!paved[y * W + x]) { x++; continue; }
      let end = x;
      while (end < W && paved[y * W + end]) end++;
      for (let k = x; k < end; k++) hr[y * W + k] = end - x;
      x = end;
    }
  }
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!paved[y * W + x]) { y++; continue; }
      let end = y;
      while (end < H && paved[end * W + x]) end++;
      for (let k = y; k < end; k++) vr[k * W + x] = end - y;
      y = end;
    }
  }
  return { hr, vr };
}

/** The planet's own extent: the bounding box of its land, which is what a street spans a share of. */
function extentOf(land: Uint8Array, W: number, H: number): { w: number; h: number } {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!land[y * W + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? { w: W, h: H } : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** 4-connected clusters of the cells `mask` marks, as lists of flat indices in raster order. */
function clustersOf(mask: Uint8Array, W: number, H: number): number[][] {
  const { labels, sizes } = labelComponents(mask, W, H);
  const out = sizes.slice(1).map((): number[] => []);
  for (let i = 0; i < W * H; i++) if (labels[i]) out[labels[i]! - 1]!.push(i);
  return out;
}

/** The junction and bend cells of a pavement mask, with the arms each junction cell saw. */
interface ArmReading {
  paved: number;
  /** Cells whose ring shows three arms or more. */
  node: Uint8Array;
  /** Cells whose two arms meet at a right angle. */
  bend: Uint8Array;
  /** Cells inside a paved square, which carry no junction reading. */
  court: Uint8Array;
  armsOf: Map<number, { dx: number; dy: number }[]>;
}

function armReading(paved: Uint8Array, W: number, H: number, open = openingWidths(paved, W, H)): ArmReading {
  const court = new Uint8Array(W * H);
  let pavedCells = 0;
  for (let i = 0; i < W * H; i++) {
    if (!paved[i]) continue;
    pavedCells++;
    if (open[i]! >= COURT_WIDE) court[i] = 1;
  }
  // Every paved cell outside a square is asked for its arms; the answer is clustered by the callers,
  // so one meeting of streets counts once however many of its cells can see all of it.
  const node = new Uint8Array(W * H);
  const bend = new Uint8Array(W * H);
  const armsOf = new Map<number, { dx: number; dy: number }[]>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!paved[i] || court[i]) continue;
      const arms = armsAt(paved, W, H, x, y);
      if (arms.length >= 3) { node[i] = 1; armsOf.set(i, arms); }
      else if (arms.length === 2 && arms[0]!.dx * arms[1]!.dx + arms[0]!.dy * arms[1]!.dy > THROUGH_DOT) {
        bend[i] = 1;
      }
    }
  }
  return { paved: pavedCells, node, bend, court, armsOf };
}

/** The network's junction mix and how much of it spans the planet. */
export function networkShape(paved: Uint8Array, land: Uint8Array, W: number, H: number, open?: Uint8Array): NetworkShape {
  const { paved: pavedCells, node, bend, court, armsOf } = armReading(paved, W, H, open);

  const nodes: Node[] = [];
  let tee = 0, fourWay = 0;
  for (const cells of clustersOf(node, W, H)) {
    let best: { dx: number; dy: number }[] = [];
    let sx = 0, sy = 0;
    for (const i of cells) {
      sx += i % W; sy += (i / W) | 0;
      const arms = armsOf.get(i)!;
      if (arms.length > best.length) best = arms;
    }
    nodes.push({ x: sx / cells.length, y: sy / cells.length, arms: best });
    if (best.length >= 4) fourWay++; else tee++;
  }
  const bends = clustersOf(bend, W, H).length;
  const squares = clustersOf(court, W, H).length;

  const { hr, vr } = straightRuns(paved, W, H);
  const extent = extentOf(land, W, H);
  let spanning = 0, longest = 0;
  for (let i = 0; i < W * H; i++) {
    if (!paved[i]) continue;
    const share = Math.max(hr[i]! / extent.w, vr[i]! / extent.h);
    if (share > longest) longest = share;
    if (share >= LATTICE_SPAN) spanning++;
  }

  const junctions = tee + fourWay;
  return {
    paved: pavedCells,
    junctions, tee, fourWay, bends, squares,
    fourWayShare: junctions ? fourWay / junctions : 0,
    offsetPairs: offsetPairs(nodes),
    fullSpanShare: pavedCells ? spanning / pavedCells : 0,
    longestSpan: longest,
  };
}

/** A T-junction as the offset reading needs it: which street runs through, where the node stands on
 *  it, and which way the third arm leaves. */
interface Tee { axis: 'x' | 'y'; along: number; across: number; side: 1 | -1 }

/** The T-junctions of a node list, with the street that passes through each one named. */
function teesOf(nodes: readonly Node[]): Tee[] {
  const out: Tee[] = [];
  for (const node of nodes) {
    if (node.arms.length !== 3) continue;
    // The one pair of opposed arms is the street passing through; the third arm is the branch. A T
    // has exactly one such pair, and the first found is it.
    let found = false;
    for (let a = 0; a < 3 && !found; a++) {
      for (let b = a + 1; b < 3 && !found; b++) {
        const p = node.arms[a]!, q = node.arms[b]!;
        if (p.dx * q.dx + p.dy * q.dy > THROUGH_DOT) continue;
        const branch = node.arms[3 - a - b]!;
        const axis: 'x' | 'y' = Math.abs(p.dx) > Math.abs(p.dy) ? 'x' : 'y';
        // Which side the branch leaves on, and not its direction: an arm's direction is the mean of
        // the ring cells it lit, so a 2-wide street's arm sits a little off the axis and two branches
        // that plainly face away from each other read only two thirds opposed.
        const off = axis === 'x' ? branch.dy : branch.dx;
        out.push({
          axis,
          along: axis === 'x' ? node.x : node.y,
          across: axis === 'x' ? node.y : node.x,
          side: off >= 0 ? 1 : -1,
        });
        found = true;
      }
    }
  }
  return out;
}

/**
 * Staggered crossings: two T-junctions on one street whose branches leave on opposite sides within
 * `OFFSET_APART` of each other, a Z-shaped walk (two roads that would cross are offset into two T-junctions).
 *
 * Greedy and one pairing per junction, so three T's in a row read as one pair and not as three.
 */
function offsetPairs(nodes: readonly Node[]): number {
  const tees = teesOf(nodes);
  const used = new Uint8Array(tees.length);
  let pairs = 0;
  for (let a = 0; a < tees.length; a++) {
    if (used[a]) continue;
    for (let b = a + 1; b < tees.length; b++) {
      if (used[b]) continue;
      const p = tees[a]!, q = tees[b]!;
      if (p.axis !== q.axis) continue;
      if (Math.abs(p.across - q.across) > OFFSET_ACROSS) continue;
      const apart = Math.abs(p.along - q.along);
      if (apart < 1 || apart > OFFSET_APART) continue;
      if (p.side === q.side) continue;
      used[a] = 1; used[b] = 1; pairs++;
      break;
    }
  }
  return pairs;
}

export interface OneWideReading {
  /** Every paved cell whose opening measure reads 1. */
  oneWideCells: number;
  /** Of those, the ones that are a garden path: a leaf hanging off one plaza-reachable street. */
  gardenCells: number;
  /** The rest, which are road one cell wide. */
  networkCells: number;
  /** Garden paths, as paths rather than cells. */
  gardens: number;
  /** `networkCells` over the map's pavement: what the hard rule is judged on. */
  oneWideShare: number;
}

/**
 * The 1-WIDE rule, scoped to the network (the third road grade).
 *
 * The hard rule is that no road is one cell wide, and a path (a garden walk inside a region, to a
 * fountain court or along a bed) is a third grade that carries nothing between regions. The two are told apart by what the pavement does, not by what laid it: a
 * 1-wide cluster is a garden path when it is a leaf, hanging off exactly one piece of >=2-wide
 * pavement that the plaza can already walk to, and short enough to be a walk inside a place.
 * Anything else — a neck two streets meet through, a thin thread the plaza's only route runs along,
 * a path reaching no street at all — is charged as road.
 */
export function networkOneWide(
  masks: { paved: Uint8Array; anchor: Uint8Array; crossing: Uint8Array; W: number; H: number },
  open = openingWidths(masks.paved, masks.W, masks.H),
): OneWideReading {
  const { paved, anchor, crossing, W, H } = masks;
  const thin = new Uint8Array(W * H);
  const skeleton = new Uint8Array(W * H);
  let pavedCells = 0, oneWideCells = 0;
  for (let i = 0; i < W * H; i++) {
    if (!paved[i]) continue;
    pavedCells++;
    if (open[i]! <= 1) { thin[i] = 1; oneWideCells++; } else skeleton[i] = 1;
  }

  // The skeleton's own components, and which of them the plaza reaches over the skeleton alone: a
  // 1-wide path may only be excused where the street it hangs off does not depend on it.
  const comp = new Int32Array(W * H).fill(-1);
  const parts = clustersOf(skeleton, W, H);
  parts.forEach((cells, id) => { for (const i of cells) comp[i] = id; });
  const reached = anchorReach(skeleton, anchor, crossing, { W, H });
  const live = new Set<number>();
  for (let i = 0; i < W * H; i++) if (skeleton[i] && reached[i]) live.add(comp[i]!);

  let gardenCells = 0, gardens = 0;
  for (const cells of clustersOf(thin, W, H)) {
    const touches = new Set<number>();
    for (const i of cells) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (skeleton[j]) touches.add(comp[j]!);
      }
    }
    const [only] = [...touches];
    if (cells.length > GARDEN_PATH_MAX || touches.size !== 1 || !live.has(only!)) continue;
    gardens++;
    gardenCells += cells.length;
  }
  const networkCells = oneWideCells - gardenCells;
  return {
    oneWideCells, gardenCells, networkCells, gardens,
    oneWideShare: pavedCells ? networkCells / pavedCells : 0,
  };
}

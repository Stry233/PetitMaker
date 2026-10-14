/*
 * Up to four proposals of work the live map invites, read off the generator's own masks
 * (`readMap`, `segmentRegions`, `waterBodies`) and the object index, so a proposal never disagrees
 * with the generator about what land, pavement or a body of water is. Pure: a `GridState` in, a list
 * out, in macro cells; the card that draws them chooses their words.
 */
import type { GridState } from '../../core/model/types';
import { SKETCH_PROFILE as P } from './sketch-tuning';
import { roleOf } from '../../state/catalog';
import { bridgeSpanRange } from '../../tools/placement';
import { getObjectIndex } from '../../state/object-index';
import { NEIGHBORS4 } from '../../core/grid/directions';
import { cellCentre } from '../../core/grid/grid-convert';
import { readMap, segmentRegions, waterBodies, type MapMasks, type Region } from '../../tools/reading';
import { cellKey } from '../../core/grid/rect';

export type SketchKind = 'lane' | 'pond' | 'bridge' | 'grove';

/** The quarter of the map a proposal sits in. */
export type SketchDir = 'north' | 'south' | 'east' | 'west' | 'middle';

/** A point in macro cell coordinates. */
interface SketchPoint { x: number; y: number }

/** One pip of a grove sketch: a tree that stands there, or one the stand could take. */
interface SketchPip extends SketchPoint { r: number; standing: boolean }

/** The figure a proposal draws, in macro cells; each family holds what its own drawing needs. */
export type SketchArt =
  /** A bowed line from a paved place to ground with no road, with the pavement width it proposes. */
  | { shape: 'lane'; from: SketchPoint; via: SketchPoint; to: SketchPoint; width: number }
  | { shape: 'pond'; cx: number; cy: number; rx: number; ry: number }
  /** A deck across a gap, plus the approach on each bank. */
  | { shape: 'bridge'; x: number; y: number; w: number; h: number; approach: readonly [SketchPoint, SketchPoint][] }
  | { shape: 'grove'; pips: readonly SketchPip[] };

export interface SketchProposal {
  kind: SketchKind;
  dir: SketchDir;
  /** The measurement both of the card's lines quote: a distance, a width, a span or a count. */
  params: { n: number };
  art: SketchArt;
}

/** Which quarter of the map a point sits in. */
function direction(g: MapMasks, p: SketchPoint): SketchDir {
  const dx = (p.x - g.W / 2) / (g.W / 2);
  const dy = (p.y - g.H / 2) / (g.H / 2);
  if (Math.abs(dx) < P.middleShare && Math.abs(dy) < P.middleShare) return 'middle';
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? 'north' : 'south';
  return dx < 0 ? 'west' : 'east';
}

const cellX = (g: MapMasks, i: number): number => i % g.W;
const cellY = (g: MapMasks, i: number): number => (i / g.W) | 0;

function centroid(g: MapMasks, cells: readonly number[]): SketchPoint {
  let sx = 0; let sy = 0;
  for (const i of cells) { sx += cellX(g, i); sy += cellY(g, i); }
  return { x: sx / cells.length, y: sy / cells.length };
}

/** The cell of `cells` nearest `to` — a figure has to land on ground the region actually holds, and
 *  a centroid of a crescent sits outside it. */
function nearestCell(g: MapMasks, cells: readonly number[], to: SketchPoint): SketchPoint {
  let best = cells[0]!;
  let bestD = Infinity;
  for (const i of cells) {
    const d = (cellX(g, i) - to.x) ** 2 + (cellY(g, i) - to.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { x: cellX(g, best), y: cellY(g, best) };
}

/** The cell of `cells` farthest from `from`. */
function farthestCell(g: MapMasks, cells: readonly number[], from: SketchPoint): SketchPoint {
  let best = cells[0]!;
  let bestD = -1;
  for (const i of cells) {
    const d = (cellX(g, i) - from.x) ** 2 + (cellY(g, i) - from.y) ** 2;
    if (d > bestD) { bestD = d; best = i; }
  }
  return { x: cellX(g, best), y: cellY(g, best) };
}

/** The cell of a region deepest inside it: the one whose ring of region cells is widest, by a
 *  4-connected wave from the region's own edge. A pond wants the middle of the open ground, and a
 *  centroid sits outside a crescent. */
function deepestCell(g: MapMasks, cells: readonly number[]): SketchPoint {
  const inRegion = new Set(cells);
  const depth = new Map<number, number>();
  let front: number[] = [];
  for (const i of cells) {
    const x = cellX(g, i); const y = cellY(g, i);
    const edge = x === 0 || y === 0 || x === g.W - 1 || y === g.H - 1
      || !inRegion.has(i - 1) || !inRegion.has(i + 1) || !inRegion.has(i - g.W) || !inRegion.has(i + g.W);
    if (edge) { depth.set(i, 0); front.push(i); }
  }
  let deepest = cells[0]!;
  while (front.length > 0) {
    const next: number[] = [];
    for (const i of front) {
      const d = depth.get(i)!;
      deepest = i;
      for (const j of [i - 1, i + 1, i - g.W, i + g.W]) {
        if (!inRegion.has(j) || depth.has(j)) continue;
        depth.set(j, d + 1);
        next.push(j);
      }
    }
    front = next;
  }
  return { x: cellX(g, deepest), y: cellY(g, deepest) };
}

function boxOf(g: MapMasks, cells: readonly number[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const i of cells) {
    const x = cellX(g, i); const y = cellY(g, i);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/** Whether any cell of the region touches pavement or a crossing: the region can be walked to on a
 *  made surface, so it is not the one with no road down to it. */
function roadReaches(g: MapMasks, region: Region): boolean {
  for (const i of region.cells) {
    const x = cellX(g, i); const y = cellY(g, i);
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.W || ny >= g.H) continue;
      const j = ny * g.W + nx;
      if (g.paved[j] || g.crossing[j]) return true;
    }
  }
  return false;
}

/** Where a lane would come from: the anchor landmark if the map has one, else the pavement already down. A map
 *  with neither has nowhere to pave from, and the family declines. */
function laneOrigin(g: MapMasks): SketchPoint | null {
  const anchor: number[] = [];
  const paved: number[] = [];
  for (let i = 0; i < g.W * g.H; i++) {
    if (g.anchor[i]) anchor.push(i);
    else if (g.paved[i]) paved.push(i);
  }
  const from = anchor.length > 0 ? anchor : paved;
  if (from.length === 0) return null;
  return nearestCell(g, from, centroid(g, from));
}

/* ── the four analysers ─────────────────────────────────────────────────────── */

/** A sizeable place with no road to it, and the plaza to pave from. */
function proposeLane(g: MapMasks, regions: readonly Region[], taken: Set<number>): SketchProposal | null {
  const from = laneOrigin(g);
  if (!from) return null;
  const at = regions.findIndex((region, k) => (
    !taken.has(k) && region.cells.length >= P.laneRegionMin && !roadReaches(g, region)
  ));
  if (at < 0) return null;
  const region = regions[at]!;
  taken.add(at);
  // The far end of the place, not its middle: a lane down to a bay reaches into it, and the far end
  // is also what keeps the lane's landing clear of the pond's own deep-interior point.
  const to = farthestCell(g, region.cells, from);
  // The bow is perpendicular to the run, so the lane leans the same way whichever quarter it
  // crosses; its size is the run's own length, which keeps a short spur from looping.
  const mx = (from.x + to.x) / 2; const my = (from.y + to.y) / 2;
  const dx = to.x - from.x; const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const via = { x: mx - (dy / len) * len * P.laneBow, y: my + (dx / len) * len * P.laneBow };
  return {
    kind: 'lane',
    dir: direction(g, to),
    // The reading the caption quotes is how far the ground is from the pavement, which is what the
    // proposal is about. The region's own cell count is a five-figure number on an unpaved map:
    // true, and no help to anybody reading a two-line caption.
    params: { n: Math.round(Math.hypot(to.x - from.x, to.y - from.y)) },
    art: { shape: 'lane', from, via, to, width: P.laneWidth },
  };
}

/** A flat expanse with next to nothing on it. */
function proposePond(g: MapMasks, regions: readonly Region[], taken: Set<number>): SketchProposal | null {
  const fits = (region: Region): boolean => {
    if (region.cells.length < P.pondRegionMin) return false;
    const covered = region.cells.reduce((n, i) => n + (g.covered[i] ? 1 : 0), 0);
    return covered / region.cells.length <= P.pondCoverMax;
  };
  // A place of its own where the map has one. Where it does not, the pond and the lane share the
  // map's one open expanse and stay different proposals about it: the lane runs to its far end
  // and the pond sits at its deepest point, so the two figures are never drawn over each other.
  const at = regions.findIndex((region, k) => !taken.has(k) && fits(region));
  const on = at >= 0 ? at : regions.findIndex(fits);
  if (on < 0) return null;
  const region = regions[on]!;
  taken.add(on);
  const middle = deepestCell(g, region.cells);
  const box = boxOf(g, region.cells);
  const clamp = (span: number): number => Math.min(
    P.pondRadiusMax, Math.max(P.pondRadiusMin, Math.round(span * P.pondShare)),
  );
  const { rx, ry } = fitEllipse(g, region, middle, clamp(box.x1 - box.x0 + 1), clamp(box.y1 - box.y0 + 1));
  return {
    kind: 'pond',
    dir: direction(g, middle),
    // How wide the pond it offers is, measured off the room the meadow actually has.
    params: { n: rx * 2 },
    art: { shape: 'pond', cx: cellCentre(middle).x, cy: cellCentre(middle).y, rx, ry },
  };
}

/** The largest ellipse at `centre` that stands on the region's own ground, shrinking from the asked
 *  size a step at a time. A pond drawn over the coast is a proposal the map cannot take. */
function fitEllipse(
  g: MapMasks, region: Region, centre: SketchPoint, wantX: number, wantY: number,
): { rx: number; ry: number } {
  const inRegion = new Set(region.cells);
  let rx = wantX; let ry = wantY;
  while (rx > P.pondRadiusMin || ry > P.pondRadiusMin) {
    let on = 0; let all = 0;
    for (let y = Math.ceil(centre.y - ry); y <= Math.floor(centre.y + ry); y++) {
      for (let x = Math.ceil(centre.x - rx); x <= Math.floor(centre.x + rx); x++) {
        if (((x - centre.x) / rx) ** 2 + ((y - centre.y) / ry) ** 2 > 1) continue;
        all++;
        if (x >= 0 && y >= 0 && x < g.W && y < g.H && inRegion.has(y * g.W + x)) on++;
      }
    }
    if (all === 0 || on / all >= P.pondFitShare) break;
    rx = Math.max(P.pondRadiusMin, rx - 1);
    ry = Math.max(P.pondRadiusMin, ry - 1);
  }
  return { rx, ry };
}

/** A water run with a level bank on each side, at a span a bridge may cross. */
function proposeBridge(g: MapMasks, state: GridState): SketchProposal | null {
  const span = bridgeSpanRange();
  if (!span) return null;
  for (const body of waterBodies(g, state)) {
    const inBody = new Set(body.cells);
    for (const horizontal of [true, false] as const) {
      const outer = horizontal ? body.y1 - body.y0 : body.x1 - body.x0;
      for (let a = 0; a <= outer; a++) {
        const line = (horizontal ? body.y0 : body.x0) + a;
        const from = horizontal ? body.x0 : body.y0;
        const to = horizontal ? body.x1 : body.y1;
        let run = 0;
        for (let b = from; b <= to + 1; b++) {
          const x = horizontal ? b : line;
          const y = horizontal ? line : b;
          const inside = b <= to && inBody.has(y * g.W + x);
          if (inside) { run++; continue; }
          if (run >= span.min && run <= span.max) {
            const near = horizontal ? { x: b - run - 1, y: line } : { x: line, y: b - run - 1 };
            const far = horizontal ? { x: b, y: line } : { x: line, y: b };
            if (levelBank(g, near) && levelBank(g, far) && bankTier(g, near) === bankTier(g, far)) {
              const deck = horizontal
                ? { x: b - run, y: line, w: run, h: 1 }
                : { x: line, y: b - run, w: 1, h: run };
              const approach: [SketchPoint, SketchPoint][] = horizontal
                ? [[{ x: near.x - P.bridgeApproach + 1, y: line }, near], [far, { x: far.x + P.bridgeApproach - 1, y: line }]]
                : [[{ x: line, y: near.y - P.bridgeApproach + 1 }, near], [far, { x: line, y: far.y + P.bridgeApproach - 1 }]];
              return {
                kind: 'bridge',
                dir: direction(g, { x: deck.x + deck.w / 2, y: deck.y + deck.h / 2 }),
                params: { n: run },
                art: { shape: 'bridge', ...deck, approach },
              };
            }
          }
          run = 0;
        }
      }
    }
  }
  return null;
}

/** A bank a deck may land on: dry land, standing clear, with nothing built on it. */
function levelBank(g: MapMasks, p: SketchPoint): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= g.W || p.y >= g.H) return false;
  const i = p.y * g.W + p.x;
  return g.land[i] === 1 && !g.water[i] && !g.mountain[i] && !g.covered[i];
}

const bankTier = (g: MapMasks, p: SketchPoint): number => g.elev[p.y * g.W + p.x]!;

/** A stand of two to four trees, and the open ground beside them a thicker one would take. */
function proposeGrove(g: MapMasks, state: GridState): SketchProposal | null {
  const trees = getObjectIndex(state).entries
    .filter((entry) => roleOf(entry.obj) === 'canopy')
    .map((entry) => ({ x: Math.floor(entry.rect.x), y: Math.floor(entry.rect.y) }));
  if (trees.length === 0) return null;

  // One pass of single-link clustering: a tree joins the stand it is within `P.groveSpan` of.
  const seen = new Set<number>();
  const stands: SketchPoint[][] = [];
  for (let s = 0; s < trees.length; s++) {
    if (seen.has(s)) continue;
    seen.add(s);
    const stack = [s];
    const stand: SketchPoint[] = [];
    while (stack.length > 0) {
      const at = stack.pop()!;
      stand.push(trees[at]!);
      for (let k = 0; k < trees.length; k++) {
        if (seen.has(k)) continue;
        const dx = Math.abs(trees[k]!.x - trees[at]!.x);
        const dy = Math.abs(trees[k]!.y - trees[at]!.y);
        if (Math.max(dx, dy) <= P.groveSpan) { seen.add(k); stack.push(k); }
      }
    }
    stands.push(stand);
  }

  // The thinnest stand that still reads as one: the sparsest is the one worth thickening.
  const sparse = stands
    .filter((stand) => stand.length >= P.groveTreesMin && stand.length <= P.groveTreesMax)
    .sort((a, b) => a.length - b.length)[0];
  if (!sparse) return null;

  const pips: SketchPip[] = sparse.map((tree) => ({ ...cellCentre(tree), r: 1.1, standing: true }));
  for (const spot of infill(g, sparse)) pips.push({ ...cellCentre(spot), r: 0.9, standing: false });
  const mid = {
    x: sparse.reduce((n, tree) => n + tree.x, 0) / sparse.length,
    y: sparse.reduce((n, tree) => n + tree.y, 0) / sparse.length,
  };
  return {
    kind: 'grove',
    dir: direction(g, mid),
    params: { n: sparse.length },
    art: { shape: 'grove', pips },
  };
}

/** Open ground inside the stand's own reach, where the trees it is missing would go. Real cells: a
 *  pip over water or over a roof would be a proposal the rules refuse. */
function infill(g: MapMasks, stand: readonly SketchPoint[]): SketchPoint[] {
  const box = {
    x0: Math.min(...stand.map((p) => p.x)) - 2, y0: Math.min(...stand.map((p) => p.y)) - 2,
    x1: Math.max(...stand.map((p) => p.x)) + 2, y1: Math.max(...stand.map((p) => p.y)) + 2,
  };
  const taken = new Set(stand.map((p) => cellKey(p.x, p.y)));
  const out: SketchPoint[] = [];
  for (let y = Math.max(0, box.y0); y <= Math.min(g.H - 1, box.y1) && out.length < P.groveInfillMax; y += 2) {
    for (let x = Math.max(0, box.x0); x <= Math.min(g.W - 1, box.x1) && out.length < P.groveInfillMax; x += 2) {
      const i = y * g.W + x;
      if (taken.has(cellKey(x, y))) continue;
      if (g.land[i] && !g.covered[i] && !g.paved[i] && !g.water[i] && !g.mountain[i]) out.push({ x, y });
    }
  }
  return out;
}

/**
 * The proposals this map offers, in the order the card cycles them.
 *
 * Each family gets at most one, and a region already spoken for is not proposed twice: four sketches
 * of one meadow would read as one idea drawn four ways. Family order is stable for a given map, so
 * the timed card rotation is deterministic rather than shuffled.
 */
export function proposeSketches(state: GridState): SketchProposal[] {
  const g = readMap(state);
  if (g.landCells === 0) return [];
  // The two land families share one segmentation, at the smaller of their two floors.
  const regions = segmentRegions(g, Math.min(P.laneRegionMin, P.pondRegionMin));
  const taken = new Set<number>();
  return [
    proposeLane(g, regions, taken),
    proposePond(g, regions, taken),
    proposeBridge(g, state),
    proposeGrove(g, state),
  ].filter((idea): idea is SketchProposal => idea !== null);
}

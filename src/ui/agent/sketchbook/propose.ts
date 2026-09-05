/*
 * Derives up to four sketch proposals from the live `GridState`. Each analyzer returns a proposal
 * only when the corresponding feature is present; an empty result keeps the sketch card hidden.
 *
 * IT READS THE EVALUATOR'S OWN MASKS (`tools/generation/designer/eval`) rather than walking the
 * cells here: `readGrid` decides what land, pavement, water and a plant ARE for the whole project,
 * `segmentRegions` decides what one open place is, and `waterBodies` decides what one body of water
 * is. A second definition of any of those, written for a card, would let the card disagree with the
 * generator about the map they are both looking at. The stands come off `state/object-index`, which
 * is the one answer to "what objects are here" (never a per-cell scan).
 *
 * THE TWO MODULES ARE NAMED DIRECTLY RATHER THAN THE DOOR (`tools/generation/designer/eval/index.ts`).
 * The door re-exports the whole scorecard graph — street ends, water forms, dressing palette and
 * all — for the sake of these three functions; `grid.ts` and `water-bodies.ts` are the two files
 * they live in. A threshold moved in either still reaches this card.
 *
 * PURE, AND SAID IN KEYS. No store, no renderer, no clock: a `GridState` in, a list out, so the
 * whole family is unit-testable against real maps. Both lines an idea carries (what she sees, and
 * the ORDER a press hands the composer) travel as i18n KEYS with their real readings as params,
 * resolved at render — the house rule for a standing line, so a locale change reaches a caption
 * already on screen. The numbers in those params are measurements, never decoration.
 *
 * GEOMETRY IS IN MACRO CELLS, because that is the coordinate the map itself is in. The card projects
 * it into whatever frame its photograph was composed at; nothing here knows the card's size.
 */
import { ItemCategory, type GridState } from '../../../core/model/types';
import { categoryOf } from '../../../state/catalog';
import { getObjectIndex } from '../../../state/object-index';
import { readGrid, segmentRegions, type EvalGrid, type Region } from '../../../tools/generation/designer/eval/grid';
import { waterBodies } from '../../../tools/generation/designer/eval/water-bodies';

export type SketchKind = 'lane' | 'pond' | 'bridge' | 'grove';

/** A point in MACRO CELL coordinates. */
export interface SketchPoint { x: number; y: number }

/** One pip of a grove sketch: a tree that STANDS there, or one the stand could take. */
export interface SketchPip extends SketchPoint { r: number; standing: boolean }

/**
 * The figure she draws, in macro cells. One variant per family, each holding what its own drawing
 * needs and nothing more — a card that had to guess which fields were meaningful for a shape would
 * be a fifth place the families are enumerated.
 */
export type SketchArt =
  /** A lane: a bowed line from a paved place to somewhere with no road, with the width of the
   *  pavement it proposes (the ghost band behind the dashes). */
  | { shape: 'lane'; from: SketchPoint; via: SketchPoint; to: SketchPoint; width: number }
  | { shape: 'pond'; cx: number; cy: number; rx: number; ry: number }
  /** A deck across a gap, plus the approach on each bank. */
  | { shape: 'bridge'; x: number; y: number; w: number; h: number; approach: readonly [SketchPoint, SketchPoint][] }
  | { shape: 'grove'; pips: readonly SketchPip[] };

export interface SketchIdea {
  kind: SketchKind;
  /** What she says she SEES, and what a press hands the composer. Keys, resolved at render. */
  capKey: string;
  orderKey: string;
  /** The compass quarter the feature sits in, as a key too: a direction is a word, and it is part of
   *  the sentence in every language. */
  dirKey: string;
  /** The readings both lines quote. Numbers only — the one word either line takes is the
   *  direction, which the card resolves from `dirKey`. */
  params: Record<string, number>;
  art: SketchArt;
}

/* ── what counts as worth proposing ─────────────────────────────────────────── */

/** A region with no road to it is worth a lane at this size and not below: a pocket of open ground a
 *  few cells across is a garden, and paving to it would be the sketch's own invention. */
const LANE_REGION_MIN = 40;
/** How far off the straight line the lane bows, as a share of its own length. A road drawn dead
 *  straight from the plaza reads as a ruler mark rather than as a lane. */
const LANE_BOW = 0.16;
/** The pavement the lane proposes, in cells: the width the road macros lay. */
const LANE_WIDTH = 2;

/** A pond wants a real expanse under it. */
const POND_REGION_MIN = 120;
/** And an EMPTY one: at most this share of the region may be under an object. */
const POND_COVER_MAX = 0.04;
/**
 * The pond's own extent, as a share of the region's box, with a floor and a CEILING. The ceiling is
 * what keeps it a pond: a share of the whole island's box is a lake covering a third of the map, and
 * the caption offers to dig one, not to flood the place.
 */
const POND_SHARE = 0.22;
const POND_RADIUS_MIN = 2;
const POND_RADIUS_MAX = 9;
/** How much of the ellipse has to stand on the region's own ground before it is a pond that fits.
 *  Below it the figure is shrunk a step at a time rather than drawn over the coast. */
const POND_FIT_SHARE = 0.85;

/** The game's own span rule (`core/model/bridge-span.ts`): a bridge crosses 3 to 6 macro blocks. */
const BRIDGE_SPAN_MIN = 3;
const BRIDGE_SPAN_MAX = 6;
/** How far the approach dashes run onto each bank. */
const BRIDGE_APPROACH = 2;

/** A stand this side of thin is a grove worth thickening; at or above it, the wood is already a
 *  wood. Two is the fewest that reads as a group rather than as one tree. */
const GROVE_TREES_MIN = 2;
const GROVE_TREES_MAX = 4;
/** How close two trees have to be to belong to one stand, in cells. */
const GROVE_SPAN = 6;
/** How many more the sketch offers, at most. */
const GROVE_INFILL_MAX = 3;

/** The eight-key direction table, held as literal keys so the i18n drift scan sees every one. */
const DIR_KEY = {
  north: 'agent3.sketch_dir_north',
  south: 'agent3.sketch_dir_south',
  east: 'agent3.sketch_dir_east',
  west: 'agent3.sketch_dir_west',
  middle: 'agent3.sketch_dir_middle',
} as const;

/** Inside this share of the map's own half-width, a feature is not in any quarter: it is in the
 *  middle, and saying "the north meadow" about the middle of the island is a small lie. */
const MIDDLE_SHARE = 0.22;

/** Which quarter of the map a point sits in, as the key for the word. */
function directionKey(g: EvalGrid, p: SketchPoint): string {
  const dx = (p.x - g.W / 2) / (g.W / 2);
  const dy = (p.y - g.H / 2) / (g.H / 2);
  if (Math.abs(dx) < MIDDLE_SHARE && Math.abs(dy) < MIDDLE_SHARE) return DIR_KEY.middle;
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? DIR_KEY.north : DIR_KEY.south;
  return dx < 0 ? DIR_KEY.west : DIR_KEY.east;
}

const cellX = (g: EvalGrid, i: number): number => i % g.W;
const cellY = (g: EvalGrid, i: number): number => (i / g.W) | 0;

function centroid(g: EvalGrid, cells: readonly number[]): SketchPoint {
  let sx = 0; let sy = 0;
  for (const i of cells) { sx += cellX(g, i); sy += cellY(g, i); }
  return { x: sx / cells.length, y: sy / cells.length };
}

/** The cell of `cells` nearest `to` — a figure has to land on ground the region actually holds, and
 *  a centroid of a crescent sits outside it. */
function nearestCell(g: EvalGrid, cells: readonly number[], to: SketchPoint): SketchPoint {
  let best = cells[0]!;
  let bestD = Infinity;
  for (const i of cells) {
    const d = (cellX(g, i) - to.x) ** 2 + (cellY(g, i) - to.y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { x: cellX(g, best), y: cellY(g, best) };
}

/** The cell of `cells` FARTHEST from `from`. */
function farthestCell(g: EvalGrid, cells: readonly number[], from: SketchPoint): SketchPoint {
  let best = cells[0]!;
  let bestD = -1;
  for (const i of cells) {
    const d = (cellX(g, i) - from.x) ** 2 + (cellY(g, i) - from.y) ** 2;
    if (d > bestD) { bestD = d; best = i; }
  }
  return { x: cellX(g, best), y: cellY(g, best) };
}

/** The cell of a region DEEPEST inside it: the one whose ring of region cells is widest, by a
 *  4-connected wave from the region's own edge. A pond wants the middle of the open ground, and a
 *  centroid sits outside a crescent. */
function deepestCell(g: EvalGrid, cells: readonly number[]): SketchPoint {
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

function boxOf(g: EvalGrid, cells: readonly number[]): { x0: number; y0: number; x1: number; y1: number } {
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
function roadReaches(g: EvalGrid, region: Region): boolean {
  for (const i of region.cells) {
    const x = cellX(g, i); const y = cellY(g, i);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.W || ny >= g.H) continue;
      const j = ny * g.W + nx;
      if (g.paved[j] || g.crossing[j]) return true;
    }
  }
  return false;
}

/** Where a lane would come FROM: the plaza if the map has one, else the pavement already down. A map
 *  with neither has nowhere to pave from, and the family declines. */
function laneOrigin(g: EvalGrid): SketchPoint | null {
  const plaza: number[] = [];
  const paved: number[] = [];
  for (let i = 0; i < g.W * g.H; i++) {
    if (g.plaza[i]) plaza.push(i);
    else if (g.paved[i]) paved.push(i);
  }
  const from = plaza.length > 0 ? plaza : paved;
  if (from.length === 0) return null;
  return nearestCell(g, from, centroid(g, from));
}

/* ── the four analysers ─────────────────────────────────────────────────────── */

/** A sizeable place with no road to it, and the plaza to pave from. */
function proposeLane(g: EvalGrid, regions: readonly Region[], taken: Set<number>): SketchIdea | null {
  const from = laneOrigin(g);
  if (!from) return null;
  const at = regions.findIndex((region, k) => (
    !taken.has(k) && region.cells.length >= LANE_REGION_MIN && !roadReaches(g, region)
  ));
  if (at < 0) return null;
  const region = regions[at]!;
  taken.add(at);
  // The FAR end of the place, not its middle: a lane down to a bay reaches into it, and the far end
  // is also what keeps the lane's landing clear of the pond's own deep-interior point.
  const to = farthestCell(g, region.cells, from);
  // The bow is perpendicular to the run, so the lane leans the same way whichever quarter it
  // crosses; its size is the run's own length, which keeps a short spur from looping.
  const mx = (from.x + to.x) / 2; const my = (from.y + to.y) / 2;
  const dx = to.x - from.x; const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const via = { x: mx - (dy / len) * len * LANE_BOW, y: my + (dx / len) * len * LANE_BOW };
  return {
    kind: 'lane',
    capKey: 'agent3.sketch_lane_cap',
    orderKey: 'agent3.sketch_lane_order',
    dirKey: directionKey(g, to),
    // The reading the caption quotes is how FAR the ground is from the pavement, which is what the
    // proposal is about. The region's own cell count is a five-figure number on an unpaved island:
    // true, and no help to anybody reading a two-line caption.
    params: { n: Math.round(Math.hypot(to.x - from.x, to.y - from.y)) },
    art: { shape: 'lane', from, via, to, width: LANE_WIDTH },
  };
}

/** A flat expanse with next to nothing on it. */
function proposePond(g: EvalGrid, regions: readonly Region[], taken: Set<number>): SketchIdea | null {
  const fits = (region: Region): boolean => {
    if (region.cells.length < POND_REGION_MIN) return false;
    const covered = region.cells.reduce((n, i) => n + (g.covered[i] ? 1 : 0), 0);
    return covered / region.cells.length <= POND_COVER_MAX;
  };
  // A place of its own where the map has one. Where it does not, the pond and the lane share the
  // island's one open expanse and stay different proposals about it: the lane runs to its FAR end
  // and the pond sits at its deepest point, so the two figures are never drawn over each other.
  const at = regions.findIndex((region, k) => !taken.has(k) && fits(region));
  const on = at >= 0 ? at : regions.findIndex(fits);
  if (on < 0) return null;
  const region = regions[on]!;
  taken.add(on);
  const middle = deepestCell(g, region.cells);
  const box = boxOf(g, region.cells);
  const clamp = (span: number): number => Math.min(
    POND_RADIUS_MAX, Math.max(POND_RADIUS_MIN, Math.round(span * POND_SHARE)),
  );
  const { rx, ry } = fitEllipse(g, region, middle, clamp(box.x1 - box.x0 + 1), clamp(box.y1 - box.y0 + 1));
  return {
    kind: 'pond',
    capKey: 'agent3.sketch_pond_cap',
    orderKey: 'agent3.sketch_pond_order',
    dirKey: directionKey(g, middle),
    // How wide the pond it offers is, measured off the room the meadow actually has.
    params: { n: rx * 2 },
    art: { shape: 'pond', cx: middle.x + 0.5, cy: middle.y + 0.5, rx, ry },
  };
}

/** The largest ellipse at `centre` that stands on the region's own ground, shrinking from the asked
 *  size a step at a time. A pond drawn over the coast is a proposal the map cannot take. */
function fitEllipse(
  g: EvalGrid, region: Region, centre: SketchPoint, wantX: number, wantY: number,
): { rx: number; ry: number } {
  const inRegion = new Set(region.cells);
  let rx = wantX; let ry = wantY;
  while (rx > POND_RADIUS_MIN || ry > POND_RADIUS_MIN) {
    let on = 0; let all = 0;
    for (let y = Math.ceil(centre.y - ry); y <= Math.floor(centre.y + ry); y++) {
      for (let x = Math.ceil(centre.x - rx); x <= Math.floor(centre.x + rx); x++) {
        if (((x - centre.x) / rx) ** 2 + ((y - centre.y) / ry) ** 2 > 1) continue;
        all++;
        if (x >= 0 && y >= 0 && x < g.W && y < g.H && inRegion.has(y * g.W + x)) on++;
      }
    }
    if (all === 0 || on / all >= POND_FIT_SHARE) break;
    rx = Math.max(POND_RADIUS_MIN, rx - 1);
    ry = Math.max(POND_RADIUS_MIN, ry - 1);
  }
  return { rx, ry };
}

/** A water run with a level bank on each side, at a span a bridge may cross. */
function proposeBridge(g: EvalGrid, state: GridState): SketchIdea | null {
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
          if (run >= BRIDGE_SPAN_MIN && run <= BRIDGE_SPAN_MAX) {
            const near = horizontal ? { x: b - run - 1, y: line } : { x: line, y: b - run - 1 };
            const far = horizontal ? { x: b, y: line } : { x: line, y: b };
            if (levelBank(g, near) && levelBank(g, far) && bankTier(g, near) === bankTier(g, far)) {
              const deck = horizontal
                ? { x: b - run, y: line, w: run, h: 1 }
                : { x: line, y: b - run, w: 1, h: run };
              const approach: [SketchPoint, SketchPoint][] = horizontal
                ? [[{ x: near.x - BRIDGE_APPROACH + 1, y: line }, near], [far, { x: far.x + BRIDGE_APPROACH - 1, y: line }]]
                : [[{ x: line, y: near.y - BRIDGE_APPROACH + 1 }, near], [far, { x: line, y: far.y + BRIDGE_APPROACH - 1 }]];
              return {
                kind: 'bridge',
                capKey: 'agent3.sketch_bridge_cap',
                orderKey: 'agent3.sketch_bridge_order',
                dirKey: directionKey(g, { x: deck.x + deck.w / 2, y: deck.y + deck.h / 2 }),
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
function levelBank(g: EvalGrid, p: SketchPoint): boolean {
  if (p.x < 0 || p.y < 0 || p.x >= g.W || p.y >= g.H) return false;
  const i = p.y * g.W + p.x;
  return g.land[i] === 1 && !g.water[i] && !g.mountain[i] && !g.covered[i];
}

const bankTier = (g: EvalGrid, p: SketchPoint): number => g.elev[p.y * g.W + p.x]!;

/** A stand of two to four trees, and the open ground beside them a thicker one would take. */
function proposeGrove(g: EvalGrid, state: GridState): SketchIdea | null {
  const trees = getObjectIndex(state).entries
    .filter((entry) => categoryOf(entry.obj) === ItemCategory.Tree)
    .map((entry) => ({ x: Math.floor(entry.rect.x), y: Math.floor(entry.rect.y) }));
  if (trees.length === 0) return null;

  // One pass of single-link clustering: a tree joins the stand it is within `GROVE_SPAN` of.
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
        if (Math.max(dx, dy) <= GROVE_SPAN) { seen.add(k); stack.push(k); }
      }
    }
    stands.push(stand);
  }

  // The THINNEST stand that still reads as one: the sparsest is the one worth thickening.
  const sparse = stands
    .filter((stand) => stand.length >= GROVE_TREES_MIN && stand.length <= GROVE_TREES_MAX)
    .sort((a, b) => a.length - b.length)[0];
  if (!sparse) return null;

  const pips: SketchPip[] = sparse.map((tree) => ({ x: tree.x + 0.5, y: tree.y + 0.5, r: 1.1, standing: true }));
  for (const spot of infill(g, sparse)) pips.push({ x: spot.x + 0.5, y: spot.y + 0.5, r: 0.9, standing: false });
  const mid = {
    x: sparse.reduce((n, tree) => n + tree.x, 0) / sparse.length,
    y: sparse.reduce((n, tree) => n + tree.y, 0) / sparse.length,
  };
  return {
    kind: 'grove',
    capKey: 'agent3.sketch_grove_cap',
    orderKey: 'agent3.sketch_grove_order',
    dirKey: directionKey(g, mid),
    params: { n: sparse.length },
    art: { shape: 'grove', pips },
  };
}

/** Open ground inside the stand's own reach, where the trees it is missing would go. Real cells: a
 *  pip over water or over a roof would be a proposal the rules refuse. */
function infill(g: EvalGrid, stand: readonly SketchPoint[]): SketchPoint[] {
  const box = {
    x0: Math.min(...stand.map((p) => p.x)) - 2, y0: Math.min(...stand.map((p) => p.y)) - 2,
    x1: Math.max(...stand.map((p) => p.x)) + 2, y1: Math.max(...stand.map((p) => p.y)) + 2,
  };
  const taken = new Set(stand.map((p) => `${p.x},${p.y}`));
  const out: SketchPoint[] = [];
  for (let y = Math.max(0, box.y0); y <= Math.min(g.H - 1, box.y1) && out.length < GROVE_INFILL_MAX; y += 2) {
    for (let x = Math.max(0, box.x0); x <= Math.min(g.W - 1, box.x1) && out.length < GROVE_INFILL_MAX; x += 2) {
      const i = y * g.W + x;
      if (taken.has(`${x},${y}`)) continue;
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
export function proposeSketches(state: GridState): SketchIdea[] {
  const g = readGrid(state);
  if (g.landCells === 0) return [];
  // The two land families share one segmentation, at the smaller of their two floors.
  const regions = segmentRegions(g, Math.min(LANE_REGION_MIN, POND_REGION_MIN));
  const taken = new Set<number>();
  return [
    proposeLane(g, regions, taken),
    proposePond(g, regions, taken),
    proposeBridge(g, state),
    proposeGrove(g, state),
  ].filter((idea): idea is SketchIdea => idea !== null);
}

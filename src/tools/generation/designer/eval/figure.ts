/**
 * THE MAP'S ONE SET PIECE, and where the best ends of the network go.
 *
 * A FIGURE IS A GAP-TOLERANT CLUSTER OF WATER, not a water body, which is why the reading does not
 * go through `water-bodies.ts`: the set piece is a flooded panel with dry mass STANDING IN IT — the
 * reference's banner is 772 water cells around 130 cells of retained mountain — so a body
 * decomposition returns a court's concentric rings as four separate annuli and a banner as the gaps
 * between its letters.
 */
import type { GridState } from '../../../../core/model/types';
import { eachTerminus } from '../streets/street-ends';
import { readGrid, type EvalGrid } from './grid';
import { ARRIVAL_REACH } from './streets';

/**
 * THE MAP'S ONE SET PIECE, read off the finished map.
 *
 * The principle no content statistic catches: a composition has a PRIMARY set piece, two or three
 * secondary ones, and ordinary ground for the rest; when every place is equally elaborate, none of them
 * is the point.
 *
 * Cells within `FIGURE_GAP` of each other are one figure, the same tolerance the flora-cluster reading
 * uses, which is what makes this see what a viewer sees rather than what a body decomposition returns.
 *
 * DOMINANCE IS A RATIO, not a size: what the principle asks for is a ladder, so the reading reports the
 * largest figure against the SECOND largest. A map whose biggest water is one of five equal ponds has
 * no primary anything however large the ponds are.
 *
 * FRAMING is what makes a figure read as figure against ground — the reference frames its banner on
 * four sides with a road border. It is read as the share of the band `FRAME_READ` cells
 * around the figure's box that is CALM — paved OR bare — since a bed planted against the panel's edge is
 * the framing gone. IT DOES NOT DISTINGUISH THE TWO, so an untouched terrace reads 1.00 exactly as a
 * road border does, and a high reading says the ground was kept clear rather than that a border was
 * built. Whether the frame is PAVED is a separate question, and the answer on this generator is mostly
 * no: the courses reach the figure on about half the batch.
 */
export const FIGURE_GAP = 2;

export const FRAME_READ = 3;

/**
 * The water a cluster must stand in to count as a composed FIGURE here, and the number the gate reads.
 *
 * It sits UNDER the pass's own panel floor (`SET_PIECE_MIN`, 120 cells) because the two numbers count
 * different things: a court's pattern stands dry inside its panel, so the water a 120-cell panel leaves
 * is about 100 cells. One declaration, so the count in this reading and the floor the gate holds a map
 * to cannot drift apart — read against 120, a gate-passing map returns `figures: 0`.
 */
export const SET_PIECE_CELLS_MIN = 80;

/**
 * THE ONE BIG THING: the water a full-richness map's biggest composed figure must stand in.
 *
 * `SET_PIECE_CELLS_MIN` above is what makes a cluster COUNT as a figure at all and is lower on purpose;
 * this is the SCALE at which a centrepiece reads as clearly larger and more elaborate than anything
 * else on the map, rather than as one of several modest scattered ponds of similar size. A map's biggest
 * figure comes to 216 to 966 cells with this floor and 118 to 524 without it, against 1010 on the
 * terraced reference and 1427 on the garden town.
 *
 * IT IS 200 AND NOT 250 BECAUSE THE FAMILY IS A CHOICE. A seed that draws the text family and can only
 * fit it at scale 2 lands a 324-cell panel where the court would have taken the terrace floor, and
 * family variety is worth a rung of scale on the seeds where the two disagree.
 *
 * THE LADDER RATIO IS NOT GATED anywhere, and the reference is why: read by this code its banner and its
 * flooded lettering field come to 1010 and 971 cells, so a "three times the second largest" rule reads
 * 1.04 on the expert map and a bar on it would fail the map it was derived from.
 *
 * ONE DECLARATION: the harness and the committed probe read it from here, so the gate and the test
 * cannot drift apart.
 */
export const SET_PIECE_FLOOR = 200;

export interface FigureReading {
  /** Water clusters of `SET_PIECE_CELLS_MIN` cells or more: the map's composed figures. */
  figures: number;
  /** Cells of the largest, and of the second largest cluster (0 where there is none). */
  largest: number;
  second: number;
  /** The largest over the second: the ladder as one number. `Infinity` where nothing else comes near
   *  the floor, which is the cleanest possible answer to "one thing that happens once". */
  dominance: number;
  /** The largest figure's own bounding box, and how much of it stands in water. */
  box: { x: number; y: number; w: number; h: number };
  boxFill: number;
  /** Share of the largest figure's surrounding band that is calm: paved or bare. */
  framed: number;
  /** Chebyshev distance from the largest figure to the nearest pavement: how the walk relates to it. */
  toPavement: number;
}

export function figureReading(state: GridState, g = readGrid(state)): FigureReading {
  const { W, H } = g;
  const clusters = waterClusters(g);
  const sizes = clusters.map((c) => c.length).sort((a, b) => b - a);
  const figures = sizes.filter((n) => n >= SET_PIECE_CELLS_MIN).length;
  const best = clusters.reduce<number[]>((a, c) => (c.length > a.length ? c : a), []);
  const empty = { x: 0, y: 0, w: 0, h: 0 };
  if (!best.length) {
    return { figures, largest: 0, second: 0, dominance: 0, box: empty, boxFill: 0, framed: 0, toPavement: -1 };
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0, wet = 0;
  for (const i of best) {
    const x = i % W, y = (i / W) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (g.water[i]) wet++;
  }
  const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  let band = 0, calm = 0;
  for (let y = y0 - FRAME_READ; y <= y1 + FRAME_READ; y++) {
    for (let x = x0 - FRAME_READ; x <= x1 + FRAME_READ; x++) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = y * W + x;
      if (!g.land[i]) continue;
      band++;
      if (g.paved[i] || !g.covered[i]) calm++;
    }
  }
  const own = new Set(best);
  let toPavement = -1;
  for (let r = 0; r <= FRAME_READ * 4 && toPavement < 0; r++) {
    for (const i of own) {
      const x = i % W, y = (i / W) | 0;
      for (let dy = -r; dy <= r && toPavement < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (g.paved[ny * W + nx]) { toPavement = r; break; }
        }
      }
      if (toPavement >= 0) break;
    }
  }
  const second = sizes[1] ?? 0;
  return {
    figures, largest: best.length, second,
    dominance: second > 0 ? best.length / second : Infinity,
    box, boxFill: box.w * box.h ? wet / (box.w * box.h) : 0,
    framed: band ? calm / band : 0,
    toPavement,
  };
}

/**
 * WHERE THE BEST ENDS OF THE NETWORK GO.
 *
 * That every end arrives at SOMETHING is `streetArrivals`, and it is a hard rule. This is the half it
 * does not read: the strongest places on the map should all be terminal, and what a walk ends at should
 * be a place built to be arrived at rather than the nearest garden. So the termini are sorted by
 * what stands in their forward cone: the map's own figure, a crossing that carries the walk somewhere
 * else, an anchor building's door, or ordinary ground.
 *
 * The cone is `streetArrivals`' own, so the two readings cannot disagree about where an end is looking.
 */
export interface SingularArrivals {
  termini: number;
  /** Ends whose cone reaches the map's set piece. */
  atFigure: number;
  /** Ends whose cone reaches a bridge or ramp: the walk carries on somewhere it could not otherwise. */
  atCrossing: number;
  /** Ends whose cone reaches a building or facility. */
  atStructure: number;
}

export function singularArrivals(state: GridState, g = readGrid(state), figure?: FigureReading): SingularArrivals {
  const { W, H } = g;
  const box = (figure ?? figureReading(state, g)).box;
  const out: SingularArrivals = { termini: 0, atFigure: 0, atCrossing: 0, atStructure: 0 };
  eachTerminus(g.paved, g.W, g.H, (face, dx, dy) => {
    out.termini++;
    let figureSeen = false, crossing = false, structure = false;
    for (const i of face) {
      const fx = i % W, fy = (i / W) | 0;
      for (let k = 1; k <= ARRIVAL_REACH; k++) {
        for (let across = -ARRIVAL_REACH; across <= ARRIVAL_REACH; across++) {
          const x = fx + dx * k + dy * across, y = fy + dy * k + dx * across;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const j = y * W + x;
          if (box.w > 0 && x >= box.x && y >= box.y && x < box.x + box.w && y < box.y + box.h
            && g.water[j]) figureSeen = true;
          if (g.crossing[j]) crossing = true;
          if (g.structure[j]) structure = true;
        }
      }
    }
    if (figureSeen) out.atFigure++;
    else if (crossing) out.atCrossing++;
    else if (structure) out.atStructure++;
  });
  return out;
}

/** The map's water as GAP-TOLERANT clusters: cells within `FIGURE_GAP` of one another, so a flooded
 *  panel and the dry strokes standing inside it read as the one composed thing they are. */
function waterClusters(g: EvalGrid): number[][] {
  const { W, H } = g;
  const seeds: number[] = [];
  for (let i = 0; i < W * H; i++) if (g.water[i]) seeds.push(i);
  if (!seeds.length) return [];
  const seen = new Uint8Array(W * H);
  const out: number[][] = [];
  for (const start of seeds) {
    if (seen[start]) continue;
    const piece: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      piece.push(p);
      const x = p % W, y = (p / W) | 0;
      for (let dy = -FIGURE_GAP; dy <= FIGURE_GAP; dy++) {
        for (let dx = -FIGURE_GAP; dx <= FIGURE_GAP; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (seen[j] || !g.water[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push(piece);
  }
  return out.sort((a, b) => b.length - a.length);
}

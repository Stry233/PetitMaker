/**
 * The map's one set piece, and where the best ends of the network go.
 *
 * A figure is a gap-tolerant cluster of water, not a water body, which is why the reading does not
 * go through `water-bodies.ts`: the set piece is a flooded panel with dry mass standing in it — the
 * reference's banner is 772 water cells around 130 cells of retained mountain — so a body
 * decomposition returns a court's concentric rings as four separate annuli and a banner as the gaps
 * between its letters.
 */
import type { GridState } from '../../../core/model/types';
import { ARRIVAL_REACH } from './streets';
import { FIGURE_CALM } from '../../../tools/generation/designer/water/water-forms';
import { eachTerminus, readMap, type MapMasks } from '../../../tools/reading';
import { gapClusters } from './grid';

/**
 * The map's one set piece, read off the finished map: a composition has a primary set piece, two
 * or three secondary ones and ordinary ground, and when every place is equally elaborate none is
 * the point.
 *
 * Cells within `FIGURE_GAP` of each other are one figure, the flora-cluster tolerance, so this sees
 * what a viewer sees. Dominance is the largest figure against the second largest.
 *
 * Framing is the share of the `FIGURE_CALM` band around the figure's box that is calm, paved or
 * bare. It does not tell the two apart: a high reading says the ground was kept clear, not that a
 * border was built.
 */
export const FIGURE_GAP = 2;

/**
 * The water a cluster must stand in to count as a composed figure here, and the number the gate reads.
 *
 * It sits under the pass's own panel floor (`SET_PIECE_MIN`, 120 cells) because the two numbers count
 * different things: a court's pattern stands dry inside its panel, so the water a 120-cell panel leaves
 * is about 100 cells. One declaration, so the count in this reading and the floor the gate holds a map
 * to cannot drift apart — read against 120, a gate-passing map returns `figures: 0`.
 */
export const SET_PIECE_CELLS_MIN = 80;

/**
 * The water a full-richness map's biggest composed figure must stand in: the scale at which a
 * centrepiece reads as larger than anything else rather than one of several modest ponds.
 * `SET_PIECE_CELLS_MIN` only makes a cluster count as a figure. 200 rather than 250 lets a seed
 * that draws the text family fit it at scale 2. The ladder ratio stays ungated because the
 * reference's own banner and lettering field are nearly equal. The harness and the probe both read
 * it from here.
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

export function figureReading(state: GridState, g = readMap(state)): FigureReading {
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
  for (let y = y0 - FIGURE_CALM; y <= y1 + FIGURE_CALM; y++) {
    for (let x = x0 - FIGURE_CALM; x <= x1 + FIGURE_CALM; x++) {
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
  for (let r = 0; r <= FIGURE_CALM * 4 && toPavement < 0; r++) {
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
 * Where the best ends of the network go.
 *
 * That every end arrives at something is `streetArrivals`, and it is a hard rule. This is the half it
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

export function singularArrivals(state: GridState, g = readMap(state), figure?: FigureReading): SingularArrivals {
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

/** The map's water as gap-tolerant clusters: cells within `FIGURE_GAP` of one another, so a flooded
 *  panel and the dry strokes standing inside it read as the one composed thing they are. */
function waterClusters(g: MapMasks): number[][] {
  return gapClusters(g.water, g.W, g.H, FIGURE_GAP).sort((a, b) => b.length - a.length);
}

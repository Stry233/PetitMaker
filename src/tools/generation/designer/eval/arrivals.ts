/**
 * DO THE STREETS END AT PLACES? Sparseness is legible when short streets END AT PLACES, and legible
 * only as absence when they do not.
 *
 * That every end arrives at SOMETHING is `streetArrivals`, and it is a hard rule. This is the harder
 * question: are the map's SET PIECES what the network stops at? A town whose streets all pass through
 * and none of them finishes anywhere has nothing terminal to offer a visitor, however many junctions
 * it carries.
 *
 * THE READING IS ABOUT THE PLACES, NOT THE ENDS. Measured from the ends it does not discriminate:
 * counting an end as a spur when a junction stands within reach along the pavement takes in nearly
 * every end on a network with junctions every twenty cells (references 15 and 26 of 28 and 31, a
 * generated batch 30 to 66 of 32 to 66), which separates junction DENSITY and nothing else. So this
 * counts the SET PIECES a walk finishes at instead, and there are two ways a walk finishes at one:
 *
 *  - a street END faces it — `eachTerminus`' own face, within `PLACE_REACH` of the piece's box; or
 *  - the pavement that reaches it is a LEAF of the network. A fountain court's own paved border is
 *    exactly this: the network runs in, goes round the water and goes no further. It presents no
 *    terminus, because a border two cells wide has no face with three cells of street behind it —
 *    and it is the plainest arrival on the map. What makes it an arrival is that taking it away costs
 *    the network nothing else, which is the same thing as saying nothing is reached THROUGH it.
 *
 * Pure and deterministic: a finished map in, counts out.
 */
import type { GridState, Rect } from '../../../../core/model/types';
import { eachTerminus } from '../streets/street-ends';
import { figureReading, type FigureReading } from './figure';
import { NB4, readGrid, type EvalGrid } from './grid';
import { courtBoxes } from './water';

/** How far from a set piece's own box a street end, or the pavement that serves it, may stand. One
 *  composed place's own depth: past that the street stopped somewhere else. */
export const PLACE_REACH = 5;

/**
 * How much pavement removing a piece's own band may cost the network BEYOND that band before the band
 * reads as a through route rather than as a leaf.
 *
 * Not zero, because a border can carry a stub of its own — a doorstep spur off the court, a cell the
 * course laid on its way in — and a walk that ends at a place with a bench beside it has still ended
 * there. It is short enough that a district reached through the piece cannot hide inside it.
 */
const LEAF_SLACK = 12;

export interface PlaceArrivals {
  /** Street ends on the map, by `eachTerminus`: the same faces `streetArrivals` judges. */
  termini: number;
  /** Set pieces read off the finished map: the largest composed figure, and every formal court. */
  places: number;
  /** Set pieces a walk finishes at, either way. */
  arrivedAt: number;
  /** Of those, the ones a street END faces. */
  byTerminus: number;
  /** Of those, the ones whose own pavement is a leaf of the network. */
  byLeaf: number;
}

export function placeArrivals(
  state: GridState, g = readGrid(state), figure?: FigureReading,
): PlaceArrivals {
  const box = (figure ?? figureReading(state, g)).box;
  // The set piece and a court are the same thing where the map's largest water IS its court, and one
  // place asked about twice would answer the batch reading twice. MERGED IN ORDER rather than by a
  // first-match filter, so the answer does not depend on which pair happens to be compared first: an
  // overlap relation is not transitive, and A overlapping B while B overlaps C leaves A and C in the
  // list under a filter and folds all three together here.
  const places: Rect[] = [];
  for (const candidate of [...(box.w > 0 ? [box] : []), ...courtBoxes(state, g)]) {
    const host = places.findIndex((o) => overlaps(o, candidate));
    if (host < 0) { places.push({ ...candidate }); continue; }
    const o = places[host]!;
    const x1 = Math.max(o.x + o.w, candidate.x + candidate.w);
    const y1 = Math.max(o.y + o.h, candidate.y + candidate.h);
    o.x = Math.min(o.x, candidate.x); o.y = Math.min(o.y, candidate.y);
    o.w = x1 - o.x; o.h = y1 - o.y;
  }
  const out: PlaceArrivals = { termini: 0, places: places.length, arrivedAt: 0, byTerminus: 0, byLeaf: 0 };

  const faced = new Set<number>();
  eachTerminus(g.paved, g.W, g.H, (face) => {
    out.termini++;
    for (const i of face) faced.add(i);
  });

  const reachable = plazaPavement(g, null);
  for (const place of places) {
    const ends = withinReach(g, place, (i) => faced.has(i));
    if (ends) { out.arrivedAt++; out.byTerminus++; continue; }
    const band = new Set(withinReachCells(g, place).filter((i) => reachable.has(i)));
    if (band.size === 0) continue;
    const left = plazaPavement(g, band);
    let lost = 0;
    for (const i of reachable) if (!band.has(i) && !left.has(i)) lost++;
    if (lost > LEAF_SLACK) continue;
    out.arrivedAt++;
    out.byLeaf++;
  }
  return out;
}

/** The paved cells the plaza can walk to, with `cut` treated as if it were not there. Crossings
 *  conduct through their whole 3x3, exactly as the scorecard's own connectivity reading has them. */
function plazaPavement(g: EvalGrid, cut: ReadonlySet<number> | null): Set<number> {
  const { W, H } = g;
  const conduct = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if ((g.paved[i] || g.plaza[i]) && !cut?.has(i)) conduct[i] = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!g.crossing[y * W + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && !cut?.has(ny * W + nx)) conduct[ny * W + nx] = 1;
        }
      }
    }
  }
  const seen = new Uint8Array(W * H);
  const queue: number[] = [];
  for (let i = 0; i < W * H; i++) if (g.plaza[i] && conduct[i]) { seen[i] = 1; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head]!;
    const x = p % W, y = (p / W) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!conduct[j] || seen[j]) continue;
      seen[j] = 1; queue.push(j);
    }
  }
  const out = new Set<number>();
  for (let i = 0; i < W * H; i++) if (seen[i] && g.paved[i]) out.add(i);
  return out;
}

/** Every paved cell within `PLACE_REACH` of a set piece's box. */
function withinReachCells(g: EvalGrid, box: Rect): number[] {
  const out: number[] = [];
  for (let y = box.y - PLACE_REACH; y < box.y + box.h + PLACE_REACH; y++) {
    for (let x = box.x - PLACE_REACH; x < box.x + box.w + PLACE_REACH; x++) {
      if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
      const i = y * g.W + x;
      if (g.paved[i]) out.push(i);
    }
  }
  return out;
}

const withinReach = (g: EvalGrid, box: Rect, hit: (i: number) => boolean): boolean =>
  withinReachCells(g, box).some(hit);

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

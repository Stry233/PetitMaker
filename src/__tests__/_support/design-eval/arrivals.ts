/**
 * Do the streets end at places? `streetArrivals` already requires every end to arrive at
 * something; this asks whether the map's set pieces are what the network stops at.
 *
 * It counts places rather than ends, since counting ends as spurs near a junction only separates
 * junction density. A walk finishes at a set piece in two ways:
 *
 *  - a street end faces it: `eachTerminus`' own face, within `PLACE_REACH` of the piece's box; or
 *  - the pavement that reaches it is a leaf of the network, as a fountain court's paved border is:
 *    it presents no terminus, but taking it away costs the network nothing else, so nothing is
 *    reached through it.
 *
 * Pure and deterministic: a finished map in, counts out.
 */
import type { GridState } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import { figureReading, type FigureReading } from './figure';
import { courtBoxes } from './water';
import { eachTerminus, readMap, type MapMasks } from '../../../tools/reading';
import { anchorReach } from './reach';

/** How far from a set piece's own box a street end, or the pavement that serves it, may stand. One
 *  composed place's own depth: past that the street stopped somewhere else. */
export const PLACE_REACH = 5;

/**
 * How much pavement removing a piece's own band may cost the network beyond that band before the band
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
  /** Of those, the ones a street end faces. */
  byTerminus: number;
  /** Of those, the ones whose own pavement is a leaf of the network. */
  byLeaf: number;
}

export function placeArrivals(
  state: GridState, g = readMap(state), figure?: FigureReading,
): PlaceArrivals {
  const box = (figure ?? figureReading(state, g)).box;
  // The set piece and a court are the same thing where the map's largest water is its court, and one
  // place asked about twice would answer the batch reading twice. Merged in order rather than by a
  // first-match filter, so the answer does not depend on which pair happens to be compared first: an
  // overlap relation is not transitive, and `A` overlapping `B` while `B` overlaps `C` leaves `A` and `C` in the
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

  const reachable = hubPavement(g, null);
  for (const place of places) {
    const ends = withinReach(g, place, (i) => faced.has(i));
    if (ends) { out.arrivedAt++; out.byTerminus++; continue; }
    const band = new Set(withinReachCells(g, place).filter((i) => reachable.has(i)));
    if (band.size === 0) continue;
    const left = hubPavement(g, band);
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
function hubPavement(g: MapMasks, cut: ReadonlySet<number> | null): Set<number> {
  const reach = anchorReach(g.paved, g.anchor, g.crossing, g, cut);
  const out = new Set<number>();
  for (let i = 0; i < g.W * g.H; i++) if (reach[i] && g.paved[i]) out.add(i);
  return out;
}

/** Every paved cell within `PLACE_REACH` of a set piece's box. */
function withinReachCells(g: MapMasks, box: Rect): number[] {
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

const withinReach = (g: MapMasks, box: Rect, hit: (i: number) => boolean): boolean =>
  withinReachCells(g, box).some(hit);

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

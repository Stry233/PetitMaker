/**
 * Whether the map's set pieces are what the street network stops at. It counts places, not ends
 * (counting ends only separates junction density). A walk finishes at a set piece in two ways:
 *
 *  - a street end (`eachTerminus`' face) stands within `PLACE_REACH` of the piece's box; or
 *  - the pavement that reaches it is a leaf of the network, as a fountain court's paved border is:
 *    removing it costs the network nothing else.
 */
import type { GridState } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import { figureReading, type FigureReading } from './figure';
import { courtBoxes } from './water';
import { eachTerminus, readMap, type MapMasks } from '../../../tools/reading';
import { anchorReach } from './reach';

/** How far from a set piece's box a street end, or the pavement serving it, may stand: one composed
 *  place's depth. */
export const PLACE_REACH = 5;

/**
 * Pavement that removing a piece's band may cost beyond the band before the band reads as a through
 * route rather than a leaf. Not zero, since a border can carry its own stub (a doorstep spur off the
 * court); small enough that a district reached through the piece cannot hide inside it.
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
  // The figure and a court coincide where the largest water is the court, so overlapping boxes merge
  // into one place, in order, so that A and C still join when each overlaps B.
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

/** The paved cells the plaza can walk to with `cut` removed, by the scorecard's own `anchorReach`. */
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

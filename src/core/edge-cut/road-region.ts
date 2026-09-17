/*
 * road-region.ts — a road SURFACE as one whole: the connected same-material region, its outline
 * traced as one chain of exact elements, feathered as one boundary.
 *
 * The feather is a property of the surface's outline, not of any tile: per-tile fades cannot wrap
 * a corner that two tiles share (an L-bend's inner corner, the end of a boundary run against a fed
 * cell), so they leave hard notches inside what is one continuous surface. This module builds the
 * union first and fades second.
 *
 * The union needs no general polygon clipper because every piece — a tile's kept shape, a feed's
 * fill — meets its neighbours along whole cell sides with integer corners. So: collect every
 * piece's boundary ELEMENTS (exact lines and arcs, road-shape.ts); within one material+level, a
 * line whose exact reverse also occurs is interior and both are cancelled (that cancellation IS
 * the union, and each cancelled pair joins its two pieces into one region); the surviving
 * elements stitch into rings at their shared corners.
 *
 * `points(t)` then OFFSETS the ring analytically — a line to a parallel line, an arc to a
 * concentric arc — and joins each adjacent pair exactly: a convex junction trims both offsets to
 * their intersection (the true eroded corner, arcs included, which is what keeps a straight edge
 * exactly straight beside a cut instead of tilting toward a sampled chord), and a concave
 * junction bridges them with a corner arc of radius `t` (the distance field's own rounding).
 * Sampling happens only at the very end, with fixed counts, so a renderer can pair rings vertex by
 * vertex across insets.
 */
import type { PlacedObject } from '../model/types';
import type { RoadLookup } from '../model/road-lookup';
import { ROAD_ARC_STEPS, roadBodyElements, roadCutFeeds, type RoadEl, type RoadPt } from './road-shape';

/** One ring of a region outline. `points(t)` is the ring inset by `t` cells toward the region's
 *  interior — for a hole that means outward from the hole. Fixed point count across `t`. */
export interface RoadRegionRing {
  points(t: number): RoadPt[];
}

/** One connected road surface: every tile of one material at one level whose shapes join, plus
 *  the fills it feeds into neighbouring cut tiles of other materials. */
export interface RoadRegion {
  /** The surface's material (catalogId of its tiles). */
  material: string;
  /** The stored coating level every member shares. */
  elevation: number;
  /** The member road tiles (feed cells belong to the region but host a foreign tile). */
  members: PlacedObject[];
  /** Every cell the region draws in: member cells plus fed cells. */
  cells: { x: number; y: number }[];
  /** Outer outline(s) and holes; which is which never matters to a renderer, because each
   *  vertex's inset direction already points into the surface. */
  rings: RoadRegionRing[];
  /** Everything the outline was derived from, as one comparable string — members AND the foreign
   *  cut tiles the region feeds into, whose corners shape the fills. A renderer caching drawn
   *  regions must key on this: keying on members alone goes stale when a neighbouring cut
   *  changes, which redraws nothing the user can see until their next edit. */
  signature: string;
}

type Vec = readonly [number, number];

const EPS = 1e-9;

/** Corner-arc subdivision cap: a concave junction's bridge is split so no step exceeds this. */
const BRIDGE_STEP = Math.PI / 8;

const key = (p: RoadPt): string => `${Math.round(p[0] * 4096)},${Math.round(p[1] * 4096)}`;

/** The same quantized point as ONE number: coordinates live in [-1, map] cells, so the 1/4096
 *  quanta fit 21 bits each with room, and a numeric key spares the cancellation pass a template
 *  string per edge — the hottest allocation in a whole-network rebuild. */
const pid = (p: RoadPt): number =>
  (Math.round(p[0] * 4096) + 0x8000) * 0x200000 + (Math.round(p[1] * 4096) + 0x8000);

const sub = (a: RoadPt, b: RoadPt): Vec => [a[0] - b[0], a[1] - b[1]];
const cross = (u: Vec, v: Vec): number => u[0] * v[1] - u[1] * v[0];
const dot = (u: Vec, v: Vec): number => u[0] * v[0] + u[1] * v[1];
const norm = (v: Vec): Vec => {
  const l = Math.hypot(v[0], v[1]);
  return l < EPS ? [0, 0] : [v[0] / l, v[1] / l];
};

interface TaggedEl {
  el: RoadEl;
  piece: number;
}

/** Unit travel tangent at an element's start/end. Arcs turn with their sweep (the sign of the
 *  a→b turn about the centre; every arc here spans a quarter turn or less). */
function sweepOf(el: Extract<RoadEl, { kind: 'arc' }>): number {
  return Math.sign(cross(sub(el.a, el.c), sub(el.b, el.c))) || 1;
}
function tangentAt(el: RoadEl, p: RoadPt, atStart: boolean): Vec {
  if (el.kind === 'line') return norm(sub(el.b, el.a));
  void atStart;
  const s = sweepOf(el);
  const r = sub(p, el.c);
  return norm([-s * r[1], s * r[0]]);
}
/** With the +1 handedness (interior left of travel), a line's inward normal. */
function lineNormal(el: Extract<RoadEl, { kind: 'line' }>): Vec {
  const d = norm(sub(el.b, el.a));
  return [-d[1], d[0]];
}
/** The direction an element's endpoint travels as the outline insets. */
function offsetDir(el: RoadEl, p: RoadPt): Vec {
  if (el.kind === 'line') return lineNormal(el);
  const out = norm(sub(p, el.c));
  return [el.dr * out[0], el.dr * out[1]];
}
/** An element's endpoint at inset `t`, before any trimming against its neighbour. */
function offsetEndpoint(el: RoadEl, p: RoadPt, t: number): RoadPt {
  const d = offsetDir(el, p);
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

interface Piece {
  road: PlacedObject;      // the tile whose cell this piece draws in
  material: string;        // the surface it belongs to (a feed carries its feeder's)
  members: PlacedObject[]; // the member tiles this piece speaks for (a feed names its feeders)
  els: RoadEl[];
}

/** Sampled signed area (y-down shoelace), only for the SIGN: pieces arrive through roadTxPt,
 *  which mirrors for three of the four connection sides, and every ring walks one handedness. */
function orientationOf(els: RoadEl[]): number {
  let area = 0;
  const put = (a: RoadPt, b: RoadPt): void => { area += a[0] * b[1] - b[0] * a[1]; };
  for (const el of els) {
    if (el.kind === 'line') { put(el.a, el.b); continue; }
    const r = Math.hypot(el.a[0] - el.c[0], el.a[1] - el.c[1]);
    const s = sweepOf(el);
    const a0 = Math.atan2(el.a[1] - el.c[1], el.a[0] - el.c[0]);
    let span = (Math.atan2(el.b[1] - el.c[1], el.b[0] - el.c[0]) - a0) * s;
    span = ((span % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let prev = el.a;
    for (let i = 1; i <= 4; i++) {
      const a = a0 + s * span * (i / 4);
      const p: RoadPt = [el.c[0] + r * Math.cos(a), el.c[1] + r * Math.sin(a)];
      put(prev, p);
      prev = p;
    }
  }
  return area;
}

function reverseEls(els: RoadEl[]): RoadEl[] {
  return [...els].reverse().map((el) => (el.kind === 'line'
    ? { kind: 'line' as const, a: el.b, b: el.a }
    : { kind: 'arc' as const, c: el.c, a: el.b, b: el.a, dr: el.dr }));
}

/** The pieces of every surface, elements oriented one way (interior left of travel). */
function collectPieces(all: readonly PlacedObject[], roads: RoadLookup): Piece[] {
  const pieces: Piece[] = [];
  const oriented = (els: RoadEl[]): RoadEl[] => (orientationOf(els) < 0 ? reverseEls(els) : els);
  for (const road of all) {
    const { x, y } = road.position;
    pieces.push({
      road, material: road.catalogId, members: [road],
      els: oriented(roadBodyElements(roads, road, x, y, 1, 1)),
    });
    for (const feed of roadCutFeeds(roads, road)) {
      pieces.push({
        road,
        material: feed.feeders[0]!.catalogId,
        members: [...feed.feeders],
        els: oriented(feed.elements(x, y, 1, 1)),
      });
    }
  }
  return pieces;
}

class UnionFind {
  private parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r]!;
    while (this.parent[i] !== i) { const next = this.parent[i]!; this.parent[i] = r; i = next; }
    return r;
  }
  union(i: number, j: number): void { this.parent[this.find(i)] = this.find(j); }
}

function stitchRings(els: TaggedEl[]): RoadEl[][] {
  const byStart = new Map<string, TaggedEl[]>();
  for (const e of els) {
    const k = key(e.el.a);
    const list = byStart.get(k);
    if (list) list.push(e); else byStart.set(k, [e]);
  }
  const used = new Set<TaggedEl>();
  const rings: RoadEl[][] = [];
  for (const start of els) {
    if (used.has(start)) continue;
    const ring: RoadEl[] = [];
    let cur = start;
    for (;;) {
      used.add(cur);
      ring.push(cur.el);
      const candidates = (byStart.get(key(cur.el.b)) ?? []).filter((e) => !used.has(e));
      if (candidates.length === 0) break;
      let next = candidates[0]!;
      if (candidates.length > 1) {
        // A corner the boundary passes twice (two diagonally-touching lobes of one region):
        // continue along the sharpest turn toward the interior — positive by the handedness —
        // which keeps each lobe's wrap on its own side of the pinch.
        const din = tangentAt(cur.el, cur.el.b, false);
        let best = -Infinity;
        for (const e of candidates) {
          const tout = tangentAt(e.el, e.el.a, true);
          const turn = Math.atan2(cross(din, tout), dot(din, tout));
          if (turn > best) { best = turn; next = e; }
        }
      }
      cur = next;
    }
    rings.push(ring);
  }
  return rings;
}

/** How a ring joins two neighbouring elements at every inset. Solved analytically per `t`. */
interface Junction {
  at: RoadPt;
  /** convex/flat: offsets trimmed to one point; concave: bridged by a corner arc. */
  kind: 'point' | 'bridge';
  /** Bridge subdivision (fixed across `t`, so the point count never changes). */
  steps: number;
}

function junctionOf(prev: RoadEl, next: RoadEl): Junction {
  const at = next.a;
  const tin = tangentAt(prev, prev.b, false);
  const tout = tangentAt(next, at, true);
  const turn = Math.atan2(cross(tin, tout), dot(tin, tout));
  if (turn > -EPS) return { at, kind: 'point', steps: 0 };
  return { at, kind: 'bridge', steps: Math.max(1, Math.ceil(-turn / BRIDGE_STEP)) };
}

/** The intersection of two offset elements nearest `guess` — the trimmed convex corner. */
function trimPoint(prev: RoadEl, next: RoadEl, at: RoadPt, t: number): RoadPt {
  const dIn = offsetDir(prev, at), dOut = offsetDir(next, at);
  const guess: RoadPt = [at[0] + ((dIn[0] + dOut[0]) / 2) * t, at[1] + ((dIn[1] + dOut[1]) / 2) * t];
  const pick = (cands: RoadPt[]): RoadPt => {
    let best = guess, score = Infinity;
    for (const p of cands) {
      const d = Math.hypot(p[0] - guess[0], p[1] - guess[1]);
      if (d < score) { score = d; best = p; }
    }
    return best;
  };
  const lineLine = (a: Extract<RoadEl, { kind: 'line' }>, b: Extract<RoadEl, { kind: 'line' }>): RoadPt[] => {
    const ua = norm(sub(a.b, a.a)), ub = norm(sub(b.b, b.a));
    const den = cross(ua, ub);
    if (Math.abs(den) < EPS) return [];
    const na = lineNormal(a), nb = lineNormal(b);
    const pa: RoadPt = [a.a[0] + na[0] * t, a.a[1] + na[1] * t];
    const pb: RoadPt = [b.a[0] + nb[0] * t, b.a[1] + nb[1] * t];
    const s = cross(sub(pb, pa), ub) / den;
    return [[pa[0] + ua[0] * s, pa[1] + ua[1] * s]];
  };
  const lineCircle = (a: Extract<RoadEl, { kind: 'line' }>, b: Extract<RoadEl, { kind: 'arc' }>): RoadPt[] => {
    const u = norm(sub(a.b, a.a));
    const n = lineNormal(a);
    const p0: RoadPt = [a.a[0] + n[0] * t, a.a[1] + n[1] * t];
    const R = Math.hypot(b.a[0] - b.c[0], b.a[1] - b.c[1]) + b.dr * t;
    const w = sub(b.c, p0);
    const proj = dot(w, u);
    const d2 = dot(w, w) - proj * proj;
    const h2 = R * R - d2;
    if (h2 < 0) return [];
    const h = Math.sqrt(h2);
    return [
      [p0[0] + u[0] * (proj - h), p0[1] + u[1] * (proj - h)],
      [p0[0] + u[0] * (proj + h), p0[1] + u[1] * (proj + h)],
    ];
  };
  const circleCircle = (a: Extract<RoadEl, { kind: 'arc' }>, b: Extract<RoadEl, { kind: 'arc' }>): RoadPt[] => {
    const ra = Math.hypot(a.a[0] - a.c[0], a.a[1] - a.c[1]) + a.dr * t;
    const rb = Math.hypot(b.a[0] - b.c[0], b.a[1] - b.c[1]) + b.dr * t;
    const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1];
    const d = Math.hypot(dx, dy);
    if (d < EPS || d > ra + rb || d < Math.abs(ra - rb)) return [];
    const x = (d * d - rb * rb + ra * ra) / (2 * d);
    const h2 = ra * ra - x * x;
    const h = Math.sqrt(Math.max(0, h2));
    const mx = a.c[0] + (dx / d) * x, my = a.c[1] + (dy / d) * x;
    return [
      [mx + (dy / d) * h, my - (dx / d) * h],
      [mx - (dy / d) * h, my + (dx / d) * h],
    ];
  };
  let cands: RoadPt[];
  if (prev.kind === 'line' && next.kind === 'line') cands = lineLine(prev, next);
  else if (prev.kind === 'line' && next.kind === 'arc') cands = lineCircle(prev, next);
  else if (prev.kind === 'arc' && next.kind === 'line') cands = lineCircle(next, prev);
  else cands = circleCircle(prev as Extract<RoadEl, { kind: 'arc' }>, next as Extract<RoadEl, { kind: 'arc' }>);
  return cands.length > 0 ? pick(cands) : guess;
}

/** A ring's sampled outline at inset `t`: junction points (trimmed or bridged) plus each arc's
 *  interior samples between its trimmed ends. */
function ringPoints(ring: RoadEl[], junctions: Junction[], t: number): RoadPt[] {
  const n = ring.length;
  // First and last emitted point of each junction: an arc between two junctions samples its
  // interior between them.
  const joins: RoadPt[][] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n]!;
    const cur = ring[i]!;
    const j = junctions[i]!;
    if (j.kind === 'point') {
      joins.push([trimPoint(prev, cur, j.at, t)]);
      continue;
    }
    const pa = offsetEndpoint(prev, j.at, t);
    const pb = offsetEndpoint(cur, j.at, t);
    const a0 = Math.atan2(pa[1] - j.at[1], pa[0] - j.at[0]);
    let span = Math.atan2(pb[1] - j.at[1], pb[0] - j.at[0]) - a0;
    // The bridge sweeps the concave gap the short way (never more than a half turn here).
    if (span > Math.PI) span -= 2 * Math.PI;
    if (span < -Math.PI) span += 2 * Math.PI;
    const pts: RoadPt[] = [];
    for (let s = 0; s <= j.steps; s++) {
      const a = a0 + span * (s / j.steps);
      pts.push([j.at[0] + t * Math.cos(a), j.at[1] + t * Math.sin(a)]);
    }
    joins.push(pts);
  }
  const out: RoadPt[] = [];
  for (let i = 0; i < n; i++) {
    out.push(...joins[i]!);
    const el = ring[i]!;
    if (el.kind !== 'arc') continue;
    const start = joins[i]![joins[i]!.length - 1]!;
    const end = joins[(i + 1) % n]![0]!;
    const R = Math.hypot(el.a[0] - el.c[0], el.a[1] - el.c[1]) + el.dr * t;
    const s = sweepOf(el);
    const a0 = Math.atan2(start[1] - el.c[1], start[0] - el.c[0]);
    let span = (Math.atan2(end[1] - el.c[1], end[0] - el.c[0]) - a0) * s;
    span = ((span % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    for (let k = 1; k < ROAD_ARC_STEPS; k++) {
      const a = a0 + s * span * (k / ROAD_ARC_STEPS);
      out.push([el.c[0] + R * Math.cos(a), el.c[1] + R * Math.sin(a)]);
    }
  }
  return out;
}

/**
 * Every road surface on the map: `all` is the full road-tile list (the caller filters by
 * category, which core cannot see), `roads` the usual lookup over the same state.
 */
/**
 * How far a change can reach into road geometry, in cells. A tile's pieces read its immediate
 * neighbourhood — its own cut states, the neighbours it joins, the cut foreign tiles it feeds — so
 * two cells is already one more than any read; a region whose every cell is further away than this
 * from every changed cell is the region a full rebuild would produce again.
 */
const REGION_REACH = 2;

/**
 * `buildRoadRegions`, incrementally. `prev` is a previous build over the same map and `dirty` the
 * flat indices (`y * width + x`) of every cell whose road tile was added, removed or edited since;
 * regions standing beyond `REGION_REACH` of every dirty cell are handed back as-is — rings,
 * signature and all — and only the remaining tiles are re-derived. Paving one road on a map that
 * already carries thousands re-derives one surface instead of every surface on the map.
 *
 * A caller that cannot name what changed passes null for either and gets the full build. The
 * equivalence with the full build is pinned by `road-region-update.test.ts`.
 */
export function updateRoadRegions(
  prev: readonly RoadRegion[] | null,
  dirty: ReadonlySet<number> | null,
  all: readonly PlacedObject[],
  roads: RoadLookup,
  width: number,
): RoadRegion[] {
  if (!prev || !dirty) return buildRoadRegions(all, roads);
  if (dirty.size === 0 && prev.reduce((n, r) => n + r.members.length, 0) === all.length) return [...prev];
  const reachable = new Set<number>();
  for (const i of dirty) {
    const x = i % width;
    const y = Math.floor(i / width);
    for (let dy = -REGION_REACH; dy <= REGION_REACH; dy++) {
      for (let dx = -REGION_REACH; dx <= REGION_REACH; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0) continue;
        reachable.add(ny * width + nx);
      }
    }
  }
  const kept: RoadRegion[] = [];
  const keptMemberIds = new Set<string>();
  for (const region of prev) {
    if (region.cells.some((c) => reachable.has(c.y * width + c.x))) continue;
    kept.push(region);
    for (const m of region.members) keptMemberIds.add(m.id);
  }
  const rebuildTiles = all.filter((o) => !keptMemberIds.has(o.id));
  return rebuildTiles.length ? [...kept, ...buildRoadRegions(rebuildTiles, roads)] : kept;
}

export function buildRoadRegions(all: readonly PlacedObject[], roads: RoadLookup): RoadRegion[] {
  const pieces = collectPieces(all, roads);
  // Group by surface identity first, so cancellation can never join two materials.
  const groups = new Map<string, number[]>();
  pieces.forEach((piece, i) => {
    const gk = `${piece.material}@${piece.road.elevation}`;
    const list = groups.get(gk);
    if (list) list.push(i); else groups.set(gk, [i]);
  });

  const regions: RoadRegion[] = [];
  for (const indices of groups.values()) {
    // Cancel interior lines: a directed cell-side line whose exact reverse exists is a cell line
    // both sides cover — the surface continues across it. Cancelling every such pair is the
    // union. Arcs and interior diagonals never lie on a cell line, so only lines participate.
    const uf = new UnionFind(pieces.length);
    const open = new Map<number, Map<number, TaggedEl[]>>();
    const survivors: TaggedEl[] = [];
    for (const i of indices) {
      for (const el of pieces[i]!.els) {
        if (el.kind === 'line') {
          const a = pid(el.a);
          const b = pid(el.b);
          const rev = open.get(b)?.get(a);
          const match = rev?.pop();
          if (match) {
            uf.union(i, match.piece);
            continue;
          }
          const tagged = { el, piece: i };
          let from = open.get(a);
          if (!from) { from = new Map(); open.set(a, from); }
          const list = from.get(b);
          if (list) list.push(tagged); else from.set(b, [tagged]);
          continue;
        }
        survivors.push({ el, piece: i });
      }
    }
    for (const from of open.values()) for (const list of from.values()) survivors.push(...list);

    // One region per connected component of pieces.
    const byRoot = new Map<number, { pieceIdx: number[]; els: TaggedEl[] }>();
    for (const i of indices) {
      const root = uf.find(i);
      let entry = byRoot.get(root);
      if (!entry) { entry = { pieceIdx: [], els: [] }; byRoot.set(root, entry); }
      entry.pieceIdx.push(i);
    }
    for (const e of survivors) byRoot.get(uf.find(e.piece))!.els.push(e);

    for (const entry of byRoot.values()) {
      const members = new Map<string, PlacedObject>();
      const cells = new Map<string, { x: number; y: number }>();
      for (const i of entry.pieceIdx) {
        const piece = pieces[i]!;
        for (const m of piece.members) members.set(m.id, m);
        cells.set(`${piece.road.position.x},${piece.road.position.y}`, { ...piece.road.position });
      }
      const first = pieces[entry.pieceIdx[0]!]!;
      const signature = `${first.material}@${first.road.elevation}|${entry.pieceIdx
        .map((i) => {
          const { road } = pieces[i]!;
          return `${road.id}:${road.position.x},${road.position.y}:${road.corners?.join('') ?? ''}`;
        })
        .sort()
        .join('|')}`;
      regions.push({
        material: first.material,
        elevation: first.road.elevation,
        members: [...members.values()],
        cells: [...cells.values()],
        signature,
        rings: stitchRings(entry.els).map((ring) => {
          const junctions = ring.map((el, i) => junctionOf(ring[(i + ring.length - 1) % ring.length]!, el));
          return { points: (t: number) => ringPoints(ring, junctions, t) };
        }),
      });
    }
  }
  return regions;
}

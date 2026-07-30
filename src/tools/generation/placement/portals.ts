import { ItemCategory, TerrainType, type MacroCoord } from '../../../core/model/types';
import { getCell, NEIGHBORS4 } from '../../../core/model/grid-model';
import { detectBridgeSpan } from '../../../core/model/bridge-span';
import { TUNING } from '../tuning';
import { tryPlace, removePlaced, type PlaceCtx } from './object';
import { getPlaceableByCategory } from '../../../state/catalog';
import type { PlacementAnalysis } from './analysis';

/** A candidate crossing site between two buildable regions. Validity is confirmed at realization
 *  (tryPlace through the oracle); bridge portals are pre-validated by detectBridgeSpan, ramp portals are
 *  hints (the heightDrop snap is confirmed when the router uses them). */
export interface Portal {
  kind: 'bridge' | 'ramp';
  regionA: number; regionB: number;            // the two regions this links
  anchor: MacroCoord;                          // where the router calls tryPlace(bridge/ramp)
  approachA: MacroCoord; approachB: MacroCoord; // open cells in regionA / regionB to road-connect
  cost: number;                                // region-graph edge weight
}

/** A cell reached by stepping out from a boundary + its region (see `probe` below). */
type ProbeHit = { cell: MacroCoord; region: number } | null;
type Probe = (start: MacroCoord, dx: number, dy: number) => ProbeHit;
type Accept = (ra: number, rb: number, anchor: MacroCoord) => boolean;
type Commit = (p: Portal) => void;

/** BRIDGE portals: a span validated by detectBridgeSpan; its two ends' open approaches give the regions. */
function scanBridgePortals(
  state: PlaceCtx['state'], W: number, H: number, bridgeW: number, spanMin: number, spanMax: number,
  probe: Probe, accept: Accept, commit: Commit,
): void {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (getCell(state.cells, x, y)?.terrain?.type !== TerrainType.Water) continue;
    const s = detectBridgeSpan(state, { x, y }, bridgeW, spanMin, spanMax);
    if (!s) continue;
    const horiz = s.rotation === 0; // 0 → spans x, 90 → spans y
    const dx = horiz ? 1 : 0, dy = horiz ? 0 : 1;
    const negEnd: MacroCoord = horiz ? { x: s.position.x - 1, y: s.position.y } : { x: s.position.x, y: s.position.y - 1 };
    const posEnd: MacroCoord = horiz ? { x: s.position.x + s.spanLength, y: s.position.y } : { x: s.position.x, y: s.position.y + s.spanLength };
    const A = probe(negEnd, -dx, -dy), B = probe(posEnd, dx, dy);
    if (!A || !B || !accept(A.region, B.region, { x, y })) continue;
    commit({ kind: 'bridge', regionA: A.region, regionB: B.region, anchor: { x, y }, approachA: A.cell, approachB: B.cell, cost: TUNING.portalBridgeCost });
  }
}

/** RAMP portals: a LOW region edge that comes within reach of a region exactly ONE tier higher. (Only the
 *  low side is generated — the high side is the same pair, found when scanning from the low cell.) The
 *  anchor is the cliff-base cell (its neighbour toward the high region is the +1 mountain), where the
 *  heightDrop trait can snap a valid 2x4 ramp. */
function scanRampPortals(
  a: PlacementAnalysis, state: PlaceCtx['state'], W: number, H: number,
  inB: (x: number, y: number) => boolean, idx: (x: number, y: number) => number,
  probe: Probe, accept: Accept, commit: Commit,
): void {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (a.open[i] !== 1) continue;
    const here = a.region[i]!, elHere = a.elev[i]!;
    for (const [dx, dy] of NEIGHBORS4) {
      const hit = probe({ x, y }, dx, dy);
      if (!hit || hit.region === here) continue;
      const highElev = a.regionElev[hit.region] ?? 0;
      if (highElev - elHere !== 1) continue;
      let anchor: MacroCoord = { x, y };
      for (let d = 0; d <= TUNING.portalScanReach; d++) {
        const cx = x + dx * d, cy = y + dy * d, nx = cx + dx, ny = cy + dy;
        if (!inB(cx, cy)) break;
        const nc = inB(nx, ny) ? getCell(state.cells, nx, ny) : null;
        if (nc?.terrain?.type === TerrainType.Mountain && nc.terrain.elevation === highElev) { anchor = { x: cx, y: cy }; break; }
      }
      if (!accept(here, hit.region, anchor)) continue;
      commit({ kind: 'ramp', regionA: here, regionB: hit.region, anchor, approachA: { x, y }, approachB: hit.cell, cost: TUNING.portalRampCost });
    }
  }
}

/** Scan every region boundary for ford/tier-step crossing sites and build the region-adjacency graph.
 *  Deterministic (row-major scan; deduped + spread per region-pair). The two scans are independent
 *  full-grid passes sharing the probe/accept/commit closures below. */
export function scanPortals(ctx: PlaceCtx, a: PlacementAnalysis): { portals: Portal[]; regionAdj: Map<number, Portal[]> } {
  const W = a.width, H = a.height, state = ctx.state;
  const portals: Portal[] = [];

  const bridge = getPlaceableByCategory(ItemCategory.Bridge)[0];
  const bridgeSpanTrait = bridge?.traits.find((t) => t.type === 'waterSpan');
  const bridgeW = bridge?.width ?? 1;
  const spanMin = bridgeSpanTrait?.type === 'waterSpan' ? bridgeSpanTrait.min : 3;
  const spanMax = bridgeSpanTrait?.type === 'waterSpan' ? bridgeSpanTrait.max : 6;
  const bridgeId = bridge?.id;
  const rampId = getPlaceableByCategory(ItemCategory.Ramp)[0]?.id;
  const hasRamp = rampId !== undefined;

  // A portal is only kept if its crossing actually PLACES (dry-run through the oracle, then revert) — a
  // ramp portal is otherwise just an elevation hint, and an irregular cliff can fail the heightDrop snap.
  // Validating here keeps the region-adjacency graph honest, so the settlement never seeds a node in a
  // region the router can't truly reach.
  const realizable = (kind: 'bridge' | 'ramp', anchor: MacroCoord): boolean => {
    const id = kind === 'bridge' ? bridgeId : rampId;
    if (!id) return false;
    // A dry-run must not consume generated-object ids: every later real placement is
    // named `gen-<seed>-<n>`, so a probe that advances the counter couples the whole
    // id stream to how many probes happened to succeed — one flipped probe would
    // rename every subsequent object (spurious save diffs across versions).
    const n = ctx.counter.n;
    const obj = tryPlace(ctx, id, anchor.x, anchor.y);
    if (!obj) { ctx.counter.n = n; return false; }
    removePlaced(ctx, obj);
    ctx.counter.n = n;
    return true;
  };

  const idx = (x: number, y: number) => y * W + x;
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // Dedup per unordered region-pair, spread out so portals don't bunch at one spot.
  const pairAnchors = new Map<string, MacroCoord[]>();
  const key = (ra: number, rb: number) => (ra < rb ? `${ra},${rb}` : `${rb},${ra}`);
  const accept: Accept = (ra, rb, anchor) => {
    if (ra < 0 || rb < 0 || ra === rb) return false;
    const list = pairAnchors.get(key(ra, rb)) ?? [];
    if (list.length >= TUNING.maxPortalsPerPair) return false;
    return !list.some((p) => Math.abs(p.x - anchor.x) + Math.abs(p.y - anchor.y) <= TUNING.portalMinSeparation);
  };
  const commit: Commit = (p) => {
    if (!realizable(p.kind, p.anchor)) return;
    const k = key(p.regionA, p.regionB), l = pairAnchors.get(k) ?? [];
    l.push(p.anchor); pairAnchors.set(k, l); portals.push(p);
  };

  // Step out from `start` in (dx,dy) up to portalScanReach; return the first OPEN cell + its region (so we
  // see past the 1-cell eroded shore/cliff ring between regions).
  const probe: Probe = (start, dx, dy) => {
    for (let d = 1; d <= TUNING.portalScanReach; d++) {
      const x = start.x + dx * d, y = start.y + dy * d;
      if (!inB(x, y)) return null;
      if (a.open[idx(x, y)] === 1) return { cell: { x, y }, region: a.region[idx(x, y)]! };
    }
    return null;
  };

  if (bridge) scanBridgePortals(state, W, H, bridgeW, spanMin, spanMax, probe, accept, commit);
  if (hasRamp) scanRampPortals(a, state, W, H, inB, idx, probe, accept, commit);

  const regionAdj = new Map<number, Portal[]>();
  const add = (r: number, p: Portal) => { const l = regionAdj.get(r); if (l) l.push(p); else regionAdj.set(r, [p]); };
  for (const p of portals) { add(p.regionA, p); add(p.regionB, p); }
  return { portals, regionAdj };
}

/** Deterministic Dijkstra over the region-adjacency graph: the cheapest portal sequence linking `from`
 *  region to `to` region. Returns [] if same region, null if unreachable. Single-source wrapper over
 *  {@link routeRegionsMulti}. */
export function routeRegions(from: number, to: number, regionAdj: Map<number, Portal[]>): Portal[] | null {
  return routeRegionsMulti(new Set([from]), to, regionAdj);
}

/** The set of regions reachable from `start` through the portal graph (BFS). The settlement places its
 *  nodes only in these regions, so every node is road/bridge/ramp-connectable to the hub. */
export function reachableRegions(start: number, regionAdj: Map<number, Portal[]>): Set<number> {
  const seen = new Set<number>([start]);
  const q = [start];
  while (q.length) {
    const r = q.pop()!;
    for (const p of regionAdj.get(r) ?? []) { const nb = p.regionA === r ? p.regionB : p.regionA; if (!seen.has(nb)) { seen.add(nb); q.push(nb); } }
  }
  return seen;
}

/** Multi-source variant: cheapest portal sequence from ANY region in `sources` to `to`. [] if `to` is
 *  already a source, null if unreachable. (Used by the router to attach a node to the growing network.) */
export function routeRegionsMulti(sources: Set<number>, to: number, regionAdj: Map<number, Portal[]>): Portal[] | null {
  if (sources.has(to)) return [];
  const dist = new Map<number, number>();
  const prevPortal = new Map<number, Portal>();
  const prevRegion = new Map<number, number>();
  const visited = new Set<number>();
  for (const s of sources) dist.set(s, 0);
  for (;;) {
    let cur = -1, best = Infinity;
    for (const [r, d] of dist) { if (visited.has(r)) continue; if (d < best || (d === best && r < cur)) { best = d; cur = r; } }
    if (cur === -1) return null;
    if (cur === to) break;
    visited.add(cur);
    for (const p of regionAdj.get(cur) ?? []) {
      const nb = p.regionA === cur ? p.regionB : p.regionA;
      if (visited.has(nb)) continue;
      const nd = best + p.cost;
      if (nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); prevPortal.set(nb, p); prevRegion.set(nb, cur); }
    }
  }
  const path: Portal[] = [];
  let r = to;
  while (!sources.has(r)) {
    const p = prevPortal.get(r), pr = prevRegion.get(r);
    if (p === undefined || pr === undefined) return null;
    path.push(p); r = pr;
  }
  return path.reverse();
}

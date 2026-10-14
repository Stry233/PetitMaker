import { TerrainType, type MacroCoord } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { detectBridgeSpan } from '../../../core/domain/terrain/bridge-span';
import { realSurface } from '../../../core/domain/terrain/terrain-surface';
import { TUNING } from './tuning';
import { tryPlace, removePlaced, type PlaceCtx } from '../../placement/object';
import { getCatalogItem } from '../../../state/catalog';
import type { PlacementAnalysis } from '../../placement/analysis';
import { findTrait } from '../../../core/model/traits';
import { mainCrossingId, type CrossingKind } from '../../placement/crossings';
import { cellKey, mapGrid, type MapGrid } from '../../../core/grid/rect';

/** A crossing validated through placement rules, with the open regions served by its two ends. */
export interface Portal {
  kind: CrossingKind;
  /** Aimed routes retain the catalog geometry validated for this site. */
  catalogId?: string;
  regionA: number; regionB: number;            // the two regions this links
  anchor: MacroCoord;                          // where the router calls tryPlace(bridge/ramp)
  approachA: MacroCoord; approachB: MacroCoord; // open cells in regionA / regionB to road-connect
  /** Actual deck exits; an irregular bank can separate them from the conservative open mask. */
  landingA?: MacroCoord; landingB?: MacroCoord;
  cost: number;                                // region-graph edge weight
}

/** A cell reached by stepping out from a boundary + its region (see `probe` below). */
type ProbeHit = { cell: MacroCoord; region: number } | null;
type Probe = (start: MacroCoord, dx: number, dy: number) => ProbeHit;
type Accept = (ra: number, rb: number, anchor: MacroCoord) => boolean;
/** One key per unordered pair of regions. */
export const regionPairKey = (ra: number, rb: number): string => (ra < rb ? cellKey(ra, rb) : cellKey(rb, ra));

type Commit = (p: Portal) => void;

/** One portal scan: the map read once, the probe that steps across a gap, and the pair filter and
 *  sink every portal passes through. */
interface PortalScan extends MapGrid {
  a: PlacementAnalysis;
  state: PlaceCtx['state'];
  probe: Probe;
  accept: Accept;
  commit: Commit;
}

/** Bridge portals: a span validated by detectBridgeSpan; its two ends' open approaches give the regions. */
function scanBridgePortals(
  { state, W, H, probe, accept, commit }: PortalScan, { bridgeW, spanMin, spanMax }: { bridgeW: number; spanMin: number; spanMax: number },
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

/** Ramp portals: a low region edge that comes within reach of a region exactly one tier higher. (Only the
 *  low side is generated — the high side is the same pair, found when scanning from the low cell.) The
 *  anchor is the cliff-base cell (its neighbour toward the high region is the +1 mountain), where the
 *  heightDrop trait can snap a catalog-sized ramp. */
function scanRampPortals({ a, state, W, H, inB, idx, probe, accept, commit }: PortalScan): void {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    const here = a.region[i]!;
    if (here < 0) continue;
    const elHere = a.regionElev[here]!;
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
        const top = realSurface(nc?.terrain);
        if (top?.type === TerrainType.Mountain && top.elevation === highElev) { anchor = { x: cx, y: cy }; break; }
      }
      if (!accept(here, hit.region, anchor)) continue;
      commit({ kind: 'ramp', regionA: here, regionB: hit.region, anchor, approachA: { x, y }, approachB: hit.cell, cost: TUNING.portalRampCost });
    }
  }
}

/** A bounded number of crossing sites per region pair, spread in row-major order. */
export function scanPortals(
  ctx: PlaceCtx, a: PlacementAnalysis, perPair: number = TUNING.maxPortalsPerPair,
): { portals: Portal[]; regionAdj: Map<number, Portal[]> } {
  const W = a.width, H = a.height, state = ctx.state;
  const portals: Portal[] = [];

  const bridgeId = mainCrossingId('bridge');
  const bridge = bridgeId ? getCatalogItem(bridgeId) : undefined;
  const bridgeSpanTrait = findTrait(bridge, 'waterSpan');
  const rampId = mainCrossingId('ramp');
  const hasRamp = rampId !== undefined;

  // A portal is only kept if its crossing actually places (dry-run through the oracle, then revert) — a
  // ramp portal is otherwise just an elevation hint, and an irregular cliff can fail the heightDrop snap.
  // Validating here keeps the region-adjacency graph honest, so the settlement never seeds a node in a
  // region the router can't truly reach.
  const realizable = (kind: CrossingKind, anchor: MacroCoord): boolean => {
    const id = kind === 'bridge' ? bridgeId : rampId;
    if (!id) return false;
    const obj = tryPlace(ctx, id, anchor.x, anchor.y);
    if (!obj) return false;
    removePlaced(ctx, obj);
    return true;
  };

  const grid = mapGrid(W, H);
  const { idx, inB } = grid;

  // Dedup per unordered region-pair, spread out so portals don't bunch at one spot.
  const pairAnchors = new Map<string, MacroCoord[]>();
  const accept: Accept = (ra, rb, anchor) => {
    if (ra < 0 || rb < 0 || ra === rb) return false;
    const list = pairAnchors.get(regionPairKey(ra, rb)) ?? [];
    if (list.length >= perPair) return false;
    return !list.some((p) => Math.abs(p.x - anchor.x) + Math.abs(p.y - anchor.y) <= TUNING.portalMinSeparation);
  };
  const commit: Commit = (p) => {
    if (!realizable(p.kind, p.anchor)) return;
    const k = regionPairKey(p.regionA, p.regionB), l = pairAnchors.get(k) ?? [];
    l.push(p.anchor); pairAnchors.set(k, l); portals.push(p);
  };

  // Step out from `start` in (dx,dy) up to portalScanReach; return the first cell of a region + that
  // region (so we see past the 1-cell eroded shore/cliff ring between regions). Region cells are the
  // open cells, plus a hub's own footprint where it forms a region of its own.
  const probe: Probe = (start, dx, dy) => {
    for (let d = 1; d <= TUNING.portalScanReach; d++) {
      const x = start.x + dx * d, y = start.y + dy * d;
      if (!inB(x, y)) return null;
      const region = a.region[idx(x, y)]!;
      if (region >= 0) return { cell: { x, y }, region };
    }
    return null;
  };

  const scan: PortalScan = { ...grid, a, state, probe, accept, commit };
  if (bridge && bridgeSpanTrait?.type === 'waterSpan') {
    scanBridgePortals(scan, { bridgeW: bridge.width, spanMin: bridgeSpanTrait.min, spanMax: bridgeSpanTrait.max });
  }
  if (hasRamp) scanRampPortals(scan);

  return { portals, regionAdj: portalAdjacency(portals) };
}

export function portalAdjacency(portals: readonly Portal[]): Map<number, Portal[]> {
  const regionAdj = new Map<number, Portal[]>();
  const add = (r: number, p: Portal) => { const l = regionAdj.get(r); if (l) l.push(p); else regionAdj.set(r, [p]); };
  for (const p of portals) { add(p.regionA, p); add(p.regionB, p); }
  return regionAdj;
}

/** What one hop of the region graph costs. The default weighs a portal by its kind alone (`p.cost`);
 *  the roads press's variation hands in a seeded weight, and an aimed route hands in a weight that
 *  also carries how far the anchor lies off the line between the two points it was asked to join,
 *  so the cheapest chain is one that goes the right way rather than merely over the fewest bridges.
 *  Must be non-negative — Dijkstra settles a region the moment it is popped. */
export type PortalWeight = (p: Portal) => number;

/** Deterministic Dijkstra over the region-adjacency graph: the cheapest portal sequence from any region
 *  in `sources` to `to`. [] if `to` is already a source, null if unreachable. (Used by the router to
 *  attach a node to the growing network.) */
export function routeRegionsMulti(
  sources: Set<number>, to: number, regionAdj: Map<number, Portal[]>, weight: PortalWeight = (p) => p.cost,
): Portal[] | null {
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
      const nd = best + weight(p);
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

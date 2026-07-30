// src/tools/generation/crossings.ts — scarce, strategic crossings planned on the zone graph.
//
// Each adjacent zone pair gets at most ONE crossing: a ramp for a one-level dry seam, a bridge for
// a water seam. A spanning tree from the town keeps every room reachable (open same-level seams are
// free), a settlement-scaled loop budget adds circuits, and a couple of GORGE BRIDGES join
// same-height rooms across a lower seam (the rule spans any below-deck gap — water, void, or lower
// terrain). The populator realizes each crossing with dry-run validation and decorates it as a scene.
import { TUNING } from './tuning';
import { seamCells } from './zone-water';
import type { TerrainPlan, ZonePlan, PlannedCrossing, MacroCoord } from './types';

type EdgeKind = 'open' | 'ramp' | 'bridge';
interface Edge { a: number; b: number; kind: EdgeKind; at: MacroCoord; deck: number }

export function planCrossings(zp: ZonePlan, plan: TerrainPlan, settlement: number): void {
  if (zp.zones.length <= 1) return;
  const W = zp.width;
  const toCoord = (i: number): MacroCoord => ({ x: i % W, y: (i / W) | 0 });

  // Classify every adjacent pair once.
  const edges: Edge[] = [];
  const seen = new Set<string>();
  for (const [a, ns] of zp.adjacency) for (const b of ns) {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Crown terraces (nested massif steps) are scenic; we don't plan a crossing per terrace ring (they
    // rarely realize and would strand the realization ratio). The massif base joins via its own edges.
    if (zp.zones[a]!.crown || zp.zones[b]!.crown) continue;
    // BOTH sides of the seam: the water can run entirely along one zone's edge — judging from a
    // single side classifies a river seam as walkable-open and strands the far zone (no bridge).
    const seam = [...seamCells(zp, a, b), ...seamCells(zp, b, a)];
    if (!seam.length) continue;
    const la = zp.zones[a]!.level, lb = zp.zones[b]!.level;
    // Classify by the crossing SITE, not the whole seam: a river clipping one corner must not turn
    // a 20-cell walkable seam into "needs a bridge". Crossings anchor on the DRY stretch (walk or
    // ramp); bridges anchor on GROUND-level water only — elevated channels sit at their banks'
    // height (containment demands it), so they are not a below-deck gap and CANNOT be bridged: a
    // fully elevated-wet seam is a wall. A dry-crossable seam over a ground river ALSO offers a
    // bridge edge (a scenic loop candidate over the water).
    const dry = seam.filter((i) => plan.water[i]! < 0);
    const wet0 = seam.filter((i) => plan.water[i] === 0);
    const dryAt = dry.length ? toCoord(dry[Math.floor(dry.length / 2)]!) : null;
    const wetAt = wet0.length ? toCoord(wet0[Math.floor(wet0.length / 2)]!) : null;
    if (dryAt && dry.length >= 3) {
      if (la === lb) edges.push({ a, b, kind: 'open', at: dryAt, deck: la });
      else if (Math.abs(la - lb) === 1) edges.push({ a, b, kind: 'ramp', at: dryAt, deck: Math.max(la, lb) });
      if (wetAt) edges.push({ a, b, kind: 'bridge', at: wetAt, deck: Math.max(la, lb) }); // scenic loop option
    } else if (wetAt) {
      edges.push({ a, b, kind: 'bridge', at: wetAt, deck: Math.max(la, lb) });
    }
    // else: sheer wall or elevated-only channel — deliberately uncrossed (a sheer island-builder cliff face)
  }

  // Spanning tree from the town zone: open seams first (free), then ramps, then bridges.
  const cost: Record<EdgeKind, number> = { open: 0, ramp: 1, bridge: 2 };
  const linked = new Set([0]);
  const picked: Edge[] = [];
  for (let guard = 0; guard < zp.zones.length && linked.size < zp.zones.length; guard++) {
    let best: Edge | null = null;
    for (const e of edges) {
      const fresh = (linked.has(e.a) && !linked.has(e.b)) || (linked.has(e.b) && !linked.has(e.a));
      if (!fresh) continue;
      if (!best || cost[e.kind] < cost[best.kind] || (cost[e.kind] === cost[best.kind] && e.a + e.b < best.a + best.b)) best = e;
    }
    if (!best) break; // remaining zones are walled off entirely — allowed (cliff faces)
    linked.add(best.a); linked.add(best.b);
    if (best.kind !== 'open') picked.push(best);
  }

  // Loop budget scales with settlement: circuits, not spokes — but still scarce.
  let loops = TUNING.loopCrossingBase + Math.round(settlement * TUNING.loopCrossingPerSettlement);
  const byCost = [...edges].sort((p, q) => cost[p.kind] - cost[q.kind] || (p.a + p.b) - (q.a + q.b));
  for (const e of byCost) {
    if (loops <= 0) break;
    if (e.kind === 'open' || picked.includes(e)) continue;
    if (linked.has(e.a) && linked.has(e.b)) { picked.push(e); loops--; }
  }

  // Gorge bridges: same-height rooms separated by a strictly LOWER dry seam (the canyon vignette).
  let gorges = TUNING.gorgeBridgeMax;
  for (const [a, ns] of zp.adjacency) {
    if (gorges <= 0) break;
    for (const b of ns) {
      if (gorges <= 0) break;
      if (a >= b) continue;
      if (zp.zones[a]!.crown || zp.zones[b]!.crown) continue; // crown terraces aren't gorge candidates
      const la = zp.zones[a]!.level, lb = zp.zones[b]!.level;
      if (la !== lb || la < 1) continue;
      if (picked.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) continue;
      const seam = [...seamCells(zp, a, b), ...seamCells(zp, b, a)].filter((i) => plan.tier[i]! < la && plan.water[i]! < 0);
      if (seam.length < 2) continue;
      picked.push({ a, b, kind: 'bridge', at: toCoord(seam[Math.floor(seam.length / 2)]!), deck: la });
      gorges--;
    }
  }

  zp.crossings = picked.map((e): PlannedCrossing => ({
    kind: e.kind === 'ramp' ? 'ramp'
      : (e.deck >= 1 && zp.zones[e.a]!.level === zp.zones[e.b]!.level ? 'gorge-bridge' : 'bridge'),
    a: e.a, b: e.b, at: e.at, deckLevel: e.deck,
  }));
}

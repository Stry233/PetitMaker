// src/tools/generation/zone-water.ts — the island's water story on the zone plan.
//
// water mode: zone seams flood into channels → a designed archipelago of flat room-islets, every
// channel sized from the LIVE bridge rule so it stays spannable.
// mixed mode: lake zones (flooded rooms keeping a bridgeable island) + a river traced along zone
// seams from the peak toward a lake/the coast. The terrain-following course (zone-water-course)
// upgrades the water story with terrace channels + waterfalls after certification; the base trace
// here is the ground body it feeds.
// earth mode: dry — rooms separate by cliffs and hedges instead.
import { makeRng, type Rng } from '../../core/model/rng';
import { TUNING } from './tuning';
import { NEIGHBORS4, distanceField } from '../../core/model/grid-model';
import { ItemCategory } from '../../core/model/types';
import { getPlaceableByCategory } from '../../state/catalog';
import { geoStyle, type GeoStyle } from './style';
import type { ShapingParams, ZonePlan } from './types';

/** Live span range from the bridge catalog (waterSpan trait) — channel widths derive from the RULE,
 *  so a future rule change reshapes generation without a code change. */
function bridgeSpanRange(): { min: number; max: number } {
  const b = getPlaceableByCategory(ItemCategory.Bridge)[0];
  const t = b?.traits.find((q) => q.type === 'waterSpan') as { min?: number; max?: number } | undefined;
  return { min: t?.min ?? 3, max: t?.max ?? 6 };
}

export function buildZoneWater(zp: ZonePlan, p: ShapingParams, seed: number): Int8Array {
  const W = zp.width, H = zp.height;
  const water = new Int8Array(W * H).fill(-1);
  if (p.waterCoverage <= 0 && p.riverDensity <= 0) return water; // earth mode: dry
  const rng = makeRng(seed ^ 0x3aa9);
  const style = geoStyle(p.naturalness);
  const { min: spanMin, max: spanMax } = bridgeSpanRange();
  const chW = Math.min(spanMax - 1, spanMin + TUNING.channelWidthPad);

  if (p.mtnCapTier <= 0) {
    // WATER MODE: flood zone seams into channels → a designed archipelago. SEED VARIETY: ~a quarter
    // of seams stay dry (zones merge into bigger, odd-shaped islets) and some maps flood a whole
    // border zone into a BAY — so no two seeds read alike. Every wet seam carries the same channel
    // width (sized from the live bridge span so crossings stay plannable).
    const dry = new Set<string>();
    for (const [a, ns] of zp.adjacency) for (const b of ns) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!dry.has(key) && rng.float() < TUNING.waterDrySeamChance) dry.add(key);
    }
    for (let i = 0; i < zp.zoneOf.length; i++) {
      if (zp.zoneOf[i]! < 0) continue;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nz = zp.zoneOf[ny * W + nx]!;
        if (nz < 0 || nz === zp.zoneOf[i]) continue;
        const a0 = Math.min(zp.zoneOf[i]!, nz), b0 = Math.max(zp.zoneOf[i]!, nz);
        if (dry.has(`${a0},${b0}`)) continue;
        water[i] = 0;
        break;
      }
    }
    widen(water, zp, Math.ceil((chW + 1) / 2), style);
    if (rng.float() < TUNING.waterBayChance) { // the BAY: one border zone floods into open sea
      const bay = zp.zones.find((z) => z.bordersMap && z.id !== 0 && z.theme !== 'peak');
      if (bay) for (const i of bay.cells) if (rng.float() < TUNING.waterBayFloodChance) water[i] = 0;
    }
    return water;
  }

  // MIXED: lake zones + the seam river(s). SEED VARIETY: lake count 1-3 with per-lake rim width
  // (full ponds vs ringed pools), and one OR two rivers with their own channel widths — some maps
  // are lake-lands, others are river-lands.
  const lakeN = Math.max(1, Math.min(3, Math.round(p.waterCoverage * 2 + rng.float() * 2)));
  const lakeZones = zp.zones.filter((z) => !['town', 'peak'].includes(z.theme) && z.level === 0 && !z.bordersMap).slice(0, lakeN);
  for (const z of lakeZones) {
    z.theme = 'lake';
    const rim = 2 + rng.int(2); // 2 = broad pond, 3 = ringed pool with a wide walkable shore
    const cf = distanceField(boundaryCells(zp, z.id), W, H, style.rect); // rect style: square-cornered rim
    for (const i of z.cells) if (cf[i]! >= rim) water[i] = 0;
    let deep = z.cells[0]!, dd = -1;
    for (const i of z.cells) if (cf[i]! > dd) { dd = cf[i]!; deep = i; }
    if (dd >= rim + 2) {
      const ix = deep % W, iy = (deep / W) | 0;
      for (const i of z.cells) { // raised island at the deepest point — a destination to bridge
        const x = i % W, y = (i / W) | 0;
        if (Math.hypot(x - ix, y - iy) <= 1.5) water[i] = -1;
      }
    }
  }
  if (p.riverDensity > 0) {
    seamRiver(zp, water, rng, spanMin + rng.int(TUNING.channelWidthPad + 1), style);
    if (p.riverDensity > 0.45 && rng.float() < TUNING.waterSecondRiverChance) seamRiver(zp, water, rng, spanMin, style); // a second, narrower river
  }

  // Guarantee: a MIXED map always has water (small/irregular masks can leave no eligible lake
  // zone and a degenerate river) — flood the largest non-town ground zone as a fallback lake.
  if (!water.includes(0)) {
    const z = [...zp.zones].filter((q) => q.id !== 0 && q.level === 0).sort((a, b) => b.cells.length - a.cells.length)[0];
    if (z) {
      z.theme = 'lake';
      const cf = distanceField(boundaryCells(zp, z.id), W, H, style.rect);
      for (const i of z.cells) if (cf[i]! >= 2) water[i] = 0;
    }
  }
  return water;
}

/** Grow existing water outward by `r` rings (stays inside the grass mask); square-ended in the
 *  rectilinear style (Chebyshev dilation keeps channel ends and elbows squared off). */
function widen(water: Int8Array, zp: ZonePlan, r: number, style: GeoStyle): void {
  const seeds: number[] = [];
  for (let i = 0; i < water.length; i++) if (water[i] === 0) seeds.push(i);
  if (!seeds.length) return;
  const d = distanceField(seeds, zp.width, zp.height, style.rect);
  for (let i = 0; i < water.length; i++) if (zp.zoneOf[i]! >= 0 && d[i]! <= r - 1) water[i] = 0;
}

/** Cells of zone `zid` that touch a different zone or the void (its boundary ring). */
function boundaryCells(zp: ZonePlan, zid: number): number[] {
  const W = zp.width, H = zp.height, out: number[] = [];
  for (const i of zp.zones[zid]!.cells) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || zp.zoneOf[ny * W + nx] !== zid) { out.push(i); break; }
    }
  }
  return out;
}

/** Shared seam cells between adjacent zones a and b (cells of a touching b). */
export function seamCells(zp: ZonePlan, a: number, b: number): number[] {
  const W = zp.width, H = zp.height, out: number[] = [];
  for (const i of zp.zones[a]!.cells) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && zp.zoneOf[ny * W + nx] === b) { out.push(i); break; }
    }
  }
  return out;
}

/** The river: route over the zone graph from the peak zone to a lake/border zone; carve each
 *  hop's seam as a ground channel and pull the route through the zone interiors as a winding
 *  thread (so the river crosses rooms, not just outlines). Marks riverside zones.
 *  The style's axisDrift makes the walk axis-sticky: 0 = per-step coin flip (organic wiggle),
 *  0.5 = hold each axis until it exhausts (clean L-shaped doglegs at naturalness 0). */
function seamRiver(zp: ZonePlan, water: Int8Array, rng: Rng, chW: number, style: GeoStyle): void {
  const W = zp.width;
  // source: the peak or any high zone; target: a lake or a border zone — picked per call, so a
  // second river takes a different course than the first.
  const highs = zp.zones.filter((z) => z.level >= 1).sort((a, b) => b.level - a.level || a.id - b.id);
  const peak = highs.length ? highs[rng.int(Math.min(3, highs.length))] : zp.zones[zp.zones.length - 1];
  const targets = zp.zones.filter((z) => z.theme === 'lake' || (z.bordersMap && z.id !== 0));
  const target = targets.length ? targets[rng.int(targets.length)] : undefined;
  if (!peak || !target || peak.id === target.id) return;
  const prev = new Map<number, number>([[peak.id, -1]]);
  let frontier = [peak.id];
  while (frontier.length && !prev.has(target.id)) {
    const next: number[] = [];
    for (const z of frontier) for (const n of zp.adjacency.get(z) ?? []) if (!prev.has(n)) { prev.set(n, z); next.push(n); }
    frontier = next;
  }
  if (!prev.has(target.id)) return;
  const route: number[] = [];
  for (let z: number = target.id; z !== -1; z = prev.get(z)!) route.unshift(z);

  // Waypoints: zone centroids along the route + the mid seam cell of each hop; connect with a
  // jittered line walk → a winding thread through the rooms.
  const points: number[] = [];
  for (let h = 0; h < route.length; h++) {
    const z = zp.zones[route[h]!]!;
    points.push(z.centroid.y * W + z.centroid.x);
    if (h + 1 < route.length) {
      const seam = seamCells(zp, route[h]!, route[h + 1]!);
      if (seam.length) points.push(seam[Math.floor(seam.length / 2)]!);
    }
    zp.zones[route[h]!]!.riverside = true;
    if (z.theme === 'park') z.theme = 'garden';
  }
  for (let k = 0; k + 1 < points.length; k++) {
    let x = points[k]! % W, y = (points[k]! / W) | 0;
    const tx = points[k + 1]! % W, ty = (points[k + 1]! / W) | 0;
    let onX = Math.abs(tx - x) >= Math.abs(ty - y); // the axis the walk is currently holding
    for (let guard = 0; guard < 400 && (x !== tx || y !== ty); guard++) {
      // The course is a GROUND canyon (elevation-0 water is containment-trivial and certifies).
      // A whole at-level channel cannot work: the river travels along seams, where one bank is
      // always the LOWER room — illegal containment for its entire length. Elevated water comes
      // from the terraced course units carved after certification instead.
      if (zp.zoneOf[y * W + x]! >= 0) {
        water[y * W + x] = 0;
        zp.river.push({ x, y, level: 0, fall: false });
      }
      const dx = Math.sign(tx - x), dy = Math.sign(ty - y);
      if (dx !== 0 && dy !== 0) {
        // pX biases toward the held axis by the style's drift (0 → the classic 50/50 wiggle).
        const pX = 0.5 + (onX ? style.axisDrift : -style.axisDrift);
        onX = rng.float() < pX;
      } else onX = dx !== 0;
      if (onX) x += dx; else y += dy;
    }
  }
  widen(water, zp, Math.ceil(chW / 2), style);
}

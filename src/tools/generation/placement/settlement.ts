import { ItemCategory, type CatalogItem, type MacroCoord } from '../../../core/model/types';
import type { ZonePlan } from '../types';
import { completeBuildingSet, decorateZone, plantHedges } from './themes';
import { getCatalogItem, getPlaceableByCategory } from '../../../state/catalog';
import { makeRng, type Rng } from '../../../core/model/rng';
import { TUNING } from '../tuning';
import { objectRect, getRotatedSize } from '../../../state/object-geometry';
import { tryPlace, openAt, markCells as markFootprint, type PlaceCtx } from './object';
import type { PlacementAnalysis } from './analysis';
import { reachableRegions, type Portal } from './portals';
import { centroid, bySizeDesc, nearestRegionCell } from '../geometry';

/** A point the network connects, tagged with its buildable region + district role. */
export interface Node {
  kind: 'hub' | 'civic' | 'hamlet' | 'poi' | 'edge';
  pos: MacroCoord;
  region: number;
}

export interface SettlementResult {
  settled: Set<string>; // footprint cells "x,y" (for nature's wild↔settled gradient)
  nodes: Node[];        // hub + hamlets + civic landmarks + POIs + edge, for the network to connect
}

const FAR = 30000; // analysis.distToWater sentinel for "no water"

/** The hub/core prologue shared by both settlement paths: the plaza-anchored hub node, the reachable
 *  region set, the buildable-cell list, the building pools, and the village core ring of homes. */
interface SettleCore {
  settled: Set<string>;
  nodes: Node[];
  W: number;
  H: number;
  rng: Rng;
  center: MacroCoord;
  regAt: (p: MacroCoord) => number;
  reachable: Set<number>;
  openCells: number[];
  uniques: CatalogItem[];
  stalls: CatalogItem[];
  uq: number;         // uniques consumed so far (advanced by the core ring; the unzoned path continues it)
  hubCells: number[];
}

/** Build the shared prologue: hub node + reachability + building pools + the plaza core ring. Returns null
 *  when there is nothing to settle (settlement disabled or no ranked regions). */
function settleCore(ctx: PlaceCtx, a: PlacementAnalysis, settlement: number, regionAdj: Map<number, Portal[]>): SettleCore | null {
  const settled = new Set<string>();
  const nodes: Node[] = [];
  const W = a.width, H = a.height;
  if (settlement <= 0 || !a.rankedRegions.length) return null;
  const rng = makeRng(ctx.seed ^ 0x5e771e);

  // Hub = the plaza centre (snapped into the largest region) or that region's centroid.
  const hubRegion = a.rankedRegions[0]!;
  const hubCells = a.regionCells[hubRegion]!;
  let center = centroid(hubCells, W);
  const plaza = [...ctx.state.objects.values()].find((o) => o.locked);
  let plazaHeart = false;
  if (plaza) {
    const r = objectRect(plaza);
    const pc = { x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) };
    if (a.region[pc.y * W + pc.x] === hubRegion || nearRegion(pc, hubRegion, a)) { center = pc; plazaHeart = true; }
  }
  if (!plazaHeart && a.region[center.y * W + center.x] !== hubRegion) center = nearestRegionCell(center, hubCells, W);
  const regAt = (p: MacroCoord): number => { const r = a.region[p.y * W + p.x]; return r !== undefined && r >= 0 ? r : hubRegion; };
  nodes.push({ kind: 'hub', pos: center, region: regAt(center) });

  // Restrict every other node to regions the portal graph can actually reach from the hub, so each is
  // road/bridge/ramp-connectable (no orphan hamlet stranded on an unbridgeable island or unrampable cliff).
  const reachable = reachableRegions(regAt(center), regionAdj);
  const openCells: number[] = [];
  for (let i = 0; i < a.open.length; i++) { const r = a.region[i]; if (a.open[i] === 1 && r !== undefined && r >= 0 && reachable.has(r)) openCells.push(i); }

  // Building pool: unique cabins are the "main houses" (core + hamlet anchors), the rest market stalls.
  const uniques = getPlaceableByCategory(ItemCategory.Building).filter((b) => b.maxCount === 1);
  const stalls = getPlaceableByCategory(ItemCategory.Building).filter((b) => b.maxCount !== 1);
  let uq = 0;

  // VILLAGE CORE: a ring around the plaza, facing it — the town has a real centre to arrive at,
  // not just satellites. ONE landmark cabin anchors it; the rest of the ring is market stalls, so
  // the other unique cabins spread to hamlet anchors ACROSS the island (homes are landmarks — a
  // centre that hoards them leaves the rest of the map anonymous).
  const plazaR = plaza ? objectRect(plaza) : null;
  const coreRing = plazaR ? Math.ceil(Math.max(plazaR.w, plazaR.h) / 2) + TUNING.coreRingPad : TUNING.coreRadius;
  const coreN = Math.max(0, Math.round(TUNING.coreBuildingsBase + settlement * TUNING.coreBuildingsPerSettlement));
  for (let k = 0; k < coreN; k++) {
    const item = k === 0 && uq < uniques.length ? uniques[uq++]!
      : stalls.length ? stalls[rng.int(stalls.length)]!
      : uq < uniques.length ? uniques[uq++]! : null;
    if (!item) break;
    placeAround(ctx, a, item, center, coreRing, settled, rng);
  }

  return { settled, nodes, W, H, rng, center, regAt, reachable, openCells, uniques, stalls, uq, hubCells };
}

/** ZONE PATH (the designed island): each room is decorated in its theme's character, and each
 *  themed room becomes a network node so the roads visit every part of the design. */
function placeZoneSettlement(ctx: PlaceCtx, a: PlacementAnalysis, settlement: number, zonePlan: ZonePlan, core: SettleCore): void {
  const { settled, nodes, W, H, rng, regAt, reachable, openCells } = core;
  const themed = new Set(['hamlet', 'orchard', 'farm', 'garden']);
  for (const zone of zonePlan.zones) {
    decorateZone(ctx, a, zone, settlement, 0.6, settled, rng);
    if (zone.id === 0) continue;
    const w = nearestOpenTo(zone.centroid, a);
    if (!w) continue;
    const r = a.region[w.y * W + w.x]!;
    if (r < 0 || !reachable.has(r)) continue;
    // ACCESSIBILITY REGULATION: every non-lake room becomes a network node — the road/portal
    // spanning tree must reach it, so no part of the design is walled off from the player.
    if (themed.has(zone.theme)) nodes.push({ kind: 'hamlet', pos: w, region: r });
    else nodes.push({ kind: 'poi', pos: w, region: r });
  }
  completeBuildingSet(ctx, a, zonePlan, settled, rng); // regulation: the full catalog of buildings appears
  plantHedges(ctx, a, zonePlan, settled, rng);
  const edgeZ = nearestOpenToBorder(openCells, W, H);
  if (edgeZ) nodes.push({ kind: 'edge', pos: edgeZ, region: regAt(edgeZ) });
}

/** UNZONED PATH — the live path for maps WITHOUT a ZonePlan (hand-built terrain and maze maps): a
 *  distributed hamlet network via farthest-point hamlet sites, civic facility landmarks, and a couple
 *  of POIs. Its components are also reused by the AI agent's director tools. */
function placeUnzonedSettlement(ctx: PlaceCtx, a: PlacementAnalysis, settlement: number, core: SettleCore): void {
  const { settled, nodes, W, H, rng, center, regAt, reachable, openCells, uniques, stalls, hubCells } = core;
  let uq = core.uq;

  // Hamlet sites: farthest-point sampling (seeded by the hub so hamlets spread away from the plaza),
  // across reachable regions. The whole count scales with `settlement` (not just the area term) so it
  // responds on small maps too, where buildable-cell-count alone barely moves the dial. Sample from
  // INTERIOR cells only (≥ edge margin from the border) so farthest-point doesn't shove hamlets into the
  // map corners — the village reads as inland, with only roads reaching the edges.
  const hamletCount = Math.max(0, Math.min(TUNING.hamletCountMax, Math.round(settlement * (TUNING.hamletCountBase + openCells.length * TUNING.hamletCountPerArea))));
  const m = TUNING.placementEdgeMargin;
  const interior = openCells.filter((i) => { const x = i % W, y = (i / W) | 0; return Math.min(x, W - 1 - x, y, H - 1 - y) >= m; });
  const sites = farthestPointSample(interior.length >= hamletCount ? interior : openCells, center, hamletCount, a);
  for (const site of sites) {
    nodes.push({ kind: 'hamlet', pos: site, region: regAt(site) });
    const target = TUNING.hamletClusterMin + rng.int(TUNING.hamletClusterMax - TUNING.hamletClusterMin + 1);
    // Only anchor on open cells of a reachable region, so each home sits on connectable ground (a flat but
    // non-interior cliff-edge cell isn't in any region and its door spur can never reach the network).
    const slots = discSlots(site, TUNING.hamletClusterRadius, rng).filter((s) => { const i = s.y * W + s.x; return s.x >= 0 && s.y >= 0 && s.x < W && s.y < H && a.open[i] === 1 && reachable.has(a.region[i]!); });
    let placed = 0;
    // Anchor cabin: try a fresh unique across the disc, consume it on success and SKIP it on failure — a
    // consumed unique is never re-tried, so a cabin too big for this pocket can't jam the cluster.
    if (uq < uniques.length) {
      if (slots.some((slot) => placeBuilding(ctx, uniques[uq]!, slot, site, settled))) placed++;
      uq++;
    }
    // Fill out the cluster with small, reliable stalls.
    for (const slot of slots) {
      if (placed >= target || !stalls.length) break;
      if (placeBuilding(ctx, stalls[rng.int(stalls.length)]!, slot, site, settled)) placed++;
    }
    // Garden ring: flora + a few trees framing the homes (so a hamlet isn't bare buildings).
    scatterPlants(ctx, a, site, TUNING.gardenRadius, TUNING.gardenDensity, Infinity, TUNING.gardenTreeChance, settled, rng);
    // Farmland: a crop field (rows of one flora species) and an orchard (a grid of one fruit tree) make
    // the hamlet read as a working farmstead — developed land, not decoration.
    if (rng.float() < TUNING.fieldChance) plantField(ctx, a, site, settled, rng);
    if (rng.float() < TUNING.orchardChance) plantOrchard(ctx, a, site, settled, rng);
  }

  // Civic landmarks: facilities (largest-first; station excluded by getPlaceableByCategory as ruleTBD) at meaningful
  // spots — pavilion by water, others near the hub. Each becomes a civic node.
  const waterside = nearestOpenToWater(openCells, a, W);
  const radius = Math.sqrt(hubCells.length / Math.PI);
  for (const f of [...getPlaceableByCategory(ItemCategory.Facility)].sort(bySizeDesc)) {
    const tgt = f.id.includes('pavilion') && waterside ? waterside : center;
    const pos = placeAround(ctx, a, f, tgt, Math.max(3, radius * TUNING.civicRadiusFrac), settled, rng);
    if (pos) nodes.push({ kind: 'civic', pos, region: regAt(pos) });
  }

  // POIs: a plateau lookout + a waterside clearing, each a composed flora/tree scene the road reaches.
  const lookout = highestRegionCenter(a, W, reachable);
  if (lookout) { scatterPlants(ctx, a, lookout, TUNING.poiRadius, 1, TUNING.poiClusterMax, TUNING.poiTreeChance, settled, rng); nodes.push({ kind: 'poi', pos: lookout, region: regAt(lookout) }); }
  if (waterside) { scatterPlants(ctx, a, waterside, TUNING.poiRadius, 1, TUNING.poiClusterMax, TUNING.poiTreeChance, settled, rng); nodes.push({ kind: 'poi', pos: waterside, region: regAt(waterside) }); }

  // ISLAND POI: a small reachable region whose cells all sit at the waterline is the lake island the
  // terrain stage raised — make it a destination (a composed scene the spanning tree will BRIDGE to).
  for (const r of a.rankedRegions) {
    const cells = a.regionCells[r]!;
    if (cells.length < 3 || cells.length > 60 || !reachable.has(r) || a.regionElev[r] !== 0) continue;
    if (!cells.every((i) => a.distToWater[i]! <= 3)) continue;
    const isle = nearestRegionCell(centroid(cells, W), cells, W);
    scatterPlants(ctx, a, isle, TUNING.poiRadius, 1, TUNING.poiClusterMax, TUNING.poiTreeChance, settled, rng);
    nodes.push({ kind: 'poi', pos: isle, region: r });
    break;
  }

  // External-road target: the open cell nearest a map border (the "way out of town").
  const edge = nearestOpenToBorder(openCells, W, H);
  if (edge) nodes.push({ kind: 'edge', pos: edge, region: regAt(edge) });
}

/** Seed a believable little region as a DISTRIBUTED hamlet network: a hub (plaza), a few small home
 *  clusters spread across the buildable land, facility landmarks, and a couple of POIs — returned as
 *  nodes for the network stage to connect with roads/bridges/ramps. A thin dispatcher: it builds the
 *  shared core, then runs the zone path (a threaded ZonePlan with >1 zone) or the unzoned path. */
export function placeSettlement(ctx: PlaceCtx, a: PlacementAnalysis, settlement: number, regionAdj: Map<number, Portal[]>, zonePlan?: ZonePlan): SettlementResult {
  const core = settleCore(ctx, a, settlement, regionAdj);
  if (!core) return { settled: new Set<string>(), nodes: [] };
  if (zonePlan && zonePlan.zones.length > 1) placeZoneSettlement(ctx, a, settlement, zonePlan, core);
  else placeUnzonedSettlement(ctx, a, settlement, core);
  return { settled: core.settled, nodes: core.nodes };
}

// ── node-site selection ──────────────────────────────────────────────────────

/** Greedy site sampling over open cells, seeded by `seed`. A site's score is its spread term
 *  (min-dist-to-chosen, SATURATED at a cap so spacing stops dominating once satisfied) × a soft border
 *  factor × a DESIRABILITY factor: elevated ground (hillside terraces) and waterline views score higher —
 *  a community picks its sites for the view, it doesn't sprawl to the map corners. Deterministic. */
function farthestPointSample(openCells: number[], seed: MacroCoord, count: number, a: PlacementAnalysis): MacroCoord[] {
  const W = a.width, H = a.height;
  const chosen: MacroCoord[] = [seed];
  const out: MacroCoord[] = [];
  const soft = TUNING.placementEdgeMargin * 2, spacing2 = TUNING.hamletSpacing * TUNING.hamletSpacing;
  const spreadCap = spacing2 * TUNING.siteSpreadCap * TUNING.siteSpreadCap;
  for (let n = 0; n < count; n++) {
    let bestCell = -1, bestScore = -1, bestMd = 0;
    for (const i of openCells) {
      const x = i % W, y = (i / W) | 0;
      let md = Infinity;
      for (const c of chosen) { const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y); if (d < md) md = d; }
      const view = 1
        + (a.elev[i]! >= 1 ? TUNING.siteTerraceBonus : 0)
        + (a.distToWater[i]! >= 2 && a.distToWater[i]! <= 8 ? TUNING.siteWaterViewBonus : 0);
      const score = Math.min(md, spreadCap) * Math.min(Math.min(x, W - 1 - x, y, H - 1 - y), soft) * view;
      if (score > bestScore || (score === bestScore && i < bestCell)) { bestScore = score; bestCell = i; bestMd = md; }
    }
    if (bestCell < 0 || bestMd < spacing2) break;
    const site = { x: bestCell % W, y: (bestCell / W) | 0 };
    chosen.push(site); out.push(site);
  }
  return out;
}

/** Nearest open cell to a point (zone centroids can sit on water/cliff edges). */
function nearestOpenTo(p: MacroCoord, a: PlacementAnalysis): MacroCoord | null {
  let best: MacroCoord | null = null, bd = Infinity;
  for (let i = 0; i < a.open.length; i++) {
    if (a.open[i] !== 1) continue;
    const x = i % a.width, y = (i / a.width) | 0;
    const d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
}

function nearestOpenToWater(openCells: number[], a: PlacementAnalysis, W: number): MacroCoord | null {
  let best = -1, bd = Infinity;
  for (const i of openCells) { const d = a.distToWater[i]!; if (d < bd) { bd = d; best = i; } }
  return best < 0 || bd >= FAR ? null : { x: best % W, y: (best / W) | 0 };
}

function nearestOpenToBorder(openCells: number[], W: number, H: number): MacroCoord | null {
  let best = -1, bd = Infinity;
  for (const i of openCells) {
    const x = i % W, y = (i / W) | 0, d = Math.min(x, W - 1 - x, y, H - 1 - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best < 0 ? null : { x: best % W, y: (best / W) | 0 };
}

/** Central cell of the highest-tier REACHABLE region at/above the lookout threshold (null if none) — so
 *  the lookout sits on a plateau the router can ramp up to, not an isolated peak. */
function highestRegionCenter(a: PlacementAnalysis, W: number, reachable: Set<number>): MacroCoord | null {
  let bestReg = -1, bestElev = -1;
  for (let r = 0; r < a.regionElev.length; r++) {
    const e = a.regionElev[r]!;
    if (e >= TUNING.poiLookoutMinTier && e > bestElev && reachable.has(r)) { bestElev = e; bestReg = r; }
  }
  if (bestReg < 0) return null;
  const cells = a.regionCells[bestReg]!;
  return nearestRegionCell(centroid(cells, W), cells, W);
}

// ── placement helpers ────────────────────────────────────────────────────────

function tryPlaceMarked(ctx: PlaceCtx, id: string, x: number, y: number, rot: 0 | 90 | 180 | 270, settled: Set<string>): boolean {
  const obj = tryPlace(ctx, id, x, y, rot);
  if (obj) { markFootprint(obj, settled); return true; }
  return false;
}

/** Place `item` centred on `slot` (facing `face`); returns its top-left coord, or null if it doesn't fit. */
function placeBuilding(ctx: PlaceCtx, item: CatalogItem, slot: MacroCoord, face: MacroCoord, settled: Set<string>): MacroCoord | null {
  const rot = item.rotatable ? faceToward(slot.x, slot.y, face.x, face.y) : 0;
  const sz = getRotatedSize(item, rot);
  const px = slot.x - Math.floor(sz.w / 2), py = slot.y - Math.floor(sz.h / 2);
  return separated(item.id, px, py, rot, settled) && tryPlaceMarked(ctx, item.id, px, py, rot, settled) ? { x: px, y: py } : null;
}

/** Anchor an item near `target` (first valid jittered disc slot wins, facing the target), else null. */
function placeAround(ctx: PlaceCtx, a: PlacementAnalysis, item: CatalogItem, target: MacroCoord, radius: number, settled: Set<string>, rng: Rng): MacroCoord | null {
  for (const slot of discSlots(target, radius, rng)) {
    if (!openAt(a, slot.x, slot.y)) continue; // stays on buildable cells INSIDE any selected region
    const p = placeBuilding(ctx, item, slot, target, settled); if (p) return p;
  }
  return null;
}


/** Scatter 1x1 plants over a disc — flora by default, a tree at `treeChance`. `density` is the per-slot
 *  chance to plant, `cap` the hard limit. Used for hamlet gardens (density-driven) + POI scenes (capped). */
function scatterPlants(ctx: PlaceCtx, a: PlacementAnalysis, center: MacroCoord, radius: number, density: number, cap: number, treeChance: number, settled: Set<string>, rng: Rng): void {
  const flora = getPlaceableByCategory(ItemCategory.Flora), trees = getPlaceableByCategory(ItemCategory.Tree);
  if (!flora.length && !trees.length) return;
  let n = 0;
  for (const slot of discSlots(center, radius, rng)) {
    if (n >= cap) break;
    if (!openAt(a, slot.x, slot.y)) continue;
    if (rng.float() >= density) continue;
    const pool = trees.length && rng.float() < treeChance ? trees : (flora.length ? flora : trees);
    const sp = pool[rng.int(pool.length)]!;
    if (separated(sp.id, slot.x, slot.y, 0, settled) && tryPlaceMarked(ctx, sp.id, slot.x, slot.y, 0, settled)) n++;
  }
}

/** A crop field: alternate-row planting of ONE flora species in a small rect near the hamlet —
 *  crop rows with walkable gaps. Tries a few anchor spots; partial rows are fine (terrain decides). */
function plantField(ctx: PlaceCtx, a: PlacementAnalysis, site: MacroCoord, settled: Set<string>, rng: Rng): void {
  const flora = getPlaceableByCategory(ItemCategory.Flora);
  if (!flora.length) return;
  const species = flora[rng.int(flora.length)]!;
  for (let t = 0; t < TUNING.fieldTries; t++) {
    const ang = rng.float() * Math.PI * 2, d = TUNING.gardenRadius + 2 + rng.int(3);
    const x0 = Math.round(site.x + Math.cos(ang) * d), y0 = Math.round(site.y + Math.sin(ang) * d);
    let planted = 0;
    for (let yy = 0; yy < TUNING.fieldH; yy += 2) {
      for (let xx = 0; xx < TUNING.fieldW; xx++) {
        const px = x0 + xx, py = y0 + yy;
        if (!openAt(a, px, py) || settled.has(`${px},${py}`)) continue;
        if (tryPlace(ctx, species.id, px, py)) { settled.add(`${px},${py}`); planted++; }
      }
    }
    if (planted >= 3) return; // a real field took root here
  }
}

/** An orchard: a stride-spaced grid of ONE tree species (the stride clears the exclusion radius). */
function plantOrchard(ctx: PlaceCtx, a: PlacementAnalysis, site: MacroCoord, settled: Set<string>, rng: Rng): void {
  const trees = getPlaceableByCategory(ItemCategory.Tree);
  if (!trees.length) return;
  const species = trees[rng.int(trees.length)]!;
  for (let t = 0; t < TUNING.fieldTries; t++) {
    const ang = rng.float() * Math.PI * 2, d = TUNING.gardenRadius + 3 + rng.int(3);
    const x0 = Math.round(site.x + Math.cos(ang) * d), y0 = Math.round(site.y + Math.sin(ang) * d);
    let planted = 0;
    for (let gy = 0; gy < TUNING.orchardSize; gy++) {
      for (let gx = 0; gx < TUNING.orchardSize; gx++) {
        const px = x0 + gx * TUNING.orchardStride, py = y0 + gy * TUNING.orchardStride;
        if (!openAt(a, px, py) || settled.has(`${px},${py}`)) continue;
        if (tryPlace(ctx, species.id, px, py)) { settled.add(`${px},${py}`); planted++; }
      }
    }
    if (planted >= 3) return;
  }
}

/** Whether any cell within 2 of `p` belongs to `regionId` (the plaza centre sits ON the occupied plaza). */
function nearRegion(p: MacroCoord, regionId: number, a: PlacementAnalysis): boolean {
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = p.x + dx, y = p.y + dy;
    if (x >= 0 && y >= 0 && x < a.width && y < a.height && a.region[y * a.width + x] === regionId) return true;
  }
  return false;
}

/** Candidate cells in a disc around the centre, near→far, jittered. */
function discSlots(center: MacroCoord, radius: number, rng: Rng): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let r = 0; r <= radius; r += 1) {
    const steps = Math.max(1, Math.round(Math.PI * r));
    for (let s = 0; s < steps; s++) {
      const ang = (s / steps) * 2 * Math.PI + rng.float() * TUNING.slotAngleJitter;
      out.push({ x: Math.round(center.x + r * Math.cos(ang)), y: Math.round(center.y + r * Math.sin(ang)) });
    }
  }
  return out;
}

/** Rotation so the object faces toward (tx,ty). */
function faceToward(x: number, y: number, tx: number, ty: number): 0 | 90 | 180 | 270 {
  if (Math.abs(tx - x) >= Math.abs(ty - y)) return tx >= x ? 90 : 270;
  return ty >= y ? 180 : 0;
}

/** Reject a candidate whose footprint (± separation) touches an already-settled cell. */
function separated(catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270, settled: Set<string>): boolean {
  const item = getCatalogItem(catalogId);
  if (!item) return false;
  const { w, h } = getRotatedSize(item, rotation);
  const sep = TUNING.buildingSeparation;
  for (let yy = y - sep; yy < y + h + sep; yy++) {
    for (let xx = x - sep; xx < x + w + sep; xx++) {
      if (settled.has(`${xx},${yy}`)) return false;
    }
  }
  return true;
}


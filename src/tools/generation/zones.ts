// src/tools/generation/zones.ts — the designed-island room plan: partition, levels, themes.
//
// A noisy-voronoi partition turns the buildable mask into 6-14 organic "rooms" (zones). Each zone
// then gets a terrace LEVEL (adjacent zones differ by <= 1, the town's zone is the flat heart, the
// farthest zone is the peak) and a THEME (town/waterfront/peak/garden/orchard/farm/hamlet/park) the
// populator decorates. Slivers and disconnected fragments are reabsorbed so every room is wide
// enough to hold its theme. Deterministic throughout.
import { makeRng, type Rng } from '../../core/model/rng';
import { distanceField, relaxDistanceFrom, NEIGHBORS4 } from '../../core/model/grid-model';
import { valueNoise01 } from '../../core/model/noise';
import { geoStyle, type GeoStyle } from './style';
import { TUNING } from './tuning';
import type { Field, ShapingParams, Zone, ZonePlan, ZoneTheme, MacroCoord } from './types';
import { centroid } from './geometry';

export function buildZones(f: Field, p: ShapingParams, seed: number, town: MacroCoord): ZonePlan {
  const W = f.width, H = f.height;
  const rng = makeRng(seed ^ 0x20e5);
  const grassIdx: number[] = [];
  for (let i = 0; i < f.grass.length; i++) if (f.grass[i] === 1) grassIdx.push(i);
  // Floor of 0 (not 1): a maxElevation=0 request means a flat island with no terrace levels.
  // p.maxTier>=1 is unaffected by the floor; at 0 the wedding-cake BFS assigns
  // level 0 to every zone (Math.min(0,…)=0) and raiseCrowns early-returns, so the plan is all-ground.
  const levelCap = Math.max(0, Math.min(TUNING.zoneLevelCap, p.maxTier));
  const empty: ZonePlan = { width: W, height: H, zoneOf: new Int16Array(W * H).fill(-1), zones: [], adjacency: new Map(), river: [], crossings: [], town, levelCap };
  if (!grassIdx.length) return empty;

  // 1. SITES: the town's cell first, then farthest-point sampling (deterministic).
  const count = Math.max(TUNING.zoneCountMin, Math.min(TUNING.zoneCountMax, Math.round(grassIdx.length / TUNING.zoneAreaPerSite)));
  const townI = nearestGrass(f, town);
  const sites = [townI];
  // Incremental farthest-point: keep ONE running distance field and relax each new site into it
  // (min over sources), instead of a fresh full-grid multi-source BFS per added site.
  const dist = distanceField(sites, W, H);
  while (sites.length < count) {
    let best = -1, bd = -1;
    for (const i of grassIdx) if (dist[i]! > bd) { bd = dist[i]!; best = i; }
    if (best < 0 || bd < 4) break;
    sites.push(best);
    relaxDistanceFrom(dist, best, W, H);
  }

  // 2. ASSIGN: nearest site by noise-warped distance → organic wiggly seams (wobble amplitude
  //    scales with naturalness; at 0 the warp vanishes and the partition is pure convex voronoi).
  const style = geoStyle(p.naturalness);
  const wob = valueNoise01(seed ^ 0x77a1);
  const S = TUNING.zoneBorderNoiseScale;
  const zoneOf = new Int16Array(W * H).fill(-1);
  for (const i of grassIdx) {
    const x = i % W, y = (i / W) | 0;
    let best = 0, bd = Infinity;
    for (let s = 0; s < sites.length; s++) {
      const sx = sites[s]! % W, sy = (sites[s]! / W) | 0;
      const d = Math.hypot(sx - x, sy - y) + (wob((x + s * 37) * S, (y - s * 19) * S) - 0.5) * 2 * TUNING.zoneBorderWobble * style.wobbleScale;
      if (d < bd) { bd = d; best = s; }
    }
    zoneOf[i] = best as number;
  }

  // 3. SLIVER CLEANUP: keep each zone's largest component; reabsorb fragments + tiny zones into
  //    their majority neighbour (never the town's zone); repeat to a bounded fixpoint.
  for (let pass = 0; pass < 6; pass++) if (!cleanupPass(zoneOf, f, sites.length)) break;

  // 3b. RECTILINEAR STYLE: quantize the (cleaned) partition onto the style lattice — every seam
  //     becomes axis-aligned with straight runs >= block, the bones of the "lego" look. Runs after
  //     cleanup (which repairs wobble slivers organically); at low naturalness the wobble is already
  //     ~0, so the partition is convex and the snap cannot fragment a zone.
  if (style.block > 1) snapToLattice(zoneOf, f, style.block);

  // 4. Compact ids + zone records + adjacency; the zone containing the town becomes id 0.
  const zp = assemble(zoneOf, f, town, townI, levelCap);
  assignLevels(zp, p, rng);
  raiseCrowns(zp, p, style);
  assignThemes(zp);
  return zp;
}

/** Rectilinear style: majority-vote the zone assignment per aligned block×block tile, so every
 *  seam runs axis-aligned with straight runs >= block. Ties break to the smallest zone id;
 *  non-grass cells are untouched. A zone voted out of all its tiles simply vanishes (assemble
 *  compacts ids over the cells that remain). */
function snapToLattice(zoneOf: Int16Array, f: Field, block: number): void {
  const W = f.width, H = f.height;
  for (let by = 0; by < H; by += block) {
    for (let bx = 0; bx < W; bx += block) {
      const yEnd = Math.min(H, by + block), xEnd = Math.min(W, bx + block);
      const votes = new Map<number, number>();
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) {
        const z = zoneOf[y * W + x]!;
        if (z >= 0) votes.set(z, (votes.get(z) ?? 0) + 1);
      }
      let best = -1, bv = 0;
      for (const [z, v] of votes) if (v > bv || (v === bv && z < best)) { bv = v; best = z; }
      if (best < 0) continue;
      for (let y = by; y < yEnd; y++) for (let x = bx; x < xEnd; x++) {
        const i = y * W + x;
        if (zoneOf[i]! >= 0) zoneOf[i] = best as number;
      }
    }
  }
}

function nearestGrass(f: Field, p: MacroCoord): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < f.grass.length; i++) {
    if (f.grass[i] !== 1) continue;
    const x = i % f.width, y = (i / f.width) | 0;
    const d = (x - p.x) ** 2 + (y - p.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** One cleanup pass; returns true if anything changed. */
function cleanupPass(zoneOf: Int16Array, f: Field, nZones: number): boolean {
  const W = f.width, H = f.height;
  let changed = false;
  const seen = new Uint8Array(zoneOf.length);
  const compsByZone: number[][][] = Array.from({ length: nZones }, () => []);
  for (let s = 0; s < zoneOf.length; s++) {
    if (zoneOf[s]! < 0 || seen[s]) continue;
    const z = zoneOf[s]!, comp: number[] = [], q = [s];
    seen[s] = 1;
    while (q.length) {
      const i = q.pop()!;
      comp.push(i);
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!seen[j] && zoneOf[j] === z) { seen[j] = 1; q.push(j); }
      }
    }
    compsByZone[z]!.push(comp);
  }
  const reabsorb = (cells: number[], self: number): void => {
    // Repeated sweeps so interior cells of a fragment get absorbed once the rim flips.
    for (let sweep = 0; sweep < 8; sweep++) {
      let flipped = 0;
      for (const i of cells) {
        if (zoneOf[i] !== self) continue;
        const x = i % W, y = (i / W) | 0;
        const votes = new Map<number, number>();
        for (const [dx, dy] of NEIGHBORS4) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const z = zoneOf[ny * W + nx]!;
          if (z >= 0 && z !== self) votes.set(z, (votes.get(z) ?? 0) + 1);
        }
        let best = -1, bv = 0;
        for (const [z, v] of votes) if (v > bv || (v === bv && z < best)) { bv = v; best = z; }
        if (best >= 0) { zoneOf[i] = best as number; flipped++; changed = true; }
      }
      if (!flipped) break;
    }
  };
  for (let z = 0; z < nZones; z++) {
    const comps = compsByZone[z]!.sort((a, b) => b.length - a.length);
    for (let c = 1; c < comps.length; c++) reabsorb(comps[c]!, z);
    if (z !== 0 && comps.length && comps[0]!.length < TUNING.zoneMinArea) reabsorb(comps[0]!, z);
  }
  return changed;
}

function assemble(zoneOf: Int16Array, f: Field, town: MacroCoord, townI: number, levelCap: number): ZonePlan {
  const W = f.width, H = f.height;
  const remap = new Map<number, number>();
  remap.set(zoneOf[townI]!, 0); // the town's zone is always id 0
  const zones: Zone[] = [{ id: 0, cells: [], centroid: { x: 0, y: 0 }, level: 0, theme: 'park', bordersMap: false, riverside: false }];
  for (let i = 0; i < zoneOf.length; i++) {
    const z = zoneOf[i]!;
    if (z < 0) continue;
    if (!remap.has(z)) {
      remap.set(z, zones.length);
      zones.push({ id: zones.length, cells: [], centroid: { x: 0, y: 0 }, level: 0, theme: 'park', bordersMap: false, riverside: false });
    }
    const id = remap.get(z)!;
    zoneOf[i] = id as number;
    const zz = zones[id]!;
    zz.cells.push(i);
    const x = i % W, y = (i / W) | 0;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) zz.bordersMap = true;
  }
  const adjacency = new Map<number, Set<number>>();
  for (const z of zones) {
    let sx = 0, sy = 0;
    for (const i of z.cells) { sx += i % W; sy += (i / W) | 0; }
    z.centroid = { x: Math.round(sx / Math.max(1, z.cells.length)), y: Math.round(sy / Math.max(1, z.cells.length)) };
    adjacency.set(z.id, new Set());
  }
  for (let i = 0; i < zoneOf.length; i++) {
    const z = zoneOf[i]!;
    if (z < 0) continue;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const nz = zoneOf[ny * W + nx]!;
      if (nz >= 0 && nz !== z) { adjacency.get(z)!.add(nz); adjacency.get(nz)?.add(z); }
    }
  }
  return { width: W, height: H, zoneOf, zones, adjacency, river: [], crossings: [], town, levelCap };
}

/** Levels as a WEDDING CAKE: level = graph distance from the LOW SET, capped. A BFS distance
 *  field satisfies the adjacent-delta <= 1 rule BY CONSTRUCTION and nests highlands properly.
 *
 *  THE LOW SET MUST BE CONNECTED (grown from the town zone): the level-0 rooms ARE the island's
 *  ground floor, and `enforceUsability` measures the LARGEST CONNECTED flat region — scattered
 *  ground rooms read as fragmented flat, and usability then peels the terraces to bare ground (the
 *  "everything is flat in practice" failure on real maps). A connected ground floor is also just
 *  good town design: every street reaches every ground room.
 *  relief shrinks the low set (more of the island climbs); flatness grows it (more ground floor);
 *  both edits preserve connectivity. */
/** Invert the mtnThreshold→relief mapping: relief 0 (flat, high threshold) .. 1 (bold, low threshold). */
const reliefOf = (p: ShapingParams): number => Math.min(1, Math.max(0, (0.46 - p.mtnThreshold) / 0.34));

function assignLevels(zp: ZonePlan, p: ShapingParams, rng: Rng): void {
  if (zp.zones.length <= 1) return;
  const relief = reliefOf(p);

  // Grow the low set as a CONNECTED blob from the town zone (BFS over the zone graph; a zone may
  // join only when a neighbour already did).
  const low = new Set<number>([0]);
  const visited = new Set<number>([0]);
  let grow = [0];
  while (grow.length) {
    const next: number[] = [];
    for (const z of grow) {
      for (const n of [...(zp.adjacency.get(z) ?? [])].sort((a, b) => a - b)) {
        if (visited.has(n)) continue;
        visited.add(n);
        const zone = zp.zones[n]!;
        const pJoin = zone.bordersMap ? 0.6 - 0.4 * relief : 0.45 * (1 - relief);
        if (low.has(z) && rng.float() < pJoin) { low.add(n); next.push(n); }
      }
    }
    grow = next;
  }

  const levelsFrom = (lowSet: Set<number>): Map<number, number> => {
    const lv = new Map<number, number>();
    let frontier: number[] = [];
    for (const z of lowSet) { lv.set(z, 0); frontier.push(z); }
    while (frontier.length) {
      const next: number[] = [];
      for (const z of frontier) for (const n of zp.adjacency.get(z) ?? []) {
        if (!lv.has(n)) { lv.set(n, Math.min(zp.levelCap, lv.get(z)! + 1)); next.push(n); }
      }
      frontier = next;
    }
    return lv;
  };
  /** Whether the low set stays connected (over the zone graph) after removing `drop`. */
  const connectedWithout = (drop: number): boolean => {
    const rest = new Set([...low].filter((z) => z !== drop));
    const seen = new Set([0]);
    const q = [0];
    while (q.length) {
      const z = q.pop()!;
      for (const n of zp.adjacency.get(z) ?? []) if (rest.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
    }
    return seen.size === rest.size;
  };

  let lv = levelsFrom(low);
  // RELIEF FLOOR: seed luck must never flatten the island — drop the low set's largest members
  // (never the town, never a member whose removal would disconnect the ground floor) until enough
  // land is raised. The mirror image of the flatness loop below.
  const raisedShare = (m: Map<number, number>): number => {
    let raised = 0, all = 0;
    for (const z of zp.zones) { all += z.cells.length; if ((m.get(z.id) ?? 0) > 0) raised += z.cells.length; }
    return all ? raised / all : 0;
  };
  const floor = TUNING.reliefFloorAt1 * relief;
  for (let guard = 0; guard < zp.zones.length && raisedShare(lv) < floor && low.size > 1; guard++) {
    const byArea = [...low].filter((id) => id !== 0).sort((a, b) => zp.zones[b]!.cells.length - zp.zones[a]!.cells.length);
    const drop = byArea.find((id) => connectedWithout(id));
    if (drop === undefined) break;
    low.delete(drop);
    lv = levelsFrom(low);
  }
  // flatness: grow the low set (largest ADJACENT raised zones first, so the floor stays connected)
  // until the flat share meets the target.
  const flatShare = (m: Map<number, number>): number => {
    let flat = 0, all = 0;
    for (const z of zp.zones) { all += z.cells.length; if ((m.get(z.id) ?? 0) === 0) flat += z.cells.length; }
    return all ? flat / all : 1;
  };
  for (let guard = 0; guard < zp.zones.length && flatShare(lv) < p.targetFlat; guard++) {
    const adjacentRaised = zp.zones.filter((z) =>
      (lv.get(z.id) ?? 0) > 0 && [...(zp.adjacency.get(z.id) ?? [])].some((n) => low.has(n)));
    const cand = adjacentRaised.sort((a, b) => b.cells.length - a.cells.length)[0];
    if (!cand) break;
    low.add(cand.id);
    lv = levelsFrom(low);
  }
  for (const z of zp.zones) z.level = lv.get(z.id) ?? 0;
}

/** CROWNS — relief-scaled terraced MASSIFS. The zone graph is usually too shallow (BFS depth ~4) to
 *  climb to the Max-Height, so we take the largest RAISED zones and terrace each one UPWARD: carve its
 *  inset core as a nested zone one level higher, then repeat on that core, until it reaches the
 *  relief-scaled target peak (or the core gets too small). This is how the map reaches the real
 *  Max-Height with mass on top. Every step nests inside its parent, so the adjacent-delta <= 1 rule
 *  holds BY CONSTRUCTION (ramps/bridges stay plannable). relief sets BOTH the target peak (plain ->
 *  cliff) AND how many massifs climb. */
function raiseCrowns(zp: ZonePlan, p: ShapingParams, style: GeoStyle): void {
  const relief = reliefOf(p);
  const targetPeak = Math.max(1, Math.min(zp.levelCap, Math.round(1 + relief * (zp.levelCap - 1))));
  if (targetPeak < TUNING.crownMinPeak) return; // gentle relief: the BFS terrace depth already covers it
  const nMassifs = Math.max(1, Math.round(relief * TUNING.crownMassifs));
  const seeds = zp.zones
    .filter((z) => z.level >= 1 && z.cells.length >= TUNING.crownMinArea)
    .sort((a, b) => b.cells.length - a.cells.length || a.id - b.id)
    .slice(0, nMassifs);
  seeds.forEach((seed, idx) => {
    // VARIETY: the grandest massif (idx 0) is a pure STEEP scenic peak — it spends all its base radius
    // climbing, so it reaches the Max-Height (the map's dramatic summit). The rest are climbable
    // TERRACED PARKS: up to `crownNavMax` WIDE steps (crownNavInset) the crossing planner ramps — a
    // real staircase you can walk up — then steep scenic steps finish them off. Wide steps leave a
    // 4-deep landing so the ramp rule accepts them; steep/scenic steps are flagged `crown` (skipped by
    // crossings — a view, not a path). Scenic steps climb `style.step` levels per ring (stacked slabs
    // at low naturalness); nav steps always climb 1 so the ramp rule can still link them.
    const scenicOnly = idx === 0;
    let parent = seed, navSteps = 0;
    while (parent.level < targetPeak) {
      const wide = !scenicOnly && navSteps < TUNING.crownNavMax ? carveCrown(zp, parent, TUNING.crownNavInset, false, 1, style) : null;
      if (wide) { parent = wide; navSteps++; continue; }
      const rise = Math.min(style.step, targetPeak - parent.level);
      const spire = carveCrown(zp, parent, TUNING.crownInset, true, rise, style) ?? carveCrown(zp, parent, 1, true, rise, style);
      if (!spire) break;
      parent = spire;
    }
  });
}

/** Carve the `inset`-deep core of `parent` as a new zone `rise` levels higher — a single terrace
 *  step. `scenic` marks it `crown` (a steep spire step the crossing planner skips); a non-scenic
 *  (wide) step stays a normal zone the planner ramps. The inset erosion is Manhattan (rounded
 *  contour) or Chebyshev (square corners) per the style. Returns the new core to climb from, or
 *  null if the parent is at the cap or its core is too small to step up again. */
function carveCrown(zp: ZonePlan, parent: Zone, inset: number, scenic: boolean, rise: number, style: GeoStyle): Zone | null {
  if (parent.level >= zp.levelCap) return null;
  const W = zp.width, H = zp.height;
  const inZone = new Set(parent.cells);
  const outside: number[] = [];
  for (const i of parent.cells) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !inZone.has(ny * W + nx)) { outside.push(i); break; }
    }
  }
  const d = distanceField(outside, W, H, style.rect);
  const crownCells = largestComponent(parent.cells.filter((i) => d[i]! >= inset), W);
  if (crownCells.length < TUNING.crownMinArea) return null;
  const crown: Zone = {
    id: zp.zones.length, cells: crownCells,
    centroid: centroid(crownCells, W),
    level: Math.min(zp.levelCap, parent.level + rise), theme: 'park', bordersMap: false, riverside: false, ...(scenic ? { crown: true } : {}),
  };
  const crownSet = new Set(crownCells);
  parent.cells = parent.cells.filter((i) => !crownSet.has(i));
  for (const i of crownCells) zp.zoneOf[i] = crown.id as number;
  zp.zones.push(crown);
  zp.adjacency.set(crown.id, new Set([parent.id]));
  zp.adjacency.get(parent.id)!.add(crown.id);
  return crown;
}

/** Largest 4-connected component of a cell set. */
function largestComponent(cells: number[], W: number): number[] {
  const set = new Set(cells);
  const seen = new Set<number>();
  let best: number[] = [];
  for (const s of cells) {
    if (seen.has(s)) continue;
    const comp: number[] = [], q = [s];
    seen.add(s);
    while (q.length) {
      const i = q.pop()!;
      comp.push(i);
      for (const d of [1, -1, W, -W]) {
        const n = i + d;
        if (set.has(n) && !seen.has(n)) { seen.add(n); q.push(n); }
      }
    }
    if (comp.length > best.length) best = comp;
  }
  return best;
}

/** Themes from zone properties: one town (id 0), one peak (highest), waterfront on a border
 *  level-0 zone; HAMLETS are picked by farthest-point spread over room centroids (homes are the
 *  island's landmarks — farthest-point seeding scatters them coast to coast, so the whole map reads
 *  as settled rather than one crowded hillside); the remaining rooms cycle the
 *  working-land pool. Crown spires stay scenic parks. Lake/riverside refinement happens in
 *  zone-water. */
function assignThemes(zp: ZonePlan): void {
  if (!zp.zones.length) return;
  zp.zones[0]!.theme = 'town';
  let peak: Zone | null = null;
  for (const z of zp.zones) if (z.id !== 0 && (!peak || z.level > peak.level)) peak = z;
  if (peak) peak.theme = 'peak';
  const rest = zp.zones.filter((z) => z.theme === 'park' && !z.crown);
  const waterfront = rest.find((z) => z.bordersMap && z.level === 0);
  if (waterfront) waterfront.theme = 'waterfront';
  // HAMLET rooms: greedy farthest-point over centroids, seeded from the town — each next hamlet
  // maximizes its distance to the town and every hamlet already chosen. Capped so the island keeps
  // a few real settlements rather than suburbia. Deterministic (id tie-break).
  const hamletN = Math.min(TUNING.hamletCountMax, Math.max(2, Math.round(rest.length * TUNING.hamletRoomShare)));
  const anchors: MacroCoord[] = [zp.town];
  for (let k = 0; k < hamletN; k++) {
    let best: Zone | null = null, bd = -1;
    for (const z of rest) {
      if (z.theme !== 'park') continue;
      let md = Infinity;
      for (const p of anchors) md = Math.min(md, (z.centroid.x - p.x) ** 2 + (z.centroid.y - p.y) ** 2);
      if (md > bd || (md === bd && best !== null && z.id < best.id)) { bd = md; best = z; }
    }
    if (!best) break;
    best.theme = 'hamlet';
    anchors.push(best.centroid);
  }
  // RAISED rooms get the lived-in themes first (terrace gardens/orchards — the land is worked on
  // the levels, not just the ground), and the pool CYCLES so big maps never default to empty parks;
  // parks stay deliberate, not leftovers.
  const pool: ZoneTheme[] = ['garden', 'orchard', 'farm', 'park', 'garden'];
  let pi = 0;
  for (const z of [...rest].sort((a, b) => b.level - a.level || a.id - b.id)) {
    if (z.theme !== 'park') continue;
    z.theme = pool[pi % pool.length]!;
    pi++;
  }
}

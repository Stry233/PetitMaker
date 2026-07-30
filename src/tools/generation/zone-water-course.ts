// src/tools/generation/zone-water-course.ts — the TERRAIN-FOLLOWING RIVER.
//
// Water that flows WITH the terrain instead of only along the valley floor: a headwater POOL is
// carved high on a broad terrace (an interior pond whose every neighbour is the room's own mass at
// the pond level — legal containment with NO faces, the one legal way to put a body of water on a
// peak), a CHANNEL dug through the terrace surface carries it to the terrace lip, and a validated
// waterfall unit drops it one level — repeating terrace by terrace until the course PLUNGES onto
// the valley floor and joins the ground river. Where the chain can't continue, a taller plunge
// (landE 0) connects the levels directly; a course that can't flow at all is reverted (no stray
// puddles — one chained water story). A complementary FEEDER pass then drops falls straight into
// the existing ground river at cliffs that touch it, so every mixed map keeps water on the levels.
//
// Every unit/channel/connection is validated whole-plan against the live registry
// (reject-and-skip), so the course can never make the map illegal. Runs AFTER certification (the
// additive, self-validating slot). Deterministic + globally budgeted (TUNING.riverSegMax).
import { makeRng, type Rng } from '../../core/model/rng';
import { TUNING } from './tuning';
import { NEIGHBORS4, distanceField } from '../../core/model/grid-model';
import { tryCarveWaterUnit } from './waterfalls';
import { applyPlanToScratch } from './repair';
import type { RuleRegistry } from '../../rules/registry';
import type { MacroCoord } from '../../core/model/types';
import type { MapTemplate, TerrainPlan, Zone, ZonePlan } from './types';

/** Carve the terrain-following river: headwater pools each feeding a descending course of
 *  channels + waterfalls down to the valley floor, then feeder falls into the ground river.
 *  Returns the number of courses carved. */
export function carveRiverCourse(
  zp: ZonePlan, plan: TerrainPlan, grass: Uint8Array, template: MapTemplate, reg: RuleRegistry, seed: number,
): number {
  const rng = makeRng(seed ^ 0x6b3f);
  // candidate headwater rooms: high but pool-able (level 2..3 — the pond must sit at its room's
  // level, and elevated water is bounded at 3), broad, non-crown; riverside first (the course
  // feeds the valley water), then highest, then id — deterministic.
  const rooms = zp.zones
    .filter((z) => !z.crown && z.level >= 2 && z.level <= 3 && z.cells.length >= 90)
    .sort((a, b) => Number(b.riverside) - Number(a.riverside) || b.level - a.level || a.id - b.id);
  let courses = 0, falls = 0;
  for (const room of rooms) {
    if (courses >= TUNING.headwaterMax || falls >= TUNING.riverSegMax) break;
    const snapTier = plan.tier.slice(), snapWater = plan.water.slice();
    const riverSnap = zp.river.length;
    const pool = carvePool(zp, plan, grass, template, reg, room);
    if (!pool) continue;
    const { placed, grounded } = descend(zp, plan, grass, template, reg, rng, pool, room.level, TUNING.riverSegMax - falls);
    if (placed === 0 || !grounded) {
      // ORPHAN GUARD: a pond with no outflow, or a course that dies mid-terrace, is a stray
      // puddle, not a river — revert the whole course (ONE chained water story or nothing).
      plan.tier.set(snapTier); plan.water.set(snapWater);
      zp.river.length = riverSnap;
      continue;
    }
    courses++; falls += placed;
  }
  falls += feederFalls(zp, plan, grass, template, reg, rng, TUNING.riverSegMax - falls);
  return courses;
}

/** Effective surface elevation at a cell: water elevation, mountain tier, ground 0, or -1 off-grass. */
function surfaceElev(plan: TerrainPlan, grass: Uint8Array, x: number, y: number): number {
  const W = plan.width;
  if (x < 0 || y < 0 || x >= W || y >= plan.height || grass[y * W + x] !== 1) return -1;
  const i = y * W + x;
  return plan.water[i]! >= 0 ? plan.water[i]! : plan.tier[i]!;
}

/** Carve an interior headwater pond at the room's level (validated whole-plan; shrink on
 *  rejection). Returns the pond centre, or null if none validates. */
function carvePool(
  zp: ZonePlan, plan: TerrainPlan, grass: Uint8Array, template: MapTemplate, reg: RuleRegistry, room: Zone,
): MacroCoord | null {
  const W = plan.width, H = plan.height;
  // interior cells = far from anything that is NOT this room's own dry mass at its level
  const outside: number[] = [];
  for (const i of room.cells) {
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy, j = ny * W + nx;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || grass[j] !== 1 || plan.water[j]! >= 0 || plan.tier[j] !== room.level) { outside.push(i); break; }
    }
  }
  const d = distanceField(outside, W, H);
  let centre = -1, bd = -1;
  for (const i of room.cells) if (d[i]! > bd) { bd = d[i]!; centre = i; }
  if (centre < 0 || bd < 3) return null;
  const cx = centre % W, cy = (centre / W) | 0;
  for (let r = Math.min(2, bd - 1); r >= 1; r--) {           // try a pond, shrink on rejection
    const tier = plan.tier.slice(), water = plan.water.slice();
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r + 1) continue;
      const j = (cy + dy) * W + (cx + dx);
      tier[j] = 0; water[j] = room.level as number;
    }
    const cand: TerrainPlan = { width: W, height: H, tier, water };
    if (reg.validatePostStroke(applyPlanToScratch(cand, template)).length === 0) {
      plan.tier.set(tier); plan.water.set(water);
      zp.river.push({ x: cx, y: cy, level: room.level, fall: false });
      return { x: cx, y: cy };
    }
  }
  return null;
}

/** Step the course down the terraces from `start` at level `E0`. Every HOP is transactional and
 *  fully connected: find a lip, carve the waterfall unit there, then dig the channel that joins
 *  the stream's current foot to the fall — if the channel can't be dug, the fall is reverted and
 *  the hop retried as a PLUNGE (landE 0, straight to the valley floor). A course therefore never
 *  leaves a blind canal or an unfed fall; when no connected hop exists the course simply ends and
 *  ties into the ground water. Returns the fall count and whether the course reached the floor
 *  (`grounded` — a landE-0 fall, or a successful ground tie-in; the caller reverts ungrounded
 *  courses). */
function descend(
  zp: ZonePlan, plan: TerrainPlan, grass: Uint8Array, template: MapTemplate, reg: RuleRegistry,
  rng: Rng, start: MacroCoord, E0: number, budget: number,
): { placed: number; grounded: boolean } {
  let placed = 0, p = start, E = Math.min(3, E0), grounded = false;
  // The FIRST hop crosses the headwater room (pond → its lip), so it searches as far as a channel
  // can reach; chain hops start right below the previous fall, where the next lip is close.
  const hop = (landE: number, radius: number): MacroCoord | null => {
    const drop = findDrop(plan, grass, p, E, landE, radius);
    if (!drop) return null;
    const snapTier = plan.tier.slice(), snapWater = plan.water.slice();
    const riverSnap = zp.river.length;
    const len = 1 + rng.int(TUNING.courseRunMax);
    const ok = tryCarveWaterUnit(plan, grass, drop.at, E, drop.dir, len, template, reg, landE)
      || (len > 1 && tryCarveWaterUnit(plan, grass, drop.at, E, drop.dir, 1, template, reg, landE));
    if (!ok) return null;
    if (!carveChannel(zp, plan, grass, p, drop.at, E, template, reg)) {
      plan.tier.set(snapTier); plan.water.set(snapWater); // the fall would be unfed — revert the hop
      zp.river.length = riverSnap;
      return null;
    }
    placed++;
    zp.river.push({ x: drop.at.x, y: drop.at.y, level: E, fall: true });
    return { x: drop.at.x + drop.dir[0] * 2, y: drop.at.y + drop.dir[1] * 2 }; // just past the landing row
  };
  while (E >= 1 && placed < TUNING.coursePerHeadwater && placed < budget) {
    const radius = placed === 0 ? TUNING.courseChannelMax : TUNING.courseSearchRadius;
    const step = hop(E - 1, radius);
    if (step) { p = step; E--; continue; }
    if (E >= 2) {
      const plunge = hop(0, radius);
      if (plunge) { p = plunge; break; } // the plunge lands the story on the valley floor
    }
    break; // no connected hop from here — the course ends on this terrace
  }
  // Grounded = the story visibly reaches the ground WATER: the last fall pours straight into the
  // river (connectGround detects adjacency) or a short dug stream/gorge reaches it. A course whose
  // water ends dry is reverted by the caller — one chained story or nothing.
  if (placed > 0) grounded = connectGround(zp, plan, grass, p, template, reg);
  return { placed, grounded };
}

/** Nearest dry cell to `p` at effective elevation `E` with a cardinal `landE` neighbour (a lip of
 *  the right height), within `R`. Returns the carve anchor + flow direction toward the drop, or
 *  null. Deterministic (distance, then flat-index tie-break). */
function findDrop(
  plan: TerrainPlan, grass: Uint8Array, p: MacroCoord, E: number, landE: number, R: number,
): { at: MacroCoord; dir: readonly [number, number] } | null {
  const W = plan.width;
  let best: { at: MacroCoord; dir: readonly [number, number]; d: number; key: number } | null = null;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = p.x + dx, y = p.y + dy, i = y * W + x;
    if (surfaceElev(plan, grass, x, y) !== E || plan.water[i]! >= 0) continue; // stand on the dry lip, not the pool
    for (const [fx, fy] of NEIGHBORS4) {
      if (surfaceElev(plan, grass, x + fx, y + fy) !== landE) continue;
      const dist = Math.abs(dx) + Math.abs(dy), key = i;
      if (!best || dist < best.d || (dist === best.d && key < best.key)) best = { at: { x, y }, dir: [fx, fy], d: dist, key };
    }
  }
  return best ? { at: best.at, dir: best.dir } : null;
}

/** Dig a channel at level E across the terrace surface from `from` to `to` (an axis-aligned
 *  dogleg; both elbows tried). Painted cells must be dry terrace mass at exactly E — existing
 *  water at E (the pond, a fall run) passes through unpainted, so the stream reads as ONE body.
 *  The whole candidate is validated (containment flags any cell that strays onto a lip), so a
 *  rejected route simply leaves the fall unconnected — never an illegal map. */
function carveChannel(
  zp: ZonePlan, plan: TerrainPlan, grass: Uint8Array, from: MacroCoord, to: MacroCoord, E: number,
  template: MapTemplate, reg: RuleRegistry,
): boolean {
  const W = plan.width;
  if (Math.abs(from.x - to.x) + Math.abs(from.y - to.y) > TUNING.courseChannelMax) return false;
  for (const elbow of [{ x: to.x, y: from.y }, { x: from.x, y: to.y }]) {
    const path = [...walkLine(from, elbow), ...walkLine(elbow, to)];
    let ok = true;
    for (const c of path) {
      const i = c.y * W + c.x;
      if (grass[i] !== 1) { ok = false; break; }
      const w = plan.water[i]!;
      if (w >= 0 ? w !== E : plan.tier[i] !== E) { ok = false; break; } // dry terrace at E, or the stream itself
    }
    if (!ok) continue;
    const tier = plan.tier.slice(), water = plan.water.slice();
    let painted = 0;
    for (const c of path) {
      const i = c.y * W + c.x;
      if (water[i]! >= 0) continue;
      water[i] = E as number; tier[i] = 0; painted++;
    }
    if (!painted) return true; // already one body
    const cand: TerrainPlan = { width: W, height: plan.height, tier, water };
    if (reg.validatePostStroke(applyPlanToScratch(cand, template)).length !== 0) continue;
    plan.tier.set(tier); plan.water.set(water);
    for (const c of path) zp.river.push({ x: c.x, y: c.y, level: E, fall: false });
    return true;
  }
  return false;
}

/** The cells strictly after `a` up to and including `b`, walking one axis then none (a straight
 *  segment; callers compose doglegs from two of these). */
function walkLine(a: MacroCoord, b: MacroCoord): MacroCoord[] {
  const out: MacroCoord[] = [];
  let { x, y } = a;
  while (x !== b.x || y !== b.y) {
    if (x !== b.x) x += Math.sign(b.x - x); else y += Math.sign(b.y - y);
    out.push({ x, y });
  }
  return out;
}

/** Tie the course's foot into the existing ground water: a short validated dogleg of elevation-0
 *  water from `from` to the nearest water-0 cell. Best-effort — a rejected route (e.g. through a
 *  fall's uniform landing row) just leaves the visual gap the falls already bridge. */
function connectGround(
  zp: ZonePlan, plan: TerrainPlan, grass: Uint8Array, from: MacroCoord, template: MapTemplate, reg: RuleRegistry,
): boolean {
  const W = plan.width, R = TUNING.courseConnectMax;
  let best: MacroCoord | null = null, bd = Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = from.x + dx, y = from.y + dy;
    if (surfaceElev(plan, grass, x, y) !== 0 || plan.water[y * W + x] !== 0) continue;
    const d = Math.abs(dx) + Math.abs(dy);
    if (d < bd || (d === bd && best && y * W + x < best.y * W + best.x)) { bd = d; best = { x, y }; }
  }
  if (!best || bd <= 1) return !!best; // absent → give up; adjacent → already joined
  for (const elbow of [{ x: best.x, y: from.y }, { x: from.x, y: best.y }]) {
    const path = [from, ...walkLine(from, elbow), ...walkLine(elbow, best)];
    if (path.some((c) => grass[c.y * W + c.x] !== 1)) continue;
    const tier = plan.tier.slice(), water = plan.water.slice();
    let painted = 0;
    for (const c of path) {
      const i = c.y * W + c.x;
      if (water[i]! >= 0) continue; // never disturb existing water (any level)
      water[i] = 0; tier[i] = 0; painted++;
    }
    if (!painted) return true;
    const cand: TerrainPlan = { width: W, height: plan.height, tier, water };
    if (reg.validatePostStroke(applyPlanToScratch(cand, template)).length !== 0) continue;
    plan.tier.set(tier); plan.water.set(water);
    for (const c of path) zp.river.push({ x: c.x, y: c.y, level: 0, fall: false });
    return true;
  }
  return false;
}

/** Feeder falls: at cliffs whose foot IS the existing ground water, drop a fall straight into the
 *  river/lake (landE 0 keeps the water landing) — connected by construction. Spaced out so the
 *  banks don't read as a curtain of falls. */
function feederFalls(
  zp: ZonePlan, plan: TerrainPlan, grass: Uint8Array, template: MapTemplate, reg: RuleRegistry,
  rng: Rng, budget: number,
): number {
  if (budget <= 0) return 0;
  const W = plan.width, H = plan.height;
  const fallSpots: MacroCoord[] = zp.river.filter((r) => r.fall).map((r) => ({ x: r.x, y: r.y }));
  const farFromFalls = (x: number, y: number): boolean =>
    fallSpots.every((f) => Math.abs(f.x - x) + Math.abs(f.y - y) >= TUNING.courseFeederGap);
  let placed = 0;
  for (let y = 0; y < H && placed < budget; y++) for (let x = 0; x < W && placed < budget; x++) {
    const i = y * W + x;
    if (grass[i] !== 1 || plan.water[i]! >= 0) continue;
    const E = plan.tier[i]!;
    if (E < 1 || E > 3 || !farFromFalls(x, y)) continue;
    for (const [fx, fy] of NEIGHBORS4) {
      if (plan.water[(y + fy) * W + (x + fx)] !== 0 || surfaceElev(plan, grass, x + fx, y + fy) !== 0) continue;
      const len = 1 + rng.int(TUNING.courseRunMax);
      const ok = tryCarveWaterUnit(plan, grass, { x, y }, E, [fx, fy], len, template, reg, 0)
        || (len > 1 && tryCarveWaterUnit(plan, grass, { x, y }, E, [fx, fy], 1, template, reg, 0));
      if (ok) {
        zp.river.push({ x, y, level: E, fall: true });
        fallSpots.push({ x, y });
        placed++;
      }
      break; // one attempt per cliff cell — rejected sites just stay a bank
    }
  }
  return placed;
}

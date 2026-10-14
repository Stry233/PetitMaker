/**
 * The water story's falls off a terrace step, the companion falls set beside its main ones, and the
 * short tributary that joins it.
 */
import { flatIndex } from '../../../../core/grid/rect';
import { NEIGHBORS4_ESWN } from '../../../../core/grid/directions';
import type { MacroCoord } from '../../../../core/model/types';
import { atTier, boundsOfCells, capsAt, cellsFit, floodCells, freeAt, surfaceOf, uniform, type WaterGround } from './water-cut';
import { seedHash01 } from '../../../../core/base/hash';
import { type StoryFall, type StoryInput, type StoryReach, type Vec, left, perp, right, section } from './story-model';

/** How far along the same lip a fall's narrower companion stands, and how many companions one course
 *  carries. */
const COMPANION_GAP = { min: 3, max: 9 } as const;
const COMPANION_MAX = 3;
/** The tributary: a 1-wide branch that must rejoin the course within this many cells. */
const TRIBUTARY_LENGTH = 16;

// --- the falls ----------------------------------------------------------------------------------

/**
 * A fall on the lip ahead of the head: the band, its landing, and where the course carries on.
 *
 * The band is the row of lip cells still standing at `tier`, with a cell of terrace left at each
 * perpendicular end as V-WTR-02's caps — mountain at exactly the band's own tier, which is what a
 * cap has to be; a neighbour standing a tier higher is not one. The landing is the row it pours
 * onto, read for uniformity across the band and its caps first (V-WTR-03) and then flooded at its
 * own level, so the fall arrives in water rather than on a shelf. A landing several tiers down is a
 * plunge, and legal for the same two reasons.
 */
export function tryFall(
  ground: WaterGround, at: MacroCoord, dir: Vec, width: number, tier: number,
): { band: MacroCoord[]; landing: MacroCoord[]; landsAt: number; at: MacroCoord; dir: Vec } | null {
  const { t, grass, flat } = ground;
  if (tier < 1) return null;
  for (const d of [dir, left(dir), right(dir), [-dir[0], -dir[1]] as Vec]) {
    for (let w = width; w >= 1; w--) {
      const lip = { x: at.x + d[0], y: at.y + d[1] };
      const band = section(lip, d, w);
      if (!atTier(t, grass, flat, boundsOfCells(band), tier)) continue;
      const p = perp(d);
      const lo = (w - 1) >> 1;
      const caps = [
        { x: lip.x + p[0] * (-lo - 1), y: lip.y + p[1] * (-lo - 1) },
        { x: lip.x + p[0] * (w - lo), y: lip.y + p[1] * (w - lo) },
      ];
      if (!caps.every((c) => capsAt(t, grass, c, tier))) continue;
      const apron = { x: lip.x + d[0], y: lip.y + d[1] };
      const strip = boundsOfCells([
        ...section(apron, d, w),
        { x: apron.x + p[0] * (-lo - 1), y: apron.y + p[1] * (-lo - 1) },
        { x: apron.x + p[0] * (w - lo), y: apron.y + p[1] * (w - lo) },
      ]);
      if (!uniform(t, grass, strip)) continue;
      const landsAt = surfaceOf(t, apron.x, apron.y);
      if (landsAt < 0 || landsAt >= tier) continue;
      const landing = section(apron, d, w);
      if (!cellsFit(t, grass, flat, landing, landsAt)) continue;
      return { band, landing, landsAt, at: apron, dir: d };
    }
  }
  return null;
}

/**
 * The narrower fall beside the main one (one main waterfall with a narrower one beside it).
 *
 * It is cut after the course, along the same lip and staggered a few cells to one side, and only
 * where it pours straight into water the course already laid, because a fall onto nothing is ruled
 * out. One cell wide, so it reads as the companion rather than as a second main
 * fall.
 */
export function companionFalls(input: StoryInput, mains: readonly StoryFall[]): StoryFall[] {
  const { t, grass, flat, seed } = input;
  const out: StoryFall[] = [];
  for (const [k, main] of mains.entries()) {
    if (out.length >= COMPANION_MAX) break;
    const alongX = main.rect.w >= main.rect.h;
    const gap = COMPANION_GAP.min
      + Math.floor(seedHash01(seed ^ 0xc0a1, k) * (COMPANION_GAP.max - COMPANION_GAP.min + 1));
    for (const side of [1, -1] as const) {
      const at = alongX
        ? { x: side > 0 ? main.rect.x + main.rect.w - 1 + gap : main.rect.x - gap, y: main.rect.y }
        : { x: main.rect.x, y: side > 0 ? main.rect.y + main.rect.h - 1 + gap : main.rect.y - gap };
      const flows: Vec[] = alongX ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      let cut: number | null = null;
      for (const flow of flows) {
        cut = companionAt({ t, grass, flat }, at, flow, main.tier);
        if (cut !== null) break;
      }
      if (cut === null) continue;
      floodCells(t, [at], main.tier);
      out.push({ rect: { x: at.x, y: at.y, w: 1, h: 1 }, tier: main.tier, landsAt: cut, main: false });
      break;
    }
  }
  return out;
}

/** The level a 1-wide companion at `at` would pour onto, or null where it would pour onto anything
 *  but the story's own water, or where its own caps and back are not standing. */
function companionAt(ground: WaterGround, at: MacroCoord, flow: Vec, tier: number): number | null {
  const { t, grass } = ground;
  if (!freeAt(ground, at.x, at.y, tier)) return null;
  const p = perp(flow);
  const caps = [{ x: at.x + p[0], y: at.y + p[1] }, { x: at.x - p[0], y: at.y - p[1] }];
  if (!caps.every((c) => capsAt(t, grass, c, tier))) return null;
  // Behind it must stand at the band's own tier, or the companion shows a second, uncapped face.
  if (surfaceOf(t, at.x - flow[0], at.y - flow[1]) < tier) return null;
  const front = { x: at.x + flow[0], y: at.y + flow[1] };
  if (front.x < 0 || front.y < 0 || front.x >= t.width || front.y >= t.height) return null;
  const level = surfaceOf(t, front.x, front.y);
  if (level < 0 || level >= tier) return null;
  if (t.water[flatIndex(front.x, front.y, t.width)] !== level) return null;
  const strip = boundsOfCells([
    front, { x: front.x + p[0], y: front.y + p[1] }, { x: front.x - p[0], y: front.y - p[1] },
  ]);
  return uniform(t, grass, strip) ? level : null;
}

// --- the tributary ------------------------------------------------------------------------------

/**
 * A short branch that leaves the course and rejoins it (a main river may split off a short branch that flows back in).
 *
 * It is 1 wide and it is kept only where it rejoins: a branch that wanders off and stops is a second
 * body dressed as a story. So the cells are gathered first and flooded only once the join is found.
 */
export function cutTributary(
  input: StoryInput, spine: readonly MacroCoord[], reaches: readonly StoryReach[],
  laid: readonly MacroCoord[],
): MacroCoord[] {
  const { t, grass, flat, seed } = input;
  if (spine.length < 8) return [];
  const own = new Set(laid.map((c) => flatIndex(c.x, c.y, t.width)));
  const start = spine[Math.max(1, Math.floor(spine.length * 0.35))]!;
  const tier = reaches.find((r) => r.cells.some((c) => c.x === start.x && c.y === start.y))?.tier
    ?? reaches[0]!.tier;
  for (const firstDir of NEIGHBORS4_ESWN) {
    let at = { x: start.x + firstDir[0], y: start.y + firstDir[1] };
    let dir = firstDir;
    const branch: MacroCoord[] = [];
    for (let k = 0; k < TRIBUTARY_LENGTH; k++) {
      const i = flatIndex(at.x, at.y, t.width);
      if (k > 2 && own.has(i) && branch.length >= 4) {
        floodCells(t, branch, tier);
        return branch;
      }
      if (!freeAt({ t, grass, flat }, at.x, at.y, tier)) break;
      const probe = [...branch, at];
      if (!fitsBeside({ t, grass, flat }, probe, own, tier)) break;
      branch.push(at);
      dir = seedHash01(seed ^ 0x77b1, k) < 0.35 ? (k % 2 === 0 ? left(dir) : right(dir)) : dir;
      at = { x: at.x + dir[0], y: at.y + dir[1] };
    }
  }
  return [];
}

/** `cellsFit` for a branch: the course's own water counts as ground at the branch's level, since it
 *  stands at exactly that level and is what the branch is going to rejoin. */
function fitsBeside(ground: WaterGround, cells: readonly MacroCoord[], own: ReadonlySet<number>, tier: number): boolean {
  const { t } = ground;
  const mine = new Set(cells.map((c) => flatIndex(c.x, c.y, t.width)));
  for (const c of cells) {
    if (!freeAt(ground, c.x, c.y, tier)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = c.x + dx, ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height) return false;
        const i = flatIndex(nx, ny, t.width);
        if (mine.has(i) || own.has(i)) continue;
        if (surfaceOf(t, nx, ny) < tier) return false;
      }
    }
  }
  return true;
}

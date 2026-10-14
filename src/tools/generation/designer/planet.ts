/**
 * What the template says about the planet before anything is planned on it: the anchor landmark's
 * cells and ground, the buildable land, where terrain may be painted, and the tier every cell stands
 * at once a composition is realized. Every stage reads the planet through these, so the plan and the
 * commit cannot disagree about the shoreline or the hub.
 */
import { templateAnchor } from '../../../core/model/landmarks';
import { stepDistance } from '../../../core/grid/cell-sets';
import { flatIndex, rectContains, type Rect } from '../../../core/grid/rect';
import { footprintTerrain, wholeCellsOf } from '../../../core/grid/footprint';
import { isBuildableZone } from '../../../core/game/zones';
import { bleedsOffBuildable } from '../../../rules/zone-restriction';
import { BASE_SUPPORT } from '../../../core/game/profile';
import type { MapTemplate } from '../../../core/model/types';
import type { CompositionPlan } from './composition/composition';

/** Tiers a cell may stand above the nearest ground nothing stands on, per cell of distance. */
export const TIER_PER_CELL = BASE_SUPPORT.reach;

/** Whether the plan may build on the template's cell (x, y): its zone is buildable and the anchor
 *  landmark does not cover the whole cell (`anchorCells`), whatever ground the template records
 *  there. Every land, paint and level reading below asks this one question; a stage reading the
 *  built map asks the cell instead (`tools/reading/masks.ts:landAt`). */
function planBuildableAt(template: MapTemplate, x: number, y: number): boolean {
  return isBuildableZone(template.zones[y]?.[x]) && !rectContains(anchorCells(template), x, y);
}

/** The cells the template's anchor landmark covers whole; empty when it lays none. A cell it covers
 *  only in part stays land the plan reads, as the built-in planets record it. */
function anchorCells(template: MapTemplate): Rect {
  let rect = ANCHOR_CELLS.get(template);
  if (!rect) {
    const p = templateAnchor(template) ?? { x: 0, y: 0, width: 0, height: 0 };
    rect = wholeCellsOf({ x: p.x, y: p.y, w: p.width, h: p.height });
    ANCHOR_CELLS.set(template, rect);
  }
  return rect;
}

const ANCHOR_CELLS = new WeakMap<MapTemplate, Rect>();

/** The template's anchor landmark as whole macro cells: the hub every stage measures from, empty
 *  when the template lays none. Its config sits on the half grid, so the rect is the cells it touches. */
export function hubRect(template: MapTemplate): Rect {
  const p = templateAnchor(template) ?? { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.floor(p.x), y = Math.floor(p.y);
  return { x, y, w: Math.ceil(p.x + p.width) - x, h: Math.ceil(p.y + p.height) - y };
}

/** The terrain cells the template's anchor landmark rests on (`footprintTerrain`), half a cell past a
 *  footprint on whole cells; empty when the template lays none. No edit paints them while it stands. */
function anchorGround(template: MapTemplate): Rect {
  const p = templateAnchor(template);
  if (!p || p.width <= 0 || p.height <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  return footprintTerrain({ x: p.x, y: p.y, w: p.width, h: p.height });
}

/**
 * The tier the template's anchor landmark stands at: the lowest mountain layer on `anchorGround`, since
 * support counts only where every cell holds it. Zero when the template lays no terrain there or has
 * no anchor. The generator neither lowers nor paints that ground, so the plaza's plate is planned at
 * this tier and the ground round the plaza meets it flush.
 */
export function anchorTier(template: MapTemplate): number {
  const r = anchorGround(template);
  if (!template.terrain || r.w <= 0 || r.h <= 0) return 0;
  let low = Infinity;
  for (let y = Math.max(0, r.y); y < Math.min(template.height, r.y + r.h); y++) {
    for (let x = Math.max(0, r.x); x < Math.min(template.width, r.x + r.w); x++) {
      low = Math.min(low, template.terrain[flatIndex(x, y, template.width)] ?? 0);
    }
  }
  return Number.isFinite(low) ? low : 0;
}

/**
 * Where terrain may be painted at all (V-ZONE-01): a buildable cell a painted block does not bleed
 * off of (`rules/zone-restriction.ts:bleedsOffBuildable`), the anchor's cells counting as unbuildable.
 * Every stage that asks how high the ground stands reads this, so the plan and the commit cannot
 * disagree about the shoreline.
 */
export function paintableMask(template: MapTemplate): Uint8Array {
  const W = template.width, H = template.height;
  const out = new Uint8Array(W * H);
  const grass = (x: number, y: number): boolean => planBuildableAt(template, x, y);
  const ground = (x: number, y: number): boolean | null =>
    x < 0 || y < 0 || x >= W || y >= H ? null : grass(x, y);
  const held = anchorGround(template);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (rectContains(held, x, y)) continue;
      if (grass(x, y) && !bleedsOffBuildable(ground, { x, y })) {
        out[flatIndex(x, y, W)] = 1;
      }
    }
  }
  return out;
}

/**
 * The tier every cell stands at once the composition is realized: its plate's tier, capped at
 * `TIER_PER_CELL` per cell of distance from the nearest ground no block may stand on, which draws a
 * plate's rim down to the shore. The cap is V-MTN-03 read forward (a cell at `3d` has every 3x3
 * neighbour at `3d - 3` or more), and `PLATE_STEP_MAX` bounds neighbouring plates the same way, so
 * the field is legal by construction. Every stage reads this field rather than a plate's nominal
 * tier, or it would plan pavement onto ground that comes out a tier lower.
 */
export function cellTiers(template: MapTemplate, plan: CompositionPlan): Int8Array {
  const W = template.width, H = template.height;
  const paintable = paintableMask(template);
  const seeds: number[] = [];
  for (let i = 0; i < paintable.length; i++) if (!paintable[i]) seeds.push(i);
  const inland = stepDistance(seeds, W, H, true);
  const out = new Int8Array(W * H);
  for (let i = 0; i < out.length; i++) {
    if (!paintable[i]) continue;
    const plate = plan.plateOf[i]!;
    if (plate < 0) continue;
    out[i] = Math.max(0, Math.min(plan.plates[plate]!.tier, TIER_PER_CELL * inland[i]!));
  }
  // The ground the anchor rests on stands at the plaza plate's tier, which is the anchor's own.
  const held = anchorGround(template);
  const hub = plan.plates[plan.hubPlateId]?.tier ?? 0;
  for (let y = Math.max(0, held.y); y < Math.min(H, held.y + held.h); y++) {
    for (let x = Math.max(0, held.x); x < Math.min(W, held.x + held.w); x++) out[flatIndex(x, y, W)] = hub;
  }
  return out;
}

/**
 * The cells a road tile's `flat` window stands level on: the cell is buildable, and it, the column
 * right of it and the row below it all stand at one tier on buildable ground or on the anchor
 * landmark's own cells, whose ground no stage raises and which the flat trait lets an item meet
 * flush. Read as off the planet, a landmark on whole cells would leave no tile against its west and
 * north faces while its east and south faces kept theirs.
 */
export function levelWindows(template: MapTemplate, tiers: Int8Array): Uint8Array {
  const W = template.width, H = template.height;
  const hubArea = hubRect(template);
  const ground = (x: number, y: number): boolean =>
    planBuildableAt(template, x, y) || rectContains(hubArea, x, y);
  const out = new Uint8Array(W * H);
  for (let y = 0; y + 1 < H; y++) {
    for (let x = 0; x + 1 < W; x++) {
      if (!planBuildableAt(template, x, y)) continue;
      const t = tiers[flatIndex(x, y, W)]!;
      let ok = true;
      for (let dy = 0; dy <= 1 && ok; dy++) {
        for (let dx = 0; dx <= 1 && ok; dx++) {
          ok = ground(x + dx, y + dy) && tiers[flatIndex(x + dx, y + dy, W)] === t;
        }
      }
      if (ok) out[flatIndex(x, y, W)] = 1;
    }
  }
  return out;
}

/** The buildable planet: the Grass zone, the same mask the layout packs lots on. */
export function landMask(template: MapTemplate): Uint8Array {
  const W = template.width, H = template.height;
  const land = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (planBuildableAt(template, x, y)) land[flatIndex(x, y, W)] = 1;
    }
  }
  return land;
}

/** Chebyshev distance from the nearest unbuildable cell: how much support the ground can offer,
 *  three tiers per cell, exactly as the sculptor reads it. */
export function coastDistance(land: Uint8Array, W: number, H: number): Int16Array {
  const seeds: number[] = [];
  for (let i = 0; i < land.length; i++) if (!land[i]) seeds.push(i);
  return stepDistance(seeds, W, H, true);
}

/** The planet's centre of area: the origin a mass direction is fairly measured from. */
export function landCentroid(land: Uint8Array, W: number): { x: number; y: number } {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < land.length; i++) {
    if (!land[i]) continue;
    n++; sx += i % W; sy += (i / W) | 0;
  }
  return n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
}

export function landBox(land: Uint8Array, W: number, H: number): Rect {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!land[flatIndex(x, y, W)]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? { x: 0, y: 0, w: 0, h: 0 } : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** The plaza's centre in macro cells: the hub every distance here is measured from. */
export function hubCentre(template: MapTemplate): { x: number; y: number } {
  const r = hubRect(template);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

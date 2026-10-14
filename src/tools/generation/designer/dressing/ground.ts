/**
 * Reads the finished map into the planted runs the kits compose: the open ground left at each
 * level, segmented into runs, assigned to the regions they stand in, and grouped into the level
 * runs that share one palette.
 */
import { flatIndex, rectContains, type Rect } from '../../../../core/grid/rect';
import { NEIGHBORS4 } from '../../../../core/grid/directions';
import { componentCells, labelComponents } from '../../../../core/grid/cell-sets';
import { footprintCells } from '../../../../core/grid/footprint';
import { landmarkCells } from '../../../../core/model/landmarks';
import { objectRect } from '../../../../state/object-geometry';
import type { PlaceCtx } from '../../../placement/object';
import type { DesignPlan, RegionPlan } from '../types';
import { landAt } from '../../../reading/masks';

/** How far past its lot a region's claim reaches when a run is being assigned an owner. A run of open
 *  ground is cut by the streets and the terraces rather than by the layout, so it rarely lines up
 *  with a lot; this is the margin within which a run still counts as part of the place beside it. */
const APRON = 10;
/** A run smaller than this is not a place; it is a gap between two of them. Eight rather than a
 *  dozen because a terraced planet's open ground comes in smaller pieces than a plain's: the runs
 *  between a step, a street and a pool are what most of a rich map is made of, and dropping them
 *  leaves it thinner than the density band the built-in planets share. */
const RUN_MIN_CELLS = 8;

// --- reading the finished map -----------------------------------------------------------------------

/**
 * Open ground a plant may stand on: buildable land whose flat sweep is level and dry, with nothing
 * standing on it and nothing about it that `tryDecorate` would refuse.
 *
 * The last part is why the gate is repeated here rather than left to the placer: a mark the rules
 * turn down is a hole in a mirrored composition, so the ground has to be read the same way the
 * placement will judge it. Two cells are open but unplantable — one reserved as clearance at a door
 * or a crossing end, and one with pavement on two or more sides, which is a median strip or a pocket
 * a looping street encloses rather than a curb.
 */
export function openGround(
  place: PlaceCtx, surface: Int8Array, avoid?: ReadonlySet<number>,
  within?: (x: number, y: number) => boolean,
): Uint8Array {
  const state = place.state;
  const W = state.template.width, H = state.template.height;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = flatIndex(x, y, W);
      if (surface[i]! < 0 || !landAt(state, x, y)) continue;
      if (place.clearance.has(i) || avoid?.has(i)) continue;
      if (within && !within(x, y)) continue;
      let paved = 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && place.roads.has(flatIndex(nx, ny, W))) paved++;
      }
      if (paved < 2) out[i] = 1;
    }
  }
  for (const o of state.objects.values()) {
    const r = objectRect(o);
    for (const { x, y } of footprintCells(r.x, r.y, r.w, r.h)) {
      if (x >= 0 && y >= 0 && x < W && y < H) out[flatIndex(x, y, W)] = 0;
    }
  }
  return out;
}

/** The runs of open ground, cut wherever the surface elevation changes: the segmentation a place's
 *  symmetry and unity are read over. */
export function segmentRuns(open: Uint8Array, surface: Int8Array, W: number, H: number): number[][] {
  const { labels, sizes } = labelComponents(open, W, H, false, (i, j) => surface[i] === surface[j]);
  return componentCells(labels, sizes.length - 1).filter((cells) => cells.length >= RUN_MIN_CELLS);
}

/** A lot with its apron: the ground a region composes. */
const grounds = (region: RegionPlan): Rect | null => {
  const lot = region.lot[0];
  return lot
    ? { x: lot.x - APRON, y: lot.y - APRON, w: lot.w + 2 * APRON, h: lot.h + 2 * APRON }
    : null;
};

/**
 * Which region composes each run: the one whose lot-plus-apron covers most of it, and it composes
 * the whole run, the unit local symmetry and per-region unity are read over. A run no lot comes
 * near goes to the nearest region rather than staying bare: two fifths of a terraced planet's
 * plantable cells are terraces no lot was planned on, and leaving them bare halves the decoration
 * density the built-in planets share. A far terrace in the nearest palette reads as that place's
 * outskirt.
 */
export function assignRuns(runs: number[][], plan: DesignPlan, W: number): { run: number; regionId: string; cells: number[] }[] {
  const out: { run: number; regionId: string; cells: number[] }[] = [];
  for (const [index, cells] of runs.entries()) {
    let bestId = '', bestOverlap = 0;
    for (const region of plan.regions) {
      const ground = grounds(region);
      if (!ground) continue;
      let overlap = 0;
      for (const i of cells) if (rectContains(ground, i % W, (i / W) | 0)) overlap++;
      if (overlap > bestOverlap) { bestOverlap = overlap; bestId = region.id; }
    }
    if (!bestId) bestId = nearestRegion(plan, cells, W);
    if (bestId) out.push({ run: index, regionId: bestId, cells });
  }
  return out;
}

/**
 * Which region's palette each owned cell is planted in: one palette per level run of open land as
 * the scores read it (`levelGroups`), that of the region owning most of the run.
 *
 * Buildings and their clearance cut the ground this pass plants into several runs, each composed by
 * its own region, while per-region unity reads the level run through them. The ring of open ground
 * round the plaza passes the doors of several places, so owned piece by piece it read as one run
 * planted in every palette at once. The arrangement stays each run's own region's; only the colours
 * are shared.
 */
export function groupPalettes(
  owners: readonly { regionId: string; cells: readonly number[] }[], groups: Int32Array, plan: DesignPlan,
): Map<number, string> {
  const tally = new Map<number, Map<string, number>>();
  for (const owned of owners) {
    for (const i of owned.cells) {
      const g = groups[i]!;
      if (g < 0) continue;
      const counts = tally.get(g) ?? new Map<string, number>();
      counts.set(owned.regionId, (counts.get(owned.regionId) ?? 0) + 1);
      tally.set(g, counts);
    }
  }
  const chosen = new Map<number, string>();
  for (const [g, counts] of tally) {
    let best = '', most = 0;
    for (const region of plan.regions) {
      const n = counts.get(region.id) ?? 0;
      if (n > most) { most = n; best = region.id; }
    }
    if (best) chosen.set(g, best);
  }
  const out = new Map<number, string>();
  for (const owned of owners) {
    for (const i of owned.cells) {
      const id = chosen.get(groups[i]!);
      if (id) out.set(i, id);
    }
  }
  return out;
}

/** The level runs of open land as the scores read them (`tools/reading/regions.ts:segmentRegions`): ground at one
 *  surface, cut by pavement and the laid landmarks but not by buildings or their clearance. */
export function levelGroups(place: PlaceCtx, surface: Int8Array, W: number, H: number): Int32Array {
  const state = place.state;
  const blocked = new Uint8Array(W * H);
  for (const { x, y } of landmarkCells(state)) {
    if (x >= 0 && y >= 0 && x < W && y < H) blocked[flatIndex(x, y, W)] = 1;
  }
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (surface[i]! >= 0 && !blocked[i] && !place.roads.has(i)) open[i] = 1;
  const { labels } = labelComponents(open, W, H, false, (i, j) => surface[i] === surface[j]);
  const group = new Int32Array(W * H);
  for (let i = 0; i < W * H; i++) group[i] = labels[i]! - 1;
  return group;
}

/** The region whose lot is nearest a run's own centre. Ties break on the region id, so the answer
 *  does not depend on the plan's order. */
export function nearestRegion(plan: DesignPlan, cells: readonly number[], W: number): string {
  let sx = 0, sy = 0;
  for (const i of cells) { sx += i % W; sy += (i / W) | 0; }
  const cx = sx / cells.length, cy = sy / cells.length;
  let bestId = '', bestD = Infinity;
  for (const region of plan.regions) {
    const lot = region.lot[0];
    if (!lot) continue;
    const dx = Math.max(lot.x - cx, 0, cx - (lot.x + lot.w));
    const dy = Math.max(lot.y - cy, 0, cy - (lot.y + lot.h));
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && region.id < bestId)) { bestD = d; bestId = region.id; }
  }
  return bestId;
}

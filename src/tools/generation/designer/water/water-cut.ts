/**
 * The cutting primitives every water pass of the sculptor shares: may this be flooded at a tier, and
 * flood it.
 *
 * WHY THEY LIVE TOGETHER. Water is legal here by construction rather than by repair, and the whole
 * argument fits in two tests. A body whose every surrounding cell stands at its own level or above
 * shows no FACE, so V-WTR-02 asks it for no caps at all (`poolFits`, `cellsFit`). A body that DOES
 * show one — a fall on a terrace step — needs a cap of mountain at exactly its own tier at each
 * perpendicular end and a downstream row at one elevation, which is `atTier` and `uniform`. Three
 * passes cut water (the story, the fountain court, the sculptor's own falls and accents) and all
 * three make the same argument, so they make it with the same code.
 *
 * Pure over a `TerrainPlan`: data in, data mutated in place, no state and no rules consulted.
 */
import { flatIndex } from '../../../../core/model/grid-model';
import type { MacroCoord, Rect } from '../../../../core/model/types';
import type { TerrainPlan } from '../../core/types';

/**
 * The surface a cell presents: its water level where it holds water, else its tier. -1 off the GRID,
 * which is the one reading V-WTR-02 makes lower than any water.
 *
 * A cell off the buildable island is NOT off the grid: it carries no terrain, so its surface is 0,
 * and water at ground level may run right up to the coast without showing a face. Only the grid's
 * own edge is a drop.
 */
export function surfaceOf(t: TerrainPlan, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return -1;
  const i = flatIndex(x, y, t.width);
  return t.water[i]! >= 0 ? t.water[i]! : t.tier[i]!;
}

/** Whether a cell is untouched island terrace standing at `tier`: what a cut may take. */
export function freeAt(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, x: number, y: number, tier: number,
): boolean {
  if (x < 1 || y < 1 || x >= t.width - 1 || y >= t.height - 1) return false;
  const i = flatIndex(x, y, t.width);
  return grass[i] === 1 && !flat[i] && t.water[i]! < 0 && t.tier[i] === tier;
}

/** Whether every cell of a rect is untouched island terrace standing at `tier`. */
export function atTier(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, rect: Rect, tier: number,
): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) if (!freeAt(t, grass, flat, x, y, tier)) return false;
  }
  return true;
}

/**
 * Whether a SET of cells may be flooded at `tier` together.
 *
 * The set is judged as one body: a cell of the set is allowed to be another's neighbour, which is
 * what lets a stream widen and turn. Everything outside it must stand at `tier` or above, so the
 * finished body shows no face and needs no caps.
 */
export function cellsFit(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, cells: readonly MacroCoord[], tier: number,
): boolean {
  if (cells.length === 0) return false;
  const own = new Set(cells.map((c) => flatIndex(c.x, c.y, t.width)));
  for (const c of cells) {
    if (!freeAt(t, grass, flat, c.x, c.y, tier)) return false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = c.x + dx, ny = c.y + dy;
        if (nx >= 0 && ny >= 0 && nx < t.width && ny < t.height
          && own.has(flatIndex(nx, ny, t.width))) continue;
        if (surfaceOf(t, nx, ny) < tier) return false;
      }
    }
  }
  return true;
}

/** Whether a rect may be flooded at `tier`: every cell of it untouched terrace at that tier, and
 *  every cell of the ring around it standing at that tier or higher, so the body shows no face. */
export function poolFits(
  t: TerrainPlan, grass: Uint8Array, flat: Uint8Array, rect: Rect, tier: number,
): boolean {
  if (rect.w < 1 || rect.h < 1) return false;
  if (rect.x < 1 || rect.y < 1 || rect.x + rect.w + 1 > t.width || rect.y + rect.h + 1 > t.height) return false;
  for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      // KEEPING THE INSIDE OFF THE RESERVATION IS THE WHOLE OF THE COATING'S CLAIM. A road at
      // (x, y) validates (x, y), (x+1, y), (x, y+1) and (x+1, y+1), and `flatReservation` holds all
      // four, so a bed that takes none of them cannot refuse a street however closely it runs beside
      // one. The ring is free to be reserved ground.
      if (inside) {
        if (!freeAt(t, grass, flat, x, y, tier)) return false;
        continue;
      }
      if (surfaceOf(t, x, y) < tier) return false;
    }
  }
  return true;
}

/** Whether every cell of a rect stands at ONE surface level and is on the island: the reading
 *  V-WTR-03 makes of the row a fall pours onto. */
export function uniform(t: TerrainPlan, grass: Uint8Array, rect: Rect): boolean {
  let level: number | null = null;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) return false;
      if (!grass[flatIndex(x, y, t.width)]) return false;
      const here = surfaceOf(t, x, y);
      if (level === null) level = here;
      else if (here !== level) return false;
    }
  }
  return level !== null;
}

/** Flood a rect at `tier`: the water carries the level and the ground under it reads as cut. */
export function flood(t: TerrainPlan, rect: Rect, tier: number): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) floodCell(t, x, y, tier);
  }
}

/** Flood a set of cells at `tier`. */
export function floodCells(t: TerrainPlan, cells: readonly MacroCoord[], tier: number): void {
  for (const c of cells) floodCell(t, c.x, c.y, tier);
}

function floodCell(t: TerrainPlan, x: number, y: number, tier: number): void {
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return;
  const i = flatIndex(x, y, t.width);
  t.tier[i] = 0;
  t.water[i] = tier;
}

/** The bounding box of a set of cells; an empty set answers a zero rect. */
export function boundsOfCells(cells: readonly MacroCoord[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

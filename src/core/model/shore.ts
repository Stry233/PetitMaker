/* The shore rim: sea and sand within the profile's shore radius of grass, derived and never drawn. */
import { PLANET_PROFILE } from '../game/profile';
import { OFF_MAP_ZONE, RIM_ZONE, SAND_ZONE, groundZone, isGrassZone, isRimZone, isSandZone, type CellZone } from '../game/zones';
import type { MacroCell, MacroCoord } from './types';

const SHORE = PLANET_PROFILE.shoreRadius;

/** From this many changed cells a full pass is cheaper than the local pass on the full-size session
 *  canvas, whose cost grows with each changed cell and with how far apart they lie. */
const REFRESH_FULL_PASS_AT = 2000;

/** Whether grass lies within the shore radius of (x, y). */
function nearGround(zoneAt: (x: number, y: number) => CellZone | undefined, x: number, y: number): boolean {
  for (let dy = -SHORE; dy <= SHORE; dy++) for (let dx = -SHORE; dx <= SHORE; dx++) {
    const z = zoneAt(x + dx, y + dy);
    if (z !== undefined && isGrassZone(z)) return true;
  }
  return false;
}

/** Whether each cell has grass within the shore radius, by a row window then a column window. */
function groundNear(zones: readonly (readonly CellZone[])[]): (x: number, y: number) => boolean {
  // `across[y][x]` says whether row y holds ground within the radius of x, read off a running count
  // of the row's ground.
  const across = zones.map((row) => {
    const count = new Uint32Array(row.length + 1);
    row.forEach((z, x) => { count[x + 1] = count[x]! + (isGrassZone(z) ? 1 : 0); });
    const near = new Uint8Array(row.length);
    for (let x = 0; x < row.length; x++) near[x] = count[Math.min(row.length, x + SHORE + 1)]! > count[Math.max(0, x - SHORE)]! ? 1 : 0;
    return near;
  });
  return (x, y) => {
    for (let dy = -SHORE; dy <= SHORE; dy++) if (across[y + dy]?.[x]) return true;
    return false;
  };
}

/**
 * A new grid whose sea and sand within the shore radius of grass are the rim. A rim
 * cell in the input is read as open sea, so a rim beyond the radius becomes the off-map zone.
 */
export function deriveBoundary(zones: CellZone[][]): CellZone[][] {
  const near = groundNear(zones);
  return zones.map((row, y) => row.map((z, x): CellZone => {
    if (isGrassZone(z)) return z;
    if (near(x, y)) return RIM_ZONE;
    return isRimZone(z) ? OFF_MAP_ZONE : z;
  }));
}

/**
 * The ground under each rim cell of a stored template. `sand` lists, as row-major indices, the
 * rim cells whose ground is sand (`rimSandOf`); without it a rim cell reads as sand when any of its
 * eight neighbours is sand, otherwise sea. A rim cell in a concave corner meets the ground beyond only
 * diagonally.
 */
export function groundUnderRim(zones: readonly (readonly CellZone[])[], sand?: readonly number[]): CellZone[][] {
  const width = zones[0]?.length ?? 0;
  const listed = sand ? new Set(sand) : null;
  const sandNear = (x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isSandZone(zones[y + dy]?.[x + dx])) return true;
    return false;
  };
  const isSand = (x: number, y: number) => (listed ? listed.has(y * width + x) : sandNear(x, y));
  return zones.map((row, y) => row.map((z, x): CellZone => (isRimZone(z) ? (isSand(x, y) ? SAND_ZONE : OFF_MAP_ZONE) : z)));
}

/**
 * The row-major indices of the rim cells in `zones` whose ground in `ground` is sand: what a
 * stored template's rim hides and `groundUnderRim` restores. It is kept beside the template, outside
 * its id, which names the planet as it looks.
 */
export function rimSandOf(ground: readonly (readonly CellZone[])[], zones: readonly (readonly CellZone[])[]): number[] {
  const width = zones[0]?.length ?? 0;
  const out: number[] = [];
  zones.forEach((row, y) => row.forEach((z, x) => { if (isRimZone(z) && isSandZone(ground[y]?.[x])) out.push(y * width + x); }));
  return out;
}

/** Settles one cell's rim by `near`, keeping the ground under it; whether its zone changed. */
function settleRim(cell: MacroCell, near: boolean): boolean {
  if (isGrassZone(cell.zone)) return false;
  if (near) {
    if (isRimZone(cell.zone)) return false;
    if (isSandZone(cell.zone)) cell.under = cell.zone;
    cell.zone = RIM_ZONE;
    return true;
  }
  if (!isRimZone(cell.zone)) return false;
  cell.zone = groundZone(cell);
  delete cell.under;
  return true;
}

/**
 * Re-derives in place, by `deriveBoundary`'s rule, the rim of every sea or sand cell within the shore
 * radius of `changed`: the only cells whose rim a change of ground there can move. A cell that becomes
 * rim keeps its own ground in `under`, and one that leaves the rim gets that ground back. Returns the
 * cells whose zone changed. `fullPassAt` is the changed-cell count from which one pass over the whole
 * grid is used instead.
 */
export function refreshBoundary(cells: MacroCell[][], changed: readonly MacroCoord[], fullPassAt = REFRESH_FULL_PASS_AT): MacroCoord[] {
  const zoneAt = (x: number, y: number) => cells[y]?.[x]?.zone;
  const height = cells.length, width = cells[0]?.length ?? 0;
  const out: MacroCoord[] = [];
  if (changed.length >= fullPassAt) {
    const near = groundNear(cells.map((row) => row.map((c) => c.zone)));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (settleRim(cells[y]![x]!, near(x, y))) out.push({ x, y });
    }
    return out;
  }
  const seen = new Uint8Array(width * height);
  for (const c of changed) {
    // A half-step object announces its half-cell anchor; the window covers the cells either side of it.
    for (let y = Math.max(0, Math.floor(c.y) - SHORE); y <= Math.min(height - 1, Math.ceil(c.y) + SHORE); y++) {
      for (let x = Math.max(0, Math.floor(c.x) - SHORE); x <= Math.min(width - 1, Math.ceil(c.x) + SHORE); x++) {
        const cell = cells[y]![x]!;
        if (seen[y * width + x] || isGrassZone(cell.zone)) continue;
        seen[y * width + x] = 1;
        if (settleRim(cell, nearGround(zoneAt, x, y))) out.push({ x, y });
      }
    }
  }
  return out;
}

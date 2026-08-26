/**
 * PURE surface picking: a pointer ray against the terrain heightfield. The
 * scene is a heightfield in disguise — every XZ point has one standable
 * surface height (mountain/water column top on the micro grid, else the
 * ground slab / sea on the macro grid) — so a short-stepped march with
 * bisection refinement finds the FIRST surface the ray pierces without
 * touching any mesh. Heights mirror the mesher exactly (terrain-geometry):
 * what you pick is what you see.
 *
 * three-free so the math unit-tests headlessly; the 3D ViewProjection wraps
 * it with camera unprojection.
 */
import { CellZone, TerrainType } from '../../../core/model/types';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { solidTopOf } from '../../../core/edge-cut/terrain-silhouette';
import { GROUND_SLAB_Y, SEA_Y, layerToY, mapCenterOffset, waterSurfaceY } from '../core/coords';


export interface Vec3 { x: number; y: number; z: number }

export interface SurfacePick {
  /** The macro cell the surface belongs to (terrain cells ARE macro coords). */
  cell: MacroCoord;
  /** The surface's layer (0 for ground/sea). */
  elevation: number;
  kind: 'terrain' | 'water' | 'ground' | 'sea';
  /** The refined world-space hit point (overlays sit here). */
  point: Vec3;
}

interface SurfaceAt { h: number; cell: MacroCoord; elevation: number; kind: SurfacePick['kind'] }

/** The visible surface at world (wx, wz), or null outside the map. */
function surfaceAt(state: GridState, wx: number, wz: number): SurfaceAt | null {
  const { width, height } = state.template;
  const off = mapCenterOffset(width, height);
  const mx = Math.floor(wx + off.x), mz = Math.floor(wz + off.z);
  const inMap = mx >= 0 && mz >= 0 && mx < width && mz < height;

  // Terrain column on the micro grid: cell (x,y) covers [x−0.5, x+0.5) in cell space.
  const tx = Math.floor(wx + off.x + 0.5), tz = Math.floor(wz + off.z + 0.5);
  let best: SurfaceAt | null = null;
  if (tx >= 0 && tz >= 0 && tx < width && tz < height) {
    const t = getCell(state.cells, tx, tz)?.terrain;
    if (t && t.type === TerrainType.Mountain) {
      const top = t.patchOnly ? t.elevation : solidTopOf(t, TerrainType.Mountain);
      if (top > 0) best = { h: layerToY(top), cell: { x: tx, y: tz }, elevation: top, kind: 'terrain' };
    } else if (t && t.type === TerrainType.Water) {
      const top = t.patchOnly ? t.elevation : solidTopOf(t, TerrainType.Water);
      const h = waterSurfaceY(top);
      best = { h, cell: { x: tx, y: tz }, elevation: top, kind: 'water' };
    }
  }
  if (inMap) {
    const zone = getCell(state.cells, mx, mz)!.zone;
    const base: SurfaceAt = zone === CellZone.Void
      ? { h: SEA_Y, cell: { x: mx, y: mz }, elevation: 0, kind: 'sea' }
      : { h: GROUND_SLAB_Y, cell: { x: mx, y: mz }, elevation: 0, kind: 'ground' };
    if (!best || base.h > best.h) best = base;
  }
  return best;
}

/** The standable surface height at world (wx, wz) — the slab where nothing
 *  stands taller. Chrome anchoring (cellToScreen) sits labels on this. */
export function surfaceHeightAt(state: GridState, wx: number, wz: number): number {
  return surfaceAt(state, wx, wz)?.h ?? GROUND_SLAB_Y;
}

const STEP = 0.2;       // < half a micro cell: no column is thin enough to tunnel through
const MAX_DIST = 600;   // beyond any map diagonal
const REFINE = 24;      // bisection iterations for a sub-millimeter hit point

export function pickSurface(state: GridState, origin: Vec3, dir: Vec3): SurfacePick | null {
  const at = (t: number): Vec3 => ({ x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t });
  const below = (p: Vec3): SurfaceAt | null => {
    const s = surfaceAt(state, p.x, p.z);
    return s && p.y <= s.h ? s : null;
  };

  // The origin may start under the surface (a camera dived into a hill): step
  // out of it first so the pick lands on the next surface ahead.
  let t0 = 0;
  while (t0 < MAX_DIST && below(at(t0))) t0 += STEP;

  for (let t = t0 + STEP; t <= MAX_DIST; t += STEP) {
    if (!below(at(t))) continue;
    // Bisection between the last above-sample and this below-sample pins the
    // crossing; classify at the refined point, nudged just past the crossing
    // so wall hits attribute to the column entered.
    let lo = t - STEP, hi = t;
    for (let i = 0; i < REFINE; i++) {
      const mid = (lo + hi) / 2;
      if (below(at(mid))) hi = mid; else lo = mid;
    }
    const p = at(hi);
    const s = surfaceAt(state, p.x, p.z);
    if (!s) return null;
    return { cell: s.cell, elevation: s.elevation, kind: s.kind, point: { x: p.x, y: Math.min(p.y, s.h), z: p.z } };
  }
  return null;
}

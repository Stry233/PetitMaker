/*
 * A terrain cell as a vertical stack: the structural top it contributes as mass and the real surface
 * an object or a paint stands on. A Γ patch is a cosmetic fillet over its real base, so placement,
 * painting, support and bridges read these rather than the raw elevation.
 */
import { TerrainType, type TerrainCell } from '../../model/types';

/** The real structural top a cell contributes as mass. A Γ patch is a cosmetic fillet: it adds no mass of
 *  its own — its support is whatever the cell already was when the corner was cut (`patchBase`): 0 for a
 *  from-empty gamma (no base block, like a tier-1 fillet at any tier), N-1 when it rounds a genuinely real
 *  lower block. Falls back to elevation-1 for patches saved before patchBase existed. A real (non-patch)
 *  block contributes its full elevation. An edge cut never changes this — only the corners. */
export function structuralTop(t: StackFields): number {
  return t.patchOnly ? patchSupport(t) : t.elevation;
}

/** The fields of a terrain stack that decide its structural top, as a cell or a decoded share record carries them. */
interface StackFields { elevation: number; patchOnly?: boolean; patchBase?: number | null }

/** The real support tier under a Γ patch's cosmetic fillet: its `patchBase`, or elevation-1 for a
 *  patch saved before `patchBase` existed. Meaningful only for a `patchOnly` cell. */
export function patchSupport(t: Pick<StackFields, 'elevation' | 'patchBase'>): number {
  return t.patchBase ?? t.elevation - 1;
}

/** Does this terrain hold solid mass of `type` at layer `e`? Mountain at elevation N fills layers 1..N;
 *  water at elevation N fills 0..N (a lake sits at ground level; a waterfall is a column down to its
 *  pool). A Γ patch contributes only its `patchBase` support — its cosmetic fillet tier holds no mass. */
export function terrainSolidAt(t: TerrainCell | null | undefined, type: TerrainType, e: number): boolean {
  if (!t || t.type !== type) return false;
  const top = structuralTop(t);
  return type === TerrainType.Water ? e >= 0 && e <= top : e >= 1 && e <= top;
}

/** The top solid layer this terrain holds as `type` mass (a Γ patch counts as its real base = patchBase,
 *  0 for a from-empty gamma), or 0. */
export function solidTopOf(t: TerrainCell | null | undefined, type: TerrainType): number {
  if (!t || t.type !== type) return 0;
  return structuralTop(t);
}

/**
 * The cell's real standable surface, for placement/support questions. A Γ patch is cosmetic: it reads as
 * its real support (`patchBase`), not its fillet tier — so a from-empty gamma (patchBase 0) is bare ground
 * (null) at any tier, and a gamma rounding a real lower block reads as that block. Placement validity must
 * go through this — raw `terrain.elevation` reads see the fillet as a full block and phantom-block /
 * phantom-allow placements.
 */
export function realSurface(t: TerrainCell | null | undefined): { type: TerrainType; elevation: number } | null {
  const top = surfaceTop(t);
  return top < 0 ? null : { type: t!.type, elevation: top };
}

/** Placement elevation of a cell's real surface (ground = 0). Allocation-free equivalent of
 *  `realSurface(t)?.elevation ?? 0` — this runs inside per-footprint placement sweeps. */
export function surfaceElevation(t: TerrainCell | null | undefined): number {
  const top = surfaceTop(t);
  return top < 0 ? 0 : top;
}

/** The one scalar core behind realSurface/surfaceElevation: the standable-surface elevation, or
 *  −1 when the cell has no real surface (empty/None, a mountain with no real block, a fully
 *  cosmetic water fillet). A water column still holds water below its fillet, hence >= 0. */
function surfaceTop(t: TerrainCell | null | undefined): number {
  if (!t || t.type === TerrainType.None) return -1;
  const top = structuralTop(t);
  if (t.type === TerrainType.Mountain) return top >= 1 ? top : -1;
  return top >= 0 ? top : -1;
}

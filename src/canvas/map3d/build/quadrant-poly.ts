/**
 * The XZ top-face polygon of ONE trimmed quadrant — the 3D mirror of 2D's
 * trim-shapes.ts, and the single derivation every 3D surface that honours an
 * edge cut draws from (the terrain mesher's bevel path, the tool overlay's
 * ghost decals). Pure and three-free: points in cell units, caller places them.
 *
 * A cell is four half-tile quadrants indexed [TL, TR, BL, BR] (corner-index.ts);
 * a `CornerTrim` says which part of its quadrant survives.
 */
import type { CornerTrim } from '../../../core/model/types';
import type { CornerPos } from '../../../core/edge-cut/corner-index';

export type Pt = [number, number];

/** Arc subdivisions of a quarter fan. Matches the 2D fan's smoothness at editor zoom. */
export const FAN_STEPS = 6;

/** A rounded quarter-fan, centred at the opposite corner (outer) or the same
 *  corner (inner, for Γ patches) — mirrors trim-shapes.ts drawFanCorner. */
export function fanPoly(pos: CornerPos, x: number, z: number, s: number, inverted: boolean): Pt[] {
  let cx = x, cz = z, startAngle = 0;
  if (!inverted) {
    if (pos === 'TL') { cx = x + s; cz = z + s; startAngle = Math.PI; }
    else if (pos === 'TR') { cx = x; cz = z + s; startAngle = -Math.PI / 2; }
    else if (pos === 'BL') { cx = x + s; cz = z; startAngle = Math.PI / 2; }
    else { cx = x; cz = z; startAngle = 0; }
  } else {
    if (pos === 'TL') { cx = x; cz = z; startAngle = 0; }
    else if (pos === 'TR') { cx = x + s; cz = z; startAngle = Math.PI / 2; }
    else if (pos === 'BL') { cx = x; cz = z + s; startAngle = -Math.PI / 2; }
    else { cx = x + s; cz = z + s; startAngle = Math.PI; }
  }
  const pts: Pt[] = [[cx, cz]];
  for (let i = 0; i <= FAN_STEPS; i++) {
    const a = startAngle + (Math.PI / 2) * (i / FAN_STEPS);
    // The two arc ENDPOINTS (i=0, i=FAN_STEPS) sit at multiples of π/2, where cos/sin are exactly
    // 0/±1 — but Math.cos/sin return ~1e-16 residues there. Snap them so a fan's straight edges land
    // BIT-EXACTLY on the grid. The 3D water mesher recovers its wall outline by exact edge-matching a
    // fan against its square/triangle siblings; the residue would otherwise break that (phantom interior
    // seams on cells near the map centre, where it survives double precision). Mid-arc points stay exact.
    const end = i === 0 || i === FAN_STEPS;
    const ca = end ? Math.round(Math.cos(a)) : Math.cos(a);
    const sa = end ? Math.round(Math.sin(a)) : Math.sin(a);
    pts.push([cx + ca * s, cz + sa * s]);
  }
  return pts;
}

/** The top-face polygon (XZ) for one trimmed quadrant — mirrors trim-shapes.ts
 *  (square / triangle / outer-or-inner fan). null = 'empty' (no quadrant). */
export function cornerPolygon(trim: CornerTrim, x: number, z: number, s: number, pos: CornerPos, patchOnly: boolean): Pt[] | null {
  switch (trim) {
    case 'empty': return null;
    case 'square': return [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];
    case 'fan': return fanPoly(pos, x, z, s, patchOnly);
    case 'tri-NW': return [[x, z], [x + s, z], [x, z + s]];
    case 'tri-NE': return [[x, z], [x + s, z], [x + s, z + s]];
    case 'tri-SW': return [[x, z + s], [x, z], [x + s, z + s]];
    case 'tri-SE': return [[x + s, z], [x + s, z + s], [x, z + s]];
  }
}

/**
 * The quadrant MINUS its kept polygon — the region a trim rounds away, which is what the cut opens
 * onto: 2D's backing region, the mesher's shaped reveal, and the height a surface drape has to take
 * there. null = 'square' (nothing is cut away). `patchOnly` picks the same winding `cornerPolygon`
 * took, so the pair always partitions the quadrant.
 *
 * Fan-triangulable from its FIRST vertex: the corner the fan's centre is NOT on sees the whole
 * region (an outer fan is centred on the far corner and leaves the near one, an inner fillet the
 * reverse), which the arc's own curvature makes true of no other vertex.
 */
export function cornerComplement(trim: CornerTrim, x: number, z: number, s: number, pos: CornerPos, patchOnly: boolean): Pt[] | null {
  const near: Pt = pos === 'TL' ? [x, z] : pos === 'TR' ? [x + s, z] : pos === 'BL' ? [x, z + s] : [x + s, z + s];
  const far: Pt = pos === 'TL' ? [x + s, z + s] : pos === 'TR' ? [x, z + s] : pos === 'BL' ? [x + s, z] : [x, z];
  switch (trim) {
    case 'square': return null;
    case 'empty': return [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];
    case 'fan': return [patchOnly ? far : near, ...fanPoly(pos, x, z, s, patchOnly).slice(1)];
    case 'tri-NW': return [[x + s, z], [x + s, z + s], [x, z + s]];
    case 'tri-NE': return [[x, z], [x + s, z + s], [x, z + s]];
    case 'tri-SW': return [[x, z], [x + s, z], [x + s, z + s]];
    case 'tri-SE': return [[x, z], [x + s, z], [x, z + s]];
  }
}

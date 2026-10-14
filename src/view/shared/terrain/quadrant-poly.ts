/**
 * The top-face polygon of one trimmed quadrant, the single derivation every surface that honours an
 * edge cut draws from in both views (2D trim shapes, the 3D terrain mesher's bevel path, the tool
 * overlay's ghost decals). Pure and engine-free: points in the caller's units (cell units in 3D
 * X/Z, pixels in 2D), the caller places them.
 *
 * A cell is four half-tile quadrants indexed [TL, TR, BL, BR] (core/model/corners.ts);
 * a `CornerTrim` says which part of its quadrant survives.
 */
import type { CornerTrim } from '../../../core/model/types';
import type { CornerPos } from '../../../core/model/corners';

export type Pt = [number, number];

/** One quadrant: its top-left corner (x, z), its side `s`, and which corner of the cell it is. */
export interface Quadrant { x: number; z: number; s: number; pos: CornerPos }

/** Arc subdivisions of a quarter fan in the 3D meshes; the 2D view passes its own count. */
const FAN_STEPS = 6;

/** A rounded quarter-fan of `steps` arc segments, centred at the opposite corner (outer) or the
 *  same corner (inner, for Γ patches). */
function fanPoly(q: Quadrant, inverted: boolean, steps = FAN_STEPS): Pt[] {
  const { x, z, s, pos } = q;
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
  for (let i = 0; i <= steps; i++) {
    const a = startAngle + (Math.PI / 2) * (i / steps);
    // The two arc endpoints (i=0, i=steps) sit at multiples of π/2, where cos/sin are exactly
    // 0/±1 — but Math.cos/sin return ~1e-16 residues there. Snap them so a fan's straight edges land
    // Bit-exactly on the grid. The 3D water mesher recovers its wall outline by exact edge-matching a
    // fan against its square/triangle siblings; the residue would otherwise break that (phantom interior
    // seams on cells near the map centre, where it survives double precision). Mid-arc points stay exact.
    const end = i === 0 || i === steps;
    const ca = end ? Math.round(Math.cos(a)) : Math.cos(a);
    const sa = end ? Math.round(Math.sin(a)) : Math.sin(a);
    pts.push([cx + ca * s, cz + sa * s]);
  }
  return pts;
}

/** The top-face polygon for one trimmed quadrant (square / triangle / outer-or-inner fan).
 *  null = 'empty' (no quadrant). */
export function cornerPolygon(trim: CornerTrim, q: Quadrant, patchOnly: boolean, steps = FAN_STEPS): Pt[] | null {
  const { x, z, s } = q;
  switch (trim) {
    case 'empty': return null;
    case 'square': return [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];
    case 'fan': return fanPoly(q, patchOnly, steps);
    case 'tri-NW': return [[x, z], [x + s, z], [x, z + s]];
    case 'tri-NE': return [[x, z], [x + s, z], [x + s, z + s]];
    case 'tri-SW': return [[x, z + s], [x, z], [x + s, z + s]];
    case 'tri-SE': return [[x + s, z], [x + s, z + s], [x, z + s]];
  }
}

/**
 * The quadrant minus its kept polygon — the region a trim rounds away, which is what the cut opens
 * onto: 2D's backing region, the mesher's shaped reveal, and the height a surface drape has to take
 * there. null = 'square' (nothing is cut away). `patchOnly` picks the same winding `cornerPolygon`
 * took, so the pair always partitions the quadrant.
 *
 * Fan-triangulable from its first vertex: the corner the fan's centre is not on sees the whole
 * region (an outer fan is centred on the far corner and leaves the near one, an inner fillet the
 * reverse), which the arc's own curvature makes true of no other vertex.
 */
export function cornerComplement(trim: CornerTrim, q: Quadrant, patchOnly: boolean): Pt[] | null {
  const { x, z, s, pos } = q;
  const near: Pt = pos === 'TL' ? [x, z] : pos === 'TR' ? [x + s, z] : pos === 'BL' ? [x, z + s] : [x + s, z + s];
  const far: Pt = pos === 'TL' ? [x + s, z + s] : pos === 'TR' ? [x, z + s] : pos === 'BL' ? [x + s, z] : [x, z];
  switch (trim) {
    case 'square': return null;
    case 'empty': return [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];
    case 'fan': return [patchOnly ? far : near, ...fanPoly(q, patchOnly).slice(1)];
    case 'tri-NW': return [[x + s, z], [x + s, z + s], [x, z + s]];
    case 'tri-NE': return [[x, z], [x + s, z + s], [x, z + s]];
    case 'tri-SW': return [[x, z], [x + s, z], [x + s, z + s]];
    case 'tri-SE': return [[x, z], [x + s, z], [x, z + s]];
  }
}

/** Convex polygon `poly` clipped to the box [x0, x1] × [z0, z1] (Sutherland-Hodgman); fewer than
 *  three points when they do not overlap. */
export function clipToBox(poly: readonly Pt[], x0: number, z0: number, x1: number, z1: number): Pt[] {
  let out: Pt[] = [...poly];
  for (const [axis, sign, bound] of [[0, -1, -x0], [0, 1, x1], [1, -1, -z0], [1, 1, z1]] as const) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i]!, b = input[(i + 1) % input.length]!;
      const da = a[axis] * sign - bound, db = b[axis] * sign - bound;
      if (da <= 0) out.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return out;
}

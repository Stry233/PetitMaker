/** Flat-array mesh emitters both 3D builders share: quads, fans and the zero-area guard. */
import type { MeshData } from './types';
import type { Rgb } from '../draw/palette';
import type { Pt } from '../../shared/terrain/quadrant-poly';

export type Vec3 = [number, number, number];

/** Append a quad (4 corners, CCW seen from outside) with one flat colour. */
export function quad(m: MeshData, corners: readonly [Vec3, Vec3, Vec3, Vec3], col: Rgb): void {
  const base = m.positions.length / 3;
  for (const p of corners) { m.positions.push(p[0], p[1], p[2]); m.colors.push(col[0], col[1], col[2]); }
  m.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function emptyMesh(): MeshData { return { positions: [], colors: [], index: [] }; }

/** Twice the signed XZ area of a triangle — 0 means it cannot draw. A zero-area triangle is
 *  never emitted here: the rasterizer's edge tests can disagree about one and leak lone samples
 *  (collinear slivers rendered as isolated bright pixels). */
export function area2(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Fan-triangulate a top polygon (XZ points) at world height `y`. The polygon must be visible
 *  whole from its first vertex (convex, or star-shaped from there — `RoadFeed` polygons lead
 *  with their star vertex for exactly this): a fan across a concave stretch overdraws it. */
export function pushPolyTop(m: MeshData, pts: Pt[], y: number, col: Rgb): void {
  const base = m.positions.length / 3;
  for (const [px, pz] of pts) { m.positions.push(px, y, pz); m.colors.push(col[0], col[1], col[2]); }
  for (let i = 1; i < pts.length - 1; i++) {
    if (area2(pts[0]!, pts[i]!, pts[i + 1]!) === 0) continue;
    m.index.push(base, base + i, base + i + 1);
  }
}

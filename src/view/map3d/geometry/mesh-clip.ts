/**
 * A flat mesh cut to a set of rectangles on the ground plane: what of it lies inside any of them, its
 * vertex attributes carried to every new corner. Pure and three-free.
 */
import type { MeshData } from './types';

/** An axis-aligned rectangle on the ground plane, in world X/Z. */
export interface GroundRect { x0: number; z0: number; x1: number; z1: number }

/** One vertex with every attribute `m` carries, flattened. */
type Vert = number[];

/** The part of `m` inside the rectangles, which must not overlap (whole cells do not). */
export function clipMeshToRects(m: MeshData, rects: readonly GroundRect[]): MeshData {
  const out: MeshData = { positions: [], colors: [], index: [], ...(m.alpha ? { alpha: [] } : null), ...(m.uv ? { uv: [] } : null) };
  const vert = (i: number): Vert => [
    m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!,
    m.colors[i * 3]!, m.colors[i * 3 + 1]!, m.colors[i * 3 + 2]!,
    ...(m.alpha ? [m.alpha[i]!] : []), ...(m.uv ? [m.uv[i * 2]!, m.uv[i * 2 + 1]!] : []),
  ];
  const push = (v: Vert): number => {
    const n = out.positions.length / 3;
    out.positions.push(v[0]!, v[1]!, v[2]!);
    out.colors.push(v[3]!, v[4]!, v[5]!);
    let k = 6;
    if (out.alpha) out.alpha.push(v[k++]!);
    if (out.uv) out.uv.push(v[k]!, v[k + 1]!);
    return n;
  };
  for (let t = 0; t < m.index.length; t += 3) {
    const tri = [vert(m.index[t]!), vert(m.index[t + 1]!), vert(m.index[t + 2]!)];
    for (const r of rects) {
      const poly = clipPolygon(tri, r);
      if (poly.length < 3) continue;
      const ids = poly.map(push);
      for (let i = 1; i + 1 < ids.length; i++) out.index.push(ids[0]!, ids[i]!, ids[i + 1]!);
    }
  }
  return out;
}

/** Sutherland-Hodgman against the rectangle's four sides, X at index 0 and Z at index 2. */
function clipPolygon(poly: Vert[], r: GroundRect): Vert[] {
  const sides: ReadonlyArray<readonly [number, number, 1 | -1]> = [[0, r.x0, 1], [0, r.x1, -1], [2, r.z0, 1], [2, r.z1, -1]];
  let cur = poly;
  for (const [axis, limit, sign] of sides) {
    const next: Vert[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i]!, b = cur[(i + 1) % cur.length]!;
      const da = sign * (a[axis]! - limit), db = sign * (b[axis]! - limit);
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const k = da / (da - db);
        next.push(a.map((v, j) => v + (b[j]! - v) * k));
      }
    }
    cur = next;
    if (cur.length === 0) break;
  }
  return cur;
}

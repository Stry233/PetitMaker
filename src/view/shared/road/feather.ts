import { ROAD_FEATHER, type RoadPt } from './shape';

const EPS = 1e-9;
const CORNER_STEP = Math.PI / 16;

/**
 * Round convex fade contours inside the road, keeping one vertex count across cell-unit insets.
 * `scale` is coordinate units per cell; `winding` is +1 when the surface lies left of travel.
 * Short edges limit adjacent corner arcs to half their length.
 */
export function roadFeatherOutline(
  outlineAt: (inset: number) => RoadPt[], scale = 1, winding = 1,
): (inset: number) => RoadPt[] {
  const outline = outlineAt(0);
  let insetScale = 1;
  if (outline.length === 3) {
    let area = 0, perimeter = 0;
    for (let i = 0; i < 3; i++) {
      const a = outline[i]!, b = outline[(i + 1) % 3]!;
      area += a[0] * b[1] - b[0] * a[1];
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    // A triangular tip's core collapses at its inradius; further erosion inverts the triangle.
    if (area * winding > EPS) insetScale = Math.min(1, Math.abs(area) / perimeter / scale / ROAD_FEATHER * (1 - 1e-6));
  }
  const core = outlineAt(ROAD_FEATHER * insetScale);
  const turnAt = (points: RoadPt[], i: number): number => {
    const a = points[(i + points.length - 1) % points.length]!;
    const b = points[i]!, c = points[(i + 1) % points.length]!;
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    return Math.atan2(winding * (ux * vy - uy * vx), ux * vx + uy * vy);
  };
  // Sampled curves already have smooth joins; only sharp vertices need a corner fan.
  const steps = outline.map((_, i) => {
    const turn = turnAt(outline, i);
    const p = outline[i]!, end = core[i]!;
    const prev = outline[(i + outline.length - 1) % outline.length]!;
    const next = outline[(i + 1) % outline.length]!;
    const dx = end[0] - p[0], dy = end[1] - p[1];
    const fromBefore = winding * ((p[0] - prev[0]) * dy - (p[1] - prev[1]) * dx);
    const fromAfter = winding * ((next[0] - p[0]) * dy - (next[1] - p[1]) * dx);
    // A per-tile animation stand-in keeps shared, non-fading sides flush with its neighbours.
    if (fromBefore <= EPS || fromAfter <= EPS) return 0;
    return turn > CORNER_STEP ? Math.ceil(turn / CORNER_STEP) : 0;
  });
  return (inset) => {
    const points = outlineAt(inset * insetScale), out: RoadPt[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!, count = steps[i]!;
      if (!count) { out.push(p); continue; }
      const prev = points[(i + points.length - 1) % points.length]!;
      const next = points[(i + 1) % points.length]!;
      const before = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      const after = Math.hypot(next[0] - p[0], next[1] - p[1]);
      const turn = turnAt(points, i);
      const tangent = Math.tan(turn / 2);
      const distance = Math.min(Math.max(0, ROAD_FEATHER - inset) * insetScale * scale * tangent, before / 2, after / 2);
      if (distance < EPS || turn <= EPS || before < EPS || after < EPS) {
        for (let k = 0; k <= count; k++) out.push(p);
        continue;
      }
      const radius = distance / tangent;
      const ux = (p[0] - prev[0]) / before, uy = (p[1] - prev[1]) / before;
      const ax = p[0] - ux * distance, ay = p[1] - uy * distance;
      const cx = ax - winding * uy * radius, cy = ay + winding * ux * radius;
      const start = Math.atan2(ay - cy, ax - cx);
      for (let k = 0; k <= count; k++) {
        const angle = start + winding * turn * k / count;
        out.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
      }
    }
    return out;
  };
}

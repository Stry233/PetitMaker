import type { RoadPt } from './shape';

/** The smallest cosine between a corner bisector and its edge normal; sharper corners cap their reach here. */
const MIN_BISECTOR_COS = 0.1;

/** How far a cut can reach from the boundary point that starts it, in the units of `depth`. */
export function roadEdgeJointReach(depth: number, width: number): number {
  return Math.hypot((depth + width) / MIN_BISECTOR_COS + width, width / 2);
}

/** Grid-phased mortar cuts follow each boundary tangent; sharp corners receive a bisector joint. */
export function roadEdgeJointCuts(rings: RoadPt[][], depth: number, spacing: number, width: number): RoadPt[][] {
  const cuts: RoadPt[][] = [];
  const add = (p: RoadPt, nx: number, ny: number, reach: number): void => {
    const half = width / 2, tx = -ny * half, ty = nx * half;
    cuts.push([
      [p[0] - nx * width + tx, p[1] - ny * width + ty],
      [p[0] + nx * reach + tx, p[1] + ny * reach + ty],
      [p[0] + nx * reach - tx, p[1] + ny * reach - ty],
      [p[0] - nx * width - tx, p[1] - ny * width - ty],
    ]);
  };
  for (const input of rings) {
    const ring = input.filter((p, i) => {
      const prev = input[(i + input.length - 1) % input.length]!;
      return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-8;
    });
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!, b = ring[(i + 1) % ring.length]!, prev = ring[(i + ring.length - 1) % ring.length]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      if (length < 1e-8) continue;
      const nx = -dy / length, ny = dx / length;
      const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
      const min = Math.min(a[axis], b[axis]), max = Math.max(a[axis], b[axis]);
      for (let k = Math.floor((min + 1e-8) / spacing) + 1; k * spacing < max - 1e-8; k++) {
        const t = (k * spacing - a[axis]) / (b[axis] - a[axis]);
        add([a[0] + dx * t, a[1] + dy * t], nx, ny, depth + width);
      }
      const px = a[0] - prev[0], py = a[1] - prev[1], before = Math.hypot(px, py);
      if (before < 1e-8) continue;
      // Vertices belong to their outgoing edge so subdivisions cannot duplicate or omit a joint.
      if ((px * dx + py * dy) / (before * length) >= 0.8) {
        if (Math.abs(a[axis] / spacing - Math.round(a[axis] / spacing)) < 1e-8) add(a, nx, ny, depth + width);
        continue;
      }
      const bx = nx - py / before, by = ny + px / before, bisector = Math.hypot(bx, by);
      if (bisector < 1e-8) continue;
      const ux = bx / bisector, uy = by / bisector;
      add(a, ux, uy, (depth + width) / Math.max(MIN_BISECTOR_COS, ux * nx + uy * ny));
    }
  }
  return cuts;
}

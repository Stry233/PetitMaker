export interface ScreenPoint { x: number; y: number }

/** Rasterize the union of projected triangles, then trace only its exterior boundaries. */
export function silhouetteContours(triangles: readonly number[], width: number, height: number): ScreenPoint[][] {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < triangles.length; i += 6) {
    const xs = [triangles[i]!, triangles[i + 2]!, triangles[i + 4]!];
    const ys = [triangles[i + 1]!, triangles[i + 3]!, triangles[i + 5]!];
    const first = Math.max(0, Math.ceil(Math.min(...ys) - .5));
    const last = Math.min(height - 1, Math.floor(Math.max(...ys) - .5));
    for (let y = first; y <= last; y++) {
      const scan = y + .5;
      let left = Infinity, right = -Infinity;
      for (let edge = 0; edge < 3; edge++) {
        const next = (edge + 1) % 3;
        const a = ys[edge]!, b = ys[next]!;
        if ((a <= scan && b > scan) || (b <= scan && a > scan)) {
          const x = xs[edge]! + (xs[next]! - xs[edge]!) * (scan - a) / (b - a);
          left = Math.min(left, x); right = Math.max(right, x);
        }
      }
      const start = Math.max(0, Math.ceil(left - .5));
      const end = Math.min(width, Math.ceil(right - .5));
      if (end > start) mask.fill(1, y * width + start, y * width + end);
    }
  }
  const stride = width + 1;
  const edges = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    const next = edges.get(a);
    if (next) next.push(b); else edges.set(a, [b]);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!mask[y * width + x]) continue;
    const a = y * stride + x, b = a + 1, c = b + stride, d = a + stride;
    if (!y || !mask[(y - 1) * width + x]) add(a, b);
    if (x === width - 1 || !mask[y * width + x + 1]) add(b, c);
    if (y === height - 1 || !mask[(y + 1) * width + x]) add(c, d);
    if (!x || !mask[y * width + x - 1]) add(d, a);
  }
  const point = (key: number): ScreenPoint => ({ x: key % stride, y: Math.floor(key / stride) });
  const direction = (a: number, b: number) => b === a + 1 ? 0 : b === a + stride ? 1 : b === a - 1 ? 2 : 3;
  const contours: ScreenPoint[][] = [];
  while (edges.size) {
    const first = edges.keys().next().value!;
    const loop = [point(first)];
    let at = first, incoming = 0;
    do {
      const next = edges.get(at)!;
      // Right turns keep diagonally touching components on separate boundaries.
      const rank = (to: number) => [1, 0, 3, 2][(direction(at, to) - incoming + 4) % 4]!;
      next.sort((a, b) => rank(a) - rank(b));
      const to = next.shift()!;
      if (!next.length) edges.delete(at);
      incoming = direction(at, to);
      at = to;
      loop.push(point(at));
    } while (at !== first);
    const area = loop.slice(1).reduce((sum, b, i) => sum + loop[i]!.x * b.y - b.x * loop[i]!.y, 0);
    if (area > 0) contours.push(simplify(loop, .45));
  }
  return contours;
}

function simplify(points: ScreenPoint[], tolerance: number): ScreenPoint[] {
  if (points.length < 3) return points;
  const a = points[0]!, b = points[points.length - 1]!;
  const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
  let farthest = -1, distance = tolerance * tolerance;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
    const d = (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
    if (d > distance) { distance = d; farthest = i; }
  }
  if (farthest < 0) return [a, b];
  return [...simplify(points.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplify(points.slice(farthest), tolerance)];
}

/** A contour's dash, in css px: `on` drawn in every `period`. */
export interface ContourDash { on: number; period: number }

/** The move origin's dash. */
export const DASHED_CONTOUR: ContourDash = { on: 9, period: 15 };

/** Triangle ribbons keep line width and dash spacing in CSS pixels on every WebGL renderer; a null
 *  `pattern` draws the contour solid. */
export function contourTriangles(contours: readonly ScreenPoint[][], width = 3, pattern: ContourDash | null = DASHED_CONTOUR): number[] {
  const vertices: number[] = [];
  const radius = width / 2;
  const disk = (x: number, y: number) => {
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, b = (i + 1) * Math.PI / 4;
      vertices.push(x, y, x + Math.cos(a) * radius, y + Math.sin(a) * radius, x + Math.cos(b) * radius, y + Math.sin(b) * radius);
    }
  };
  for (const contour of contours) {
    let distance = 0;
    for (let i = 1; i < contour.length; i++) {
      const a = contour[i - 1]!, b = contour[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
      const piece = (at: number, end: number) => {
        const x = a.x + ux * at, y = a.y + uy * at, ex = a.x + ux * end, ey = a.y + uy * end;
        const nx = -uy * radius, ny = ux * radius;
        vertices.push(x+nx,y+ny, x-nx,y-ny, ex+nx,ey+ny, x-nx,y-ny, ex-nx,ey-ny, ex+nx,ey+ny);
        disk(x, y); disk(ex, ey);
      };
      if (!pattern) { piece(0, length); continue; }
      const { on, period } = pattern;
      for (let cycle = Math.floor(distance / period); cycle * period < distance + length; cycle++) {
        const at = Math.max(0, cycle * period - distance);
        const end = Math.min(length, cycle * period + on - distance);
        if (end > at) piece(at, end);
      }
      distance += length;
    }
  }
  return vertices;
}

/** The part of a world-space triangle list (x, y, z per vertex, three vertices a triangle) at or
 *  above `floorY`, as a triangle list again: what of a body the ground does not hide. */
export function clipTrianglesAbove(triangles: ArrayLike<number>, floorY: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 < triangles.length; i += 9) {
    const poly: [number, number, number][] = [0, 3, 6].map((o) => [triangles[i + o]!, triangles[i + o + 1]!, triangles[i + o + 2]!]);
    const kept: [number, number, number][] = [];
    for (let j = 0; j < 3; j++) {
      const a = poly[j]!, b = poly[(j + 1) % 3]!;
      const inA = a[1] >= floorY, inB = b[1] >= floorY;
      if (inA) kept.push(a);
      if (inA !== inB) {
        const t = (floorY - a[1]) / (b[1] - a[1]);
        kept.push([a[0] + (b[0] - a[0]) * t, floorY, a[2] + (b[2] - a[2]) * t]);
      }
    }
    for (let j = 1; j + 1 < kept.length; j++) out.push(...kept[0]!, ...kept[j]!, ...kept[j + 1]!);
  }
  return out;
}

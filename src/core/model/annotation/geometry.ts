/* Note geometry both views and hit testing share: zone outlines, caption anchors and route samples. */
import type { MacroCoord } from '../types';
import { splineSamples, type CurveAnchor } from '../../base/spline';
import { cellKey as key, rectContains } from '../../grid/rect';
import { zoneCellAt, zoneCellCentre, zoneCellSet, zoneGrid, type MapAnnotation, type ZoneGridId } from '../annotations';
import { gridSize } from '../../grid/grid-convert';
import { PLACEMENT_GRID } from '../../game/profile';

/** Trace zone boundaries into closed grid-corner loops and remove collinear points. Disconnected
 * regions and holes produce separate loops. */
function zoneLoops(cells: readonly MacroCoord[]): Array<Array<[number, number]>> {
  const set = zoneCellSet(cells);
  const has = (x: number, y: number): boolean => set.has(key(x, y));
  type Edge = { a: [number, number]; b: [number, number] };
  const byStart = new Map<string, Edge[]>();
  const edges = new Map<string, Edge>();
  const add = (a: [number, number], b: [number, number]): void => {
    const id = `${key(...a)}>${key(...b)}`;
    if (edges.has(id)) return;
    const edge = { a, b };
    edges.set(id, edge);
    const from = key(...a);
    byStart.set(from, [...(byStart.get(from) ?? []), edge]);
  };
  for (const { x, y } of cells) {
    if (!has(x, y - 1)) add([x, y], [x + 1, y]);
    if (!has(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!has(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!has(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const loops: Array<Array<[number, number]>> = [];
  const used = new Set<Edge>();
  for (const first of edges.values()) {
    if (used.has(first)) continue;
    const loop: Array<[number, number]> = [];
    let cur: Edge | undefined = first;
    while (cur && !used.has(cur)) {
      used.add(cur);
      loop.push(cur.a);
      if (cur.b[0] === first.a[0] && cur.b[1] === first.a[1]) break;
      const dx = cur.b[0] - cur.a[0], dy = cur.b[1] - cur.a[1];
      // Diagonal cells share a vertex, not an edge. Turn right to keep their contours separate.
      const rank = (edge: Edge): number => {
        const ex = edge.b[0] - edge.a[0], ey = edge.b[1] - edge.a[1];
        const cross = dx * ey - dy * ex;
        return cross > 0 ? 3 : dx * ex + dy * ey > 0 ? 2 : cross < 0 ? 1 : 0;
      };
      cur = (byStart.get(key(...cur.b)) ?? []).filter((edge) => !used.has(edge))
        .sort((a, b) => rank(b) - rank(a))[0];
    }
    if (loop.length < 3) continue;
    const merged: Array<[number, number]> = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[(i - 1 + loop.length) % loop.length]!;
      const b = loop[i]!;
      const c = loop[(i + 1) % loop.length]!;
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) merged.push(b);
    }
    if (merged.length >= 3) loops.push(merged);
  }
  return loops;
}

/** Zone-corner radius in cells: half a cell, the most a unit step holds, so the staircase of a
 *  diagonal stroke reads as one smooth line. Zones are painted in cells of a fixed size on every
 *  template, so the radius does not follow the map's ink scale; a shorter edge (a half-cell step)
 *  rounds at half its length. */
const ZONE_CORNER_CELLS = 0.5;

/** Round the corners of the loops around `cells` of `grid` with sampled quadratic curves, in map
 *  cells. The first point is repeated at the end. */
export function roundedZoneLoops(
  cells: readonly MacroCoord[], radius = ZONE_CORNER_CELLS, grid: ZoneGridId = PLACEMENT_GRID,
): Array<Array<[number, number]>> {
  const size = gridSize(grid);
  return zoneLoops(cells).map((raw) => {
    const loop = size === 1 ? raw : raw.map(([x, y]) => [x * size, y * size] as [number, number]);
    const n = loop.length;
    const out: Array<[number, number]> = [];
    // Remove coincident samples so renderers receive no zero-length segments.
    const push = (pt: [number, number]): void => {
      const last = out[out.length - 1];
      if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1e-3) return;
      out.push(pt);
    };
    const P = (i: number): [number, number] => loop[(i + n) % n]!;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = P(i - 1);
      const [bx, by] = P(i);
      const [cx, cy] = P(i + 1);
      const l1 = Math.hypot(bx - ax, by - ay);
      const l2 = Math.hypot(cx - bx, cy - by);
      const r1 = Math.min(radius, l1 / 2);
      const r2 = Math.min(radius, l2 / 2);
      const p1: [number, number] = [bx - ((bx - ax) / l1) * r1, by - ((by - ay) / l1) * r1];
      const p2: [number, number] = [bx + ((cx - bx) / l2) * r2, by + ((cy - by) / l2) * r2];
      push(p1);
      // Increase samples with radius to keep large corners smooth.
      const steps = Math.min(9, Math.max(2, Math.round(Math.max(r1, r2) * 5)));
      for (let k = 1; k <= steps; k++) {
        const t = k / (steps + 1);
        const mt = 1 - t;
        push([
          mt * mt * p1[0] + 2 * mt * t * bx + t * t * p2[0],
          mt * mt * p1[1] + 2 * mt * t * by + t * t * p2[1],
        ]);
      }
      push(p2);
    }
    if (out.length > 1 && Math.hypot(out[0]![0] - out[out.length - 1]![0], out[0]![1] - out[out.length - 1]![1]) < 1e-3) out.pop();
    out.push(out[0]!);
    return out;
  });
}

/** Calculate inward normals. `zoneLoops` orients boundaries with their interior on the right. */
export function loopInwardNormals(loop: ReadonlyArray<[number, number]>): Array<[number, number]> {
  const n = loop.length;
  return loop.map((_, i) => {
    const prev = loop[(i - 1 + n) % n]!;
    const next = loop[(i + 1) % n]!;
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len] as [number, number];
  });
}

/** Return the mean of a zone's drawn cell centres for caption placement. */
function zoneCentroid(cells: readonly MacroCoord[], grid: ZoneGridId): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const c of cells) { const m = zoneCellCentre(c, grid); sx += m.x; sy += m.y; }
  const n = Math.max(1, cells.length);
  return { x: sx / n, y: sy / n };
}

/**
 * Where a zone's caption stands: the middle of the region's thickest part, which is always one of
 * its own cells. The mean of the cells falls outside an L, a U or a ring, so instead every cell is
 * ranked by how many rings of cells stand between it and the outside (8-neighbour distance), and
 * the deepest cells win. Their mean is used when it lands inside the zone, so a rectangle's caption
 * sits at its exact centre; otherwise the deepest cell nearest the centroid is used.
 */
export function zoneLabelAnchor(cells: readonly MacroCoord[], grid: ZoneGridId = PLACEMENT_GRID): { x: number; y: number } {
  if (cells.length === 0) return { x: 0, y: 0 };
  const set = zoneCellSet(cells);
  const depth = new Map<string, number>();
  let ring: MacroCoord[] = [];
  for (const c of cells) {
    let exposed = false;
    for (let dy = -1; dy <= 1 && !exposed; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && !set.has(key(c.x + dx, c.y + dy))) { exposed = true; break; }
      }
    }
    if (exposed) { depth.set(key(c.x, c.y), 1); ring.push(c); }
  }
  let level = 1;
  while (depth.size < cells.length) {
    level += 1;
    const next: MacroCoord[] = [];
    for (const c of ring) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const k = key(c.x + dx, c.y + dy);
          if (set.has(k) && !depth.has(k)) { depth.set(k, level); next.push({ x: c.x + dx, y: c.y + dy }); }
        }
      }
    }
    ring = next;
  }
  const deepest = cells.filter((c) => depth.get(key(c.x, c.y)) === level);
  const mean = zoneCentroid(deepest, grid);
  const meanCell = zoneCellAt(mean, grid);
  if (set.has(key(meanCell.x, meanCell.y))) return mean;
  const centroid = zoneCentroid(cells, grid);
  let best = deepest[0]!;
  let bestDist = Infinity;
  for (const c of deepest) {
    const m = zoneCellCentre(c, grid);
    const d = Math.hypot(m.x - centroid.x, m.y - centroid.y);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return zoneCellCentre(best, grid);
}

/** Sample a route with the same spline implementation used by terrain curves. */
export function routeSamples(points: readonly CurveAnchor[], perSegment?: number): Array<[number, number]> {
  if (points.length < 2) return points.map((p) => [p.x, p.y]);
  return splineSamples(points, perSegment);
}

/** Return annotations intersecting a selection rectangle. Routes are tested by sampled curve
 * points so segments crossing the rectangle are included even when their anchors are outside. */
export function annotationsInRect(
  rect: { x: number; y: number; w: number; h: number },
  items: readonly MapAnnotation[],
): string[] {
  const caught = (n: MapAnnotation): boolean => {
    if (n.kind === 'zone') {
      const size = gridSize(zoneGrid(n));
      return n.cells.some((c) => rectContains(rect, c.x * size, c.y * size));
    }
    if (n.kind === 'chip') return rectContains(rect, n.x, n.y);
    if (n.kind === 'measure') {
      const [a, b] = n.points;
      return Math.max(a.x, b.x) >= rect.x && Math.min(a.x, b.x) < rect.x + rect.w
        && Math.max(a.y, b.y) >= rect.y && Math.min(a.y, b.y) < rect.y + rect.h;
    }
    return routeSamples(n.points, 8).some(([sx, sy]) => rectContains(rect, sx, sy));
  };
  return items.filter(caught).map((n) => n.id);
}

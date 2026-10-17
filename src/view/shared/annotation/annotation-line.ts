/**
 * The one line style every plan-note line wears in both views: zone borders, routes and their
 * arrowheads, measurement lines, their end ticks and the dashed guides.
 *
 * A line is a continuous path in the note's colour over a lettering-ink halo, with round joins and
 * caps. Its width is held in a narrow band of css px that grows gently with the cell's on-screen
 * size, so a line stays readable when the map is far and fine when it is near. The dashed variant
 * (guides, dashed routes) cuts the same path into runs; nothing else differs between elements.
 */
import { MAP_EDGE_ALPHA, MAP_INK } from '../../../assets/brand-palette';
import { isAnnotationInk } from '../../../config/annotation-palette';
import { loopInwardNormals, roundedZoneLoops } from '../../../core/model/annotation/geometry';
import type { MacroCoord } from '../../../core/model/types';
import type { ZoneGridId } from '../../../core/model/annotations';
import { PLACEMENT_GRID } from '../../../core/game/profile';

export const ANNOTATION_LINE = {
  /** css px where a cell spans `refCellPx`, growing with the cell's size to `power`, held within
   *  `[minPx, maxPx]`. */
  widthPx: 2, refCellPx: 16, power: 0.25, minPx: 1.25, maxPx: 3.5,
  /** The relative drift in width a drawn 2D line may carry before it is stroked again, so pans
   *  never and zooms rarely rebuild it. */
  restrokeStep: 0.08,
  alpha: 0.95,
  /** The colour a cream (ink) note's lines take, so they read over light ground. */
  inkLine: '#FFFFFF',
  halo: { color: MAP_INK, alpha: MAP_EDGE_ALPHA, scale: 2 },
  join: 'round', cap: 'round',
  /** A route's arrowhead length, in line widths. */
  arrowHead: 4,
  /** Selection marks, in line widths: a white line over a dark rim, and the waypoint dots. */
  selection: { width: 0.8, rim: 2.6, alpha: 0.95, dot: 2 },
  /** The dashed variant, in widths of the line it cuts. The pen-down run is `dash` long and the
   *  pen lifts for `visibleGap` plus the halo's own width, since each round cap reaches half a
   *  halo past its run's end; what stays clear between two dashes is then `visibleGap` widths at
   *  every zoom and in both views. */
  dashed: { dash: 3, visibleGap: 1.5 },
} as const;

/** An annotation line's width in cells at `cellPixels` css px a cell. */
export function annotationLineCells(cellPixels: number): number {
  const s = ANNOTATION_LINE;
  const px = Math.min(s.maxPx, Math.max(s.minPx, s.widthPx * (cellPixels / s.refCellPx) ** s.power));
  return px / cellPixels;
}

/** The colour a note's lines are drawn in. */
export function annotationLineColor(color: string): string {
  return isAnnotationInk(color) ? ANNOTATION_LINE.inkLine : color;
}

/** The dashed variant's pen-down and pen-up lengths for a line `width` wide, in its units. */
export function annotationDashes(width: number): { dash: number; gap: number } {
  const { dash, visibleGap } = ANNOTATION_LINE.dashed;
  return { dash: dash * width, gap: (visibleGap + ANNOTATION_LINE.halo.scale) * width };
}

/** How far a zone border runs inside its cells: half the line plus a hair, so the whole line lies
 *  in the zone's own cells. Capped below the corner rounding a unit-step edge holds (0.5), or the
 *  offset loop turns inside out at every turn. */
function zoneBorderInset(lineCells: number): number {
  return Math.min(lineCells / 2 + 0.02, 0.34);
}

/** Each outline of a zone's `cells` on `grid` as one closed path in drawn map cells, corners
 *  rounded and inset by half a line of `lineCells`. The first point repeats at the end. */
export function zoneBorderPaths(cells: readonly MacroCoord[], lineCells: number, grid: ZoneGridId = PLACEMENT_GRID): Array<Array<[number, number]>> {
  const inset = zoneBorderInset(lineCells);
  return roundedZoneLoops(cells, undefined, grid).map((loop) => {
    const open = loop.slice(0, -1);
    const normals = loopInwardNormals(open);
    const path = open.map(([x, y], i) => {
      const [nx, ny] = normals[i]!;
      return [x + nx * inset, y + ny * inset] as [number, number];
    });
    path.push(path[0]!);
    return path;
  });
}

/** Cut a path into its pen-down runs by arc length. `null` keeps it whole. The pen starts down at
 *  every path, so each edge begins on a dash. Points are tuples of any arity; the walk reads the
 *  first and last coordinates as the plane and interpolates every coordinate. */
export function dashRuns<P extends readonly number[]>(path: readonly P[], dashes: { dash: number; gap: number } | null): P[][] {
  if (!dashes || path.length < 2) return [path.slice()];
  const plane = (a: P, b: P) => Math.hypot(b[0]! - a[0]!, b[b.length - 1]! - a[a.length - 1]!);
  const lerp = (a: P, b: P, t: number): P => a.map((v, i) => v + (b[i]! - v) * t) as unknown as P;
  const runs: P[][] = [];
  let penDown = true;
  let remaining = dashes.dash;
  let run: P[] = [path[0]!];
  for (let i = 1; i < path.length; i++) {
    let a = path[i - 1]!;
    const b = path[i]!;
    let seg = plane(a, b);
    while (seg > remaining) {
      const cut = lerp(a, b, remaining / seg);
      if (penDown) { run.push(cut); runs.push(run); run = []; } else run = [cut];
      penDown = !penDown;
      a = cut;
      seg -= remaining;
      remaining = penDown ? dashes.dash : dashes.gap;
    }
    if (penDown) run.push(b);
    remaining -= seg;
  }
  if (penDown && run.length > 1) runs.push(run);
  return runs;
}

/** Planning annotations are independent of buildable map content and rule validation. Coordinates
 * use macro-grid cell units; zones use whole cells, while text and route anchors may be fractional. */
import type { MacroCoord } from './types';
import { splineSamples, type CurveAnchor } from './spline';

/** The closed planning vocabulary. Notes carry one of these ids; free text is never stored. */
export type TagId =
  | 'homes' | 'shops' | 'workshop' | 'farm' | 'orchard' | 'ranch' | 'garden'
  | 'forest' | 'plaza' | 'landmark' | 'dock' | 'water' | 'entrance' | 'reserved';

export interface AnnotationTag {
  id: TagId;
  labelKey: string;
}

export const ANNOTATION_TAGS: readonly AnnotationTag[] = [
  { id: 'homes', labelKey: 'annot.tag_homes' },
  { id: 'shops', labelKey: 'annot.tag_shops' },
  { id: 'workshop', labelKey: 'annot.tag_workshop' },
  { id: 'farm', labelKey: 'annot.tag_farm' },
  { id: 'orchard', labelKey: 'annot.tag_orchard' },
  { id: 'ranch', labelKey: 'annot.tag_ranch' },
  { id: 'garden', labelKey: 'annot.tag_garden' },
  { id: 'forest', labelKey: 'annot.tag_forest' },
  { id: 'plaza', labelKey: 'annot.tag_plaza' },
  { id: 'landmark', labelKey: 'annot.tag_landmark' },
  { id: 'dock', labelKey: 'annot.tag_dock' },
  { id: 'water', labelKey: 'annot.tag_water' },
  { id: 'entrance', labelKey: 'annot.tag_entrance' },
  { id: 'reserved', labelKey: 'annot.tag_reserved' },
];

export const TAG_IDS: readonly TagId[] = ANNOTATION_TAGS.map((t) => t.id);

export function isTagId(v: unknown): v is TagId {
  return typeof v === 'string' && (TAG_IDS as readonly string[]).includes(v);
}

/** A painted region with a numbered caption. `tag` is null only on zones loaded from older saves. */
export interface ZoneNote {
  kind: 'zone';
  id: string;
  cells: MacroCoord[];
  /** A hex from `ANNOTATION_COLORS` today; any CSS hex renders. */
  color: string;
  tag: TagId | null;
  /** Stable display number; deleted numbers are not reused. */
  num: number;
  /** Caption size; an omitted value decodes as 'm'. */
  size?: 's' | 'm' | 'l';
}

/** A tag standing on its own plate, for marking a spot without painting a zone. */
export interface ChipNote {
  kind: 'chip';
  id: string;
  x: number;
  y: number;
  tag: TagId;
  size: 's' | 'm' | 'l';
  color: string;
}

/** A routed arrow using the same adjustable curve anchors as terrain curves. */
export interface RouteNote {
  kind: 'route';
  id: string;
  points: CurveAnchor[];
  color: string;
  dashed: boolean;
}

export type MapAnnotation = ZoneNote | ChipNote | RouteNote;

/** Annotation items and their shared visibility and edit lock. */
export interface AnnotationsState {
  items: MapAnnotation[];
  visible: boolean;
  locked: boolean;
}

export function createAnnotationsState(): AnnotationsState {
  return { items: [], visible: true, locked: false };
}

/** Annotation tools; `none` enables selection and movement. */
export type AnnotationTool = 'zone' | 'chip' | 'route' | 'erase' | 'none';

/** Zone shapes shared with the terrain toolbar. */
export type AnnotationZoneShape = 'free' | 'line' | 'curve' | 'rect' | 'circle';

/** Palette chosen for contrast over grass, sand, and water. The final cream uses neutral number
 * badges and matches the map-lettering color. */
export const ANNOTATION_COLORS: readonly string[] = [
  '#FF8A7A', '#E5484D', '#FFB347', '#FFD84D',
  '#9BC53D', '#2FBF9B', '#38BDF8', '#3B82F6',
  '#818CF8', '#A78BFA', '#C969E6', '#FF7BAE',
  '#A9704C', '#8A9BAE', '#5D5A55', '#FFFEE3',
];

/** Cream annotation color rendered with white outlines and neutral number badges. */
export const ANNOTATION_INK = '#FFFEE3';

/** Generate an id unique within the session and unlikely to collide with loaded ids. */
let seq = 0;
export function generateAnnotationId(): string {
  return 'an' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Return one more than the highest assigned zone number. */
export function nextZoneNumber(annotations: readonly MapAnnotation[]): number {
  let max = 0;
  for (const a of annotations) if (a.kind === 'zone' && a.num > max) max = a.num;
  return max + 1;
}

const key = (x: number, y: number): string => `${x},${y}`;

/** Offset from macro-grid coordinates to terrain-cell drawing coordinates. A cell centered at
 * `(x, y)` occupies `[x - 0.5, x + 0.5)` in both views. */
export const ZONE_GRID_SHIFT = -0.5;

/** Return the zone cell whose drawn footprint contains `p`. */
export function zoneCellAt(p: { x: number; y: number }): MacroCoord {
  return { x: Math.floor(p.x + 0.5), y: Math.floor(p.y + 0.5) };
}

/** Build the shared zone-cell lookup used by rendering and hit testing. */
export function zoneCellSet(cells: readonly MacroCoord[]): Set<string> {
  return new Set(cells.map((c) => key(c.x, c.y)));
}

/** `cells` plus `more`, without duplicates and in stable order. */
export function addZoneCells(cells: readonly MacroCoord[], more: readonly MacroCoord[]): MacroCoord[] {
  const seen = zoneCellSet(cells);
  const out = [...cells];
  for (const c of more) {
    const k = key(c.x, c.y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** `cells` without any member of `gone`. */
export function removeZoneCells(cells: readonly MacroCoord[], gone: readonly MacroCoord[]): MacroCoord[] {
  const drop = zoneCellSet(gone);
  return cells.filter((c) => !drop.has(key(c.x, c.y)));
}

/** Trace zone boundaries into closed grid-corner loops and remove collinear points. Disconnected
 * regions and holes produce separate loops. */
export function zoneLoops(cells: readonly MacroCoord[]): Array<Array<[number, number]>> {
  const set = zoneCellSet(cells);
  const has = (x: number, y: number): boolean => set.has(key(x, y));
  const byStart = new Map<string, [[number, number], [number, number]]>();
  for (const { x, y } of cells) {
    if (!has(x, y - 1)) byStart.set(key(x, y), [[x, y], [x + 1, y]]);
    if (!has(x + 1, y)) byStart.set(key(x + 1, y), [[x + 1, y], [x + 1, y + 1]]);
    if (!has(x, y + 1)) byStart.set(key(x + 1, y + 1), [[x + 1, y + 1], [x, y + 1]]);
    if (!has(x - 1, y)) byStart.set(key(x, y + 1), [[x, y + 1], [x, y]]);
  }
  const loops: Array<Array<[number, number]>> = [];
  const used = new Set<string>();
  for (const [start, seg] of byStart) {
    if (used.has(start)) continue;
    const loop: Array<[number, number]> = [];
    let cur: [[number, number], [number, number]] | undefined = seg;
    while (cur) {
      const k = key(cur[0][0], cur[0][1]);
      if (used.has(k)) break;
      used.add(k);
      loop.push(cur[0]);
      cur = byStart.get(key(cur[1][0], cur[1][1]));
    }
    if (loop.length < 3) continue;
    const merged: Array<[number, number]> = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[(i - 1 + loop.length) % loop.length]!;
      const b = loop[i]!;
      const c = loop[(i + 1) % loop.length]!;
      if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) merged.push(b);
    }
    loops.push(merged);
  }
  return loops;
}

/** Zone-corner radius per annotation scale unit. */
export const ZONE_CORNER_CELLS = 0.28;

/** Scale the corner radius without allowing an arc to cross more than one cell. */
export function zoneCornerRadius(inkScale: number): number {
  return Math.min(ZONE_CORNER_CELLS * inkScale, 1);
}

/** Round zone-loop corners with sampled quadratic curves. The first point is repeated at the end. */
export function roundedZoneLoops(cells: readonly MacroCoord[], radius = ZONE_CORNER_CELLS): Array<Array<[number, number]>> {
  return zoneLoops(cells).map((loop) => {
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

/** Return the mean of a zone's cell centers for caption placement. */
export function zoneCentroid(cells: readonly MacroCoord[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
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
export function zoneLabelAnchor(cells: readonly MacroCoord[]): { x: number; y: number } {
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
  const mean = zoneCentroid(deepest);
  const meanCell = zoneCellAt(mean);
  if (set.has(key(meanCell.x, meanCell.y))) return mean;
  const centroid = zoneCentroid(cells);
  let best = deepest[0]!;
  let bestDist = Infinity;
  for (const c of deepest) {
    const d = Math.hypot(c.x - centroid.x, c.y - centroid.y);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return { x: best.x, y: best.y };
}

/** Sample a route with the same spline implementation used by terrain curves. */
export function routeSamples(points: readonly CurveAnchor[], perSegment?: number): Array<[number, number]> {
  if (points.length < 2) return points.map((p) => [p.x, p.y]);
  return splineSamples(points, perSegment);
}

/** Reduce a dragged path to the anchors that shape it (Ramer-Douglas-Peucker). `tolerance` is the
 * largest deviation, in cells, a dropped point may have from the simplified path. */
export function simplifyPath(points: readonly MacroCoord[], tolerance: number): MacroCoord[] {
  if (points.length <= 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    let far = -1;
    let farDist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const p = points[i]!;
      const d = len === 0
        ? Math.hypot(p.x - pa.x, p.y - pa.y)
        : Math.abs(dx * (pa.y - p.y) - (pa.x - p.x) * dy) / len;
      if (d > farDist) { farDist = d; far = i; }
    }
    if (far < 0) continue;
    keep[far] = true;
    stack.push([a, far], [far, b]);
  }
  return points.filter((_, i) => keep[i]).map((p) => ({ x: p.x, y: p.y }));
}

/** Return annotations intersecting a selection rectangle. Routes are tested by sampled curve
 * points so segments crossing the rectangle are included even when their anchors are outside. */
export function annotationsInRect(
  rect: { x: number; y: number; w: number; h: number },
  items: readonly MapAnnotation[],
): string[] {
  const inside = (px: number, py: number): boolean =>
    px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h;
  const caught = (n: MapAnnotation): boolean => {
    if (n.kind === 'zone') return n.cells.some((c) => inside(c.x, c.y));
    if (n.kind === 'chip') return inside(n.x, n.y);
    return routeSamples(n.points, 8).some(([sx, sy]) => inside(sx, sy));
  };
  return items.filter(caught).map((n) => n.id);
}

/** Scale annotations from the template's longest dimension; 36 cells maps to scale 1. */
export function annotationInkScale(template: { width: number; height: number }): number {
  return Math.max(1, Math.max(template.width, template.height) / 36);
}

/** Base annotation dimensions in cell units. Both views apply the shared ink scale and cell size. */
export const INK_CELLS = {
  text: { s: 0.66, m: 0.9, l: 1.2 } as Record<'s' | 'm' | 'l', number>,
  zoneLabel: { s: 0.56, m: 0.75, l: 1.0 } as Record<'s' | 'm' | 'l', number>,
  outline: 0.16,
  dash: 0.52,
  gap: 0.4,
  route: 0.22,
} as const;

/** Scale dash and gap lengths at half the annotation-scale growth rate. */
export function zoneDashCells(inkScale: number): { dash: number; gap: number } {
  const k = 1 + (inkScale - 1) * 0.5;
  return { dash: INK_CELLS.dash * k, gap: INK_CELLS.gap * k };
}

/** Route hit distance in cells, with a minimum target for pointer input. */
export function routeHitDistCells(inkScale: number): number {
  return Math.max(0.45, INK_CELLS.route * inkScale * 2);
}

/** Label units for width estimates: CJK characters count as one, Latin characters as 0.55. */
function labelUnits(label: string): number {
  let units = 0;
  for (const ch of label) units += ch.charCodeAt(0) > 0xff ? 1 : 0.55;
  return units;
}

/** Estimate a chip's plate width for shared hit testing. */
export function chipApproxWidthCells(note: ChipNote, label: string, inkScale = 1): number {
  const em = INK_CELLS.text[note.size]! * inkScale;
  return Math.max(1, (labelUnits(label) + 1.3) * em);
}

/** A chip's plate height in cells, from the same size table the width uses. */
export function chipApproxHeightCells(note: ChipNote, inkScale = 1): number {
  return INK_CELLS.text[note.size]! * inkScale * 1.3;
}

/** Estimate the selectable width of a zone's centered number-and-label caption. */
export function zoneLabelApproxWidthCells(zone: ZoneNote, label: string, inkScale = 1): number {
  const fs = INK_CELLS.zoneLabel[zone.size ?? 'm'] * inkScale;
  const numR = zone.num > 0 ? fs * 0.62 : 0;
  return Math.max(fs, numR * 2 + (zone.num > 0 && label ? fs * 0.3 : 0) + labelUnits(label) * fs);
}

/** The caption's height in cells, matching the drawn number disc. */
export function zoneLabelApproxHeightCells(zone: ZoneNote, inkScale = 1): number {
  return INK_CELLS.zoneLabel[zone.size ?? 'm'] * inkScale * 1.4;
}

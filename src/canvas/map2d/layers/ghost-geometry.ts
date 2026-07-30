/**
 * Pure cell-set geometry for the overlay's ghost and flash rendering. A large
 * drag-shape preview holds tens of thousands of cells, and drawing one Pixi
 * rect per cell — per pointer move for the ghost, per FRAME for a flash —
 * stalls the main thread. Merging each row's consecutive cells into spans
 * collapses a filled W×H shape to ~H rects, and the outline derives from
 * numeric row sets instead of string keys.
 */
import type { ErrorFlashCell } from './error-flash';

/** A horizontal run of cells: covers [x, x+w) × [y, y+1). */
export interface RowSpan { x: number; y: number; w: number }

/** A RowSpan pinned to one grid ('micro' = terrain, −HALF_TILE). */
export interface CellSpan extends RowSpan { micro: boolean }

/** Merge cells into row spans (per grid). Input order is free; duplicates collapse. */
export function mergeCellSpans(cells: readonly ErrorFlashCell[]): CellSpan[] {
  // rows keyed by (micro, y) → sorted unique x list
  const rows = new Map<string, { y: number; micro: boolean; xs: number[] }>();
  for (const c of cells) {
    const key = `${c.micro ? 1 : 0}:${c.y}`;
    const row = rows.get(key);
    if (row) row.xs.push(c.x);
    else rows.set(key, { y: c.y, micro: c.micro, xs: [c.x] });
  }
  const spans: CellSpan[] = [];
  for (const { y, micro, xs } of rows.values()) {
    xs.sort((a, b) => a - b);
    let start = xs[0]!, prev = xs[0]!;
    for (let i = 1; i < xs.length; i++) {
      const x = xs[i]!;
      if (x === prev || x === prev + 1) { prev = Math.max(prev, x); continue; }
      spans.push({ x: start, y, w: prev - start + 1, micro });
      start = prev = x;
    }
    spans.push({ x: start, y, w: prev - start + 1, micro });
  }
  return spans;
}

/** An edge segment in cell units (multiply by tile size to draw). */
export interface EdgeSegment { ax: number; ay: number; bx: number; by: number }

/**
 * The outer boundary of a cell set: every cell edge whose neighbour lies
 * outside the set. All cells are treated as one grid (the ghost draws a single
 * surface); horizontal runs merge into single segments.
 */
export function boundaryEdges(cells: readonly { x: number; y: number }[]): EdgeSegment[] {
  const rows = new Map<number, Set<number>>();
  for (const { x, y } of cells) {
    const row = rows.get(y);
    if (row) row.add(x); else rows.set(y, new Set([x]));
  }
  const has = (x: number, y: number): boolean => rows.get(y)?.has(x) ?? false;
  const edges: EdgeSegment[] = [];
  // Horizontal edges (top/bottom), merged along x per row.
  for (const [y, row] of rows) {
    const xs = [...row].sort((a, b) => a - b);
    for (const side of [-1, 1] as const) {
      const ey = side === -1 ? y : y + 1;
      let runStart: number | null = null, prev = 0;
      for (const x of xs) {
        const exposed = !has(x, y + side);
        if (exposed && runStart !== null && x === prev + 1) { prev = x; continue; }
        if (runStart !== null) edges.push({ ax: runStart, ay: ey, bx: prev + 1, by: ey });
        runStart = exposed ? x : null;
        prev = x;
      }
      if (runStart !== null) edges.push({ ax: runStart, ay: ey, bx: prev + 1, by: ey });
    }
  }
  // Vertical edges (left/right), one per exposed cell side merged along y.
  const cols = new Map<number, Set<number>>();
  for (const { x, y } of cells) {
    const col = cols.get(x);
    if (col) col.add(y); else cols.set(x, new Set([y]));
  }
  for (const [x, col] of cols) {
    const ys = [...col].sort((a, b) => a - b);
    for (const side of [-1, 1] as const) {
      const ex = side === -1 ? x : x + 1;
      let runStart: number | null = null, prev = 0;
      for (const y of ys) {
        const exposed = !has(x + side, y);
        if (exposed && runStart !== null && y === prev + 1) { prev = y; continue; }
        if (runStart !== null) edges.push({ ax: ex, ay: runStart, bx: ex, by: prev + 1 });
        runStart = exposed ? y : null;
        prev = y;
      }
      if (runStart !== null) edges.push({ ax: ex, ay: runStart, bx: ex, by: prev + 1 });
    }
  }
  return edges;
}

interface Interval { x: number; e: number }

/** a minus b over intervals; both sorted, non-overlapping. */
function subtractIntervals(a: readonly Interval[], b: readonly Interval[] | undefined): Interval[] {
  if (!b || b.length === 0) return [...a];
  const out: Interval[] = [];
  for (const iv of a) {
    let x = iv.x;
    for (const cut of b) {
      if (cut.e <= x) continue;
      if (cut.x >= iv.e) break;
      if (cut.x > x) out.push({ x, e: cut.x });
      x = Math.max(x, cut.e);
      if (x >= iv.e) break;
    }
    if (x < iv.e) out.push({ x, e: iv.e });
  }
  return out;
}

/**
 * Boundary of a span set WITHOUT expanding to cells — O(spans), so a map-size
 * shape preview costs its row count, not its area. Requires per-row MERGED
 * spans (no two spans in one row touch or overlap), which every producer here
 * guarantees. Same edge coverage as boundaryEdges over the expanded cells.
 */
export function boundaryEdgesFromSpans(spans: readonly RowSpan[]): EdgeSegment[] {
  const rows = new Map<number, Interval[]>();
  for (const s of spans) {
    const list = rows.get(s.y);
    const iv = { x: s.x, e: s.x + s.w };
    if (list) list.push(iv); else rows.set(s.y, [iv]);
  }
  for (const list of rows.values()) list.sort((a, b) => a.x - b.x);

  const edges: EdgeSegment[] = [];
  // Horizontal edges: what this row covers that the row above/below does not.
  for (const [y, list] of rows) {
    for (const iv of subtractIntervals(list, rows.get(y - 1))) edges.push({ ax: iv.x, ay: y, bx: iv.e, by: y });
    for (const iv of subtractIntervals(list, rows.get(y + 1))) edges.push({ ax: iv.x, ay: y + 1, bx: iv.e, by: y + 1 });
  }
  // Vertical edges: every span end is exposed (merged rows have gaps between
  // spans); contiguous ends at the same x merge into one segment.
  const ends = new Map<number, number[]>(); // x → row ys with an edge at this x
  const noteEnd = (x: number, y: number): void => {
    const ys = ends.get(x);
    if (ys) ys.push(y); else ends.set(x, [y]);
  };
  for (const s of spans) { noteEnd(s.x, s.y); noteEnd(s.x + s.w, s.y); }
  for (const [x, ys] of ends) {
    ys.sort((a, b) => a - b);
    let start = ys[0]!, prev = ys[0]!;
    for (let i = 1; i < ys.length; i++) {
      const y = ys[i]!;
      if (y === prev + 1) { prev = y; continue; }
      edges.push({ ax: x, ay: start, bx: x, by: prev + 1 });
      start = prev = y;
    }
    edges.push({ ax: x, ay: start, bx: x, by: prev + 1 });
  }
  return edges;
}

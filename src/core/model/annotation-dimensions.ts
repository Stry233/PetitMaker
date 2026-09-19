import type { MacroCoord } from './types';

export interface CellBounds { left: number; top: number; right: number; bottom: number }
export interface DimensionDrawing {
  guides: [MacroCoord, MacroCoord][];
  lines: [MacroCoord, MacroCoord][];
  labels: { at: MacroCoord; value: number }[];
}

/** The fixed endpoint and original axis survive a drag through a one-cell span. */
export function resizeMeasurement(points: readonly [MacroCoord, MacroCoord], endpoint: 0 | 1, pointer: MacroCoord): [MacroCoord, MacroCoord] {
  const next: [MacroCoord, MacroCoord] = [{ ...points[0] }, { ...points[1] }];
  const fixed = points[endpoint === 0 ? 1 : 0];
  next[endpoint] = points[0].y === points[1].y
    ? { x: Math.round(pointer.x), y: fixed.y }
    : { x: fixed.x, y: Math.round(pointer.y) };
  return next;
}

/** Inclusive cell extents: cells 0 through 83 occupy 84 cells, not 83 centre-to-centre intervals. */
export function cellBounds(cells: readonly MacroCoord[]): CellBounds | null {
  if (!cells.length) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const cell of cells) {
    left = Math.min(left, cell.x - 0.5); right = Math.max(right, cell.x + 0.5);
    top = Math.min(top, cell.y - 0.5); bottom = Math.max(bottom, cell.y + 0.5);
  }
  return { left, top, right, bottom };
}

/** CAD-style dimensions in cell units, shared by drawing, selection and both projections. */
export function dimensionDrawing(bounds: CellBounds, inkScale: number, axes: 'both' | 'x' | 'y' = 'both', flipped = false): DimensionDrawing {
  const { left, top, right, bottom } = bounds;
  const drawing: DimensionDrawing = { guides: [], lines: [], labels: [] };
  const point = (x: number, y: number): MacroCoord => ({ x, y });
  const a = point(left, top), b = point(right, top), c = point(right, bottom), d = point(left, bottom);
  drawing.guides.push([a, b], [b, c], [c, d], [d, a]);
  const offset = 0.8 * inkScale + 0.5;
  const side = flipped ? -1 : 1;
  const tick = 0.18 * inkScale;
  const dimension = (from: MacroCoord, to: MacroCoord, value: number) => {
    const at = point((from.x + to.x) / 2, (from.y + to.y) / 2);
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const gap = Math.min(length / 2, (String(value).length * 0.25 + 0.3) * inkScale);
    drawing.lines.push([from, point(at.x - dx / length * gap, at.y - dy / length * gap)],
      [point(at.x + dx / length * gap, at.y + dy / length * gap), to]);
    for (const p of [from, to]) drawing.lines.push([point(p.x - tick, p.y + tick), point(p.x + tick, p.y - tick)]);
    drawing.labels.push({ at, value });
  };
  if (axes !== 'y') {
    const y = (flipped ? top : bottom) + side * offset;
    const from = point(left, y), to = point(right, y);
    drawing.guides.push([flipped ? a : d, point(from.x, from.y + side * tick)], [flipped ? b : c, point(to.x, to.y + side * tick)]);
    dimension(from, to, Math.round(right - left));
  }
  if (axes !== 'x') {
    const x = (flipped ? left : right) + side * offset;
    const from = point(x, top), to = point(x, bottom);
    drawing.guides.push([flipped ? a : b, point(from.x + side * tick, from.y)], [flipped ? d : c, point(to.x + side * tick, to.y)]);
    dimension(from, to, Math.round(bottom - top));
  }
  return drawing;
}

export function measureDrawing(points: readonly [MacroCoord, MacroCoord], inkScale: number, flipped = false): DimensionDrawing {
  return dimensionDrawing(cellBounds(points)!, inkScale, points[0].y === points[1].y ? 'x' : 'y', flipped);
}

export function dimensionHit(p: MacroCoord, drawing: DimensionDrawing, inkScale: number): boolean {
  const reach = Math.max(0.3, inkScale * 0.18);
  if (drawing.labels.some(({ at, value }) => Math.abs(p.x - at.x) <= (String(value).length * 0.25 + 0.3) * inkScale && Math.abs(p.y - at.y) <= inkScale * 0.45)) return true;
  return [...drawing.lines, ...drawing.guides].some(([a, b]) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    const t = length2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy) <= reach;
  });
}

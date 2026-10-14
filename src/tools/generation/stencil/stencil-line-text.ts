import { NEIGHBORS4_NESW as DIRECTIONS } from '../../../core/grid/directions';
import type { Stencil } from '../recipe';
import { wrapTextRows } from './stencil-text-layout';
import type { TextGridModel } from './stencil-text-grid';
import { sharpLineCorners, joinLinePaths, symmetricLinePaths, routeLineExtrema, simplifyStrokePath, simplifyLinePaths, walkLinePath, type LinePath, type LinePoint } from './stencil-line-path';

/** Font metrics use the same em size for every glyph, including detached marks and descenders. */
export interface StrokeGlyph {
  model: TextGridModel;
  ascent: number;
  descent: number;
  unitsPerPixel: number;
  contour?: boolean;
  ideographic?: boolean;
}

/** Explicit edges keep nearby parallel strokes separate even when their tiles are neighbors. */
function connect(connections: Uint8Array, width: number, a: LinePoint, b: LinePoint): void {
  const direction = DIRECTIONS.findIndex(([dx, dy]) => a[0] + dx === b[0] && a[1] + dy === b[1]);
  if (direction < 0) return;
  connections[a[1] * width + a[0]]! |= 1 << direction;
  connections[b[1] * width + b[0]]! |= 1 << ((direction + 2) % 4);
}

function topology(coverage: Uint8Array, connections: Uint8Array, width: number): { pieces: number; cycles: number; ends: number } {
  const seen = new Uint8Array(coverage.length);
  let pieces = 0, vertices = 0, edges = 0, ends = 0;
  for (let start = 0; start < coverage.length; start++) {
    if (!coverage[start] || seen[start]) continue;
    pieces++;
    const queue = [start]; seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!;
      vertices++;
      let degree = 0;
      for (let d = 0; d < 4; d++) if (connections[i]! & (1 << d)) {
        degree++; edges++;
        const [dx, dy] = DIRECTIONS[d]!, next = i + dy * width + dx;
        if (!seen[next]) { seen[next] = 1; queue.push(next); }
      }
      if (degree === 1) ends++;
      else if (degree === 0) ends += 2;
    }
  }
  return { pieces, cycles: edges / 2 - vertices + pieces, ends };
}

/** Long near-axis segments define shared stem positions without following raster thinning jitter. */
function alignmentZones(model: TextGridModel, axis: 0 | 1): number[] {
  const samples: { value: number; weight: number }[] = [];
  for (const path of model.paths) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const length = Math.abs(a[1 - axis]! - b[1 - axis]!);
    if (length >= model.radius * 2 && Math.abs(a[axis] - b[axis]) <= model.radius * 1.5) {
      samples.push({ value: (a[axis] + b[axis]) / 2, weight: length });
    }
  }
  samples.sort((a, b) => a.value - b.value);
  const groups: typeof samples[] = [];
  for (const sample of samples) {
    const last = groups[groups.length - 1];
    if (last && sample.value - last[0]!.value <= model.radius * 2.5) last.push(sample);
    else groups.push([sample]);
  }
  return groups.map(group => group.reduce((n, s) => n + s.value * s.weight, 0) / group.reduce((n, s) => n + s.weight, 0));
}

/** Fixed advances, shared baseline and one tile-wide centerlines; size only lengthens the strokes. */
export function fitStrokeText(glyphs: readonly (StrokeGlyph | null)[], box: { width: number; height: number }): Stencil | null {
  const visible = glyphs.filter((glyph): glyph is StrokeGlyph => glyph !== null);
  if (!visible.length || !Number.isInteger(box.width) || !Number.isInteger(box.height)) return null;
  const ascent = Math.max(...visible.map(g => g.ascent));
  const descent = Math.max(0, ...visible.map(g => g.descent));
  const emHeight = ascent + descent;
  const span = (g: StrokeGlyph) => {
    const xs = g.model.paths.flatMap(p => p.map(v => v[0]));
    return { low: Math.min(...xs), high: Math.max(...xs) };
  };
  const widths = visible.map(g => { const x = span(g); return (x.high - x.low) * g.unitsPerPixel; });
  const aspect = Math.max(0.4, Math.max(...widths) / emHeight);
  const minimumHeight = Math.max(...visible.map(g => g.model.minimum.height));
  let height = box.height;
  while (height >= minimumHeight) {
    const width = Math.max(3, Math.round((height - 1) * aspect) + 1);
    const gap = Math.max(1, Math.round(height * 0.15));
    const capacity = Math.floor((box.width + gap) / (width + gap));
    const rows = wrapTextRows(glyphs.length, capacity, i => glyphs[i] === null);
    const rowGap = Math.max(2, gap);
    const totalHeight = rows.length * height + (rows.length - 1) * rowGap;
    if (!rows.length || totalHeight > box.height) { height--; continue; }
    const coverage = new Uint8Array(box.width * box.height), connections = new Uint8Array(coverage.length), curves = new Uint8Array(coverage.length);
    const top = Math.floor((box.height - totalHeight) / 2);
    const scale = (height - 1) / emHeight;
    let valid = true;
    for (let ri = 0; ri < rows.length && valid; ri++) {
      const row = rows[ri]!;
      const count = row.end - row.start;
      const left = Math.floor((box.width - count * width - (count - 1) * gap) / 2);
      for (let gi = row.start; gi < row.end; gi++) {
        const glyph = glyphs[gi];
        if (!glyph) continue;
        const { model } = glyph, bounds = span(glyph), unit = glyph.unitsPerPixel;
        const centerlines = glyph.contour || glyph.ideographic ? model.paths : model.paths.map(path => simplifyStrokePath(path, model.radius * 1.2));
        // Resolve bends before expansion so large lettering has the same bounded design cost.
        const designHeight = Math.min(height, Math.max(32, model.minimum.height));
        const ratio = (designHeight - 1) / (height - 1);
        const designWidth = Math.max(3, Math.round((width - 1) * ratio) + 1);
        const localInk = new Uint8Array(designWidth * designHeight), localEdges = new Uint8Array(localInk.length);
        const horizontal = glyph.contour ? [] : alignmentZones(model, 0), vertical = glyph.contour ? [] : alignmentZones(model, 1);
        const ys = model.paths.flatMap(path => path.map(p => p[1]));
        const low = Math.min(...ys), high = Math.max(...ys);
        if (!glyph.contour && !glyph.ideographic) vertical.push(low, high);
        const fontY = (y: number) => ascent - glyph.ascent + (high > low ? (y - low) / (high - low) : 0.5) * (glyph.ascent + glyph.descent);
        const snap = (value: number, zones: readonly number[]): number => {
          const zone = zones.reduce((a, b) => Math.abs(a - value) < Math.abs(b - value) ? a : b, value + model.radius * 3);
          return Math.abs(zone - value) <= model.radius * (glyph.ideographic ? 0.5 : 1.5) ? zone : value;
        };
        const snapY = (y: number): number => {
          if (!glyph.contour && !glyph.ideographic) {
            if (y - low <= model.radius * 2) return low;
            if (high - y <= model.radius * 2) return high;
          }
          return snap(y, vertical);
        };
        const map = ([x, y]: LinePoint): LinePoint => [
          Math.max(
            0,
            Math.min(designWidth - 1, Math.round((designWidth - 1) / 2 + (snap(x, horizontal) - (bounds.low + bounds.high) / 2) * unit * scale * ratio)),
          ),
          Math.max(0, Math.min(designHeight - 1, Math.round(fontY(snapY(y)) * scale * ratio))),
        ];
        const put = ([x, y]: LinePoint) => { localInk[y * designWidth + x] = 255; };
        const draw = (paths: readonly LinePath[]) => {
          localInk.fill(0); localEdges.fill(0);
          for (const path of paths) walkLinePath(path, (p, previous) => {
            put(p);
            if (previous) connect(localEdges, designWidth, previous, p);
          });
          return topology(localInk, localEdges, designWidth);
        };
        const paths = joinLinePaths(centerlines.map(path => path.map(map))).map(routeLineExtrema);
        const shape = draw(paths);
        if (shape.pieces !== model.pieces || shape.cycles !== model.counters ||
          (model.ends > 2 && shape.ends < model.ends - Math.max(1, Math.floor(model.ends / 4)))) { valid = false; break; }
        const accepts = (candidate: readonly LinePath[]) => {
          const next = draw(candidate);
          return next.pieces === shape.pieces && next.cycles === shape.cycles && next.ends === shape.ends;
        };
        let simplified = simplifyLinePaths(paths, Math.max(0.75, designHeight * (glyph.contour ? 0.04 : glyph.ideographic ? 0.05 : 0.12)), accepts);
        if (!glyph.contour && !glyph.ideographic && model.bands.length === 1 && model.bands[0]!.symmetric) {
          simplified = symmetricLinePaths(simplified, 0, accepts);
        }
        if (!glyph.contour && !glyph.ideographic && model.symmetricY) simplified = symmetricLinePaths(simplified, 1, accepts);
        const ox = left + (gi - row.start) * (width + gap);
        const expand = ([x, y]: LinePoint): LinePoint => [
          ox + Math.round(x * (width - 1) / (designWidth - 1)),
          top + ri * (height + rowGap) + Math.round(y * (height - 1) / (designHeight - 1)),
        ];
        const sharp = sharpLineCorners(model.paths).map(map).map(expand);
        const cornerRadius = Math.max(1, (height - 1) / (designHeight - 1) * 1.5);
        for (const path of simplified) walkLinePath(path.map(expand), (p, previous) => {
          const index = p[1] * box.width + p[0];
          coverage[index] = 255;
          if (!sharp.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) <= cornerRadius)) curves[index] = 1;
          if (previous) connect(connections, box.width, previous, p);
        });
      }
    }
    if (valid) return { ...box, coverage, connections, curves, color: new Uint32Array(coverage.length), cellAligned: true };
    height--;
  }
  return null;
}

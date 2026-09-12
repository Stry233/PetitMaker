import type { Stencil } from '../../../core/model/types';

type Point = readonly [number, number];
type Path = readonly Point[];
type Interval = readonly [number, number];
type Box = { width: number; height: number };
interface Band { left: number; right: number; axis: number[]; minimum: number; symmetric: boolean; ends: number }
export interface TextGridModel {
  width: number;
  height: number;
  paths: Path[];
  radius: number;
  bands: Band[];
  gaps: number[];
  vertical: number[];
  minimum: Box;
  pieces: number;
  counters: number;
  ends: number;
}

const NEIGHBORS: readonly Point[] = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const MIN_HEIGHT = 5;

/** Foreground uses corner connectivity; a counter must have no edge-connected route outside. */
export function textTopology(ink: Uint8Array, width: number, height: number, minimumCounterArea = 0): { pieces: number; counters: number } {
  const seen = new Uint8Array(ink.length);
  let pieces = 0, counters = 0;
  for (let start = 0; start < ink.length; start++) {
    if (seen[start]) continue;
    const filled = ink[start]! > 0;
    const todo = [start];
    seen[start] = 1;
    let border = false;
    for (let head = 0; head < todo.length; head++) {
      const i = todo[head]!, x = i % width, y = Math.floor(i / width);
      border ||= x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (let d = 0; d < 8; d += filled ? 1 : 2) {
        const [dx, dy] = NEIGHBORS[d]!, nx = x + dx, ny = y + dy;
        const j = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[j] || (ink[j]! > 0) !== filled) continue;
        seen[j] = 1; todo.push(j);
      }
    }
    if (filled) pieces++;
    else if (!border && todo.length >= minimumCounterArea) counters++;
  }
  return { pieces, counters };
}

function distanceInside(ink: Uint8Array, w: number, h: number): Float32Array {
  const out = Float32Array.from(ink, v => v ? w + h : 0);
  const at = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h ? 0 : out[y * w + x]!;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (ink[i]) out[i] = Math.min(out[i]!, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + Math.SQRT2, at(x + 1, y - 1) + Math.SQRT2);
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (ink[i]) out[i] = Math.min(out[i]!, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + Math.SQRT2, at(x - 1, y + 1) + Math.SQRT2);
  }
  return out;
}

/** Two alternating thinning passes retain the connectivity and counters of the font outline. */
function skeleton(ink: Uint8Array, w: number, h: number, distance: Float32Array): Uint8Array {
  const out = ink.slice();
  // A deepest pixel anchors each component so parallel thinning cannot erase a small dot.
  const anchors = new Set<number>(), visited = new Uint8Array(ink.length);
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || visited[start]) continue;
    const todo = [start]; visited[start] = 1;
    let anchor = start;
    for (let head = 0; head < todo.length; head++) {
      const i = todo[head]!, x = i % w, y = Math.floor(i / w);
      if (distance[i]! > distance[anchor]!) anchor = i;
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx, ny = y + dy, j = ny * w + nx;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || visited[j] || !ink[j]) continue;
        visited[j] = 1; todo.push(j);
      }
    }
    anchors.add(anchor);
  }

  const at = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h ? 0 : out[y * w + x]!;
  let changed: number;
  do {
    changed = 0;
    for (let phase = 0; phase < 2; phase++) {
      const remove: number[] = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!out[y * w + x] || anchors.has(y * w + x)) continue;
        const p = NEIGHBORS.map(([dx, dy]) => at(x + dx, y + dy));
        const count = p.reduce((a, b) => a + b, 0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        const blocked = phase === 0
          ? (p[0]! * p[2]! * p[4]!) || (p[2]! * p[4]! * p[6]!)
          : (p[0]! * p[2]! * p[6]!) || (p[0]! * p[4]! * p[6]!);
        if (!blocked) remove.push(y * w + x);
      }
      for (const i of remove) out[i] = 0;
      changed += remove.length;
    }
  } while (changed);
  return out;
}

function trace(ink: Uint8Array, w: number, h: number): Point[][] {
  const graph = new Map<number, number[]>();
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x];
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    const x = i % w, y = Math.floor(i / w);
    graph.set(i, NEIGHBORS.flatMap(([dx, dy]) =>
      at(x + dx, y + dy) && !(dx && dy && (at(x + dx, y) || at(x, y + dy))) ? [(y + dy) * w + x + dx] : []));
  }
  const used = new Set<number>();
  const paths: Point[][] = [];
  const edge = (a: number, b: number) => a * ink.length + b;
  const point = (i: number): Point => [i % w, Math.floor(i / w)];
  const starts = [...graph.keys()].sort((a, b) => Number(graph.get(a)!.length === 2) - Number(graph.get(b)!.length === 2));
  for (const start of starts) {
    const neighbors = graph.get(start)!;
    if (!neighbors.length) paths.push([point(start)]);
    for (const second of neighbors) {
      if (used.has(edge(start, second))) continue;
      const path = [point(start)];
      let prev = start, cur = second;
      for (;;) {
        used.add(edge(prev, cur)); used.add(edge(cur, prev)); path.push(point(cur));
        const next = graph.get(cur)!;
        if (cur === start || next.length !== 2) break;
        const dest = next.find(i => i !== prev)!;
        prev = cur; cur = dest;
      }
      paths.push(path);
    }
  }
  return paths;
}

function endsOf(paths: readonly Path[]): number {
  const degrees = new Map<string, number>();
  for (const path of paths) if (path.length > 1) for (const p of [path[0]!, path[path.length - 1]!]) {
    degrees.set(p.join(), (degrees.get(p.join()) ?? 0) + 1);
  }
  return [...degrees.values()].filter(degree => degree === 1).length;
}

/** Open branches distinguish dense characters whose enclosed spaces alone can survive a merge. */
export function textStrokeEnds(coverage: Uint8Array, width: number, height: number): number {
  const ink = Uint8Array.from(coverage, v => v >= 128 ? 1 : 0);
  return endsOf(trace(skeleton(ink, width, height, distanceInside(ink, width, height)), width, height));
}

function simplify(path: Path, epsilon: number): Point[] {
  if (path.length < 3) return [...path];
  const [ax, ay] = path[0]!, [bx, by] = path[path.length - 1]!;
  const length = Math.hypot(bx - ax, by - ay);
  let farthest = epsilon, split = -1;
  for (let i = 1; i < path.length - 1; i++) {
    const [x, y] = path[i]!;
    const distance = length ? Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / length : Math.hypot(x - ax, y - ay);
    if (distance > farthest) { farthest = distance; split = i; }
  }
  return split < 0 ? [path[0]!, path[path.length - 1]!] : [...simplify(path.slice(0, split + 1), epsilon).slice(0, -1), ...simplify(path.slice(split), epsilon)];
}

/** Endpoints, turns and straight stems supply alignment zones without character-specific drawings. */
function landmarks(paths: readonly Path[], radius: number, axis: 0 | 1): number[] {
  const values: number[] = [];
  let low = Infinity, high = -Infinity;
  for (const path of paths) {
    for (const p of path) { low = Math.min(low, p[axis]); high = Math.max(high, p[axis]); }
    const first = path[0]!, last = path[path.length - 1]!;
    if (first[0] !== last[0] || first[1] !== last[1]) values.push(first[axis], last[axis]);
    for (let i = 1; i < path.length - 1; i++) {
      const prev = path[i - 1]!, p = path[i]!, next = path[i + 1]!;
      const incoming: Point = [p[0] - prev[0], p[1] - prev[1]], outgoing: Point = [next[0] - p[0], next[1] - p[1]];
      const turn = [0, 1].some(d => incoming[d]! * outgoing[d]! < 0);
      const sharp = incoming[0] * outgoing[0] + incoming[1] * outgoing[1] < 0.2 * Math.hypot(...incoming) * Math.hypot(...outgoing);
      if (incoming[axis] * outgoing[axis] < 0 || (turn && sharp)) values.push(p[axis]);
    }
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      if (Math.abs(a[axis] - b[axis]) <= radius / 2 && Math.abs(a[1 - axis]! - b[1 - axis]!) >= radius * 2) values.push((a[axis] + b[axis]) / 2);
    }
  }
  values.push(low, high); values.sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const value of values) {
    const last = groups[groups.length - 1];
    if (last && value - last[0]! <= radius * 1.8) last.push(value);
    else groups.push([value]);
  }
  const centers = groups.map(g => g.reduce((a, b) => a + b, 0) / g.length);
  if (centers.length > 1) { centers[0] = low; centers[centers.length - 1] = high; }
  return centers;
}

function intervals(values: ArrayLike<number>): Interval[] {
  const runs: Interval[] = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    if (i < values.length && values[i]) { if (start < 0) start = i; }
    else if (start >= 0) { runs.push([start - 0.5, i - 0.5]); start = -1; }
  }
  return runs;
}

export function analyzeTextGrid(source: Pick<Stencil, 'width' | 'height' | 'coverage'>): TextGridModel | null {
  const { width: w, height: h } = source;
  const ink = Uint8Array.from(source.coverage, v => v >= 128 ? 1 : 0);
  if (!ink.some(Boolean)) return null;
  const distance = distanceInside(ink, w, h), thin = skeleton(ink, w, h, distance);
  const radii = Array.from(distance).filter((_, i) => thin[i]).sort((a, b) => a - b);
  const radius = Math.max(1, radii[Math.floor(radii.length / 2)] ?? 1);
  let paths = trace(thin, w, h);
  const ends = new Map<string, number>();
  for (const path of paths) for (const p of [path[0]!, path[path.length - 1]!]) ends.set(p.join(), (ends.get(p.join()) ?? 0) + 1);
  for (const path of paths) {
    const first = ends.get(path[0]!.join()) === 1, last = ends.get(path[path.length - 1]!.join()) === 1;
    const length = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - path[i]![0], p[1] - path[i]![1]), 0);
    if (first === last || length >= radius * 1.5) continue;
    const terminal = first ? path : [...path].reverse();
    for (const [x, y] of terminal.slice(0, -1)) thin[y * w + x] = 0;
  }
  paths = trace(thin, w, h).map(p => simplify(p, 1.4));
  const vertical = landmarks(paths, radius, 1);
  const occupied = new Uint8Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[y * w + x]) occupied[x] = 1;
  const bands: Band[] = intervals(occupied).map(([a, b]) => {
    const left = Math.ceil(a), right = Math.floor(b);
    const local = paths.filter(p => p.some(([x]) => x >= left && x <= right));
    let runs = 1, difference = 0, mass = 0;
    for (let y = 0; y < h; y++) {
      runs = Math.max(runs, intervals(ink.subarray(y * w + left, y * w + right + 1)).length);
      for (let x = left; x <= right; x++) {
        difference += Math.abs(ink[y * w + x]! - ink[y * w + left + right - x]!);
        mass += ink[y * w + x]!;
      }
    }
    const axis = landmarks(local, radius, 0);
    return { left, right, axis, minimum: Math.max(axis.length > 1 ? 2 : 1, Math.min(5, 2 * runs - 1)), symmetric: difference / Math.max(1, mass) < 0.25, ends: endsOf(local) };
  });
  const gaps = bands.slice(1).map((band, i) => band.left - bands[i]!.right - 1 > radius * 4 ? 2 : 1);
  const minimum = { width: bands.reduce((n, b) => n + b.minimum, 0) + gaps.reduce((a, b) => a + b, 0), height: MIN_HEIGHT };
  return { width: w, height: h, paths, radius, bands, gaps, vertical, minimum, ends: endsOf(paths), ...textTopology(ink, w, h, Math.max(2, radius * radius / 2)) };
}

function interpolate(value: number, from: readonly number[], to: readonly number[]): number {
  if (from.length === 1 || from[0] === from[from.length - 1]) return to[0]!;
  let i = 1;
  while (i < from.length - 1 && value > from[i]!) i++;
  return to[i - 1]! + (value - from[i - 1]!) / (from[i]! - from[i - 1]!) * (to[i]! - to[i - 1]!);
}

function axisMap(landmarks: readonly number[], cells: number, separate = true): { source: number[]; target: number[] } {
  if (cells === 1 || landmarks.length === 1) return { source: [(landmarks[0]! + landmarks[landmarks.length - 1]!) / 2], target: [(cells - 1) / 2] };
  const source = [...landmarks];
  while (source.length > cells) {
    let best = 1;
    for (let i = 2; i < source.length - 1; i++) if (Math.min(source[i]! - source[i - 1]!, source[i + 1]! - source[i]!) < Math.min(source[best]! - source[best - 1]!, source[best + 1]! - source[best]!)) best = i;
    source.splice(best, 1);
  }
  const gap = separate && (source.length - 1) * 2 <= cells - 1 ? 2 : 1;
  const target = source.map(v => Math.round((v - source[0]!) / (source[source.length - 1]! - source[0]!) * (cells - 1)));
  for (let i = 1; i < target.length - 1; i++) target[i] = Math.max(target[i]!, target[i - 1]! + gap);
  for (let i = target.length - 2; i > 0; i--) target[i] = Math.min(target[i]!, target[i + 1]! - gap);
  return { source, target };
}

/** Ordered stroke centers remain distinct when ordinary rounding puts them in the same cell. */
function fitCenters(values: number[], cells: number, symmetric = false): number[] {
  let centers = values.sort((a, b) => a - b).filter((v, i, all) => !i || v - all[i - 1]! > 0.4);
  while (centers.length > cells) {
    let gap = 0;
    for (let i = 1; i < centers.length - 1; i++) if (centers[i + 1]! - centers[i]! < centers[gap + 1]! - centers[gap]!) gap = i;
    centers.splice(gap, 2, (centers[gap]! + centers[gap + 1]!) / 2);
  }
  if (symmetric && centers.length) {
    const pairs = Math.floor(centers.length / 2);
    const half = Math.max(pairs, Math.floor((cells - 1) / 2));
    const left = fitCenters(centers.slice(0, pairs).map((v, i) => (v + cells - 1 - centers[centers.length - 1 - i]!) / 2), half);
    const middle = centers.length % 2 ? [Math.floor((cells - 1) / 2), Math.ceil((cells - 1) / 2)] : [];
    return [...left, ...middle, ...left.map(x => cells - 1 - x)];
  }
  let states = new Map<number, { cost: number; points: number[] }>([[-1, { cost: 0, points: [] }]]);
  for (let i = 0; i < centers.length; i++) {
    const next = new Map<number, { cost: number; points: number[] }>();
    for (const [prev, state] of states) for (let x = prev + 1; x <= cells - centers.length + i; x++) {
      const cost = state.cost + (x - centers[i]!) ** 2;
      if (cost < (next.get(x)?.cost ?? Infinity)) next.set(x, { cost, points: [...state.points, x] });
    }
    states = next;
  }
  return [...states.values()].sort((a, b) => a.cost - b.cost)[0]?.points ?? [];
}

function scanStrokes(paths: readonly Path[], axis: 0 | 1, line: number, cells: number, symmetric = false): number[] {
  const centers: number[] = [], bars: number[] = [];
  for (const path of paths) {
    if (path.length === 1 && Math.round(path[0]![axis]) === line) centers.push(path[0]![1 - axis]!);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      if (Math.abs(b[axis] - a[axis]) < 0.01) {
        if (Math.abs(line - a[axis]) <= 0.25) for (let x = Math.round(Math.min(a[1 - axis]!, b[1 - axis]!)); x <= Math.round(Math.max(a[1 - axis]!, b[1 - axis]!)); x++) bars.push(x);
      } else if (line >= Math.min(a[axis], b[axis]) && line <= Math.max(a[axis], b[axis])) {
        centers.push(a[1 - axis]! + (line - a[axis]) / (b[axis] - a[axis]) * (b[1 - axis]! - a[1 - axis]!));
      }
    }
  }
  return [...bars, ...fitCenters(centers, cells, symmetric)];
}

export interface TextGridResult { stencil: Stencil; ok: boolean; loss: number }

export function fitTextGrid(model: TextGridModel, box: Box): TextGridResult | null {
  let best = fitAtHeight(model, box, 0);
  if (!best || best.ok) return best;
  // A nearby height can separate a junction that lands between cells at the largest fit.
  for (let reduction = 1; reduction <= 3; reduction++) {
    const result = fitAtHeight(model, box, reduction);
    if (!result) break;
    if (result.ok) return result;
    if (result.loss < best.loss) best = result;
  }
  // Even-width symmetry can fuse central branches that remain distinct one column narrower.
  for (let inset = 1; inset <= 2 && box.width - inset >= model.minimum.width; inset++) {
    const frame = { width: box.width - inset, height: box.height };
    for (let reduction = 0; reduction <= 3; reduction++) {
      const result = fitAtHeight(model, frame, reduction);
      if (!result) break;
      if (!result.ok) continue;
      const coverage = new Uint8Array(box.width * box.height), ox = Math.floor(inset / 2);
      for (let y = 0; y < box.height; y++) coverage.set(result.stencil.coverage.subarray(y * frame.width, (y + 1) * frame.width), y * box.width + ox);
      return { stencil: { ...result.stencil, width: box.width, coverage, color: new Uint32Array(coverage.length) }, ok: true, loss: 0 };
    }
  }
  return best;
}

function fitAtHeight(model: TextGridModel, box: Box, reduction: number): TextGridResult | null {
  const { width, height } = box;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < model.minimum.width || height < model.minimum.height) return null;
  const refHeight = model.vertical[model.vertical.length - 1]! - model.vertical[0]! + model.radius * 2;
  const first = model.bands[0]!, last = model.bands[model.bands.length - 1]!;
  const aspect = (last.right - first.left + 1) / refHeight;
  const extent = Math.min(width / model.bands.length, height);
  const air = extent >= 10 ? 1 : 0;
  const stretch = 1 + 0.7 * Math.max(0, 1 - (extent - 5) / 12);
  const inkH = Math.max(MIN_HEIGHT, Math.min(height - air, Math.round((width - air) / aspect * stretch))) - reduction;
  if (inkH < MIN_HEIGHT) return null;
  const sizes = model.bands.map(b => Math.max(b.minimum, Math.round((b.right - b.left + 1) / refHeight * inkH)));
  const gaps = model.bands.slice(1).map((b, i) => Math.max(model.gaps[i]!, Math.round((b.left - model.bands[i]!.right - 1) / refHeight * inkH)));
  const total = () => sizes.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);
  while (total() > width - air) {
    let index = -1;
    for (let i = 0; i < sizes.length; i++) if (sizes[i]! > model.bands[i]!.minimum && (index < 0 || sizes[i]! / model.bands[i]!.minimum > sizes[index]! / model.bands[index]!.minimum)) index = i;
    if (index >= 0) { sizes[index]!--; continue; }
    const gap = gaps.findIndex((g, i) => g > model.gaps[i]!);
    if (gap < 0) break;
    gaps[gap]!--;
  }
  const oy = Math.floor((height - inkH) / 2);
  const best: { result: TextGridResult | null; blocks: number } = { result: null, blocks: Infinity };
  for (let expansion = 0; expansion < 3; expansion++) {
    for (const vertical of [axisMap(model.vertical, inkH), axisMap(model.vertical, inkH, false)])
    for (const method of ['scan', 'path']) for (const tolerance of [0.25, 0.4, 0.55]) {
      const coverage = new Uint8Array(width * height);
      let ox = Math.floor((width - total()) / 2);
      let endLoss = 0;
      for (let bi = 0; bi < model.bands.length; bi++) {
        const band = model.bands[bi]!, bw = sizes[bi]!, horizontal = axisMap(band.axis, bw);
        const mapped = (value: number, mapping: { source: number[]; target: number[] }) => {
          const closest = mapping.source.reduce((a, b) => Math.abs(a - value) < Math.abs(b - value) ? a : b);
          const snapped = Math.abs(closest - value) <= model.radius * 0.75 ? closest : value;
          return interpolate(snapped, mapping.source, mapping.target);
        };
        const put = (x: number, y: number) => {
          if (x >= 0 && y >= 0 && x < bw && y < inkH) coverage[(oy + y) * width + ox + x] = 255;
        };
        const paths = model.paths.filter(p => p.some(([x]) => x >= band.left && x <= band.right))
          .map(path => simplify(path.map(([x, y]): Point => [mapped(x, horizontal), mapped(y, vertical)]), tolerance));
        if (method === 'scan') {
          for (let y = 0; y < inkH; y++) for (const x of scanStrokes(paths, 1, y, bw, band.symmetric)) put(x, y);
          const crossbars = paths.flatMap(path => path.slice(1).flatMap((p, i) =>
            Math.abs(p[0] - path[i]![0]) >= 2 * Math.abs(p[1] - path[i]![1]) ? [[path[i]!, p]] : []));
          for (let x = 0; x < bw; x++) for (const y of scanStrokes(crossbars, 0, x, inkH)) put(x, y);
        } else for (const path of paths) {
          const points = path.map(([x, y]): Point => [Math.round(x), Math.round(y)]);
          put(points[0]![0], points[0]![1]);
          for (let i = 1; i < points.length; i++) {
            let [x, y] = points[i - 1]!;
            const [tx, ty] = points[i]!;
            const dx = Math.abs(tx - x), dy = -Math.abs(ty - y), sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
            let error = dx + dy;
            while (x !== tx || y !== ty) {
              const twice = 2 * error;
              if (twice >= dy) { error += dy; x += sx; }
              if (twice <= dx) { error += dx; y += sy; }
              put(x, y);
            }
          }
        }
        if (band.symmetric) for (let y = 0; y < inkH; y++) for (let x = 0; x < bw / 2; x++) {
          const a = (oy + y) * width + ox + x, b = (oy + y) * width + ox + bw - 1 - x;
          coverage[a] = coverage[b] = Math.max(coverage[a]!, coverage[b]!);
        }
        if (band.ends > 2) {
          const local = Uint8Array.from({ length: bw * inkH }, (_, i) => coverage[(oy + Math.floor(i / bw)) * width + ox + i % bw]!);
          endLoss += Math.max(0, band.ends - Math.max(1, Math.floor(band.ends / 4)) - textStrokeEnds(local, bw, inkH));
        }
        ox += bw + (gaps[bi] ?? 0);
      }
      const topology = textTopology(coverage, width, height);
      const loss = Math.abs(topology.pieces - model.pieces) + Math.abs(topology.counters - model.counters) + endLoss;
      let blocks = 0;
      for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
        const i = y * width + x;
        if (coverage[i] && coverage[i + 1] && coverage[i + width] && coverage[i + width + 1]) blocks++;
      }
      if (!best.result || loss < best.result.loss || (loss === best.result.loss && blocks < best.blocks)) {
        best.result = { stencil: { width, height, coverage, color: new Uint32Array(width * height), cellAligned: true }, ok: loss === 0, loss };
        best.blocks = blocks;
      }
      if (best.result.ok && best.blocks === 0) return best.result;
    }
    if (best.result?.ok) return best.result;
    let changed = false;
    for (let i = 0; i < sizes.length && total() < width - air; i++) { sizes[i]!++; changed = true; }
    if (!changed) break;
  }
  return best.result;
}

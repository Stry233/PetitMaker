export type LinePoint = readonly [number, number];
export type LinePath = readonly LinePoint[];

/** Remove sub-stroke deviations while retaining endpoints shared by the source graph. */
export function simplifyStrokePath(path: LinePath, epsilon: number): LinePoint[] {
  if (path.length < 3) return [...path];
  const [ax, ay] = path[0]!, [bx, by] = path[path.length - 1]!;
  const length = Math.hypot(bx - ax, by - ay);
  let farthest = epsilon, split = -1;
  for (let i = 1; i < path.length - 1; i++) {
    const [x, y] = path[i]!;
    const distance = length ? Math.abs((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / length : Math.hypot(x - ax, y - ay);
    if (distance > farthest) { farthest = distance; split = i; }
  }
  return split < 0 ? [path[0]!, path[path.length - 1]!] : [
    ...simplifyStrokePath(path.slice(0, split + 1), epsilon).slice(0, -1), ...simplifyStrokePath(path.slice(split), epsilon)
  ];
}

/** Quantization can collapse a short cap, leaving two graph edges to join at its former junction. */
export function joinLinePaths(paths: readonly LinePath[]): LinePath[] {
  const result = paths.map(compact).filter(path => path.length > 1);
  for (const path of paths) if (path.length && !result.some(p => p.some(q => q[0] === path[0]![0] && q[1] === path[0]![1]))) {
    if (compact(path).length === 1) result.push([path[0]!]);
  }
  for (;;) {
    const ends = new Map<string, { index: number; first: boolean }[]>();
    result.forEach((path, index) => {
      if (path.length < 2) return;
      for (const first of [true, false]) {
        const key = path[first ? 0 : path.length - 1]!.join();
        const group = ends.get(key) ?? [];
        group.push({ index, first }); ends.set(key, group);
      }
    });
    const pair = [...ends.values()].find(group => group.length === 2 && group[0]!.index !== group[1]!.index);
    if (!pair) return result;
    const [a, b] = pair;
    const left = a!.first ? [...result[a!.index]!].reverse() : result[a!.index]!;
    const right = b!.first ? result[b!.index]! : [...result[b!.index]!].reverse();
    result[a!.index] = compact([...left, ...right.slice(1)]);
    result.splice(b!.index, 1);
  }
}

/** Diagonal legs meet across an extremum, not along a shared dead-end stem. */
export function routeLineExtrema(path: LinePath): LinePath {
  const result: LinePoint[] = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!, before = path[i - 1], after = path[i + 1];
    if (before && after) {
      const dx1 = Math.sign(p[0] - before[0]), dx2 = Math.sign(after[0] - p[0]);
      const dy1 = Math.sign(p[1] - before[1]), dy2 = Math.sign(after[1] - p[1]);
      if ((dx1 || dx2) && dx1 * dx2 >= 0 && dy1 && dy1 === -dy2) {
        result.push([p[0] - dx1, p[1]], p, [p[0] + dx2, p[1]]);
        continue;
      }
      if ((dy1 || dy2) && dy1 * dy2 >= 0 && dx1 && dx1 === -dx2) {
        result.push([p[0], p[1] - dy1], p, [p[0], p[1] + dy2]);
        continue;
      }
    }
    result.push(p);
  }
  return compact(result);
}

function compact(path: LinePath): LinePoint[] {
  const result: LinePoint[] = [];
  for (const p of path) {
    const b = result[result.length - 1], a = result[result.length - 2];
    if (b && p[0] === b[0] && p[1] === b[1]) continue;
    if (a && b && (b[0] - a[0]) * (p[1] - b[1]) === (b[1] - a[1]) * (p[0] - b[0]) &&
      (b[0] - a[0]) * (p[0] - b[0]) + (b[1] - a[1]) * (p[1] - b[1]) > 0) result.pop();
    result.push(p);
  }
  return result;
}

export function walkLinePath(path: LinePath, visit: (p: LinePoint, previous?: LinePoint) => void): void {
  let previous: LinePoint | undefined;
  for (let i = 0; i < path.length; i++) {
    const target = path[i]!;
    if (!previous) { visit(target); previous = target; continue; }
    let [x, y] = previous;
    const [tx, ty] = target, dx = Math.abs(tx - x), dy = Math.abs(ty - y);
    let ix = 0, iy = 0;
    while (x !== tx || y !== ty) {
      if (x !== tx && (y === ty || (ix + 0.5) * dy <= (iy + 0.5) * dx)) { x += Math.sign(tx - x); ix++; }
      else { y += Math.sign(ty - y); iy++; }
      const next: LinePoint = [x, y];
      visit(next, previous); previous = next;
    }
  }
}

function distanceSquared(p: LinePoint, path: LinePath): number {
  let distance = Infinity;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    distance = Math.min(distance, (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2);
  }
  return distance;
}

/** Compare both directions so a shortcut cannot erase a bowl or flatten a detached stroke. */
function deviation(path: LinePath, reference: LinePath, limit: number): number {
  let error = 0, count = 0;
  for (const [from, to] of [[path, reference], [reference, path]] as const) {
    let valid = true;
    walkLinePath(from, p => {
      if (!valid) return;
      const d = distanceSquared(p, to);
      if (d > limit * limit) valid = false;
      error += d; count++;
    });
    if (!valid) return Infinity;
  }
  return error / Math.max(1, count);
}

/** Coordinate reversals separate diagonal legs; shortcuts must retain their peaks and valleys. */
function monotoneSections(path: LinePath): LinePath[] {
  if (path.length < 3) return [path];
  const cuts = new Set([0, path.length - 1]);
  for (const axis of [0, 1] as const) {
    let direction = 0, lastMotion = 0;
    for (let i = 1; i < path.length; i++) {
      const next = Math.sign(path[i]![axis] - path[i - 1]![axis]);
      if (!next) continue;
      if (direction && next !== direction) { cuts.add(lastMotion); cuts.add(i - 1); }
      direction = next;
      lastMotion = i;
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  return points.slice(1).map((end, i) => path.slice(points[i]!, end + 1));
}

/** Half-length terminal runs center a staircase on its diagonal in either direction. */
function balancedStaircase(a: LinePoint, b: LinePoint, steps: number, axis: 0 | 1): LinePath {
  const point = (t: number): LinePoint => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)];
  const path: LinePoint[] = [a];
  for (let i = 0; i < steps; i++) {
    const before = point(i / steps), after = point((i + 1) / steps), middle = point((i + 0.5) / steps);
    path.push(axis === 0 ? [middle[0], before[1]] : [before[0], middle[1]]);
    path.push(axis === 0 ? [middle[0], after[1]] : [after[0], middle[1]]);
  }
  return compact([...path, b]);
}

/** Bend reduction is measured in glyph units, so enlarging text lengthens runs rather than adding steps. */
export function simplifyLinePaths(paths: readonly LinePath[], tolerance: number, accept: (paths: readonly LinePath[]) => boolean): LinePath[] {
  const originals = paths.flatMap(monotoneSections).map(path => {
    const points: LinePoint[] = [];
    walkLinePath(path, p => points.push(p));
    return compact(points);
  });
  const result: LinePath[] = [...originals];
  for (let n = 0; n < result.length; n++) {
    const reference = originals[n]!;
    const xs = reference.map(p => p[0]), ys = reference.map(p => p[1]);
    const span = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    // Narrow diagonal legs need a smaller error budget than the height of the complete glyph.
    const limit = Math.min(tolerance, Math.max(0.75, span / 4));
    let path = result[n]!;
    while (path.length > 2) {
      const candidates: { path: LinePath; score: number }[] = [];
      for (let i = 0; i < path.length - 2; i++) for (let j = i + 2; j < Math.min(path.length, i + 17); j++) {
        const a = path[i]!, b = path[j]!;
        for (const corner of [[a[0], b[1]], [b[0], a[1]]] as const) {
          const next = compact([...path.slice(0, i + 1), corner, ...path.slice(j)]);
          const removed = path.length - next.length;
          if (removed <= 0) continue;
          const error = deviation(next, reference, limit);
          if (Number.isFinite(error)) candidates.push({ path: next, score: error / removed });
        }
      }
      candidates.sort((a, b) => a.score - b.score);
      const chosen = candidates.find(candidate => {
        result[n] = candidate.path;
        return accept(result);
      });
      if (!chosen) { result[n] = path; break; }
      path = chosen.path;
      result[n] = path;
    }
    const balanced: { path: LinePath; error: number }[] = [];
    for (let steps = 1; steps <= (path.length - 2) / 2; steps++) for (const axis of [0, 1] as const) {
      const candidate = balancedStaircase(reference[0]!, reference[reference.length - 1]!, steps, axis);
      if (candidate.length > path.length) continue;
      const error = deviation(candidate, reference, limit);
      if (Number.isFinite(error)) balanced.push({ path: candidate, error });
    }
    balanced.sort((a, b) => a.path.length - b.path.length || a.error - b.error);
    const chosen = balanced.find(candidate => { result[n] = candidate.path; return accept(result); });
    result[n] = chosen?.path ?? path;
  }
  return result;
}

/** Mirror a fitted half only for a source glyph that declares bilateral symmetry. */
export function symmetricLinePaths(paths: readonly LinePath[], axis: 0 | 1, accept: (paths: readonly LinePath[]) => boolean): LinePath[] {
  if (axis === 1) {
    const transpose = (paths: readonly LinePath[]) => paths.map(path => path.map(([x, y]): LinePoint => [y, x]));
    return transpose(symmetricLinePaths(transpose(paths), 0, candidate => accept(transpose(candidate))));
  }
  const xs = paths.flatMap(path => path.map(p => p[0]));
  const sum = Math.min(...xs) + Math.max(...xs);
  const candidates = [false, true].map(right => {
    const half: LinePoint[][] = [];
    for (const path of paths) {
      let run: LinePoint[] = [];
      walkLinePath(path, p => {
        if (right ? p[0] * 2 >= sum : p[0] * 2 <= sum) run.push(p);
        else if (run.length) { half.push(run); run = []; }
      });
      if (run.length) half.push(run);
    }
    const result: LinePath[] = half.flatMap(path => [compact(path), compact(path.map(([x, y]) => [sum - x, y]))]);
    // An even-width glyph joins its halves across the central edge.
    if (sum % 2) for (const path of half) for (const p of [path[0]!, path[path.length - 1]!]) {
      if (Math.abs(p[0] * 2 - sum) === 1) result.push([p, [sum - p[0], p[1]]]);
    }
    return result;
  });
  candidates.sort((a, b) => a.reduce((sum, p) => sum + p.length, 0) - b.reduce((sum, p) => sum + p.length, 0));
  return candidates.find(accept) ?? [...paths];
}

/** Axis-aligned source corners stay angular; diagonal and curved strokes may use rounded tiles. */
export function sharpLineCorners(paths: readonly LinePath[]): LinePoint[] {
  const corners: LinePoint[] = [];
  const axis = (dx: number, dy: number) => Math.abs(dx) > Math.abs(dy) * 4 ? 0 : Math.abs(dy) > Math.abs(dx) * 4 ? 1 : -1;
  for (const path of paths) {
    const first = path[0], last = path[path.length - 1];
    const closed = path.length > 2 && first![0] === last![0] && first![1] === last![1];
    const points = closed ? path.slice(0, -1) : path;
    for (let i = closed ? 0 : 1; i < points.length - (closed ? 0 : 1); i++) {
      const a = points[(i + points.length - 1) % points.length]!, b = points[i]!, c = points[(i + 1) % points.length]!;
      const before = axis(b[0] - a[0], b[1] - a[1]), after = axis(c[0] - b[0], c[1] - b[1]);
      if (before >= 0 && after >= 0 && before !== after) corners.push(b);
    }
  }
  return corners;
}

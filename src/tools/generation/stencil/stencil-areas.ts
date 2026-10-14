/**
 * A small picture read as areas: four-connected runs of one colour, the outline they form, the merges
 * that bring them to a target count, and the palette entry each is given. `stencil-small.ts` reads a
 * small box through them; the feature accent and the object budget segment through `coherentAreas`.
 */
import type { Stencil } from '../recipe';
import { covered } from './stencil';
import { colorDistance, colorDistanceSq, luma } from './color';
import { NEIGHBORS4_NESW } from '../../../core/grid/directions';
import { componentCells, labelComponents } from '../../../core/grid/cell-sets';

/** Detects dark, shallow regions that collectively enclose enough of the figure to form an outline. */
const RIM_ENCLOSE_MIN = 0.4;
const RIM_DEPTH_MAX = 2;
const RIM_SHARE_MAX = 0.4;
/** How much of the figure an outline may be and still be given its own tier rather than kept in the
 *  picture's order (`allocateEntries`, where the arithmetic behind the fifth is). */
const RIM_SPEND_MAX = 0.2;

export function figureRim(stencil: Stencil, areas: readonly Area[]): number[] {
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  let figure = 0;
  for (const [id, area] of areas.entries()) {
    for (const i of area.cells) owner[i] = id;
    figure += area.cells.length;
  }
  if (figure === 0) return [];
  const depth = cellDepths(stencil, (i) => owner[i]! >= 0);
  let boundary = 0;
  for (let i = 0; i < width * height; i++) if (owner[i]! >= 0 && depth[i] === 1) boundary++;
  if (boundary === 0) return [];
  const mean = areas.reduce((sum, area) => sum + area.tone * area.cells.length, 0) / figure;

  const out: number[] = [];
  let cells = 0, edge = 0;
  for (const [id, area] of areas.entries()) {
    if (area.tone >= mean) continue;
    if (area.cells.reduce((sum, i) => sum + depth[i]!, 0) / area.cells.length > RIM_DEPTH_MAX) continue;
    out.push(id);
    cells += area.cells.length;
    edge += area.cells.filter((i) => depth[i] === 1).length;
  }
  if (out.length === 0) return [];
  if (edge / boundary < RIM_ENCLOSE_MIN || cells > figure * RIM_SHARE_MAX) return [];
  return out;
}

/** Fuses selected areas by cell-weighted mean color and returns the fused area's sorted position. */
export function fuseAreas(areas: readonly Area[], ids: readonly number[]): { areas: Area[]; at: number } {
  const taken = new Set(ids);
  if (taken.size === 0) return { areas: [...areas], at: -1 };
  // Preserve object identity when the selected outline is already one connected area.
  if (taken.size === 1) return { areas: [...areas], at: ids[0]! };
  const cells: number[] = [];
  let r = 0, g = 0, b = 0;
  for (const id of taken) {
    const area = areas[id];
    if (!area) continue;
    cells.push(...area.cells);
    r += ((area.rgb >> 16) & 0xff) * area.cells.length;
    g += ((area.rgb >> 8) & 0xff) * area.cells.length;
    b += (area.rgb & 0xff) * area.cells.length;
  }
  if (cells.length === 0) return { areas: [...areas], at: -1 };
  cells.sort((a, b2) => a - b2);
  const rgb = ((Math.round(r / cells.length) << 16) | (Math.round(g / cells.length) << 8) | Math.round(b / cells.length)) >>> 0;
  const fused: Area = { cells, rgb, tone: luma(rgb) };
  const out = [...areas.filter((_, id) => !taken.has(id)), fused]
    .sort((a, b2) => a.cells[0]! - b2.cells[0]!);
  return { areas: out, at: out.indexOf(fused) };
}

/** A four-connected run in five-bit-per-channel color space. */
export interface Area {
  /** Cell indices, in ascending order. */
  cells: number[];
  /** Cell-weighted mean source color. */
  rgb: number;
  /** Luma of `rgb`. */
  tone: number;
}

/** Minimum cell count for a coherent area. */
export const AREA_MIN = 3;

/** Maximum channel-weighted distance for folding a speck into an adjacent area. */
const FOLD_MAX = 30;

const bucketOf = (rgb: number): number =>
  ((((rgb >> 19) & 0x1f) << 10) | (((rgb >> 11) & 0x1f) << 5) | ((rgb >> 3) & 0x1f)) >>> 0;

/** Segments writable cells by their fitted color and folds close undersized regions into neighbours. */
export function coherentAreas(
  stencil: Stencil,
  matchable: (index: number) => boolean,
  colorAt: (index: number) => number,
): Area[] {
  const { width, height } = stencil;
  const n = width * height;
  const writable = new Uint8Array(n);
  for (let i = 0; i < n; i++) writable[i] = matchable(i) && covered(stencil, i % width, (i / width) | 0) ? 1 : 0;
  const bucket = new Int32Array(n);
  for (let i = 0; i < n; i++) if (writable[i]) bucket[i] = bucketOf(colorAt(i));
  // An area is a 4-connected run of one colour bucket; its cells are listed in raster order.
  const { labels, sizes } = labelComponents(writable, width, height, false, (i, j) => bucket[i] === bucket[j]);
  const label = labels.map((l) => l - 1);
  const areas = componentCells(labels, sizes.length - 1).map((cells) => ({ cells, r: 0, g: 0, b: 0 }));
  for (const area of areas) {
    for (const i of area.cells) {
      const rgb = colorAt(i);
      area.r += (rgb >> 16) & 0xff; area.g += (rgb >> 8) & 0xff; area.b += rgb & 0xff;
    }
  }
  const mean = (a: { cells: number[]; r: number; g: number; b: number }): number => {
    const size = a.cells.length;
    return ((Math.round(a.r / size) << 16) | (Math.round(a.g / size) << 8) | Math.round(a.b / size)) >>> 0;
  };

  // Resolve larger specks first; keep isolated or strongly contrasting details such as outlines.
  const order = areas.map((_, id) => id)
    .filter((id) => areas[id]!.cells.length < AREA_MIN)
    .sort((a, b) => (areas[b]!.cells.length - areas[a]!.cells.length) || (areas[a]!.cells[0]! - areas[b]!.cells[0]!));
  for (const id of order) {
    const area = areas[id]!;
    if (area.cells.length === 0 || area.cells.length >= AREA_MIN) continue;
    const own = mean(area);
    let host = -1, bestD = Infinity;
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of NEIGHBORS4_NESW) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = label[ny * width + nx]!;
        if (other < 0 || other === id || areas[other]!.cells.length === 0) continue;
        const d = colorDistanceSq(own, mean(areas[other]!));
        if (d < bestD || (d === bestD && (host < 0 || areas[other]!.cells[0]! < areas[host]!.cells[0]!))) {
          bestD = d; host = other;
        }
      }
    }
    if (host < 0 || bestD > FOLD_MAX * FOLD_MAX) continue;
    const into = areas[host]!;
    for (const i of area.cells) { label[i] = host; into.cells.push(i); }
    into.r += area.r; into.g += area.g; into.b += area.b;
    into.cells.sort((a, b) => a - b);
    area.cells = [];
  }

  return areas
    .filter((a) => a.cells.length > 0)
    .map((a) => ({ cells: a.cells, rgb: mean(a), tone: luma(mean(a)) }))
    .sort((a, b) => a.cells[0]! - b.cells[0]!);
}

/** The first entry, in tone order, at least this light — 0 where nothing is asked. */
function indexAtLeast(byTone: readonly { tone: number }[], tone: number | undefined): number {
  if (tone === undefined || !Number.isFinite(tone)) return 0;
  for (const [index, entry] of byTone.entries()) if (entry.tone >= tone) return index;
  return byTone.length - 1;
}

/** Four-connected distance from each figure cell to the outside: 1 on the rim, increasing inward. */
export function cellDepths(
  stencil: Stencil,
  inFigure: (index: number) => boolean,
): Int32Array {
  const { width, height } = stencil;
  const depth = new Int32Array(width * height);
  const queue: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (!inFigure(i)) continue;
    const x = i % width, y = (i / width) | 0;
    let rim = false;
    for (const [dx, dy] of NEIGHBORS4_NESW) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || !inFigure(ny * width + nx)) { rim = true; break; }
    }
    if (rim) { depth[i] = 1; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of NEIGHBORS4_NESW) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!inFigure(next) || depth[next] !== 0) continue;
      depth[next] = depth[i]! + 1;
      queue.push(next);
    }
  }
  return depth;
}

/** Scores each area by normalized size × neighbour contrast × interior depth. */
export function areaSalience(stencil: Stencil, areas: readonly Area[]): AreaReading {
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  const depth = cellDepths(stencil, (i) => owner[i]! >= 0);

  const size: number[] = [], contrast: number[] = [], inside: number[] = [], deepest: number[] = [];
  const touches: number[][] = [];
  for (const [id, area] of areas.entries()) {
    let worst = 0;
    const near = new Set<number>();
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of NEIGHBORS4_NESW) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = owner[ny * width + nx]!;
        if (other < 0 || other === id) continue;
        near.add(other);
        const d = colorDistance(area.rgb, areas[other]!.rgb);
        if (d > worst) worst = d;
      }
    }
    size.push(area.cells.length);
    contrast.push(worst);
    inside.push(area.cells.reduce((sum, i) => sum + depth[i]!, 0) / area.cells.length);
    // A region's shallowest cell caps the uniform tier that all of its cells can support.
    deepest.push(area.cells.reduce((least, i) => Math.min(least, depth[i]!), Infinity));
    touches.push([...near].sort((a, b) => a - b));
  }
  const share = (xs: number[]): number[] => {
    const top = Math.max(...xs, 0);
    // A missing comparison is neutral rather than zero salience.
    return top <= 0 ? xs.map(() => 1) : xs.map((v) => v / top);
  };
  const [s, c, d] = [share(size), share(contrast), share(inside)];
  return { salience: areas.map((_, id) => s[id]! * c[id]! * d[id]!), depth: deepest, touches };
}

/** Salience, minimum support depth, and adjacency for each area. */
export interface AreaReading { salience: number[]; depth: number[]; touches: number[][] }

/**
 * Assigns one palette entry to each connected image area. Areas begin at their nearest tone; close
 * groups merge before scarce entries are assigned, and salient collisions receive unused adjacent
 * entries while preserving tonal order. Support depth caps each area's tier. A sufficiently thin
 * silhouette may use its darkest legal tier independently so the enclosed mass keeps its range.
 */
export function allocateEntries(
  areas: readonly Area[],
  read: AreaReading,
  entryTones: readonly number[],
  minTone: readonly number[] = [],
  rim = -1,
): number[] {
  const { salience } = read;
  const out = new Array<number>(areas.length).fill(0);
  if (areas.length === 0 || entryTones.length === 0) return out;
  const byTone = entryTones.map((tone, index) => ({ tone, index })).sort((a, b) => a.tone - b.tone);

  // Merge groups whose complete tonal range is narrower than one palette step. Using complete ranges
  // avoids the single-linkage effect that would collapse a gradual gradient into one group.
  const step = byTone.length > 1
    ? (byTone[byTone.length - 1]!.tone - byTone[0]!.tone) / (byTone.length - 1)
    : Infinity;

  let groups = areas.map((area, id) => ({
    ids: [id], tone: area.tone, lo: area.tone, hi: area.tone,
    cells: area.cells.length, salience: salience[id] ?? 0,
    floor: indexAtLeast(byTone, minTone[id]),
  })).sort((a, b) => (a.tone - b.tone) || (areas[a.ids[0]!]!.cells[0]! - areas[b.ids[0]!]!.cells[0]!));

  // A detected outline remains one palette group.
  const holdsRim = (group: { ids: number[] }): boolean => rim >= 0 && group.ids.includes(rim);
  // Thin outlines may receive an independent entry.
  const rimShare = rim >= 0
    ? (areas[rim]?.cells.length ?? 0) / Math.max(1, areas.reduce((sum, area) => sum + area.cells.length, 0))
    : 1;
  const apart = rim >= 0 && rimShare <= RIM_SPEND_MAX;
  const joinable = (i: number): boolean => !holdsRim(groups[i]!) && !holdsRim(groups[i + 1]!);
  const nearest = (): { at: number; span: number } => {
    let at = -1, span = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) {
      const a = groups[i]!, b = groups[i + 1]!;
      if (!joinable(i)) continue;
      const own = Math.max(a.hi, b.hi) - Math.min(a.lo, b.lo);
      if (own < span) { span = own; at = i; }
    }
    return { at, span };
  };
  const cheapest = (): number => {
    let at = -1, best = Infinity;
    for (let i = 0; i + 1 < groups.length; i++) {
      if (!joinable(i)) continue;
      const cost = (groups[i + 1]!.tone - groups[i]!.tone) * Math.min(groups[i]!.salience, groups[i + 1]!.salience);
      if (cost < best) { best = cost; at = i; }
    }
    return at;
  };
  while (groups.length > 1) {
    const near = nearest();
    const at = near.at >= 0 && near.span < step ? near.at
      : groups.length > byTone.length ? cheapest()
        : -1;
    if (at < 0) break;
    const a = groups[at]!, b = groups[at + 1]!;
    const cells = a.cells + b.cells;
    groups.splice(at, 2, {
      ids: [...a.ids, ...b.ids],
      tone: (a.tone * a.cells + b.tone * b.cells) / cells,
      lo: Math.min(a.lo, b.lo),
      hi: Math.max(a.hi, b.hi),
      cells,
      salience: Math.max(a.salience, b.salience),
      floor: Math.max(a.floor, b.floor),
    });
  }

  // One area has no inter-area order to preserve.
  const single = groups.length === 1;

  // Start each group at its nearest tone.
  const want = groups.map((group) => {
    let at = 0, bestD = Infinity;
    for (const [index, entry] of byTone.entries()) {
      const d = Math.abs(entry.tone - group.tone);
      if (d < bestD) { bestD = d; at = index; }
    }
    return at;
  });

  // Shift ordered groups together to satisfy support floors; handle a thin outline independently.
  const spent = apart ? groups.map((_, k) => k).filter((k) => !holdsRim(groups[k]!)) : [];
  const carried = spent.length > 0 ? spent : groups.map((_, k) => k);
  const first = carried[0]!, last = carried[carried.length - 1]!;
  const shift = single ? 0 : carried.reduce((most, k) => Math.max(most, groups[k]!.floor - want[k]!), 0);
  const base = Math.min(byTone.length - 1, want[first]! + shift);
  const span = Math.max(1, want[last]! - want[first]!);
  let previous = -1;
  for (const [seat, k] of carried.entries()) {
    const group = groups[k]!;
    const room = byTone.length - 1 - base;
    const spread = base + ((want[k]! - want[first]!) / span) * room;
    // Room for the groups still to come, so the last one is never pushed off the end of the palette.
    const ceiling = byTone.length - 1 - (carried.length - 1 - seat);
    const at = Math.min(byTone.length - 1, Math.max(Math.min(ceiling, Math.max(Math.round(spread), previous + 1)), single ? 0 : group.floor));
    previous = at;
    for (const id of group.ids) out[id] = byTone[at]!.index;
  }
  // Give an independent outline its darkest supported tier.
  for (const [k, group] of groups.entries()) {
    if (!holdsRim(group) || carried.includes(k)) continue;
    for (const id of group.ids) out[id] = byTone[group.floor]!.index;
  }
  return out;
}

/** Region-level thresholds, in palette steps, that distinguish flat areas from smooth gradients. */
const REGION_RANGE_MIN = 2;
const REGION_SMOOTH_MAX = 0.7;
const REGION_ROUGH_MIN = 1.4;

export function regionFlatness(
  stencil: Stencil, areas: readonly Area[], colorAt: (index: number) => number, step: number,
): number[] {
  if (!(step > 0)) return areas.map(() => 1);
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  return areas.map((area, id) => {
    const tones = area.cells.map((i) => luma(colorAt(i))).sort((a, b) => a - b);
    const range = (tones[Math.floor(tones.length * 0.9)]! - tones[Math.floor(tones.length * 0.1)]!) / step;
    if (range < REGION_RANGE_MIN) return 1;
    let pairs = 0, sum = 0;
    for (const i of area.cells) {
      const x = i % width, y = (i / width) | 0;
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (owner[next] !== id) continue;
        pairs++;
        sum += Math.abs(luma(colorAt(i)) - luma(colorAt(next)));
      }
    }
    if (pairs === 0) return 1;
    const rough = sum / pairs / step;
    return Math.min(1, Math.max(0, (rough - REGION_SMOOTH_MAX) / (REGION_ROUGH_MIN - REGION_SMOOTH_MAX)));
  });
}

/** Target three to six spatial regions, roughly one for every four cells on the short side. */
const REGION_TARGET_MIN = 3;
const REGION_TARGET_MAX = 6;
const REGION_CELLS_PER = 4;

export function regionTarget(box: { width: number; height: number }, areas: readonly Area[], weight: number): number {
  const side = Math.min(box.width, box.height);
  const base = Math.min(REGION_TARGET_MAX, Math.max(REGION_TARGET_MIN, Math.round(side / REGION_CELLS_PER)));
  const held = Math.max(base, areas.length);
  return Math.round(base + (1 - Math.min(1, Math.max(0, weight))) * (held - base));
}

/**
 * Merges adjacent areas to `target` using color distance weighted by harmonic mean area size.
 * `protect` identifies an unmergeable outline; pair scan order provides deterministic ties.
 */
export function mergeToTarget(
  stencil: Stencil, areas: readonly Area[], target: number, protect = -1,
): { areas: Area[]; protect: number } {
  const n = areas.length;
  if (n <= Math.max(1, target)) return { areas: [...areas], protect };
  const { width, height } = stencil;
  const owner = new Int32Array(width * height).fill(-1);
  for (const [id, area] of areas.entries()) for (const i of area.cells) owner[i] = id;
  const near: Set<number>[] = areas.map(() => new Set<number>());
  for (let i = 0; i < width * height; i++) {
    const own = owner[i]!;
    if (own < 0) continue;
    const x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of NEIGHBORS4_NESW) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const other = owner[ny * width + nx]!;
      if (other < 0 || other === own) continue;
      near[own]!.add(other);
      near[other]!.add(own);
    }
  }
  const cells = areas.map((area) => [...area.cells]);
  const sums = areas.map((area) => ({
    r: ((area.rgb >> 16) & 0xff) * area.cells.length,
    g: ((area.rgb >> 8) & 0xff) * area.cells.length,
    b: (area.rgb & 0xff) * area.cells.length,
  }));
  const alive = areas.map(() => true);
  const meanOf = (id: number): number => {
    const size = Math.max(1, cells[id]!.length), s = sums[id]!;
    return ((Math.round(s.r / size) << 16) | (Math.round(s.g / size) << 8) | Math.round(s.b / size)) >>> 0;
  };

  let count = n;
  while (count > target) {
    let from = -1, into = -1, best = Infinity;
    for (let a = 0; a < n; a++) {
      if (!alive[a] || a === protect) continue;
      for (const b of near[a]!) {
        if (b <= a || !alive[b] || b === protect) continue;
        const sa = cells[a]!.length, sb = cells[b]!.length;
        const cost = colorDistance(meanOf(a), meanOf(b)) * ((sa * sb) / (sa + sb));
        if (cost < best) { best = cost; into = a; from = b; }
      }
    }
    if (from < 0 || into < 0) break;   // every pair left touches the protected region: nothing to do
    for (const i of cells[from]!) { owner[i] = into; cells[into]!.push(i); }
    sums[into]!.r += sums[from]!.r; sums[into]!.g += sums[from]!.g; sums[into]!.b += sums[from]!.b;
    cells[into]!.sort((a, b) => a - b);
    cells[from]!.length = 0;
    alive[from] = false;
    for (const b of near[from]!) { if (b !== into) { near[into]!.add(b); near[b]!.add(into); } near[b]!.delete(from); }
    count--;
  }

  const kept = areas.map((_, id) => id).filter((id) => alive[id] && cells[id]!.length > 0);
  const out = kept.map((id) => {
    const rgb = meanOf(id);
    return { cells: cells[id]!, rgb, tone: luma(rgb) };
  });
  const order = kept.map((id, at) => ({ id, at })).sort((a, b) => out[a.at]!.cells[0]! - out[b.at]!.cells[0]!);
  return {
    areas: order.map((o) => out[o.at]!),
    protect: order.findIndex((o) => o.id === protect),
  };
}

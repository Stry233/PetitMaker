import { median } from '../../../core/base/math';
import { MaxFlow } from '../../../core/base/max-flow';
import { LANDMARKS } from '../../../core/game/profile';
import { labelComponents, stepDistance } from '../../../core/grid/cell-sets';
import { GRASS, SAND, SEA, toLab, type PaletteSampler } from './color';
import { SCAN_PROFILE } from '../profile';

// The ground's surfaces read by where they lie, never by their colours' values, so a planet drawn
// in other colours reads the same. The sea surrounds the scan, grass fills the planet's interior and
// the sand rim always lies between them, and the boundaries between the three surfaces are the clear
// ones: the sea's shades blend into one another and the grass carries decals, while the coast and the
// grass edge are steps. So a raster of the ground is cut into regions (connected runs of one palette
// cluster that no clear colour edge crosses, specks merged into the neighbour they share most edge
// with), and the regions take ordered labels (grass, sand, sea) by a minimum cut whose cost is low
// across steep colour steps: the outside is sea, the deep interior grass, and sea never borders grass.
// The palette's clusters are named by where their pixels lie (`nameSurfaces`, the pass 1 palette); the
// finished evidence reads each region's own class instead (`readRegions`), since one cluster may hold
// two surfaces' colours apart from each other, and its votes from the regions (`surfaceVotes`).

const S = SCAN_PROFILE.ground.surfaces;
/** The largest footprint, in cells, of a landmark standing on the coast: an object on the sea is
 *  never larger. */
const DECK_CELLS = Math.max(0, ...LANDMARKS.filter((l) => l.ground === 'coast').map((l) => l.width * l.height));

/** A raster of the ground the clusters are named on. */
export interface SurfaceRaster {
  readonly w: number;
  readonly h: number;
  /** Per pixel the cluster nearest its colour, -1 where nothing was seen. */
  readonly label: Int16Array;
  /** Per pixel its L*a*b*, three values a pixel. */
  readonly lab: Float32Array;
  /** Cluster `c`'s weight at pixel `i`; without it a pixel weighs one for its own cluster. */
  readonly vote?: (c: number, i: number) => number;
  /** Pixels a lattice cell covers. */
  readonly perCell: number;
}

/** The palette mosaic's seen box as a surface raster, each bin labelled by the nearest of `centres`. */
export function mosaicRaster(centres: Float64Array, sampler: PaletteSampler): SurfaceRaster {
  const m = sampler.mosaic;
  const k = centres.length / 3;
  const bx = m.seen.x0 - m.x0;
  const by = m.seen.y0 - m.y0;
  const w = Math.max(0, m.seen.x1 - m.seen.x0);
  const h = Math.max(0, m.seen.y1 - m.seen.y0);
  const label = new Int16Array(w * h).fill(-1);
  const lab = new Float32Array(w * h * 3);
  const one = new Float64Array(3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = ((y + by) * m.cols + x + bx) * 4;
      const wt = m.sums[o + 3]!;
      if (!(wt > sampler.minWeight)) continue;
      const c = (v: number) => Math.min(255, Math.max(0, Math.round(v / wt)));
      toLab(c(m.sums[o]!), c(m.sums[o + 1]!), c(m.sums[o + 2]!), one);
      const i = y * w + x;
      lab.set(one, i * 3);
      label[i] = nearest(one, centres, k);
    }
  }
  const cell = SCAN_PROFILE.cell;
  return { w, h, label, lab, perCell: (cell.width * cell.height) / (m.step * m.step) };
}

function nearest(lab: ArrayLike<number>, centres: Float64Array, k: number): number {
  let best = 0;
  let bd = Infinity;
  for (let q = 0; q < k; q++) {
    const d = (lab[0]! - centres[q * 3]!) ** 2 + (lab[1]! - centres[q * 3 + 1]!) ** 2 + (lab[2]! - centres[q * 3 + 2]!) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** Where the raster meets the outside: unseen pixels connected to its frame, and the seen pixels
 *  beside them or on the frame. */
function outsideOf(r: SurfaceRaster): { outside: Uint8Array; edge: Uint8Array } {
  const { w, h, label } = r;
  const n = w * h;
  const unseen = new Uint8Array(n);
  for (let i = 0; i < n; i++) unseen[i] = label[i]! < 0 ? 1 : 0;
  const { labels } = labelComponents(unseen, w, h);
  const reach = new Set<number>();
  for (let x = 0; x < w; x++) for (const i of [x, (h - 1) * w + x]) if (labels[i]) reach.add(labels[i]!);
  for (let y = 0; y < h; y++) for (const i of [y * w, y * w + w - 1]) if (labels[i]) reach.add(labels[i]!);
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) outside[i] = labels[i] && reach.has(labels[i]!) ? 1 : 0;
  const edge = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (label[i]! < 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    edge[i] = x === 0 || y === 0 || x === w - 1 || y === h - 1 || outside[i - 1] || outside[i + 1] || outside[i - w] || outside[i + w] ? 1 : 0;
  }
  return { outside, edge };
}

/** The raster's regions: `of` per pixel (-1 where unseen), each region's cluster and edge pixels,
 *  and per pair of neighbouring regions the edge pairs between them and their summed colour step. */
interface Regions {
  readonly of: Int32Array;
  readonly count: number;
  readonly cluster: Int32Array;
  readonly edge: Float64Array;
  readonly pairs: Map<number, { readonly a: number; readonly b: number; n: number; step: number }>;
}

/** The seen pixel up to `reach` steps from `i` along (dx, dy) in the raster, the farthest one; `i`
 *  when none is. */
function outFrom(r: SurfaceRaster, i: number, dx: number, dy: number, reach: number): number {
  const { w, h, label } = r;
  const x = i % w;
  const y = (i - x) / w;
  for (let s = reach; s > 0; s--) {
    const nx = x + s * dx;
    const ny = y + s * dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && label[ny * w + nx]! >= 0) return ny * w + nx;
  }
  return i;
}

function labDistance(lab: Float32Array, i: number, j: number): number {
  return Math.hypot(lab[i * 3]! - lab[j * 3]!, lab[i * 3 + 1]! - lab[j * 3 + 1]!, lab[i * 3 + 2]! - lab[j * 3 + 2]!);
}

/** The pixel up to `reach` steps from `i` along (dx, dy) before the run of `i`'s cluster ends. */
function outWithin(r: SurfaceRaster, i: number, dx: number, dy: number, reach: number): number {
  const { w, h, label } = r;
  const x = i % w;
  const y = (i - x) / w;
  let last = i;
  for (let s = 1; s <= reach; s++) {
    const nx = x + s * dx;
    const ny = y + s * dy;
    if (!(nx >= 0 && ny >= 0 && nx < w && ny < h) || label[ny * w + nx] !== label[i]) break;
    last = ny * w + nx;
  }
  return last;
}

/** Whether neighbouring pixels lie in one run: one cluster, and no step over `split` times the
 *  median step between clusters across them, read up to `S.reach` cells out on either side within
 *  the cluster, so two surfaces one cluster holds stay apart where a clear edge parts them, while a
 *  step to another cluster nearby does not part a run. */
function joinsOf(r: SurfaceRaster, split: number): (i: number, j: number) => boolean {
  const { w, label, lab } = r;
  const n = w * r.h;
  const reach = Math.max(1, Math.round(S.reach * Math.sqrt(r.perCell)));
  const right = new Float32Array(n);
  const down = new Float32Array(n);
  const between: number[] = [];
  for (let i = 0; i < n; i++) {
    if (label[i]! < 0) continue;
    for (const [j, dx, dy, into] of [[i % w + 1 < w ? i + 1 : -1, 1, 0, right], [i + w < n ? i + w : -1, 0, 1, down]] as const) {
      if (j < 0 || label[j]! < 0) continue;
      if (label[j] !== label[i]) between.push(labDistance(lab, outFrom(r, i, -dx, -dy, reach), outFrom(r, j, dx, dy, reach)));
      else into[i] = labDistance(lab, outWithin(r, i, -dx, -dy, reach), outWithin(r, j, dx, dy, reach));
    }
  }
  const clear = between.length > 0 ? split * median(between, 'upper') : Infinity;
  return (i, j) => {
    if (label[i] !== label[j]) return false;
    const [a, b] = i < j ? [i, j] : [j, i];
    return (b === a + 1 ? right[a]! : down[a]!) < clear;
  };
}

function regionsOf(r: SurfaceRaster, edgeMask: Uint8Array, split: number = S.split): Regions {
  const { w, h, label } = r;
  const n = w * h;
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) seen[i] = label[i]! >= 0 ? 1 : 0;
  const { labels, sizes } = labelComponents(seen, w, h, false, joinsOf(r, split));
  const parts = sizes.length;
  const parent = Int32Array.from({ length: parts }, (_, i) => i);
  const root = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; }
    return x;
  };
  const size = Float64Array.from(sizes);
  const touching: Map<number, number>[] = Array.from({ length: parts }, () => new Map());
  for (let i = 0; i < n; i++) {
    const a = labels[i]!;
    if (!a) continue;
    const x = i % w;
    for (const j of [x + 1 < w ? i + 1 : -1, i + w < n ? i + w : -1]) {
      const b = j < 0 ? 0 : labels[j]!;
      if (!b || b === a) continue;
      touching[a]!.set(b, (touching[a]!.get(b) ?? 0) + 1);
      touching[b]!.set(a, (touching[b]!.get(a) ?? 0) + 1);
    }
  }
  const colour = new Float64Array(parts * 3);
  for (let i = 0; i < n; i++) {
    const a = labels[i]!;
    if (!a) continue;
    for (let q = 0; q < 3; q++) colour[a * 3 + q]! += r.lab[i * 3 + q]!;
  }
  const merge = (s: number, into: number) => {
    parent[s] = into;
    size[into]! += size[s]!;
    for (let q = 0; q < 3; q++) colour[into * 3 + q]! += colour[s * 3 + q]!;
    const near = touching[into]!;
    near.delete(s);
    for (const [t, c] of touching[s]!) {
      if (t === into) continue;
      near.set(t, (near.get(t) ?? 0) + c);
      const back = touching[t]!;
      back.delete(s);
      back.set(into, (back.get(into) ?? 0) + c);
    }
    touching[s]!.clear();
  };
  // Specks join the neighbour they share the most edge with, the smallest first.
  const speck = S.speck * r.perCell;
  const order = Array.from({ length: parts - 1 }, (_, i) => i + 1).sort((p, q) => size[p]! - size[q]! || p - q);
  for (const s of order) {
    if (root(s) !== s || size[s]! >= speck) continue;
    let best = -1;
    let most = 0;
    for (const [t, c] of touching[s]!) if (c > most || (c === most && t < best)) { most = c; best = t; }
    if (best >= 0) merge(s, best);
  }
  // Ribbons under `S.ribbon` cells thick (twice the area over the edge length), the blends and foam
  // the camera draws along an edge, join the neighbour nearest their mean colour: an edge seen as two
  // half steps is still one edge.
  const ribbon = S.ribbon * Math.sqrt(r.perCell);
  const edgeOf = (s: number) => { let e = 0; for (const c of touching[s]!.values()) e += c; return e; };
  const thin = order.filter((s) => root(s) === s).sort((p, q) => (2 * size[p]!) / Math.max(1, edgeOf(p)) - (2 * size[q]!) / Math.max(1, edgeOf(q)) || p - q);
  for (const s of thin) {
    if (root(s) !== s || 2 * size[s]! >= ribbon * edgeOf(s)) continue;
    let best = -1;
    let near = Infinity;
    for (const t of touching[s]!.keys()) {
      let d = 0;
      for (let q = 0; q < 3; q++) d += (colour[s * 3 + q]! / size[s]! - colour[t * 3 + q]! / size[t]!) ** 2;
      if (d < near || (d === near && t < best)) { near = d; best = t; }
    }
    if (best >= 0) merge(s, best);
  }
  const id = new Int32Array(parts).fill(-1);
  let count = 0;
  for (let p = 1; p < parts; p++) if (root(p) === p) id[p] = count++;
  const of = new Int32Array(n).fill(-1);
  const cluster = new Int32Array(count);
  const edge = new Float64Array(count);
  for (let i = 0; i < n; i++) {
    if (!labels[i]) continue;
    const top = root(labels[i]!);
    const reg = id[top]!;
    of[i] = reg;
    if (top === labels[i]) cluster[reg] = label[i]!;
    if (edgeMask[i]) edge[reg]! += 1;
  }
  // The colour step across an edge pair is read `S.reach` cells further out on either side, over
  // whatever lies there, so a step the camera blurs over a few pixels, or a blend of the two colours
  // between them, counts whole, while a speck of another colour does not make an edge of its own.
  const pairs = new Map<number, { a: number; b: number; n: number; step: number }>();
  const reach = Math.max(1, Math.round(S.reach * Math.sqrt(r.perCell)));
  for (let i = 0; i < n; i++) {
    const a = of[i]!;
    if (a < 0) continue;
    const x = i % w;
    for (const [d, dx, dy] of [[1, 1, 0], [w, 0, 1]] as const) {
      if (d === 1 ? x + 1 >= w : i + w >= n) continue;
      const j = i + d;
      const b = of[j]!;
      if (b < 0 || b === a) continue;
      const key = Math.min(a, b) * count + Math.max(a, b);
      const e = pairs.get(key) ?? pairs.set(key, { a: Math.min(a, b), b: Math.max(a, b), n: 0, step: 0 }).get(key)!;
      e.n++;
      e.step += labDistance(r.lab, outFrom(r, i, -dx, -dy, reach), outFrom(r, j, dx, dy, reach));
    }
  }
  return { of, count, cluster, edge, pairs };
}

/**
 * Each region's label (`SEA`, `SAND` or `GRASS`): the minimum cut over the ordered labels, two
 * binary layers a region (label at least sand, label sea). The regions at the outside whose cluster
 * holds `S.seaBorder` of the edge pixels are fixed to sea, and the regions holding `S.deepShare` of
 * the deep interior (pixels at least `S.deep` of the deepest pixel's distance from the outside) are
 * fixed to grass, with every region of the cluster holding most of it that reaches into it, since
 * roads and rivers cut the grass into pieces.
 * Cutting an edge costs its length over 1 + (step / sigma)^2, sigma `S.contrast` times the edges'
 * length-weighted median step, so of two clear steps round one surface the clearer still costs less;
 * sea next to grass costs `S.touch` times the edge's length.
 */
function labelRegions(r: SurfaceRaster, outside: Uint8Array, regions: Regions, k: number): Int8Array {
  const { w, h } = r;
  const n = w * h;
  const { count, pairs } = regions;
  const from: number[] = [];
  for (let i = 0; i < n; i++) if (outside[i]) from.push(i);
  const steps = stepDistance(from, w, h);
  const depth = (i: number) => {
    const x = i % w;
    const y = (i - x) / w;
    return Math.min(steps[i]!, x + 1, y + 1, w - x, h - y);
  };
  let deepest = 0;
  for (let i = 0; i < n; i++) if (regions.of[i]! >= 0) deepest = Math.max(deepest, depth(i));
  const inner = new Float64Array(count);
  for (let i = 0; i < n; i++) if (regions.of[i]! >= 0 && depth(i) >= S.deep * deepest) inner[regions.of[i]!]! += 1;
  const innerOf = new Float64Array(k);
  for (let g = 0; g < count; g++) innerOf[regions.cluster[g]!]! += inner[g]!;
  let core = 0;
  for (let c = 1; c < k; c++) if (innerOf[c]! > innerOf[core]!) core = c;
  let interior = 0;
  for (let g = 0; g < count; g++) interior += inner[g]!;
  const grass = new Uint8Array(count);
  for (let g = 0; g < count; g++) if ((regions.cluster[g] === core && inner[g]! > 0) || inner[g]! >= S.deepShare * interior) grass[g] = 1;
  const clusterEdge = new Float64Array(k);
  let edges = 0;
  for (let g = 0; g < count; g++) { clusterEdge[regions.cluster[g]!]! += regions.edge[g]!; edges += regions.edge[g]!; }
  const sea = new Uint8Array(count);
  for (let g = 0; g < count; g++) if (!grass[g] && regions.edge[g]! > 0 && clusterEdge[regions.cluster[g]!]! >= S.seaBorder * edges) sea[g] = 1;
  const byStep = [...pairs.values()].map((e) => ({ step: e.step / e.n, n: e.n })).sort((p, q) => p.step - q.step);
  let total = 0;
  for (const e of byStep) total += e.n;
  let seen = 0;
  let median = 0;
  for (const e of byStep) { seen += e.n; if (seen >= total / 2) { median = e.step; break; } }
  const sigma = Math.max(1e-6, S.contrast * median);
  let sum = 0;
  const cost = new Map<number, number>();
  for (const [key, e] of pairs) {
    const step = e.step / e.n;
    const c = e.n / (1 + (step / sigma) ** 2);
    cost.set(key, c);
    sum += 2 * c + 2 * S.touch * e.n;
  }
  const fixed = 2 * sum + 1;
  const flow = new MaxFlow(2 * count, 4 * pairs.size + count);
  const at = (g: number, layer: 1 | 2) => 2 * g + layer - 1;
  for (const [key, e] of pairs) {
    const c = cost.get(key)!;
    flow.edge(at(e.a, 1), at(e.b, 1), c, c);
    flow.edge(at(e.a, 2), at(e.b, 2), c, c);
    flow.edge(at(e.a, 2), at(e.b, 1), S.touch * e.n, 0);
    flow.edge(at(e.b, 2), at(e.a, 1), S.touch * e.n, 0);
  }
  for (let g = 0; g < count; g++) {
    flow.edge(at(g, 2), at(g, 1), fixed, 0);
    const toSea = sea[g] ? fixed : 0;
    const toGrass = grass[g] ? fixed : 0;
    flow.terminal(at(g, 1), toSea, toGrass);
    flow.terminal(at(g, 2), toSea, toGrass);
  }
  flow.solve();
  const out = new Int8Array(count);
  for (let g = 0; g < count; g++) out[g] = flow.sourceSide(at(g, 2)) ? SEA : flow.sourceSide(at(g, 1)) ? SAND : GRASS;
  // The grass's own colour is grass wherever it lies on land: roads and rivers that cut it into
  // pieces draw contours inside it as clear as its edge.
  for (let g = 0; g < count; g++) if (out[g] === SAND && regions.cluster[g] === core) out[g] = GRASS;
  return out;
}

/** The share entry, after the sea, sand and grass ones, of a cluster's weight on the sand within
 *  `S.edge` cells of the grass. */
const NEAR_GRASS = 3;

/** The surfaces a raster's clusters lie on: per cluster its weight in sea, sand and grass regions and
 *  in the sand at the grass edge. */
function placeClusters(k: number, raster: SurfaceRaster): number[][] {
  const share = Array.from({ length: k }, () => [0, 0, 0, 0]);
  const n = raster.w * raster.h;
  const surface = new Int8Array(n).fill(-1);
  if (n === 0) return share;
  const { outside, edge } = outsideOf(raster);
  const regions = regionsOf(raster, edge);
  if (regions.count === 0) return share;
  const labels = labelRegions(raster, outside, regions, k);
  const grass: number[] = [];
  for (let i = 0; i < n; i++) {
    const g = regions.of[i]!;
    if (g < 0) continue;
    surface[i] = labels[g]!;
    if (surface[i] === GRASS) grass.push(i);
  }
  const toGrass = stepDistance(grass, raster.w, raster.h);
  const near = S.edge * Math.sqrt(raster.perCell);
  const { vote } = raster;
  for (let i = 0; i < n; i++) {
    const l = surface[i]!;
    if (l < 0) continue;
    const at = l === SAND && toGrass[i]! <= near ? [l, NEAR_GRASS] : [l];
    for (const q of at) {
      if (!vote) { share[raster.label[i]!]![q]! += 1; continue; }
      for (let c = 0; c < k; c++) share[c]![q]! += vote(c, i);
    }
  }
  return share;
}

/**
 * Each cluster's class from where its pixels lie on `raster` (`centres` L*a*b*, three values a
 * centre). Water's colour (making up `S.seaPart` of the open sea, or `S.seaShare` of it at sea and
 * under `S.sandShare` on sand: shallows, and grass under a light that tints it alike) is sea, since
 * the inland water rule later reads its enclosed part as grass, while grass named sea out at sea
 * would stay wrong. Any other colour is sand unless under `S.offGrass` of it lies off the grass (a
 * blend of sand and grass may lie on the sand within `S.edge` cells of it): grass votes past the
 * sand rim would draw grass the game cannot have. A colour on the sea or the grass far nearer the
 * sand's main cluster (`S.paving`) is an object there (a deck, paving, roads): sand, so landmarks
 * stand out. A cluster no pixel weighs for takes the nearest surface's. Deterministic.
 */
export function nameSurfaces(centres: Float64Array, raster: SurfaceRaster): Uint8Array {
  const k = centres.length / 3;
  const share = placeClusters(k, raster);
  const classes = new Uint8Array(k).fill(SAND);
  const main = (cls: number) => {
    let best = 0;
    for (let c = 1; c < k; c++) if (share[c]![cls]! > share[best]![cls]!) best = c;
    return best;
  };
  const sea = main(SEA);
  const sand = main(SAND);
  const grass = main(GRASS);
  const dist = (a: number, b: number) =>
    Math.hypot(centres[a * 3]! - centres[b * 3]!, centres[a * 3 + 1]! - centres[b * 3 + 1]!, centres[a * 3 + 2]! - centres[b * 3 + 2]!);
  let open = 0;
  for (let c = 0; c < k; c++) open += share[c]![SEA]!;
  /** Whether a colour lies between the sand's main cluster and the grass's, within `S.blend` of
   *  their distance off the line joining them. */
  const blend = (c: number) => {
    const u = [0, 1, 2].map((j) => centres[grass * 3 + j]! - centres[sand * 3 + j]!);
    const d = [0, 1, 2].map((j) => centres[c * 3 + j]! - centres[sand * 3 + j]!);
    const span = u[0]! ** 2 + u[1]! ** 2 + u[2]! ** 2;
    const t = (d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!) / span;
    return span > 0 && t > 0 && t < 1 && Math.hypot(d[0]! - t * u[0]!, d[1]! - t * u[1]!, d[2]! - t * u[2]!) < S.blend * Math.sqrt(span);
  };
  for (let c = 0; c < k; c++) {
    const [s, a, g, edge] = share[c]! as [number, number, number, number];
    const all = s + a + g;
    if (!(all > 0)) {
      const d = [dist(c, sea), dist(c, sand), dist(c, grass)];
      classes[c] = d[0]! <= d[1]! && d[0]! <= d[2]! ? SEA : d[1]! <= d[2]! ? SAND : GRASS;
    } else if (s >= S.seaPart * open || (s >= S.seaShare * all && a < S.sandShare * all)) {
      classes[c] = c !== sea && dist(c, sand) < S.paving * dist(c, sea) ? SAND : SEA;
    } else {
      const off = s + a - (blend(c) ? edge : 0);
      classes[c] = off >= S.offGrass * all || (c !== grass && dist(c, sand) < S.paving * dist(c, grass)) ? SAND : GRASS;
    }
  }
  return classes;
}


/** The ground a raster's regions read: each pixel's surface and the class its region's colour
 *  stands for there; -1 where unseen. */
export interface GroundRegions {
  readonly surface: Int8Array;
  readonly look: Int8Array;
}

/**
 * The surfaces the regions lie on (`labelRegions`) and the class each point's colour reads as there:
 * its surface's, but an object, read on finer runs (`S.objectSplit`), reads as what it is. On the
 * grass, a run it encloses or a small one in a colour nearer the sand's (paving, a build) is sand,
 * one nearer the sea's (a pond, which the inland water rule reads as grass) sea, and so is a speck
 * of another cluster the grass took in; on the sand, water the open sea does not reach is sea; on
 * the sea, a run in a deck's colour (`deckLike`) is sand, and decks the cut gave the beach go back
 * to the sea (`mooredDecks`). So a cluster holding two surfaces' colours apart from each other, a
 * lit lawn and the shallows, reads as each where it lies. Deterministic.
 */
export function readRegions(raster: SurfaceRaster): GroundRegions {
  const n = raster.w * raster.h;
  const surface = new Int8Array(n).fill(-1);
  const look = new Int8Array(n).fill(-1);
  let k = 0;
  for (let i = 0; i < n; i++) k = Math.max(k, raster.label[i]! + 1);
  if (k === 0) return { surface, look };
  const { outside, edge } = outsideOf(raster);
  const coarse = regionsOf(raster, edge);
  if (coarse.count === 0) return { surface, look };
  const coarseLabels = labelRegions(raster, outside, coarse, k);
  const fine = objectRuns(raster, edge, coarse, coarseLabels);
  const lying = fine.labels.slice();
  mooredDecks(fine);
  const cls = objectClasses(fine);
  const { of, main, colour } = fine;
  const pixel = (i: number, to: number) => (to < 0 ? Infinity : Math.hypot(
    raster.lab[i * 3]! - colour[to * 3]!, raster.lab[i * 3 + 1]! - colour[to * 3 + 1]!, raster.lab[i * 3 + 2]! - colour[to * 3 + 2]!));
  // A pixel lies where the coarse cut put it, unless a deck moored at the beach went back to the sea;
  // it reads as its object's class where its finer run is an object, else as where it lies. A speck
  // of another cluster the grass took in (a build's or a paving stripe's pixels) keeps the class its
  // own colour reads as on the grass.
  for (let i = 0; i < n; i++) {
    const g = of[i]!;
    if (g < 0) continue;
    const lies = coarseLabels[coarse.of[i]!]!;
    const label = fine.labels[g]!;
    surface[i] = lies !== SEA && label === SEA && lying[g] !== SEA ? SEA : lies;
    look[i] = cls[g] !== label ? cls[g]! : surface[i]!;
    if (label === GRASS && cls[g] === GRASS && raster.label[i] !== fine.regions.cluster[g]) {
      const grass = pixel(i, main[GRASS]!);
      if (pixel(i, main[SAND]!) < S.paving * grass) look[i] = SAND;
      else if (pixel(i, main[SEA]!) < S.water * grass) look[i] = SEA;
    }
  }
  return { surface, look };
}

/** The finer runs objects are read on, each with the surface most of its pixels lie on, its size and
 *  mean colour, each surface's largest run, the grass's area, and how much of each run's edge
 *  borders another surface. */
interface ObjectRuns {
  readonly regions: Regions;
  readonly of: Int32Array;
  readonly count: number;
  readonly labels: Int8Array;
  readonly size: Float64Array;
  readonly colour: Float64Array;
  readonly main: readonly number[];
  readonly grassArea: number;
  readonly rim: Float64Array;
  readonly off: Float64Array;
  /** The pixels a coast landmark's footprint covers: no object on the sea is larger. */
  readonly deck: number;
  /** The colour distance from the sand's largest run to the water nearest it among the sea's runs
   *  too large to be objects. */
  readonly water: number;
}

function objectRuns(raster: SurfaceRaster, edge: Uint8Array, coarse: Regions, coarseLabels: Int8Array): ObjectRuns {
  const n = raster.w * raster.h;
  const regions = regionsOf(raster, edge, S.objectSplit);
  const { count, of } = regions;
  const share = new Float64Array(count * 3);
  for (let i = 0; i < n; i++) if (of[i]! >= 0) share[of[i]! * 3 + coarseLabels[coarse.of[i]!]!]! += 1;
  const labels = Int8Array.from({ length: count }, (_, g) => {
    const [a, b, c] = [share[g * 3]!, share[g * 3 + 1]!, share[g * 3 + 2]!];
    return a >= b && a >= c ? SEA : b >= c ? SAND : GRASS;
  });
  const size = new Float64Array(count);
  const colour = new Float64Array(count * 3);
  for (let i = 0; i < n; i++) {
    const g = of[i]!;
    if (g < 0) continue;
    size[g]! += 1;
    for (let q = 0; q < 3; q++) colour[g * 3 + q]! += raster.lab[i * 3 + q]!;
  }
  for (let g = 0; g < count; g++) for (let q = 0; q < 3; q++) colour[g * 3 + q]! /= size[g]!;
  const main = [-1, -1, -1];
  let grassArea = 0;
  for (let g = 0; g < count; g++) {
    const l = labels[g]!;
    if (l === GRASS) grassArea += size[g]!;
    if (main[l]! < 0 || size[g]! > size[main[l]!]!) main[l] = g;
  }
  const rim = new Float64Array(count);
  const off = new Float64Array(count);
  for (const e of regions.pairs.values()) {
    rim[e.a]! += e.n;
    rim[e.b]! += e.n;
    if (labels[e.a] !== labels[e.b]) { off[e.a]! += e.n; off[e.b]! += e.n; }
  }
  const runs = { regions, of, count, labels, size, colour, main, grassArea, rim, off, deck: DECK_CELLS * raster.perCell, water: Infinity };
  let water = Infinity;
  for (let g = 0; g < count; g++) if (labels[g] === SEA && size[g]! > runs.deck) water = Math.min(water, colourDistance(runs, g, main[SAND]!));
  return { ...runs, water };
}

function colourDistance(runs: Pick<ObjectRuns, 'colour'>, g: number, to: number): number {
  const { colour } = runs;
  return to < 0 ? Infinity
    : Math.hypot(colour[g * 3]! - colour[to * 3]!, colour[g * 3 + 1]! - colour[to * 3 + 1]!, colour[g * 3 + 2]! - colour[to * 3 + 2]!);
}

/** Whether a run is in a deck's colour: no larger than a coast landmark, off the grass, standing out
 *  from the beach's colour and nearer the sand than the water is. */
function deckLike(runs: ObjectRuns, g: number): boolean {
  const { main, labels, size } = runs;
  if (g === main[SAND] || g === main[SEA] || labels[g] === GRASS || !(size[g]! <= runs.deck)) return false;
  const d = colourDistance(runs, g, main[SAND]!);
  return d > S.deckApart * runs.water && d < S.deckColour * runs.water;
}

/** Gives a deck the cut gave, in part or whole, to the beach it is moored at back to the sea:
 *  neighbouring runs in a deck's colour, together no larger than a coast landmark, with over
 *  `S.moored` of their edge on the sea. */
function mooredDecks(runs: ObjectRuns): void {
  const { regions, count, labels, size } = runs;
  const near: number[][] = Array.from({ length: count }, () => []);
  for (const e of regions.pairs.values()) { near[e.a]!.push(e.b); near[e.b]!.push(e.a); }
  const group = new Int32Array(count).fill(-1);
  for (let g0 = 0; g0 < count; g0++) {
    if (group[g0]! >= 0 || !deckLike(runs, g0)) continue;
    const members = [g0];
    group[g0] = g0;
    for (let m = 0; m < members.length; m++) {
      for (const q of near[members[m]!]!) if (group[q]! < 0 && deckLike(runs, q)) { group[q] = g0; members.push(q); }
    }
    let total = 0;
    for (const g of members) total += size[g]!;
    if (!(total <= runs.deck) || !members.some((g) => labels[g] === SAND)) continue;
    let onSea = 0, round = 0;
    for (const g of members) {
      for (const q of near[g]!) {
        if (group[q] === g0) continue;
        const e = regions.pairs.get(Math.min(g, q) * count + Math.max(g, q))!;
        round += e.n;
        if (labels[q] === SEA) onSea += e.n;
      }
    }
    if (onSea > S.moored * round) for (const g of members) labels[g] = SEA;
  }
}

/** Each run's class (`readRegions`): its surface's, or an object's. */
function objectClasses(runs: ObjectRuns): Int8Array {
  const { regions, count, labels, size, main, rim, off, grassArea } = runs;
  const borders = new Uint8Array(count);
  for (const e of regions.pairs.values()) {
    borders[e.a]! |= 1 << labels[e.b]!;
    borders[e.b]! |= 1 << labels[e.a]!;
  }
  const dist = (g: number, to: number) => colourDistance(runs, g, to);
  const cls = Int8Array.from(labels);
  for (let g = 0; g < count; g++) {
    const l = labels[g]!;
    if (g === main[l]) continue;
    if (l === SAND) {
      // Water the cut gave to the sand where the open sea does not reach: a pond the beach opens onto.
      if (!(borders[g]! & (1 << SEA)) && dist(g, main[SEA]!) < S.water * dist(g, main[SAND]!)) cls[g] = SEA;
    } else if (l === SEA) {
      if (deckLike(runs, g)) cls[g] = SAND;
    } else if (off[g]! <= S.enclosed * rim[g]! || size[g]! < S.object * grassArea) {
      if (dist(g, main[SAND]!) < S.paving * dist(g, main[GRASS]!)) cls[g] = SAND;
      else if (dist(g, main[SEA]!) < S.water * dist(g, main[GRASS]!)) cls[g] = SEA;
    }
  }
  return cls;
}

/** Votes per pixel: sea and grass shares, and the share of an object standing on the sea. */
export interface SurfaceVotes {
  readonly sea: Float32Array;
  readonly grass: Float32Array;
  /** Where a region in another surface's colour stands on the sea (a deck): the sea votes read it as
   *  the sea it stands on, and the landmark search reads it here. */
  readonly seaObject: Float32Array;
}

/**
 * Each pixel's votes from the regions (`readRegions`): its region's class, an object on the sea
 * voting the sea it stands on, and where the pixels `S.blendReach` cells out on either side vote two
 * classes (along the axis or diagonal whose two such pixels differ most in colour), the share of the
 * way its colour lies from one's colour to the other's: the blur and the foam the camera draws across
 * an edge, read the same in any palette. Pixels `fill` marks that the raster did not see take the
 * nearest seen pixel's class; the rest read as all sea and no grass.
 */
export function surfaceVotes(raster: SurfaceRaster, regions: GroundRegions, fill: Uint8Array): SurfaceVotes {
  const { w, lab } = raster;
  const n = w * raster.h;
  const { surface, look } = regions;
  const cls = Int8Array.from(look, (c, i) => (surface[i] === SEA ? SEA : c));
  const sea = new Float32Array(n).fill(1);
  const grass = new Float32Array(n);
  const seaObject = new Float32Array(n);
  const reach = Math.max(1, Math.round(S.blendReach * Math.sqrt(raster.perCell)));
  const at = (c: number) => [c === SEA ? 1 : 0, c === GRASS ? 1 : 0] as const;
  for (let i = 0; i < n; i++) {
    const c = cls[i]!;
    if (c < 0) continue;
    if (surface[i] === SEA && look[i] !== SEA) seaObject[i] = 1;
    let best = 0;
    let bp = -1;
    let bq = -1;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
      const p = outFrom(raster, i, -dx, -dy, reach);
      const q = outFrom(raster, i, dx, dy, reach);
      if (cls[p] === cls[q]) continue;
      const step = labDistance(lab, p, q);
      if (step > best) { best = step; bp = p; bq = q; }
    }
    if (bp < 0) {
      [sea[i], grass[i]] = at(c);
      continue;
    }
    let along = 0;
    for (let q = 0; q < 3; q++) along += (lab[i * 3 + q]! - lab[bp * 3 + q]!) * (lab[bq * 3 + q]! - lab[bp * 3 + q]!);
    const t = Math.min(1, Math.max(0, along / (best * best)));
    const [sp, gp] = at(cls[bp]!);
    const [sq, gq] = at(cls[bq]!);
    sea[i] = (1 - t) * sp + t * sq;
    grass[i] = (1 - t) * gp + t * gq;
  }
  // The pixels the raster left out take the class of the nearest one it read, ring by ring.
  const from = Int32Array.from({ length: n }, (_, i) => (cls[i]! >= 0 ? i : -1));
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (from[i]! >= 0) frontier.push(i);
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1, i >= w ? i - w : -1, i + w < n ? i + w : -1]) {
        if (j < 0 || from[j]! >= 0 || !fill[j]) continue;
        from[j] = from[i]!;
        [sea[j], grass[j]] = at(cls[from[i]!]!);
        next.push(j);
      }
    }
    frontier = next;
  }
  return { sea, grass, seaObject };
}

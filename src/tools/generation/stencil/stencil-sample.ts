/*
 * Converts decoded pixels to a cell stencil. Each destination quadrant integrates its covered source
 * area, avoiding browser downsampling artifacts. Photographic sources use averaged colour and error
 * diffusion. Flat drawings avoid diffusion and use majority colour except in compact boxes, where
 * area averages retain subcell detail. The module is pure arithmetic after decoded pixels arrive.
 */
import type { Stencil, StencilSourceNature } from '../recipe';
import { COMPACT_IMAGE_LIMIT, COVERAGE_ON } from './stencil';
import { colorBucket } from './color';
import { backgroundMask } from './stencil-backdrop';
import { cropPixels, salientCrop, CROP_MAX_SIDE, type SourceRect } from './stencil-crop';

export type { StencilSourceNature };

/** A decoded picture: RGBA rows, as `getImageData` hands them over. */
export interface SourcePixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** The cell box a picture is fitted into. */
interface SampleBox { width: number; height: number }

/** How a picture is read. Everything defaults to what a picture off the shelf gets. */
export interface SampleOptions {
  /** Take the nature as given rather than reading it. */
  nature?: StencilSourceNature;
  /** Whether a flat backdrop is dropped from the picture. Default true. */
  background?: boolean;
  /** Whether the picture is fitted by what it builds rather than by its file's own frame.
   *  Default true; off is the untrimmed reading a comparison is scored against. */
  trim?: boolean;
  /**
   * Experiment, default off: build the most identifying part of the subject rather than the whole of it
   * shrunk past legibility (`salientCrop`). Below about twenty cells a character's head carries the
   * subject and its body carries nothing, and a box that small cannot hold both — so the wise depiction
   * may be a crop. Nothing in the app sets this: a picture the visitor did not frame may not be the
   * picture they asked for.
   */
  crop?: boolean;
}

/** How many of the commonest colours are asked to account for the picture. Sixteen is well past any
 *  sprite's palette and well short of what a photograph needs. */
const FLAT_TOP_COLORS = 16;

/**
 * The share of a picture its sixteen commonest colours have to cover for it to be read as a drawing.
 *
 * Drawings sit well above the threshold and photographs, gradients and screenshots well below it,
 * so one statistic decides, with the threshold in the middle of the gap. The boundary is validated
 * at its two ends rather than on borderline photographs; both readings produce a legal map and a
 * mistake costs reproduction quality rather than correctness.
 */
const FLAT_COLOR_SHARE = 0.6;

/**
 * What kind of picture this is, and the number the answer was made on.
 *
 * Reads only the pixels the picture actually draws (alpha at least half), so a sticker on a
 * transparent field is judged on the sticker.
 */
export function readSourceNature(src: SourcePixels): { nature: StencilSourceNature; flatShare: number } {
  // One counter per five-bit bucket, in a flat table: the buckets are a fixed 32768 and the walk is
  // over every pixel of the source, so a table costs one indexed add per pixel where a map costs a
  // hash lookup and a write. Only the sixteen largest counts are read back, and they are kept as a
  // sorted window rather than by sorting all of them.
  const counts = new Int32Array(1 << 15);
  let total = 0;
  for (let i = 0; i + 3 < src.data.length; i += 4) {
    if (src.data[i + 3]! < 128) continue;
    const key = colorBucket(src.data[i]!, src.data[i + 1]!, src.data[i + 2]!);
    counts[key] = counts[key]! + 1;
    total++;
  }
  if (total === 0) return { nature: 'photographic', flatShare: 0 };
  const top = new Int32Array(FLAT_TOP_COLORS);
  for (let key = 0; key < counts.length; key++) {
    const n = counts[key]!;
    if (n <= top[FLAT_TOP_COLORS - 1]!) continue;
    let at = FLAT_TOP_COLORS - 1;
    while (at > 0 && top[at - 1]! < n) { top[at] = top[at - 1]!; at--; }
    top[at] = n;
  }
  let kept = 0;
  for (const n of top) kept += n;
  const flatShare = kept / total;
  return { nature: flatShare >= FLAT_COLOR_SHARE ? 'flat' : 'photographic', flatShare };
}

/**
 * Fits a source into `box` with preserved aspect ratio and centered placement. Two-by-two quadrant
 * sampling records coverage for corner trimming. Photographs and compact boxes average colour;
 * larger flat drawings use majority colour. Transparent or removed backdrop cells remain uncovered. Empty build borders are
 * cropped and sampled again unless `trim` is disabled.
 */
export function stencilFromPixels(src: SourcePixels, box: SampleBox, opts: SampleOptions = {}): Stencil | null {
  return sampleStencil(src, box, opts)?.stencil ?? null;
}

/** A sampled picture: its stencil and the build trim it was sampled from. */
interface SampledStencil {
  stencil: Stencil;
  /**
   * The source rectangle everything the picture builds sits inside, in the pixels of the picture the
   * trim read (after the salient crop, when one was taken), or null where nothing was trimmed:
   * nothing builds at all, what does already reaches the frame, or `trim` is off.
   *
   * Measured on the same reading the build uses, so what is dropped is exactly what would have laid
   * nothing. That is one question in every material rather than several: a cell reaches the map only
   * if it is covered (`stencil.ts:covered`), and every palette a picture can be told in — the green
   * ramp, the ramp with the blue in it, the item catalogue — answers a covered cell with something to
   * lay. What "builds nothing" therefore means is transparent, keyed out as backdrop, or under the
   * coverage a cell is claimed at.
   */
  trim: SourceRect | null;
}

/** `stencilFromPixels` with the trim it took. */
export function sampleStencil(src: SourcePixels, box: SampleBox, opts: SampleOptions = {}): SampledStencil | null {
  if (box.width < 1 || box.height < 1 || src.width < 1 || src.height < 1) return null;
  const nature = opts.nature ?? readSourceNature(src).nature;
  let backdrop = opts.background === false ? null : backgroundMask(src);
  // The experiment (`SampleOptions.crop`), and it happens first because everything below is a reading of
  // whatever picture it is handed: the crop keys the backdrop into its own alpha, so the pipeline after
  // it sees a smaller picture and asks nothing new.
  if (opts.crop && Math.min(box.width, box.height) <= CROP_MAX_SIDE) {
    const window = salientCrop(src, box, backdrop);
    if (window) { src = cropPixels(src, window, backdrop); backdrop = null; }
  }
  const first = samplePixels(src, box, nature, backdrop);
  if (opts.trim === false) return { stencil: first, trim: null };
  const rect = buildingRect(first, src, box);
  if (!rect) return { stencil: first, trim: null };
  // The second pass carries the first's answers rather than asking again: the keyed backdrop is
  // baked into the crop's alpha and the nature is passed in. Re-keying the crop would be a
  // different question with the evidence removed — the gates in `backgroundMask` want a border that
  // is mostly backdrop and a flooded region with an inside, and a crop crushed against the subject
  // has neither, so the wall of white would come back as ink and pave the region again.
  return { stencil: samplePixels(cropPixels(src, rect, backdrop), box, nature, null), trim: rect };
}

/**
 * How much bigger the subject has to come out for a trim to be worth taking: a tenth.
 *
 * A trim is not free. Re-fitting the crop moves every cell's phase against the picture, and on a
 * fine pattern that is not a smaller change than the one it is buying: a comb of one-cell stripes
 * whose last column happens to be empty gains 40 cells where it had 39, and lands with every cell
 * half covered, which reads as a solid block rather than as stripes. Below a tenth nobody can see
 * the subject grow, so the rim goes unclaimed and the picture is left where the file put it.
 */
const TRIM_MIN_GAIN = 1.1;

/** Where a picture lands inside its cell box: `object-fit: contain` in quadrant units, which is what
 *  the sampler works in. The one mapping between source pixels and cells. */
function containFit(src: { width: number; height: number }, box: SampleBox): { scale: number; offX: number; offY: number } {
  const qw = box.width * 2, qh = box.height * 2;
  const scale = Math.min(qw / src.width, qh / src.height);
  return { scale, offX: (qw - src.width * scale) / 2, offY: (qh - src.height * scale) / 2 };
}

/** The bounding box of the covered cells, mapped back through the fit into the source's own pixels
 *  and rounded outward, so a trim can never cut into ink that was going to be built. */
function buildingRect(stencil: Stencil, src: SourcePixels, box: SampleBox): SourceRect | null {
  const { width, height } = box;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((stencil.coverage[y * width + x] ?? 0) < COVERAGE_ON) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;                       // nothing builds: there is no picture to fit
  const { scale, offX, offY } = containFit(src, box);
  const left = Math.max(0, Math.floor((x0 * 2 - offX) / scale));
  const top = Math.max(0, Math.floor((y0 * 2 - offY) / scale));
  const right = Math.min(src.width, Math.ceil(((x1 + 1) * 2 - offX) / scale));
  const bottom = Math.min(src.height, Math.ceil(((y1 + 1) * 2 - offY) / scale));
  if (right <= left || bottom <= top) return null;
  // Already the whole picture, which is every photograph and every drawing that fills its own file.
  // Reported as "no trim" rather than as a crop of everything, so a caller can tell the two apart.
  if (left === 0 && top === 0 && right === src.width && bottom === src.height) return null;
  const rect = { x: left, y: top, width: right - left, height: bottom - top };
  const gain = containFit(rect, box).scale / scale;
  return gain >= TRIM_MIN_GAIN ? rect : null;
}

/** One reading of a picture into a cell box: the area integral itself, with the two decisions above
 *  it (what kind of picture this is, and which pixels are backdrop) already made. */
function samplePixels(
  src: SourcePixels, box: SampleBox, nature: StencilSourceNature, backdrop: Uint8Array | null,
): Stencil {
  const { width, height } = box;
  const { scale, offX, offY } = containFit(src, box);
  const useMajority = nature === 'flat' && Math.min(width, height) >= COMPACT_IMAGE_LIMIT;

  const coverage = new Uint8Array(width * height);
  const color = new Uint32Array(width * height);
  const quad = new Uint8Array(width * height * 4);
  // Quadrant order [TL, TR, BL, BR], the `core/model/corners.ts` convention the trim reads.
  const QUAD = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;

  // The colours a whole cell covers, kept per five-bit bucket so the majority reading can ask which
  // one most of the cell is. Weight is area times alpha: a pixel the picture barely draws does not
  // get to name the cell. Reused across cells rather than reallocated per cell.
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();

  // One quadrant's integral over the source rectangle it covers: total alpha, and colour weighted by
  // it. Partial pixels at the edges count for the fraction they contribute.
  const integrate = (qx: number, qy: number): [number, number, number, number] => {
    const x0 = Math.max(0, (qx - offX) / scale), x1 = Math.min(src.width, (qx + 1 - offX) / scale);
    const y0 = Math.max(0, (qy - offY) / scale), y1 = Math.min(src.height, (qy + 1 - offY) / scale);
    if (x1 <= x0 || y1 <= y0) return [0, 0, 0, 0];
    let area = 0, a = 0, r = 0, g = 0, b = 0;
    for (let py = Math.floor(y0); py < Math.ceil(y1); py++) {
      const hy = Math.min(py + 1, y1) - Math.max(py, y0);
      if (hy <= 0) continue;
      for (let px = Math.floor(x0); px < Math.ceil(x1); px++) {
        const wx = Math.min(px + 1, x1) - Math.max(px, x0);
        if (wx <= 0) continue;
        const w = wx * hy;
        const i = (py * src.width + px) * 4;
        const pr = src.data[i]!, pg = src.data[i + 1]!, pb = src.data[i + 2]!;
        const pa = backdrop?.[py * src.width + px] ? 0 : src.data[i + 3]! / 255;
        area += w;
        a += w * pa;
        r += w * pa * pr;
        g += w * pa * pg;
        b += w * pa * pb;
        if (useMajority && pa > 0) {
          const key = colorBucket(pr, pg, pb);
          const bucket = buckets.get(key);
          if (bucket) { bucket.w += w * pa; bucket.r += w * pa * pr; bucket.g += w * pa * pg; bucket.b += w * pa * pb; }
          else buckets.set(key, { w: w * pa, r: w * pa * pr, g: w * pa * pg, b: w * pa * pb });
        }
      }
    }
    if (area <= 0) return [0, 0, 0, 0];
    return [a / area, a > 0 ? r / a : 0, a > 0 ? g / a : 0, a > 0 ? b / a : 0];
  };

  // The commonest colour in the buckets, as the mean of the pixels that voted for it — so the cell
  // draws the shade the picture had there, not the bucket's rounded centre. Ties go to the lower
  // key, which is one function of the picture rather than of insertion order.
  const majority = (): number | null => {
    let best: { w: number; r: number; g: number; b: number } | null = null;
    let bestKey = Infinity;
    for (const [key, bucket] of buckets) {
      if (!best || bucket.w > best.w || (bucket.w === best.w && key < bestKey)) { best = bucket; bestKey = key; }
    }
    if (!best || best.w <= 0) return null;
    return ((Math.round(best.r / best.w) << 16) | (Math.round(best.g / best.w) << 8) | Math.round(best.b / best.w)) >>> 0;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      buckets.clear();
      let aSum = 0, r = 0, g = 0, b = 0;
      for (let c = 0; c < 4; c++) {
        const [a, qr, qg, qb] = integrate(x * 2 + QUAD[c]![0], y * 2 + QUAD[c]![1]);
        quad[i * 4 + c] = Math.round(a * 255);
        aSum += a;
        r += qr * a; g += qg * a; b += qb * a;
      }
      coverage[i] = Math.round((aSum / 4) * 255);
      const mode = useMajority ? majority() : null;
      color[i] = mode !== null
        ? mode
        : aSum > 0
          ? (((Math.round(r / aSum) << 16) | (Math.round(g / aSum) << 8) | Math.round(b / aSum)) >>> 0)
          : 0;
    }
  }
  return { width, height, coverage, color, quad, nature };
}

/**
 * How much of a cell's quantisation error is passed on to its neighbours.
 *
 * Not all of it, which is what the textbook does. A region is small and its palette is coarse, so an
 * undamped diffusion carries a big error a long way and lays the worms and streaks that reads as
 * noise rather than as shading; three quarters spends most of the error where it belongs and lets the
 * rest go.
 */
export const DIFFUSION = 0.75;

/**
 * The same, for the terrain ramp — gentler, because that palette is one hue.
 *
 * An error the ramp cannot spend is a hue error: a blue cell matched against eight greens leaves a
 * mistake no neighbour can make good, and carrying three quarters of it across the picture only lays
 * noise over a shape that was reading correctly. Measured on gradients in and out of the ramp's own
 * gamut: three fifths is where the in-gamut gain is nearly all there and the out-of-gamut loss has
 * not started.
 */
export const RAMP_DIFFUSION = 0.6;

/** Floyd-Steinberg's weights, in the order the walk visits them: ahead, and the three below. */
const SPREAD: readonly (readonly [number, number, number])[] = [
  [1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16],
];

/**
 * Match every cell of a picture to a palette, spending each cell's error on the cells not yet
 * matched — Floyd-Steinberg over a serpentine walk, so the error does not always travel the same way
 * and the picture keeps no directional grain.
 *
 * `pick` is the caller's own nearest-colour search, so this works for the terrain ramp and for the
 * item catalogue alike; `rgbOf` says what the chosen entry actually draws in, which is what the error
 * is measured against. A cell the caller declines (`null`) carries its own error no further: nothing
 * was drawn there, so there is no mistake to pass on.
 *
 * Deterministic: one walk, fixed weights, no randomness anywhere.
 */
export function matchWithDiffusion<T>(
  stencil: Stencil,
  wanted: (index: number) => number | null,
  pick: (rgb: number) => T | null,
  rgbOf: (entry: T) => number,
  damping = DIFFUSION,
): (T | null)[] {
  const { width: w, height: h } = stencil;
  const out: (T | null)[] = new Array(w * h).fill(null);
  const errR = new Float32Array(w * h), errG = new Float32Array(w * h), errB = new Float32Array(w * h);
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

  for (let y = 0; y < h; y++) {
    const rightward = y % 2 === 0;
    for (let k = 0; k < w; k++) {
      const x = rightward ? k : w - 1 - k;
      const i = y * w + x;
      const want = wanted(i);
      if (want === null) continue;
      const r = clamp(((want >> 16) & 0xff) + errR[i]!);
      const g = clamp(((want >> 8) & 0xff) + errG[i]!);
      const b = clamp((want & 0xff) + errB[i]!);
      const entry = pick(((Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)) >>> 0);
      out[i] = entry;
      if (entry === null) continue;
      const got = rgbOf(entry);
      const dr = (r - ((got >> 16) & 0xff)) * damping;
      const dg = (g - ((got >> 8) & 0xff)) * damping;
      const db = (b - (got & 0xff)) * damping;
      for (const [sx, sy, weight] of SPREAD) {
        const nx = x + (rightward ? sx! : -sx!), ny = y + sy!;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        errR[ni] = errR[ni]! + dr * weight!;
        errG[ni] = errG[ni]! + dg * weight!;
        errB[ni] = errB[ni]! + db * weight!;
      }
    }
  }
  return out;
}

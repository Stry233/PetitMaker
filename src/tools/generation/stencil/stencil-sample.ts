/*
 * Converts decoded pixels to a cell stencil. Each destination quadrant integrates its covered source
 * area, avoiding browser downsampling artifacts. Photographic sources use averaged colour and error
 * diffusion. Flat drawings avoid diffusion and use majority colour except in compact boxes, where
 * area averages retain subcell detail. The module is pure arithmetic after decoded pixels arrive.
 */
import type { Stencil, StencilSourceNature } from '../../../core/model/types';
import { COMPACT_IMAGE_LIMIT, COVERAGE_ON } from './stencil';

export type { StencilSourceNature };

/** A decoded picture: RGBA rows, as `getImageData` hands them over. */
export interface SourcePixels {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A rectangle of a source picture, in its own pixels. */
export interface SourceRect { x: number; y: number; width: number; height: number }

/** The cell box a picture is fitted into. */
export interface SampleBox { width: number; height: number }

/** How a picture is read. Everything defaults to what a picture off the shelf gets. */
export interface SampleOptions {
  /** Take the nature as given rather than reading it. */
  nature?: StencilSourceNature;
  /** Whether a flat backdrop is dropped from the picture. Default true. */
  background?: boolean;
  /** Whether the picture is fitted by what it BUILDS rather than by its file's own frame.
   *  Default true; off is the untrimmed reading a comparison is scored against. */
  trim?: boolean;
  /**
   * EXPERIMENT, DEFAULT OFF: build the most identifying PART of the subject rather than the whole of it
   * shrunk past legibility (`salientCrop`). Below about twenty cells a character's head carries the
   * subject and its body carries nothing, and a box that small cannot hold both — so the wise depiction
   * may be a crop. Nothing in the app sets this: it exists so an offline evaluation can rule on whether
   * a picture the visitor did not frame is a picture they asked for.
   */
  crop?: boolean;
}

/** A colour reduced to five bits a channel: near-identical shades share a bucket, which is what
 *  makes a count of "how many colours is this drawn in" survive a JPEG's noise or a scaler's
 *  blending. */
const bucketOf = (r: number, g: number, b: number): number =>
  (((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)) >>> 0;

/** How many of the commonest colours are asked to account for the picture. Sixteen is well past any
 *  sprite's palette and well short of what a photograph needs. */
const FLAT_TOP_COLORS = 16;

/**
 * The share of a picture its sixteen commonest colours have to cover for it to be read as a DRAWING.
 *
 * Measured on real pasted sources and on counter-examples: a pixel-art sticker sits at 0.82, a JPEG
 * of one at 0.87, a shipped catalog sprite at 0.89; a photograph (blurred noise) at 0.23, a gradient
 * with grain at 0.04, an in-game screenshot at 0.35. The gap is wide enough that ONE statistic is
 * more honest than a compound score, and the threshold sits in the middle of it.
 *
 * WHAT THAT EVIDENCE IS, exactly: four pasted pictures, our own drawn fixtures, and synthetic
 * continuous tone. No borderline photograph has been measured — a heavily posterised one, a flat
 * studio shot, a screenshot of a photograph — so the boundary is validated at its two ENDS rather
 * than at the middle. Both readings produce a legal map and the mistake costs reproduction quality
 * rather than correctness, which is why one number is allowed to decide it at all.
 */
export const FLAT_COLOR_SHARE = 0.6;

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
    const key = bucketOf(src.data[i]!, src.data[i + 1]!, src.data[i + 2]!);
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
  if (box.width < 1 || box.height < 1 || src.width < 1 || src.height < 1) return null;
  const nature = opts.nature ?? readSourceNature(src).nature;
  let backdrop = opts.background === false ? null : backgroundMask(src);
  // The experiment (`SampleOptions.crop`), and it happens FIRST because everything below is a reading of
  // whatever picture it is handed: the crop keys the backdrop into its own alpha, so the pipeline after
  // it sees a smaller picture and asks nothing new.
  if (opts.crop && Math.min(box.width, box.height) <= CROP_MAX_SIDE) {
    const window = salientCrop(src, box, backdrop);
    if (window) { src = cropPixels(src, window, backdrop); backdrop = null; }
  }
  const first = samplePixels(src, box, nature, backdrop);
  if (opts.trim === false) return first;
  const rect = buildingRect(first, src, box);
  if (!rect) return first;
  // The SECOND pass carries the first's answers rather than asking again: the keyed backdrop is
  // baked into the crop's alpha and the nature is passed in. Re-keying the crop would be a
  // different question with the evidence removed — the gates in `backgroundMask` want a border that
  // is mostly backdrop and a flooded region with an inside, and a crop crushed against the subject
  // has neither, so the wall of white would come back as ink and pave the region again.
  return samplePixels(cropPixels(src, rect, backdrop), box, nature, null);
}

/**
 * The source rectangle everything the picture BUILDS sits inside, or null where there is nothing to
 * trim: nothing builds at all, or what does already reaches the frame.
 *
 * Measured on the SAME reading the build uses, so what is dropped is exactly what would have laid
 * nothing. That is one question in every material rather than several: a cell reaches the map only
 * if it is covered (`stencil.ts:covered`), and every palette a picture can be told in — the green
 * ramp, the ramp with the blue in it, the item catalogue — answers a covered cell with something to
 * lay. What "builds nothing" therefore means is transparent, keyed out as backdrop, or under the
 * coverage a cell is claimed at.
 */
export function buildingCrop(src: SourcePixels, box: SampleBox, opts: SampleOptions = {}): SourceRect | null {
  if (box.width < 1 || box.height < 1 || src.width < 1 || src.height < 1) return null;
  const nature = opts.nature ?? readSourceNature(src).nature;
  const backdrop = opts.background === false ? null : backgroundMask(src);
  return buildingRect(samplePixels(src, box, nature, backdrop), src, box);
}

/**
 * How much bigger the subject has to come out for a trim to be worth taking: a tenth.
 *
 * A TRIM IS NOT FREE. Re-fitting the crop moves every cell's phase against the picture, and on a
 * fine pattern that is not a smaller change than the one it is buying: a comb of one-cell stripes
 * whose last column happens to be empty gains 40 cells where it had 39, and lands with every cell
 * half covered, which reads as a solid block rather than as stripes. Below a tenth nobody can see
 * the subject grow, so the rim goes unclaimed and the picture is left where the file put it.
 */
export const TRIM_MIN_GAIN = 1.1;

/** Where a picture lands inside its cell box: `object-fit: contain` in QUADRANT units, which is what
 *  the sampler works in. The one mapping between source pixels and cells. */
function containFit(src: { width: number; height: number }, box: SampleBox): { scale: number; offX: number; offY: number } {
  const qw = box.width * 2, qh = box.height * 2;
  const scale = Math.min(qw / src.width, qh / src.height);
  return { scale, offX: (qw - src.width * scale) / 2, offY: (qh - src.height * scale) / 2 };
}

/** The bounding box of the covered cells, mapped back through the fit into the source's own pixels
 *  and rounded OUTWARD, so a trim can never cut into ink that was going to be built. */
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

/**
 * THE EXPERIMENT: the sub-rectangle of a picture that most identifies its subject, or null where the
 * picture has no such part.
 *
 * WHY A CROP COULD BE THE WISER DEPICTION. Below about twenty cells a whole figure is a silhouette with
 * no room for what a viewer recognises it BY — measured over the benchmark, a sixteen-cell box lets a
 * picture say a seventh of what it has to say. A character's head holds the eyes, the ears and the
 * markings; its body holds a colour. Given a box that can carry one of the two, building the head is a
 * depiction and building both is a smudge.
 *
 * WHAT "IDENTIFYING" IS TAKEN TO BE: local CONTRAST over the subject's own ink. An eye, a marking or a
 * mouth is where the picture changes fastest, and a flat coat or a plain background is where it changes
 * least. Read on a coarse grid (`CROP_GRID`) so a single hard pixel edge cannot name the window, and
 * asked as a window of the BOX'S OWN SHAPE, since a crop that does not match the box gives its gain
 * straight back to the letterboxing.
 *
 * IT DECLINES RATHER THAN GUESSES. A picture whose detail is spread evenly — a pattern, a texture, a
 * tile — has no part that identifies it better than the whole, and the window has to beat the whole
 * subject's own density by `CROP_MIN_GAIN` before it is taken.
 */
export const CROP_MAX_SIDE = 20;
export const CROP_WINDOW = 0.6;
export const CROP_GRID = 24;
export const CROP_MIN_GAIN = 1.4;

export function salientCrop(
  src: SourcePixels, box: SampleBox, keyed: Uint8Array | null = null,
): SourceRect | null {
  const lumaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return 0;
    const i = (y * src.width + x) * 4;
    if (keyed?.[y * src.width + x] || (src.data[i + 3] ?? 0) < 128) return 0;
    return 0.299 * src.data[i]! + 0.587 * src.data[i + 1]! + 0.114 * src.data[i + 2]!;
  };
  const inked = (x: number, y: number): boolean => {
    const i = (y * src.width + x) * 4;
    return !keyed?.[y * src.width + x] && (src.data[i + 3] ?? 0) >= 128;
  };

  // The subject's own frame: a crop is a choice inside it, never a way of finding it.
  let x0 = src.width, y0 = src.height, x1 = -1, y1 = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (!inked(x, y)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < x0 || y1 < y0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;

  const cols = Math.min(CROP_GRID, w), rows = Math.min(CROP_GRID, h);
  const cw = w / cols, ch = h / rows;
  const detail = new Float64Array(cols * rows);
  const ink = new Float64Array(cols * rows);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inked(x, y)) continue;
      const at = Math.min(rows - 1, Math.floor((y - y0) / ch)) * cols + Math.min(cols - 1, Math.floor((x - x0) / cw));
      detail[at] = detail[at]! + Math.abs(lumaAt(x + 1, y) - lumaAt(x - 1, y)) + Math.abs(lumaAt(x, y + 1) - lumaAt(x, y - 1));
      ink[at] = ink[at]! + 1;
    }
  }
  let whole = 0, wholeInk = 0;
  for (let i = 0; i < detail.length; i++) { whole += detail[i]!; wholeInk += ink[i]!; }
  if (wholeInk === 0 || whole <= 0) return null;

  // A window of the box's shape, six tenths of the subject's shorter side, slid over the grid.
  const aspect = box.width / box.height;
  const side = CROP_WINDOW * Math.min(w, h);
  const ww = Math.min(w, aspect >= 1 ? side * aspect : side);
  const wh = Math.min(h, aspect >= 1 ? side : side / aspect);
  const bw = Math.max(1, Math.round(ww / cw)), bh = Math.max(1, Math.round(wh / ch));
  if (bw >= cols && bh >= rows) return null;

  let best = -1, bestAt: [number, number] = [0, 0];
  for (let r = 0; r + bh <= rows; r++) {
    for (let c = 0; c + bw <= cols; c++) {
      let sum = 0;
      for (let dr = 0; dr < bh; dr++) for (let dc = 0; dc < bw; dc++) sum += detail[(r + dr) * cols + c + dc]!;
      if (sum > best) { best = sum; bestAt = [c, r]; }
    }
  }
  if (best <= 0) return null;
  // Against the whole subject read at the same density: a picture whose detail is spread evenly has no
  // part that says more than all of it.
  const share = (bw * bh) / (cols * rows);
  if (best / whole < CROP_MIN_GAIN * share) return null;

  const [c, r] = bestAt;
  const left = Math.max(0, Math.round(x0 + c * cw)), top = Math.max(0, Math.round(y0 + r * ch));
  const right = Math.min(src.width, Math.round(x0 + (c + bw) * cw));
  const bottom = Math.min(src.height, Math.round(y0 + (r + bh) * ch));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A rectangle of a picture as a picture of its own. `keyed` pixels come out transparent, which is
 *  how a backdrop decision made on the whole source survives into a reading of part of it. */
export function cropPixels(src: SourcePixels, rect: SourceRect, keyed: Uint8Array | null = null): SourcePixels {
  const data = new Uint8Array(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const from = ((y + rect.y) * src.width + x + rect.x) * 4, to = (y * rect.width + x) * 4;
      data[to] = src.data[from]!;
      data[to + 1] = src.data[from + 1]!;
      data[to + 2] = src.data[from + 2]!;
      data[to + 3] = keyed?.[(y + rect.y) * src.width + x + rect.x] ? 0 : src.data[from + 3]!;
    }
  }
  return { data, width: rect.width, height: rect.height };
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
  // Quadrant order [TL, TR, BL, BR], the corner-index convention the trim reads.
  const QUAD = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;

  // The colours a whole cell covers, kept per five-bit bucket so the majority reading can ask which
  // one MOST of the cell is. Weight is area times alpha: a pixel the picture barely draws does not
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
          const key = bucketOf(pr, pg, pb);
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

/** Distance between two packed colours, weighted the way the eye weighs the channels — the same
 *  metric every palette match in this system uses. */
function colorDistance(a: number, b: number): number {
  const dr = ((a >> 16) & 0xff) - ((b >> 16) & 0xff);
  const dg = ((a >> 8) & 0xff) - ((b >> 8) & 0xff);
  const db = (a & 0xff) - (b & 0xff);
  return Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db);
}

/** How close a pixel has to be to the backdrop's colour to be part of it. Wide enough for a JPEG's
 *  noise and a watermark's faint pattern over a white field, narrow enough that a subject drawn in a
 *  neighbouring shade is not swallowed. */
export const BACKGROUND_TOLERANCE = 30;
/** How much of the picture's own border the backdrop has to hold before there is one at all. */
export const BACKGROUND_BORDER_SHARE = 0.6;
/** And how much of the whole picture. */
export const BACKGROUND_MIN_SHARE = 0.15;
/**
 * How DEEP it has to be, as a share of the picture's shorter side.
 *
 * A backdrop is a field the subject sits in; a drawn OUTLINE around a sticker is also one colour,
 * also touches every edge and can also be a sixth of the picture, and it is part of the drawing.
 * What tells them apart is thickness: erode the flooded region by this much and a backdrop still has
 * an inside while a rim is gone. A share of the side rather than a count of pixels, so it means the
 * same thing at any resolution.
 */
export const BACKGROUND_MIN_DEPTH = 0.05;
/**
 * And how much has to survive on the OTHER side of it: the subject the flood leaves must be more than
 * a hairline, measured as erosions it survives.
 *
 * A backdrop is a field a subject sits IN, and the three gates above all measure the field. A flat
 * path tile is one colour edge to edge, so the flood covers the whole picture and passes every one of
 * them: the border is that colour, the flood reaches all of it, and it has any depth asked for. The
 * mask then keys the picture out of existence, and a region asked for that picture builds nothing at
 * all at any size in any material. What the flood leaves has to be a subject, and the same erosion the
 * field is held to says whether it is. TWO rather than the field's own depth, because a subject can
 * legitimately be thin where a field cannot: the stones of a stone path survive two erosions and not
 * six, and a picture of stones in mortar is a picture.
 */
export const BACKGROUND_MIN_SUBJECT_DEPTH = 2;

/**
 * Which SOURCE PIXELS are a flat backdrop rather than the picture — null when there is no backdrop.
 *
 * A cut-out PNG says this with its alpha and needs nothing here. A photograph of a sticker, a JPEG,
 * a screenshot of one — the formats people actually paste — say it with a wall of white, and matching
 * that wall to a palette paves the whole region in the nearest colour: a region filled edge to edge with
 * one tier and the subject reduced to a few specks inside it. What
 * carries a picture at twenty cells a side is its SILHOUETTE, and a backdrop is precisely what hides
 * one.
 *
 * READ AT THE SOURCE'S OWN RESOLUTION, which is the whole reason it works. The same walk over the
 * CELL grid leaks: a drawn outline is about one cell wide there, the cells it half fills read as the
 * white behind it, and the flood pours through the gaps and takes the subject's own white face with
 * it. At source resolution that outline is several pixels of solid ink and seals.
 *
 * THE BACKDROP IS FOUND FROM THE BORDER AND ONLY REACHED FROM IT, and three gates keep it from firing
 * on a picture that has none: the border must genuinely be one colour, the flood must reach a real
 * share of the picture, and a pixel joins by its distance to the BACKDROP rather than to its
 * neighbour, so a gradient cannot be walked across one small step at a time. A fourth asks what the
 * flood LEFT (`BACKGROUND_MIN_SUBJECT_DEPTH`): a field with no subject in it is not a field.
 */
export function backgroundMask(src: SourcePixels): Uint8Array | null {
  const { width: w, height: h } = src;
  if (w < 2 || h < 2) return null;
  const rgbAt = (i: number): number =>
    ((src.data[i * 4]! << 16) | (src.data[i * 4 + 1]! << 8) | src.data[i * 4 + 2]!) >>> 0;
  const opaque = (i: number): boolean => src.data[i * 4 + 3]! >= 128;

  const border: number[] = [];
  for (let x = 0; x < w; x++) { border.push(x); border.push((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { border.push(y * w); border.push(y * w + w - 1); }
  const onBorder = border.filter(opaque);
  if (onBorder.length === 0) return null;

  // The border's commonest colour, as the mean of the pixels that voted for it — the bucket's own
  // centre would be up to four levels off in every channel.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const i of onBorder) {
    const rgb = rgbAt(i);
    const key = bucketOf((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);
    const bucket = buckets.get(key);
    if (bucket) { bucket.n++; bucket.r += (rgb >> 16) & 0xff; bucket.g += (rgb >> 8) & 0xff; bucket.b += rgb & 0xff; }
    else buckets.set(key, { n: 1, r: (rgb >> 16) & 0xff, g: (rgb >> 8) & 0xff, b: rgb & 0xff });
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  let bestKey = Infinity;
  for (const [key, bucket] of buckets) {
    if (!best || bucket.n > best.n || (bucket.n === best.n && key < bestKey)) { best = bucket; bestKey = key; }
  }
  if (!best) return null;
  const backdrop = ((Math.round(best.r / best.n) << 16) | (Math.round(best.g / best.n) << 8) | Math.round(best.b / best.n)) >>> 0;

  // WHICH PIXELS COULD BELONG TO THE BACKDROP, answered once for the whole picture. The flood asks
  // this of every pixel it reaches from each of its four sides, so a per-call test measured the same
  // colour distance about four times over.
  const near = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (opaque(i) && colorDistance(rgbAt(i), backdrop) <= BACKGROUND_TOLERANCE) near[i] = 1;
  }
  const seeds = onBorder.filter((i) => near[i] === 1);
  if (seeds.length / onBorder.length < BACKGROUND_BORDER_SHARE) return null;

  const mask = new Uint8Array(w * h);
  const stack = [...seeds];
  for (const i of seeds) mask[i] = 1;
  let found = 0;
  while (stack.length) {
    const i = stack.pop()!;
    found++;
    const x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of EDGES) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (mask[n] || !near[n]) continue;
      mask[n] = 1;
      stack.push(n);
    }
  }
  let drawn = 0;
  for (let i = 0; i < w * h; i++) if (opaque(i)) drawn++;
  if (drawn === 0 || found / drawn < BACKGROUND_MIN_SHARE) return null;
  if (!hasDepth(mask, w, h, Math.max(2, Math.round(BACKGROUND_MIN_DEPTH * Math.min(w, h))))) return null;
  const subject = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) subject[i] = opaque(i) && !mask[i] ? 1 : 0;
  return hasDepth(subject, w, h, BACKGROUND_MIN_SUBJECT_DEPTH) ? mask : null;
}

/**
 * Whether anything of `mask` survives being eroded `depth` times — a region with an inside, as
 * opposed to a band that is all edge.
 *
 * ASKED AS A DISTANCE, not as `depth` erosions. What an erosion counts down is how far a pixel sits
 * from the nearest one the mask does not hold (the picture's own edge counting as one of those), so a
 * pixel survives k erosions exactly while that distance exceeds k. Two chamfer passes give every
 * pixel its distance at once, where eroding the whole mask a step at a time re-walked the source
 * `depth` times over — and depth is a share of the source's own side, so a 500-pixel picture asked
 * for twenty-five walks of itself.
 */
function hasDepth(mask: Uint8Array, w: number, h: number, depth: number): boolean {
  const dist = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const up = y > 0 ? dist[i - w]! : 0;
      const left = x > 0 ? dist[i - 1]! : 0;
      dist[i] = Math.min(up, left) + 1;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const down = y < h - 1 ? dist[i + w]! : 0;
      const right = x < w - 1 ? dist[i + 1]! : 0;
      const own = Math.min(dist[i]!, Math.min(down, right) + 1);
      if (own > depth) return true;
      dist[i] = own;
    }
  }
  return false;
}

const EDGES: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * How much of a cell's quantisation error is passed on to its neighbours.
 *
 * NOT ALL OF IT, which is what the textbook does. A region is small and its palette is coarse, so an
 * undamped diffusion carries a big error a long way and lays the worms and streaks that reads as
 * noise rather than as shading; three quarters spends most of the error where it belongs and lets the
 * rest go.
 */
export const DIFFUSION = 0.75;

/**
 * The same, for the TERRAIN ramp — gentler, because that palette is one hue.
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
 * DETERMINISTIC: one walk, fixed weights, no randomness anywhere.
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

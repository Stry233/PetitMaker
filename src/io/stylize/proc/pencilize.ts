/*
 * pencilize.ts — a structure-aware coloured-pencil pass over ANY picture of the map.
 *
 * The mechanical track's second medium. Three moves carry it, all deterministic in the seed:
 *
 *   1. XDoG LINES. The classical extended difference-of-Gaussians gives the sketch its drawn
 *      outline: soft, slightly broken pencil lines wherever tone changes, no vector tracing.
 *   2. ORIENTED STROKES. Pigment arrives as elongated hatch strokes. Their direction follows an
 *      ORIENTATION FIELD: where the caller supplies one from the map's own structure (roads run
 *      along themselves, shores along the water), strokes follow the drawing the way a hand would;
 *      elsewhere they fall to a steady sketching angle. Dark tone earns a second, crossed layer.
 *   3. TOOTH. Coloured pencil never fills the paper: a strong tooth field gates the pigment, so
 *      valleys stay white in the lights and only heavy pressure closes them in the darks.
 *
 * Pure array-in, array-out plus an optional orientation sampler, so the pass is testable without
 * a canvas and identical over a real capture or the flat fields base.
 */
import { fnv1a, makeNoise } from './noise';
import type { Bitmap } from './watercolorize';

export interface PencilizeOptions {
  seed: number;
  /** Radians at image position (px). Supplied from map structure where the caller has it. */
  orientation?: (x: number, y: number) => number;
  /** Stroke coverage gain. */
  pressure?: number;
  /** Line darkness of the XDoG sketch pass. */
  line?: number;
  /** Paper tint. */
  paper?: [number, number, number];
}

/** Separable repeated box blur over a scalar field (approximates a Gaussian). */
function blurField(src: Float32Array, w: number, h: number, passes: number): Float32Array {
  const a = new Float32Array(src);
  const b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const l = a[row + Math.max(0, x - 1)]!, c = a[row + x]!, r = a[row + Math.min(w - 1, x + 1)]!;
        b[row + x] = (l + c + r) / 3;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const u = b[Math.max(0, y - 1) * w + x]!, c = b[y * w + x]!, d = b[Math.min(h - 1, y + 1) * w + x]!;
        a[y * w + x] = (u + c + d) / 3;
      }
    }
  }
  return a;
}

export function pencilize(img: Bitmap, o: PencilizeOptions): void {
  const { width: w, height: h, data: D } = img;
  const nz = makeNoise(fnv1a(String(o.seed) + 'pcl'));
  const short = Math.min(w, h);
  const pressure = o.pressure ?? 1;
  const lineGain = o.line ?? 0.75;
  const paper = o.paper ?? [247, 243, 232];

  /* luminance, and the two Gaussian scales XDoG compares */
  const n = w * h;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.2126 * D[i * 4]! + 0.7152 * D[i * 4 + 1]! + 0.0722 * D[i * 4 + 2]!) / 255;
  const narrowPasses = Math.max(1, Math.round(short / 900));
  const g1 = blurField(L, w, h, narrowPasses);
  const g2 = blurField(L, w, h, narrowPasses + 2);

  /* XDoG: soft-thresholded difference — the drawn line, in [0..1] where 1 is a full stroke */
  const PHI = 18, EPS = 0.006, P = 22;
  const line = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = (1 + P) * g1[i]! - P * g2[i]!;
    line[i] = d >= EPS ? 0 : 1 - (1 + Math.tanh(PHI * (d - EPS))) / 2 > 0.5 ? 1 : 0.55;
  }

  /* one paper for the whole sheet: tooth at pencil scale, relief at hand scale */
  const toothScale = short / 260;
  const reliefScale = short / 24;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      const r0 = D[i]! / 255, gr0 = D[i + 1]! / 255, b0 = D[i + 2]! / 255;
      const lum = 0.2126 * r0 + 0.7152 * gr0 + 0.0722 * b0;
      const tone = 1 - lum;

      /* the stroke direction: the drawing's own where given, a sketching angle otherwise */
      const th = o.orientation ? o.orientation(x, y) : 0.72 + (nz.fbm(x / reliefScale, y / reliefScale, 2) - 0.5) * 0.5;
      const cos = Math.cos(th), sin = Math.sin(th);
      const su = (x * cos + y * sin) / (short / 200);
      const sv = (-x * sin + y * cos) / 1.35;
      const hatch = nz.fbm(su + 17, sv + 5, 2);
      /* the crossed second layer arrives with pressure */
      const su2 = (x * Math.cos(th + 1.15) + y * Math.sin(th + 1.15)) / (short / 200);
      const sv2 = (-x * Math.sin(th + 1.15) + y * Math.cos(th + 1.15)) / 1.35;
      const cross = nz.fbm(su2 + 211, sv2 + 91, 2);
      const tooth = nz.fbm(x / toothScale + 61, y / toothScale + 133, 2);

      /* coverage: tone asks for pigment, the hatch carries it, the tooth withholds it */
      let cover = tone * 1.25 * pressure;
      cover *= 0.55 + 0.75 * hatch;
      if (tone > 0.42) cover *= 0.75 + 0.55 * cross;
      cover *= 0.62 + 0.55 * tooth;
      cover = Math.min(1, cover);

      /* the pigment: the map's own hue, sharpened the way wax colour sits over white paper */
      const maxc = Math.max(r0, gr0, b0), minc = Math.min(r0, gr0, b0);
      const sat = maxc - minc;
      const kSat = 1 + Math.min(0.6, 1.6 * sat);
      const mr = Math.min(1, lum + (r0 - lum) * kSat) * 0.92;
      const mg = Math.min(1, lum + (gr0 - lum) * kSat) * 0.92;
      const mb = Math.min(1, lum + (b0 - lum) * kSat) * 0.92;

      let outR = (paper[0]! / 255) * (1 - cover) + mr * cover;
      let outG = (paper[1]! / 255) * (1 - cover) + mg * cover;
      let outB = (paper[2]! / 255) * (1 - cover) + mb * cover;

      /* the sketch line over everything, greyed toward the local hue, broken by the tooth */
      const lk = line[j]! * lineGain * (0.55 + 0.5 * tooth);
      if (lk > 0.02) {
        const ink = 0.22;
        outR = outR * (1 - lk) + (mr * 0.35 + ink) * lk * 0.9;
        outG = outG * (1 - lk) + (mg * 0.35 + ink) * lk * 0.9;
        outB = outB * (1 - lk) + (mb * 0.35 + ink) * lk * 0.9;
      }

      /* the sheet's own relief light */
      const relief = 1 + 0.04 * (nz.fbm(x / reliefScale + 7, y / reliefScale + 3, 2) - 0.5);
      D[i] = Math.max(0, Math.min(255, outR * relief * 255));
      D[i + 1] = Math.max(0, Math.min(255, outG * relief * 255));
      D[i + 2] = Math.max(0, Math.min(255, outB * relief * 255));
    }
  }
}

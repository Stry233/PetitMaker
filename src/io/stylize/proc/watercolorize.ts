/*
 * watercolorize.ts — a structure-blind watercolour pass over ANY picture of the map.
 *
 * The naive half of the aquarelle style: it reads only pixels, so whatever the source shows — the
 * real renderer's sprites included — survives into the painting. The moves are the classical
 * watercolour-rendering literature's (Curtis 1997's pigment-on-paper terms, Bousseau 2006's wash
 * abstraction), all deterministic in the seed:
 *
 *   1. WASH ABSTRACTION. An edge-stopping smoothing at half resolution simplifies each field the
 *      way a loaded brush does — detail inside a region melts, boundaries stay — so the painting
 *      reads as strokes rather than as a photograph seen through glass.
 *   2. DOMAIN WARP. The abstracted picture is resampled through a low-frequency displacement
 *      field, so every straight edge wavers like a stroke laid by hand.
 *   3. THE WASH TRANSFORM. Pigment is transparent: each channel relaxes toward paper, hardest in
 *      the mids, under one wet-scale unevenness field.
 *   4. EDGE DARKENING. Colour boundaries deepen into dried rims, saturating as they darken.
 *   5. GRANULATION AND RELIEF. One paper-height field drives both: pigment settles into the
 *      paper's hollows where the tone is heavy (texture that follows the paper, never random
 *      noise), and the sheet's own relief lights the surface faintly.
 *   6. BACKRUNS. A handful of seeded blooms push pigment out to a cauliflower front: paler
 *      inside, deepened along the front.
 *
 * Pure array-in, array-out on an ImageData-shaped object, so the pass is testable without a
 * canvas and callable from any surface that can hand it pixels.
 */
import { fnv1a, makeNoise, mulberry32 } from './noise';

export interface Bitmap { data: Uint8ClampedArray; width: number; height: number }

export interface WatercolorizeOptions {
  seed: number;
  /** Warp amplitude as a fraction of the image's short edge. */
  warp?: number;
  /** How strongly edges deepen (the dried rim). */
  rim?: number;
  /** How far the wash lightens toward paper in the mids. */
  lift?: number;
  /** How strongly pigment settles into the paper's tooth. */
  granulation?: number;
  /** Edge-stopping smoothing passes at half resolution (the brush's abstraction). */
  abstraction?: number;
  /** Tone bands per unit luminance: each glaze is a discrete wash, and every band boundary earns
   *  a dried rim of its own — the painted structure INSIDE a field. 0 disables. */
  bands?: number;
  /** Strength of the directional streaks the brush hairs leave in a wash. */
  stroke?: number;
  /** Paper tint the light returns through. */
  paper?: [number, number, number];
}

/** One separable box blur, in place, radius 1 — repeated for spread. */
function blur3(src: Float32Array, w: number, h: number, passes: number): Float32Array {
  const a = src;
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

/** Edge-stopping smoothing on an RGB byte buffer: each pass averages the 3x3 neighbourhood with
 *  weights that die on colour distance, so fields melt together and boundaries hold. */
function abstractWash(px: Float32Array, w: number, h: number, passes: number): Float32Array {
  let a = px;
  let b: Float32Array = new Float32Array(px.length);
  const sigma2 = 2 * 26 * 26;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const r0 = a[i]!, g0 = a[i + 1]!, b0 = a[i + 2]!;
        let sr = 0, sg = 0, sb = 0, sw = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.min(h - 1, Math.max(0, y + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(w - 1, Math.max(0, x + dx));
            const j = (yy * w + xx) * 3;
            const dr = a[j]! - r0, dg = a[j + 1]! - g0, db = a[j + 2]! - b0;
            const wgt = Math.exp(-(dr * dr + dg * dg + db * db) / sigma2);
            sr += a[j]! * wgt; sg += a[j + 1]! * wgt; sb += a[j + 2]! * wgt; sw += wgt;
          }
        }
        b[i] = sr / sw; b[i + 1] = sg / sw; b[i + 2] = sb / sw;
      }
    }
    const t = a; a = b; b = t;
  }
  return a;
}

export function watercolorize(img: Bitmap, o: WatercolorizeOptions): void {
  const { width: w, height: h, data: D } = img;
  const nz = makeNoise(fnv1a(String(o.seed) + 'wcz'));
  const short = Math.min(w, h);
  const warpAmp = (o.warp ?? 0.0032) * short;
  const rimGain = o.rim ?? 0.72;
  const lift = o.lift ?? 0.44;
  const gran = o.granulation ?? 0.22;
  const bands = o.bands ?? 5;
  const stroke = o.stroke ?? 0.16;
  const paper = o.paper ?? [247, 244, 234];
  /* Short-wavelength, small-amplitude: the DRAWING stays where the map put it, and only the edge
     itself frays — a large slow warp reads as glass, not paint. */
  const warpScale = short / 70;

  /* 1. wash abstraction at half resolution: melt the detail, hold the boundaries. */
  const hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1);
  let half: Float32Array = new Float32Array(hw * hh * 3);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const sx = Math.min(w - 2, x * 2), sy = Math.min(h - 2, y * 2);
      const i00 = (sy * w + sx) * 4, i01 = i00 + 4, i10 = i00 + w * 4, i11 = i10 + 4;
      const t = (y * hw + x) * 3;
      half[t] = (D[i00]! + D[i01]! + D[i10]! + D[i11]!) / 4;
      half[t + 1] = (D[i00 + 1]! + D[i01 + 1]! + D[i10 + 1]! + D[i11 + 1]!) / 4;
      half[t + 2] = (D[i00 + 2]! + D[i01 + 2]! + D[i10 + 2]! + D[i11 + 2]!) / 4;
    }
  }
  half = abstractWash(half, hw, hh, Math.max(1, Math.min(8, o.abstraction ?? 4)));

  /* the fields, at quarter resolution, bilinearly sampled below */
  const qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
  const wetQ = new Float32Array(qw * qh);
  const paperQ = new Float32Array(qw * qh);
  const toothQ = new Float32Array(qw * qh);
  const wetScaleQ = Math.min(qw, qh) / 7;
  const paperScaleQ = Math.min(qw, qh) / 22;
  const toothScaleQ = Math.min(qw, qh) / 90;
  for (let y = 0; y < qh; y++) {
    for (let x = 0; x < qw; x++) {
      const j = y * qw + x;
      wetQ[j] = nz.fbm(x / wetScaleQ + 91, y / wetScaleQ + 53, 2);
      paperQ[j] = nz.fbm(x / paperScaleQ + 7, y / paperScaleQ + 131, 2);
      toothQ[j] = nz.fbm(x / toothScaleQ + 211, y / toothScaleQ + 17, 2);
    }
  }
  const sampleQ = (f: Float32Array, x: number, y: number): number => {
    const fx = Math.min(qw - 1.001, Math.max(0, x / 4)), fy = Math.min(qh - 1.001, Math.max(0, y / 4));
    const xi = fx | 0, yi = fy | 0, ax = fx - xi, ay = fy - yi;
    const i0 = yi * qw + xi;
    return (f[i0]! * (1 - ax) + f[i0 + 1]! * ax) * (1 - ay) + (f[i0 + qw]! * (1 - ax) + f[i0 + qw + 1]! * ax) * ay;
  };

  /* backruns: a few seeded blooms, folded into one quarter-res field (lighten inside, deepen on
     the cauliflower front) */
  const bloomQ = new Float32Array(qw * qh).fill(0);
  {
    const rnd = mulberry32(fnv1a(String(o.seed) + 'bloom'));
    const count = 6;
    for (let k = 0; k < count; k++) {
      const cx = qw * (0.12 + 0.76 * rnd()), cy = qh * (0.12 + 0.76 * rnd());
      const r = (Math.min(qw, qh) / 14) * (1 + rnd() * 1.4);
      const ph = rnd() * 6.283;
      const x0 = Math.max(0, (cx - r * 1.3) | 0), x1 = Math.min(qw, cx + r * 1.3);
      const y0 = Math.max(0, (cy - r * 1.3) | 0), y1 = Math.min(qh, cy + r * 1.3);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          const rr = r * (1 + 0.09 * Math.sin(a * 4 + ph) + 0.05 * Math.sin(a * 9 + ph * 2) + 0.06 * Math.sin(a * 2 - ph));
          const j = y * qw + x;
          if (d < rr - 1) bloomQ[j] = Math.min(bloomQ[j]!, 0) - 0.35;    // paler inside
          else if (d < rr + 0.8) bloomQ[j] = Math.max(bloomQ[j]!, 0.55);  // the front
        }
      }
    }
  }

  /* 2. warp-resample the ABSTRACTED image back to full resolution. */
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wx = (nz.fbm(x / warpScale, y / warpScale, 2) - 0.55) * 2 * warpAmp;
      const wy = (nz.fbm(x / warpScale + 37, y / warpScale + 11, 2) - 0.55) * 2 * warpAmp;
      const fx = Math.min(hw - 1.001, Math.max(0, (x + wx) / 2)), fy = Math.min(hh - 1.001, Math.max(0, (y + wy) / 2));
      const xi = fx | 0, yi = fy | 0, ax = fx - xi, ay = fy - yi;
      const i0 = (yi * hw + xi) * 3, i1 = i0 + 3, i2 = i0 + hw * 3, i3 = i2 + 3;
      const di = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        D[di + c] = (half[i0 + c]! * (1 - ax) + half[i1 + c]! * ax) * (1 - ay)
                  + (half[i2 + c]! * (1 - ax) + half[i3 + c]! * ax) * ay;
      }
    }
  }

  /* 3. GLAZE STEPS. Tone quantizes into discrete washes — hue held, luminance banded — with the
        band threshold wandering on the wet field, so the steps read as hand-laid glazes rather
        than posterization. The edge pass below then rims every band boundary, which is what puts
        painted structure INSIDE a field instead of only around it. */
  if (bands > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r0 = D[i]! / 255, g0 = D[i + 1]! / 255, b0 = D[i + 2]! / 255;
        const L = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;
        if (L <= 0.02 || L >= 0.985) continue;
        const drift = (sampleQ(wetQ, x, y) - 0.5) * 0.7;
        /* soft step: the band transition spans a fifth of a band, so its contour is a smooth
           gradient the rim pass can shade, never a pixel staircase */
        const t = L * bands + drift;
        const f = t - Math.floor(t);
        const soft = f < 0.4 ? 0 : f > 0.6 ? 1 : (f - 0.4) / 0.2;
        const q = (Math.floor(t) + soft * soft * (3 - 2 * soft) + 0.5 - drift) / bands;
        const gain = 1 + (Math.min(1.08, Math.max(0.92, q / L)) - 1) * 0.62;
        D[i] = Math.max(0, Math.min(255, D[i]! * gain));
        D[i + 1] = Math.max(0, Math.min(255, D[i + 1]! * gain));
        D[i + 2] = Math.max(0, Math.min(255, D[i + 2]! * gain));
      }
    }
  }

  /* 3b. the edge field on the glazed wash, spread to a rim's width. */
  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const gx = Math.abs(D[i + 4]! - D[i - 4]!) + Math.abs(D[i + 5]! - D[i - 3]!) + Math.abs(D[i + 6]! - D[i - 2]!);
      const gy = Math.abs(D[i + w * 4]! - D[i - w * 4]!) + Math.abs(D[i + w * 4 + 1]! - D[i - w * 4 + 1]!) + Math.abs(D[i + w * 4 + 2]! - D[i - w * 4 + 2]!);
      edge[y * w + x] = Math.min(1, (gx + gy) / 340);
    }
  }
  const rim = blur3(edge, w, h, 1 + Math.max(1, Math.round(short / 640)));

  /* 4-6. glaze, rim, granulation, blooms and paper relief, in one pass. */
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const j = y * w + x, i = j * 4;
      const wet = 0.8 + 0.4 * sampleQ(wetQ, x, y);
      /* the brush's pull: elongated grain, its direction turning slowly across the sheet */
      const th = (sampleQ(paperQ, x, y) - 0.5) * 0.9;
      const su = (x * Math.cos(th) + y * Math.sin(th)) / (short / 2.4);
      const sv = (-x * Math.sin(th) + y * Math.cos(th)) / (short / 110);
      const streak = nz.fbm(su + 313, sv + 77, 2) - 0.55;
      const bloom = sampleQ(bloomQ, x, y);
      const k = lift * wet * (1 - Math.min(0, bloom) * 0.5);    // paler still inside a bloom
      const P = sampleQ(paperQ, x, y) - 0.5;
      const tooth = sampleQ(toothQ, x, y) - 0.5;
      const relief = 1 + 0.05 * P + 0.03 * tooth;
      const rr = (rim[j]! * rimGain + Math.max(0, bloom) * 0.16);
      for (let c = 0; c < 3; c++) {
        const v = D[i + c]! / 255, p = paper[c]! / 255;
        const mids = 4 * v * (1 - v);
        let out = v + (p - v) * (k * (1 + stroke * streak * 2)) * (0.35 + 0.65 * mids);
        /* granulation: pigment settles into the hollows, only where tone is heavy */
        out *= 1 - gran * (1 - out) * (0.5 - P - tooth * 0.6);
        out *= 1 - rr * (0.55 + 0.45 * (1 - v));
        out *= relief;
        D[i + c] = Math.max(0, Math.min(255, out * 255));
      }
    }
  }
}

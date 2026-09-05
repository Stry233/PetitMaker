import { describe, it, expect } from 'vitest';
import { fnv1a, mulberry32, contentRandom, makeNoise, makeNoise1 } from '../../../../io/stylize/proc/noise';
import {
  hexToRgb, rgbToHex, rgbToOklab, oklabToRgb, hexToLch, lchToHex, lightness, reColor, mixHex,
} from '../../../../io/stylize/proc/oklab';
import { traceMask, chaikin, wobble, ringArea, distanceField, signedDistanceField } from '../../../../io/stylize/proc/geom';
import { validatePalette, valueRange, type PackPalette } from '../../../../io/stylize/proc/palette';

describe('proc/noise — the same seed draws the same picture', () => {
  it('a seeded stream repeats exactly', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 8 }, () => a());
    const second = Array.from({ length: 8 }, () => b());
    expect(first).toEqual(second);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('per-instance variation is seeded from content, so it survives a re-mint of object ids', () => {
    const a = contentRandom('tree-peach', 12, 30, 'crown')();
    const b = contentRandom('tree-peach', 12, 30, 'crown')();
    const elsewhere = contentRandom('tree-peach', 12, 31, 'crown')();
    expect(a).toBe(b);
    expect(a).not.toBe(elsewhere);
  });

  it('fbm stays inside its range and repeats per seed', () => {
    const n1 = makeNoise(7);
    const n2 = makeNoise(7);
    for (let i = 0; i < 40; i++) {
      const v = n1.fbm(i * 0.37, i * 0.11, 4);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBe(n2.fbm(i * 0.37, i * 0.11, 4));
    }
  });

  it('the 1-D field is correlated along its argument rather than independent per sample', () => {
    const f = makeNoise1(3);
    let near = 0;
    let far = 0;
    for (let i = 0; i < 200; i++) {
      near += Math.abs(f(i * 0.01) - f(i * 0.01 + 0.01));
      far += Math.abs(f(i * 0.01) - f(i * 0.01 + 5.13));
    }
    expect(near).toBeLessThan(far);
  });

  it('fnv1a is stable and distinguishes near-identical keys', () => {
    expect(fnv1a('tree-peach|12|30')).toBe(fnv1a('tree-peach|12|30'));
    expect(fnv1a('tree-peach|12|30')).not.toBe(fnv1a('tree-peach|12|31'));
  });
});

describe('proc/oklab — value is authored, not hoped for', () => {
  it('round-trips a colour through OKLab', () => {
    for (const hex of ['#b1e291', '#97e1ff', '#1b7511', '#ffffff', '#000000']) {
      const back = rgbToHex(oklabToRgb(rgbToOklab(hexToRgb(hex))));
      expect(back).toBe(hex.toLowerCase());
    }
  });

  it('measures the defect the packs exist to avoid', () => {
    // The shipped ramp: no value below 0.49, and water lighter than lowland green.
    const greens = ['#b1e291', '#A3D070', '#93c956', '#79c440', '#5cb837', '#4ca42a', '#3e941d', '#298c19', '#1b7511'];
    const darkest = Math.min(...greens.map(lightness));
    expect(darkest).toBeGreaterThan(0.45);
    const waterVsLowland = lightness('#97e1ff') - lightness('#b1e291');
    expect(Math.abs(waterVsLowland)).toBeLessThan(0.05);
  });

  it('reColor restates lightness while keeping hue', () => {
    const moved = reColor('#b1e291', { L: 0.4 });
    expect(lightness(moved)).toBeCloseTo(0.4, 2);
    expect(hexToLch(moved)[2]).toBeCloseTo(hexToLch('#b1e291')[2], 1);
  });

  it('a blend lands at the perceptual midpoint, where an sRGB average does not', () => {
    const a = '#2e5c86';
    const b = '#c89a55';
    const mid = mixHex(a, b, 0.5);
    const wanted = (lightness(a) + lightness(b)) / 2;
    expect(lightness(mid)).toBeCloseTo(wanted, 2);
    // The channel-wise sRGB average of the same pair sits measurably darker than the eye reads.
    const ca = hexToRgb(a);
    const cb = hexToRgb(b);
    const naive = rgbToHex([(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2, (ca[2] + cb[2]) / 2]);
    expect(lightness(naive)).toBeLessThan(wanted);
  });

  it('an out-of-gamut request loses chroma, never lightness', () => {
    const clipped = lchToHex([0.55, 0.5, 1.2]);
    expect(lightness(clipped)).toBeCloseTo(0.55, 1);
  });
});

describe('proc/geom — a mask becomes an outline', () => {
  const box = (w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array => {
    const m = new Uint8Array(w * h);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
    return m;
  };

  it('traces one ring around one region, closed and of the right area', () => {
    const rings = traceMask(box(10, 10, 2, 2, 6, 6), 10, 10);
    expect(rings).toHaveLength(1);
    expect(Math.abs(ringArea(rings[0]!))).toBeCloseTo(16, 5);
  });

  it('traces a hole as its own ring, wound the other way', () => {
    const m = box(12, 12, 1, 1, 11, 11);
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) m[y * 12 + x] = 0;
    const rings = traceMask(m, 12, 12);
    expect(rings).toHaveLength(2);
    const areas = rings.map(ringArea).sort((a, b) => a - b);
    expect(Math.sign(areas[0]!)).not.toBe(Math.sign(areas[1]!));
  });

  it('finds every disjoint region', () => {
    const m = new Uint8Array(20 * 8);
    for (let x = 1; x < 4; x++) for (let y = 1; y < 4; y++) m[y * 20 + x] = 1;
    for (let x = 12; x < 16; x++) for (let y = 2; y < 6; y++) m[y * 20 + x] = 1;
    expect(traceMask(m, 20, 8)).toHaveLength(2);
  });

  it('an empty mask traces nothing', () => {
    expect(traceMask(new Uint8Array(64), 8, 8)).toHaveLength(0);
  });

  it('smoothing preserves the enclosed area to within a corner, and adds vertices', () => {
    const ring = traceMask(box(12, 12, 3, 3, 9, 9), 12, 12)[0]!;
    const smoothed = chaikin(ring, 2);
    expect(smoothed.length).toBeGreaterThan(ring.length);
    expect(Math.abs(ringArea(smoothed))).toBeGreaterThan(Math.abs(ringArea(ring)) * 0.8);
  });

  it('wobble moves points but keeps the ring closed and bounded by its amplitude', () => {
    const ring = chaikin(traceMask(box(20, 20, 4, 4, 16, 16), 20, 20)[0]!, 2);
    const moved = wobble(ring, 0.15, 1.5, makeNoise1(11));
    expect(moved).toHaveLength(ring.length);
    let maxShift = 0;
    for (let i = 0; i < ring.length; i++) {
      maxShift = Math.max(maxShift, Math.hypot(moved[i]![0] - ring[i]![0], moved[i]![1] - ring[i]![1]));
    }
    expect(maxShift).toBeLessThanOrEqual(0.15 + 1e-6);
    expect(maxShift).toBeGreaterThan(0);
  });

  it('zero amplitude is exactly the identity, so a pack can turn the hand off', () => {
    const ring = traceMask(box(8, 8, 2, 2, 6, 6), 8, 8)[0]!;
    expect(wobble(ring, 0, 2, makeNoise1(1))).toBe(ring);
  });

  it('the distance field is exact, not an approximation', () => {
    const m = new Uint8Array(9 * 9);
    m[4 * 9 + 4] = 1;
    const d = distanceField(m, 9, 9);
    expect(d[4 * 9 + 4]).toBeCloseTo(0, 6);
    expect(d[4 * 9 + 7]).toBeCloseTo(3, 6);
    expect(d[1 * 9 + 1]).toBeCloseTo(Math.hypot(3, 3), 6);
  });

  it('the signed field is negative inside and positive outside', () => {
    const m = box(12, 12, 3, 3, 9, 9);
    const s = signedDistanceField(m, 12, 12);
    expect(s[6 * 12 + 6]!).toBeLessThan(0);
    expect(s[0]!).toBeGreaterThan(0);
    expect(s[3 * 12 + 3]!).toBeLessThanOrEqual(0);
  });
});

describe('proc/palette — the value rules a pack must pass', () => {
  // Declared in OKLCh rather than picked by eye, which is the practice the module exists to force.
  const at = (L: number, C: number, hDeg: number): string => lchToHex([L, C, (hDeg * Math.PI) / 180]);
  const sound: PackPalette = {
    paper: at(0.88, 0.03, 88),
    ground: [at(0.755, 0.058, 128), at(0.68, 0.054, 125), at(0.60, 0.05, 122), at(0.52, 0.046, 119)],
    water: at(0.5, 0.05, 245),
    waterDeep: at(0.42, 0.052, 250),
    road: at(0.40, 0.07, 55),
    roadShade: at(0.31, 0.065, 48),
    dark: at(0.28, 0.03, 120),
  };

  it('accepts a sound palette', () => {
    expect(validatePalette(sound)).toEqual([]);
  });

  it('rejects a palette with no real dark', () => {
    const problems = validatePalette({ ...sound, dark: '#8f8f8f' });
    expect(problems.some((p) => p.includes('dark anchor'))).toBe(true);
  });

  it('rejects water that does not clear its ground, the shipped palette defect', () => {
    const problems = validatePalette({ ...sound, water: at(0.74, 0.05, 200) });
    expect(problems.some((p) => p.includes('water clears the dominant ground'))).toBe(true);
  });

  it('checks a RESERVED path by its rim, since the surface is bare substrate by design', () => {
    // A path left unpainted reads by the edge drawn around it: the surface may match its ground.
    const reserved = { ...sound, road: sound.ground[0]!, roadTreatment: 'reserved' as const };
    expect(validatePalette(reserved)).toEqual([]);
    // ...but a rim that does not clear is still a failure, because then nothing carries the path.
    const blunt = { ...reserved, dark: at(0.7, 0.02, 120) };
    expect(validatePalette(blunt).some((p) => p.includes('reserved path rim'))).toBe(true);
  });

  it('rejects a road that lands on a ground value it crosses', () => {
    const problems = validatePalette({ ...sound, road: at(0.745, 0.06, 60) });
    expect(problems.some((p) => p.includes('road clears the dominant ground'))).toBe(true);
  });

  it('rejects a ramp that does not darken monotonically', () => {
    const problems = validatePalette({ ...sound, ground: [at(0.6, 0.05, 122), at(0.7, 0.05, 125), at(0.5, 0.05, 120)] });
    expect(problems.some((p) => p.includes('strictly darkening'))).toBe(true);
  });

  it('reports the span a picture covers', () => {
    const r = valueRange([...sound.ground, sound.water, sound.dark, sound.paper]);
    expect(r.span).toBeGreaterThan(0.4);
  });
});

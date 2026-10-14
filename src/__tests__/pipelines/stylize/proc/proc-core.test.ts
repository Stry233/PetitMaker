import { describe, it, expect } from 'vitest';
import { contentRandom, makeNoise } from '../../../../pipelines/stylize/proc/noise';
import {
  hexToLch, lightness, reColor, mixHex,
} from '../../../../pipelines/stylize/proc/oklab';
import { hexStringToNumber, lerpColor, numberToHexString } from '../../../../core/base/color';
import { validatePalette, type PackPalette } from '../../../../pipelines/stylize/proc/palette';

describe('proc/noise — the same seed draws the same picture', () => {
  it('per-instance variation is seeded from content, so it survives a re-mint of object ids', () => {
    const a = contentRandom('tree-peach', 12, 30, 'crown')();
    const b = contentRandom('tree-peach', 12, 30, 'crown')();
    const elsewhere = contentRandom('tree-peach', 12, 31, 'crown')();
    expect(a).toBe(b);
    expect(a).not.toBe(elsewhere);
    expect(a).toBe(0.35643180669285357);
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
    expect(makeNoise(7).fbm(1.3, 2.7, 4)).toBe(0.8227623580509873);
  });
});

describe('proc/oklab — value is authored, not hoped for', () => {
  it('round-trips a colour through OKLab: a move that restates nothing gives the colour back', () => {
    for (const hex of ['#b1e291', '#97e1ff', '#1b7511', '#ffffff', '#000000']) {
      expect(reColor(hex, {})).toBe(hex.toLowerCase());
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
    const naive = numberToHexString(lerpColor(hexStringToNumber(a), hexStringToNumber(b), 0.5));
    expect(lightness(naive)).toBeLessThan(wanted);
  });

  it('an out-of-gamut request loses chroma, never lightness', () => {
    const clipped = reColor('#808080', { L: 0.55, C: 0.5, h: 1.2 });
    expect(lightness(clipped)).toBeCloseTo(0.55, 1);
  });
});

describe('proc/palette — the value rules a pack must pass', () => {
  // Declared in OKLCh rather than picked by eye, which is the practice the module exists to force.
  const at = (L: number, C: number, hDeg: number): string => reColor('#808080', { L, C, h: (hDeg * Math.PI) / 180 });
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

});

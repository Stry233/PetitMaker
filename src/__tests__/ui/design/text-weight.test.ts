import { describe, it, expect } from 'vitest';
import { TEXT_ROLES, isDenseScript, readableWeight, roleFont, roleWeight, weightVars } from '../../../ui/design/text-weight';

/** The weights the shipped faces draw, and the 1x CSS-px size each heavier rung needs. */
const HEAVY = 900, BOLD = 700, MEDIUM = 500, REGULAR = 400;
const HEAVY_MIN = 24, BOLD_MIN = 16, MEDIUM_MIN = 12;
/** Display density adds at most this factor; dense scripts need this many px more per rung. */
const MAX_DENSITY_GAIN = 1.4, DENSE_BUMP = 2;
const weightVar = (role: string) => `--fw-${role}`;

describe('readableWeight', () => {
  it.each([1, 2, 3])('keeps tiny labels light at %sx display density', dpr => {
    for (const dense of [false, true]) {
      expect(readableWeight(900, 8, dense, dpr)).toBe(REGULAR);
      expect(readableWeight(800, 10, dense, dpr)).toBeLessThanOrEqual(MEDIUM);
      expect(readableWeight(900, 28, dense, dpr)).toBe(HEAVY);
    }
  });

  it('keeps midsize Retina labels bold while prose retains its intended medium weight', () => {
    for (const dense of [false, true]) {
      expect(readableWeight(800, 13, dense, 2)).toBe(BOLD);
      expect(readableWeight(700, 14, dense, 2)).toBe(BOLD);
      expect(readableWeight(500, 14, dense, 2)).toBe(MEDIUM);
      expect(readableWeight(900, 24, dense, 2)).toBe(HEAVY);
    }
    expect(readableWeight(800, 13)).toBe(MEDIUM);
    expect(readableWeight(800, 12, true, 2)).toBe(MEDIUM);
  });

  it('caps the density allowance instead of treating tiny Retina text as a large heading', () => {
    expect(readableWeight(900, 10, false, 2)).toBe(MEDIUM);
    for (const size of [10, 13, 16, 20, 24]) {
      expect(readableWeight(900, size, false, 3)).toBe(readableWeight(900, size * MAX_DENSITY_GAIN));
    }
  });

  it.each([
    [MEDIUM_MIN, MEDIUM, REGULAR],
    [BOLD_MIN, BOLD, MEDIUM],
    [HEAVY_MIN, HEAVY, BOLD],
  ])('reduces weight immediately below the %spx boundary', (size, at, below) => {
    expect(readableWeight(HEAVY, size)).toBe(at);
    expect(readableWeight(HEAVY, size - 0.1)).toBe(below);
    expect(readableWeight(HEAVY, size + DENSE_BUMP, true)).toBe(at);
    expect(readableWeight(HEAVY, size + DENSE_BUMP - 0.1, true)).toBe(below);
  });

  it('also accounts for lost raster resolution below 1x density', () => {
    expect(readableWeight(900, 24, false, 0.4)).toBe(REGULAR);
    expect(readableWeight(900, 24, false, 1)).toBe(HEAVY);
  });

  it('never adds weight to a lighter nominal', () => {
    for (const nominal of [300, REGULAR, MEDIUM, 600, BOLD, 800, HEAVY]) {
      for (const size of [8, 12, 16, 20, 28, 40]) {
        expect(readableWeight(nominal, size)).toBeLessThanOrEqual(nominal);
      }
    }
    expect(readableWeight(400, 4)).toBe(400);
    expect(readableWeight(500, 4)).toBe(REGULAR);
  });

  it('never makes larger text lighter', () => {
    for (const dense of [false, true]) {
      let last = 0;
      for (let px = 1; px <= 40; px += 0.5) {
        const weight = readableWeight(900, px, dense);
        expect(weight).toBeGreaterThanOrEqual(last);
        last = weight;
      }
    }
  });
});

describe('isDenseScript', () => {
  it('gives CJK strokes and Thai marks more room', () => {
    for (const locale of ['zh', 'ja', 'th'] as const) expect(isDenseScript(locale)).toBe(true);
    for (const locale of ['en', 'ru', 'id', 'fr'] as const) expect(isDenseScript(locale)).toBe(false);
  });
});

describe('the role table', () => {
  it('keeps authored sizes above the shared text floor', () => {
    for (const [name, role] of Object.entries(TEXT_ROLES)) expect(role.px, name).toBeGreaterThanOrEqual(12);
    expect(TEXT_ROLES.caption.px).toBe(12);
    expect(TEXT_ROLES.small.px).toBe(12);
  });

  it('shares each role weight between styles and its custom property', () => {
    expect(roleWeight('chip')).toBe(`var(--fw-chip, ${TEXT_ROLES.chip.weight})`);
    expect(weightVar('title')).toBe('--fw-title');
    expect(roleFont('action')).toEqual({ fontSize: TEXT_ROLES.action.px, fontWeight: roleWeight('action') });
  });

  it('uses actual surface zoom for every role on both standard and Retina displays', () => {
    for (const dense of [false, true]) for (const zoom of [0.6, 1, 1.25, 1.8]) for (const dpr of [1, 2]) {
      const standard = weightVars(zoom, dpr, dense) as Record<string, string>;
      for (const role of Object.keys(TEXT_ROLES) as (keyof typeof TEXT_ROLES)[]) {
        expect(standard[weightVar(role)]).toBe(String(readableWeight(TEXT_ROLES[role].weight, TEXT_ROLES[role].px * zoom, dense, dpr)));
      }
    }
  });

  it('keeps small-scale captions light without flattening the title', () => {
    const small = weightVars(0.6, 2, false) as Record<string, string>;
    expect(small['--fw-small']).toBe('400');
    expect(small['--fw-label']).toBe('400');
    expect(small['--fw-title']).toBe('700');
    expect((weightVars(1, 2, false) as Record<string, string>)['--fw-title']).toBe('900');
  });
});

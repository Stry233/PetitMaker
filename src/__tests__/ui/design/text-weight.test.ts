/*
 * The weight ladder's arithmetic: the terms a device pixel is built from, the two floors, the dense
 * bump, and the roles that ride them.
 *
 * The floors themselves come from rendered specimens (see `ui/design/text-weight.ts`); what is
 * pinned here is that the answer is driven by the SIZE ON THE GLASS rather than by any one of the
 * factors that produce it, since that is the property the previous scale-keyed answer lacked.
 */
import { describe, it, expect } from 'vitest';
import {
  BOLD, BOLD_MIN, DENSE_BUMP, HEAVY, HEAVY_MIN, MEDIUM, TEXT_FLOOR, TEXT_ROLES,
  isDenseScript, readableWeight, roleFont, roleWeight, textDevicePx, weightVar, weightVars,
} from '../../../ui/design/text-weight';

describe('textDevicePx', () => {
  it('multiplies the css size by the surface zoom and the display ratio', () => {
    expect(textDevicePx(12, 1, 1)).toBe(12);
    // The frame draws at units.ts:ZOOM (1.25) times the factor the chrome rides, so one authored
    // number lands larger inside the frame than in a modal.
    expect(textDevicePx(12, 1.25, 1)).toBe(15);
    // A hi-dpi display buys pixels back: the same 12 css px resolves like 24.
    expect(textDevicePx(12, 1, 2)).toBe(24);
  });

  it('reads a shrunk window and a hi-dpi screen through the same product', () => {
    // 1366x768 (frameFit 0.96) at dpr 1 and the reference window at dpr 0.96 are one answer.
    expect(textDevicePx(12, 0.96, 1)).toBeCloseTo(textDevicePx(12, 1, 0.96));
  });
});

describe('readableWeight', () => {
  it('leaves a nominal weight standing at a comfortable size', () => {
    expect(readableWeight(900, 24)).toBe(900);
    expect(readableWeight(800, HEAVY_MIN)).toBe(800);
    expect(readableWeight(700, BOLD_MIN)).toBe(700);
  });

  it('steps a heavy weight down to bold under the heavy floor', () => {
    expect(readableWeight(900, HEAVY_MIN - 0.5)).toBe(BOLD);
    expect(readableWeight(800, HEAVY_MIN - 0.5)).toBe(BOLD);
  });

  it('steps down again to medium under the bold floor', () => {
    expect(readableWeight(900, BOLD_MIN - 0.5)).toBe(MEDIUM);
    expect(readableWeight(700, BOLD_MIN - 0.5)).toBe(MEDIUM);
  });

  it('never pushes below medium, and passes a light nominal through untouched', () => {
    expect(readableWeight(MEDIUM, 4)).toBe(MEDIUM);
    expect(readableWeight(400, 4)).toBe(400);
    expect(readableWeight(900, 0.1)).toBe(MEDIUM);
  });

  it('holds the dense floors DENSE_BUMP higher, since a CJK glyph fills its em', () => {
    const between = HEAVY_MIN + DENSE_BUMP - 0.5;
    expect(readableWeight(900, between, false)).toBe(HEAVY);
    expect(readableWeight(900, between, true)).toBe(BOLD);
    expect(readableWeight(700, BOLD_MIN + DENSE_BUMP - 0.5, false)).toBe(BOLD);
    expect(readableWeight(700, BOLD_MIN + DENSE_BUMP - 0.5, true)).toBe(MEDIUM);
  });

  it('is monotone: a bigger size never asks for a lighter weight', () => {
    for (const dense of [false, true]) {
      let last = 0;
      for (let px = 1; px <= 30; px += 0.5) {
        const w = readableWeight(900, px, dense);
        expect(w).toBeGreaterThanOrEqual(last);
        last = w;
      }
    }
  });

  it('answers the reported window: a modal keeps its title and drops a CJK chip', () => {
    // 1918x869 maximized on a 1080p screen: frameFit 1 and dpr 1, so a chrome size IS its device
    // size and the table's px can be passed straight in.
    expect(readableWeight(900, TEXT_ROLES.title.px, true)).toBe(900);
    // A 13px pill is under the dense heavy floor but over the dense bold one.
    expect(readableWeight(800, TEXT_ROLES.chip.px, true)).toBe(BOLD);
    // The same pill in a Latin locale stands at its nominal, which is the Heavy face already.
    expect(readableWeight(800, TEXT_ROLES.chip.px, false)).toBe(800);
    // The frame's own small print rides ZOOM 1.25, which is what keeps the main UI heavy there: the
    // same 12 px that a modal must lighten stands untouched inside the frame.
    expect(readableWeight(800, TEXT_FLOOR, true)).toBe(BOLD);
    expect(readableWeight(800, textDevicePx(TEXT_FLOOR, 1.25, 1), true)).toBe(800);
  });
});

describe('isDenseScript', () => {
  it('names the em-filling scripts and nothing else', () => {
    expect(isDenseScript('zh')).toBe(true);
    expect(isDenseScript('ja')).toBe(true);
    for (const l of ['en', 'ru', 'th', 'id', 'fr'] as const) expect(isDenseScript(l)).toBe(false);
  });
});

describe('the role table', () => {
  it('sets nothing below the floor, which is the interface small-print size', () => {
    expect(TEXT_FLOOR).toBe(12);
    for (const [name, role] of Object.entries(TEXT_ROLES)) {
      expect(role.px, name).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }
  });

  it('carries the nominal weight as the var fallback, so an unpublished surface is unchanged', () => {
    expect(roleWeight('chip')).toBe(`var(--fw-chip, ${TEXT_ROLES.chip.weight})`);
    expect(weightVar('title')).toBe('--fw-title');
    expect(roleFont('action')).toEqual({
      fontSize: TEXT_ROLES.action.px,
      fontWeight: `var(--fw-action, ${TEXT_ROLES.action.weight})`,
    });
  });

  it('resolves every role into its own custom property', () => {
    const vars = weightVars(1, 1, false) as Record<string, string>;
    for (const role of Object.keys(TEXT_ROLES) as (keyof typeof TEXT_ROLES)[]) {
      expect(vars[weightVar(role)]).toBe(String(readableWeight(
        TEXT_ROLES[role].weight, TEXT_ROLES[role].px, false)));
    }
  });

  it('lightens the small roles as a surface shrinks, and never the title', () => {
    const roomy = weightVars(1, 1, true) as Record<string, string>;
    // FIT_FLOOR: the smallest a window can drive the chrome to.
    const tight = weightVars(0.6, 1, true) as Record<string, string>;
    expect(Number(tight['--fw-small'])).toBeLessThan(Number(roomy['--fw-small']));
    // A title is set large enough that no window in range can take it under the heavy floor, so the
    // adaptation is invisible where the design is already comfortable.
    expect(roomy['--fw-title']).toBe('900');
    expect(tight['--fw-title']).toBe('900');
  });
});

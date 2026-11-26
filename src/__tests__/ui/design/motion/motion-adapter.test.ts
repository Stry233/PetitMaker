import { describe, expect, it } from 'vitest';
import { arrangementFadeCss, arrangementFades, cssMotion, fadeShares, framerMotion, outMotion, seconds, travelSeconds } from '../../../../ui/design/motion';
import { CSS_CURVES, bezierOf, springs } from '../../../../ui/design/motion/curves';
import { DURATIONS } from '../../../../ui/design/motion/durations';

/** A damped spring's travel from 0 to 1 at `t` seconds, released from rest. */
function springAt({ stiffness, damping, mass }: { stiffness: number; damping: number; mass: number }, t: number): number {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t));
}

/** A CSS cubic-bezier's progress at time share `u`, solved along x by bisection. */
function bezierAt([x1, y1, x2, y2]: readonly number[], u: number): number {
  const along = (a: number, b: number, s: number) => 3 * (1 - s) ** 2 * s * a + 3 * (1 - s) * s * s * b + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (along(x1!, x2!, mid) < u) lo = mid; else hi = mid;
  }
  return along(y1!, y2!, (lo + hi) / 2);
}

describe('shared motion adapters', () => {
  it('preserves spring physics and rejects an implicit fixed-duration conversion', () => {
    expect(framerMotion('mode.plate.arrive').type).toBe('spring');
    expect(outMotion('mode.plate.arrive').duration).toBeUndefined();
    expect(() => seconds('mode.plate.arrive')).toThrow('spring');
    expect(() => cssMotion('mode.plate.arrive', ['transform'])).toThrow('spring');
  });

  it('removes travel for timed and physical transitions under reduced motion', () => {
    for (const id of ['modal.resize', 'mode.plate.arrive'] as const) {
      expect(framerMotion(id, true)).toEqual({ duration: 0 });
      expect(cssMotion(id, ['transform'], true)).toBe('none');
    }
  });
});

describe('the CSS twin of a spring curve', () => {
  it('follows the stiff spring over its settle, so a CSS transition on it moves as the Framer one does', () => {
    const settle = DURATIONS.quick;
    const css = CSS_CURVES.stiff.slice('cubic-bezier('.length, -1).split(',').map(Number);
    let worst = 0;
    for (let i = 0; i <= 50; i++) worst = Math.max(worst, Math.abs(bezierAt(css, i / 50) - springAt(springs.stiff, (i / 50) * settle)));
    expect(worst).toBeLessThan(0.025);
    // And it does not overshoot, since the spring does not visibly either.
    for (let i = 0; i <= 50; i++) expect(bezierAt(css, i / 50)).toBeLessThanOrEqual(1);
  });
});

describe('a re-arrangement\'s fades of what only one arrangement shows', () => {
  const ID = 'shell.row.fade' as const;
  const shares = fadeShares(ID);

  it('fades out by the travel\'s outShare and in from its inAt, read off the travel\'s own progress', () => {
    const { in: arrive, out: leave } = arrangementFades(ID);
    const curve = bezierOf('punchy');
    const d = seconds(ID);
    const [inAt, inFor, outFor] = [arrive.delay as number, arrive.duration as number, leave.duration as number];
    // Where the travel stands as each fade ends or starts.
    expect(bezierAt(curve, outFor / d)).toBeCloseTo(shares.out, 2);
    expect(bezierAt(curve, inAt / d)).toBeCloseTo(shares.in, 2);
    expect(inAt + inFor).toBeCloseTo(d);
    // At every moment each fade has gone the share of its own span the travel has gone, as the morph's
    // keyframed fades do, rather than running the travel's whole curve again inside its span.
    for (let i = 0; i <= 20; i++) {
      const out = (i / 20) * outFor, into = inAt + (i / 20) * inFor;
      expect(bezierAt(leave.ease as unknown as number[], out / outFor)).toBeCloseTo(bezierAt(curve, out / d) / shares.out, 2);
      expect(bezierAt(arrive.ease as unknown as number[], (into - inAt) / inFor)).toBeCloseTo((bezierAt(curve, into / d) - shares.in) / (1 - shares.in), 2);
    }
    const css = (ease: unknown) => `cubic-bezier(${(ease as number[]).join(', ')})`;
    expect(arrangementFadeCss(ID, true, ['opacity'])).toBe(`opacity ${inFor}s ${css(arrive.ease)} ${inAt}s`);
    expect(arrangementFadeCss(ID, false, ['opacity'])).toBe(`opacity ${outFor}s ${css(leave.ease)}`);
    expect(arrangementFades(ID, true)).toEqual({ in: { duration: 0 }, out: { duration: 0 } });
    expect(travelSeconds(ID, 1)).toBeCloseTo(d);
  });
});

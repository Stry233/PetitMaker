import { describe, expect, it } from 'vitest';
import { cssMotion, framerMotion, outMotion, seconds } from '../../../../ui/design/motion';
import { CSS_CURVES } from '../../../../ui/design/motion/curves';
import { bezierOf, springs } from '../../../../ui/design/styles';

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
  it('follows the gentle spring over its settle, overshoot included', () => {
    const settle = 0.5;
    const css = CSS_CURVES.gentle.slice('cubic-bezier('.length, -1).split(',').map(Number);
    let worst = 0;
    for (let i = 0; i <= 50; i++) worst = Math.max(worst, Math.abs(bezierAt(css, i / 50) - springAt(springs.gentle, (i / 50) * settle)));
    expect(worst).toBeLessThan(0.025);
    // The fast-arrival tween it stood in for strays far further from the spring.
    let punchy = 0;
    for (let i = 0; i <= 50; i++) punchy = Math.max(punchy, Math.abs(bezierAt(bezierOf('punchy'), i / 50) - springAt(springs.gentle, (i / 50) * settle)));
    expect(punchy).toBeGreaterThan(0.1);
  });
});

/**
 * face.test.ts — the closed-eye lid COVERS the eye it is drawn over.
 *
 * A GEOMETRY TEST, and it has to be: jsdom has no layout, so the only checkable statement about a lid
 * is the relationship between the two boxes. The lid is an ellipse inscribed in its box and the dot is
 * an ellipse inscribed in its own, so "covers" means every point of the dot's boundary lies inside the
 * lid's — which is what is sampled below, rather than the weaker claim that one box contains the other
 * (two ellipses in nested boxes still cross where their aspects differ).
 */
import { describe, it, expect } from 'vitest';
import { ART, EYE_DOTS, LID_LASH, LID_MARGIN, lashWidth, lidBox } from '../../../ui/agent/character/face';

/** Whether the point sits inside the ellipse inscribed in `box`, in percent space. */
function insideLid(box: { left: number; top: number; width: number; height: number }, x: number, y: number): number {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const a = box.width / 2;
  const b = box.height / 2;
  return ((x - cx) / a) ** 2 + ((y - cy) / b) ** 2;
}

describe('the closed-eye lid', () => {
  for (const side of ['l', 'r'] as const) {
    it(`covers the ${side} eye dot's whole boundary`, () => {
      const dot = EYE_DOTS[side];
      const lid = lidBox(dot);
      const cx = (dot.x + dot.w / 2) / ART.w * 100;
      const cy = (dot.y + dot.h / 2) / ART.h * 100;
      const rx = dot.w / 2 / ART.w * 100;
      const ry = dot.h / 2 / ART.h * 100;
      let worst = 0;
      for (let i = 0; i < 720; i += 1) {
        const th = (i / 720) * Math.PI * 2;
        const at = insideLid(lid, cx + rx * Math.cos(th), cy + ry * Math.sin(th));
        if (at > worst) worst = at;
      }
      // 1 is the lid's own edge; the dot's furthest point must be strictly inside it, and the margin
      // says by how much (1 / 1.18^2).
      expect(worst).toBeLessThan(1);
      expect(worst).toBeCloseTo(1 / LID_MARGIN ** 2, 4);
    });

    it(`is centred on the ${side} eye dot, so no crescent can show on one side`, () => {
      const dot = EYE_DOTS[side];
      const lid = lidBox(dot);
      expect(lid.left + lid.width / 2).toBeCloseTo((dot.x + dot.w / 2) / ART.w * 100, 6);
      expect(lid.top + lid.height / 2).toBeCloseTo((dot.y + dot.h / 2) / ART.h * 100, 6);
    });
  }

  /** The whole reason the box is stated as a border box: the lash must not push the oval down. */
  it('scales its lash with the drawing rather than holding a flat px', () => {
    const big = lashWidth(240);
    const small = lashWidth(56);
    expect(big / small).toBeCloseTo(240 / 56, 3);
    // At the standard 72px character size, the lash is approximately 2px.
    expect(lashWidth(72)).toBeCloseTo(2, 0);
    expect(LID_LASH).toBeLessThan(0.5);
  });

  it('never draws a lash thinner than a line', () => {
    expect(lashWidth(8)).toBe(1);
  });
});

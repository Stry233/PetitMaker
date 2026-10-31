// @vitest-environment jsdom
/**
 * Framer rewrites a projected px corner as a percentage of the box in page px, which the browser
 * resolves against the element's zoomed box, leaving the corner `1 / zoom` short during a layout
 * animation. The corrector keeps a declared element's corner constant at every scale and leaves an
 * undeclared one to Framer's arithmetic.
 */
import { describe, it, expect } from 'vitest';
import { scaleCorrectors } from 'framer-motion';
import { frameZoomAttr } from '../../../ui/design/motion/zoom-corrected-radius';

const CORNERS = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'];
/** The corrector the module installs in Framer for the shorthand. */
const correctRadius = scaleCorrectors.borderRadius!.correct as unknown as (latest: string | number, node: object) => string | number;

/** A projection node as the corrector reads it: the projected box in page px and its element. */
function node(scale: number, zoom?: number) {
  const el = document.createElement('div');
  if (zoom !== undefined) {
    for (const [k, v] of Object.entries(frameZoomAttr(zoom))) el.setAttribute(k, String(v));
  }
  // The element's layout box is 200 of its own px.
  const pageWidth = 200 * (zoom ?? 1) * scale;
  return { instance: el, target: { x: { min: 0, max: pageWidth }, y: { min: 0, max: pageWidth } } };
}

/** The drawn corner in page px: the percentage of the 200 px box, scaled by projection and zoom. */
function drawn(corrected: string | number, scale: number, zoom: number): number {
  const percent = parseFloat(String(corrected));
  return (percent / 100) * 200 * scale * zoom;
}

describe('a corner that is being projected inside a zoomed frame', () => {
  const ZOOM = 1.25;

  it('is installed for the shorthand and every longhand corner', () => {
    expect(scaleCorrectors.borderRadius!.applyTo).toEqual(CORNERS);
    for (const corner of CORNERS) expect(scaleCorrectors[corner]!.correct, corner).toBe(scaleCorrectors.borderRadius!.correct);
  });

  it('draws the same physical corner at every scale, identity included', () => {
    const drawnAt = (scale: number) => drawn(correctRadius(20, node(scale, ZOOM)), scale, ZOOM);
    // 20 frame px is 25 page px at every scale.
    for (const scale of [0.55, 0.8, 1, 1.4, 1.82]) {
      expect(drawnAt(scale), `at scale ${scale}`).toBeCloseTo(20 * ZOOM, 6);
    }
  });

  /** At identity Framer writes the authored px straight through, so the corrector must agree. */
  it('agrees at identity with the value Framer writes when it corrects nothing', () => {
    expect(drawn(correctRadius(20, node(1, ZOOM)), 1, ZOOM)).toBeCloseTo(20 * ZOOM, 6);
  });

  it('leaves an element that declares no zoom exactly where Framer had it', () => {
    expect(correctRadius(20, node(1))).toBe('10% 10%');
    expect(correctRadius('20px', node(1))).toBe('10% 10%');
  });

  it('passes through anything that is not a pixel length', () => {
    expect(correctRadius('50%', node(0.5, ZOOM))).toBe('50%');
    expect(correctRadius('1em', node(0.5, ZOOM))).toBe('1em');
  });

  it('says nothing about a box with no width rather than dividing by it', () => {
    const flat = { instance: document.createElement('div'), target: { x: { min: 8, max: 8 }, y: { min: 0, max: 100 } } };
    expect(correctRadius(20, flat)).toBe('0% 20%');
  });
});

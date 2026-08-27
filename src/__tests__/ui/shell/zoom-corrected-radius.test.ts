/**
 * THE CORNER OF A PROJECTED BOX, AND THE ONE UNIT MISMATCH UNDER IT.
 *
 * Framer rewrites a px corner as a percentage of the box it is projecting, measured in PAGE px; the
 * browser then resolves that percentage against the element's own box, which inside the frame is
 * drawn under a zoom. The two are different units, so the drawn corner comes out `1 / zoom` short
 * for as long as a layout animation runs and returns to its authored size the frame it stops —
 * which is a jump at the end of the move.
 *
 * What is asserted here is the property that makes the jump impossible rather than rare: for a
 * DECLARED element the same authored number describes the same physical corner at every projection
 * scale, IDENTITY INCLUDED, so whatever frame Framer stops correcting on there is nothing to see.
 * And an element that declares nothing gets Framer's own arithmetic to the digit, since replacing a
 * library's conversion for one panel must not move anyone else's corner.
 */
import { describe, it, expect } from 'vitest';
import { correctRadius, frameZoomAttr } from '../../../ui/shell/motion/zoom-corrected-radius';

/** A projection node as the corrector sees one: the box being projected, in page px, and the
 *  element it belongs to. `scale` is what the projection is applying at this instant. */
function node(scale: number, zoom?: number) {
  const el = document.createElement('div');
  if (zoom !== undefined) {
    for (const [k, v] of Object.entries(frameZoomAttr(zoom))) el.setAttribute(k, String(v));
  }
  // The element's own layout box is 200 of its px; the projected box is that box in page px, times
  // whatever the projection is scaling it by right now.
  const pageWidth = 200 * (zoom ?? 1) * scale;
  return { instance: el, target: { x: { min: 0, max: pageWidth }, y: { min: 0, max: pageWidth } } };
}

/** What the corner actually DRAWS, in page px: the percentage resolved against the element's own
 *  200 px box, then scaled by the projection and by the zoom, which is what reaches the screen. */
function drawn(corrected: string | number, scale: number, zoom: number): number {
  const percent = parseFloat(String(corrected));
  return (percent / 100) * 200 * scale * zoom;
}

describe('a corner that is being projected inside a zoomed frame', () => {
  const ZOOM = 1.25;

  it('draws the same physical corner at every scale, identity included', () => {
    const drawnAt = (scale: number) => drawn(correctRadius(20, node(scale, ZOOM)), scale, ZOOM);
    // 20 of the frame's px is 25 of the page's, and that is what has to reach the screen whether
    // the box is halfway through shrinking, halfway through growing, or exactly where it landed.
    for (const scale of [0.55, 0.8, 1, 1.4, 1.82]) {
      expect(drawnAt(scale), `at scale ${scale}`).toBeCloseTo(20 * ZOOM, 6);
    }
  });

  /** The frame at rest is the same fact from the other side: Framer skips the conversion when the
   *  projected transform is identity and writes the authored px straight through, so the two ways
   *  of arriving at the resting frame have to agree. */
  it('agrees at identity with the value Framer writes when it corrects nothing', () => {
    expect(drawn(correctRadius(20, node(1, ZOOM)), 1, ZOOM)).toBeCloseTo(20 * ZOOM, 6);
  });

  it('leaves an element that declares no zoom exactly where Framer had it', () => {
    // Framer's own arithmetic: the radius as a percentage of the projected box, no factor at all.
    expect(correctRadius(20, node(1))).toBe('10% 10%');
    expect(correctRadius('20px', node(1))).toBe('10% 10%');
  });

  /** A percentage is already relative to the box, and any other unit is one this cannot reason
   *  about: both are the author's and are handed back untouched. */
  it('passes through anything that is not a pixel length', () => {
    expect(correctRadius('50%', node(0.5, ZOOM))).toBe('50%');
    expect(correctRadius('1em', node(0.5, ZOOM))).toBe('1em');
  });

  it('says nothing about a box with no width rather than dividing by it', () => {
    const flat = { instance: document.createElement('div'), target: { x: { min: 8, max: 8 }, y: { min: 0, max: 100 } } };
    expect(correctRadius(20, flat)).toBe('0% 20%');
  });
});

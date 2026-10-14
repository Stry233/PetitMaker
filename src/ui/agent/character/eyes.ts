/*
 * The eye positions in the drawing and the closed-eye lid derived from them. `EYE_DOTS` are the dots'
 * bounding boxes measured off the shipped PNG, in art pixels. The lid's box is its border box with
 * the lash as a share of it, so it covers the dot at every rendered size, and `LID_MARGIN` keeps it
 * strictly larger than the dot in both axes.
 */

/** `base.png`'s own pixel dimensions, which every box here is a fraction of. */
const ART = { w: 235, h: 230 } as const;

/** A box in the art's own pixels. */
interface ArtBox { x: number; y: number; w: number; h: number }

/**
 * The two eye dots' bounds in `base.png`. She is drawn three-quarters on, so the far eye sits both
 * right of and below the near one; the two boxes are the same size because the dots are.
 */
export const EYE_DOTS: Record<'l' | 'r', ArtBox> = {
  l: { x: 75, y: 92, w: 17, h: 16 },
  r: { x: 149, y: 119, w: 17, h: 16 },
};

/** How much larger than the dot the lid oval is drawn, per axis. Enough that the dot's anti-aliased
 *  rim and a sub-pixel rounding at the smallest size she renders at are both inside it, and little
 *  enough that the closed eye still reads as an eyelid rather than a patch of fur. */
const LID_MARGIN = 1.18;

/** The lash's share of the lid height, kept proportional at every rendered size. */
const LID_LASH = 0.3;

/** A box as the percentages a CSS `position: absolute` child of the drawing takes. */
interface PctBox { left: number; top: number; width: number; height: number }

/**
 * The lid's border box for one eye: the dot's own box grown by `LID_MARGIN` about its centre, in
 * percent of the drawing. `Character.tsx` sets `box-sizing: border-box` from this, so what is stated
 * here is the oval that gets painted.
 */
export function lidBox(eye: ArtBox): PctBox {
  const w = eye.w * LID_MARGIN;
  const h = eye.h * LID_MARGIN;
  return {
    left: ((eye.x + eye.w / 2) - w / 2) / ART.w * 100,
    top: ((eye.y + eye.h / 2) - h / 2) / ART.h * 100,
    width: w / ART.w * 100,
    height: h / ART.h * 100,
  };
}

/** The lash's width in css px for a drawing rendered `size` px wide, never below the one device-ish
 *  pixel that keeps it a line rather than nothing. */
export function lashWidth(size: number): number {
  return Math.max(1, lidBox(EYE_DOTS.l).height / 100 * (size * ART.h / ART.w) * LID_LASH);
}

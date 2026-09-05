/*
 * face.ts — where her eyes ARE in the drawing, and the closed-eye lid derived from it.
 *
 * THE LID IS NOT ART: it is one oval per eye, drawn over `base.png` and grown out of `scaleY(0)` when
 * she closes her eyes (`Character.tsx`). It only covers the eye if its own box
 * is stated in the SAME space the eye is drawn in, and that is what `EYE_DOTS` is: the two dots'
 * bounding boxes measured off the shipped PNG's own pixels (every pixel darker than the fur at the
 * dot's soft rim, flood-filled so the head outline stays a separate blob), in the art's pixels.
 *
 * TWO THINGS MAKE A LID THAT ONLY ALMOST COVERS, and both are about mixing spaces:
 *
 * - A BORDER IN CSS PX INSIDE A BOX IN PERCENT. The lash is a bottom border, and a `content-box`
 *   element's border is ADDED below its declared height — so a lid stated as 6.5% of the art plus a
 *   flat 2px lash is 6.5% tall on a large drawing and 10.2% tall on a small one, with its centre
 *   dropping by half the difference. At the desk seat that put the oval a whole css pixel below the
 *   dot and left the dot's upper rim standing as a dark ring around it. The box below is therefore
 *   the BORDER box, and the lash is a SHARE of it, so the oval is the same oval at every size the
 *   drawing is rendered at (collapsed block, desk seat, either end of the UI zoom).
 * - AN OVAL THE SIZE OF WHAT IT COVERS. Two ellipses of the same box are the same ellipse: any
 *   difference in aspect or centre then shows as a crescent. `LID_MARGIN` is what makes the lid
 *   strictly larger than the dot in both axes, which is what "covers" means for an ellipse.
 */

/** `base.png`'s own pixel dimensions, which every box here is a fraction of. */
export const ART = { w: 235, h: 230 } as const;

/** A box in the art's own pixels. */
export interface ArtBox { x: number; y: number; w: number; h: number }

/**
 * The two eye dots' bounds in `base.png`. She is drawn three-quarters on, so the far eye sits both
 * right of and BELOW the near one; the two boxes are the same size because the dots are.
 */
export const EYE_DOTS: Record<'l' | 'r', ArtBox> = {
  l: { x: 75, y: 92, w: 17, h: 16 },
  r: { x: 149, y: 119, w: 17, h: 16 },
};

/** How much larger than the dot the lid oval is drawn, per axis. Enough that the dot's anti-aliased
 *  rim and a sub-pixel rounding at the smallest size she renders at are both inside it, and little
 *  enough that the closed eye still reads as an eyelid rather than a patch of fur. */
export const LID_MARGIN = 1.18;

/** The lash's share of the lid height, kept proportional at every rendered size. */
export const LID_LASH = 0.3;

/** A box as the percentages a CSS `position: absolute` child of the drawing takes. */
export interface PctBox { left: number; top: number; width: number; height: number }

/**
 * The lid's BORDER box for one eye: the dot's own box grown by `LID_MARGIN` about its centre, in
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

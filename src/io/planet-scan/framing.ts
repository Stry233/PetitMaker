import { SCAN_PROFILE } from './profile';

/**
 * Where a decoded picture of `width` x `height` lands in the scan's frame: the game's view (the
 * largest rectangle of the view's aspect centred in the picture, `SCAN_PROFILE.view`) falls where
 * the calibrated frame holds it, at one uniform scale. A recording of the game window alone, of a
 * screen of another shape or of a wider canvas around the game therefore reads like the reference
 * recordings; the scan's frame outside the picture stays black. `x` and `y` are the picture's top
 * left corner in frame pixels, `scale` the frame pixels a picture pixel spans.
 */
export function placePicture(width: number, height: number): { x: number; y: number; scale: number } {
  const { frame, view } = SCAN_PROFILE;
  const fit = (w: number, h: number) => (w / h >= view.aspect ? { w: h * view.aspect, h } : { w, h: w / view.aspect });
  const source = fit(width, height);
  const target = fit(frame.width, frame.height);
  const scale = target.w / source.w;
  return {
    x: (frame.width - target.w) / 2 - ((width - source.w) / 2) * scale,
    y: (frame.height - target.h) / 2 - ((height - source.h) / 2) * scale,
    scale,
  };
}

/** Whether a picture of this shape is one the placement is known to read: the game's view alone,
 *  or a 16:9 screen around it. */
export function familiarShape(width: number, height: number): boolean {
  const aspect = width / height;
  return [SCAN_PROFILE.view.aspect, 16 / 9].some((a) => Math.abs(Math.log(aspect / a)) < SCAN_PROFILE.view.shapeTolerance);
}

/**
 * Placing a decoded picture in the scan's frame: the game's 16:10 view lands where the calibrated
 * 16:9 frame holds it whatever the picture's shape, and a 16:9 recording maps onto the whole frame.
 */
import { describe, expect, it } from 'vitest';
import { familiarShape, placePicture } from '../../../io/planet-scan/framing';
import { SCAN_PROFILE } from '../../../io/planet-scan/profile';

const { width: FW, height: FH } = SCAN_PROFILE.frame;
/** The view's rectangle in frame pixels for a picture whose view is the centred 16:10 fit. */
function viewIn(width: number, height: number) {
  const at = placePicture(width, height);
  const a = SCAN_PROFILE.view.aspect;
  const w = width / height >= a ? height * a : width;
  const h = w / a;
  return { x: at.x + ((width - w) / 2) * at.scale, y: at.y + ((height - h) / 2) * at.scale, w: w * at.scale, h: h * at.scale };
}

describe('placing a picture in the scan\'s frame', () => {
  it('maps a 16:9 recording onto the whole frame', () => {
    expect(placePicture(1920, 1080)).toEqual({ x: 0, y: 0, scale: FW / 1920 });
    expect(placePicture(3840, 2160)).toEqual({ x: 0, y: 0, scale: FW / 3840 });
  });

  it('puts the view of the game window, a 16:10 screen, a 21:9 screen and a 4:3 screen where the reference holds it', () => {
    const reference = viewIn(1920, 1080);
    expect(reference).toEqual({ x: 48, y: 0, w: 864, h: FH });
    for (const [w, h] of [[1728, 1080], [1920, 1200], [2560, 1080], [1600, 1200], [1280, 800]] as const) {
      const v = viewIn(w, h);
      for (const k of ['x', 'y', 'w', 'h'] as const) expect(v[k]).toBeCloseTo(reference[k], 9);
    }
  });

  it('knows the game\'s view and 16:9 screens as familiar shapes', () => {
    expect([familiarShape(1728, 1080), familiarShape(1920, 1080), familiarShape(1366, 768)]).toEqual([true, true, true]);
    expect([familiarShape(2560, 1080), familiarShape(1080, 1920)]).toEqual([false, false]);
  });
});

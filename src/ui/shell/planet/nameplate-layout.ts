/**
 * Where the planet session's nameplate stands: its row on the mode row's ink line, the span it may
 * slide in across the window, and how far the toast band moves to clear it, all in the zooms given.
 */
import { TOAST_BAND_TOP } from '../../chrome/floating/toast-band';
import { MODE_ROW_INK_CENTRE, cornerArt, cornerWidth, modeRowRight, type FrameLayout } from '../frame';
import { RAIL } from '../units';

/** The plate's height in css px; its ends are half-circles. */
export const PLATE_ROW = 52;
/** The name button's side padding, the air between its name and the pen, and the pen, in css px. */
export const NAME_PAD = 12;
export const NAME_GAP = 8;
export const PEN = 16;
/** The name button at its narrowest: its padding and the pen, with the name itself down to nothing. */
export const NAME_LEAST = 2 * NAME_PAD + NAME_GAP + PEN;
/** Space between the plate and the surfaces it opens, and between the plate and the toast band, in css px. */
export const PANEL_GAP = 8;

/** The plate's box top in chrome css px: its middle on the mode row's ink centre, converting the zooms. */
export function nameplateTop(frameZoom: number, chromeZoom: number): number {
  return (MODE_ROW_INK_CENTRE * frameZoom) / chromeZoom - PLATE_ROW / 2;
}

/** Where the plate's box ends, in chrome css px. */
function nameplateBottom(frameZoom: number, chromeZoom: number): number {
  return nameplateTop(frameZoom, chromeZoom) + PLATE_ROW;
}

/** The span the plate may stand in and the centre it keeps while it fits there, in screen px. */
export interface NameplateSpan { left: number; right: number; centre: number }

/**
 * Where the plate may stand across the window in screen px: clear of the session's mode row and, while level
 * with it, of the corner, each by the least gap between groups.
 */
export function nameplateSpan(
  viewportW: number, frameZoom: number, chromeZoom: number,
  layout: Pick<FrameLayout, 'width' | 'edgeRight' | 'cornerTop'>, modes: number,
): NameplateSpan {
  const level = layout.cornerTop < nameplateBottom(frameZoom, chromeZoom) * chromeZoom / frameZoom;
  const corner = level ? cornerWidth(cornerArt(true)) + RAIL.groupMin : 0;
  return {
    left: (modeRowRight(modes) + RAIL.groupMin) * frameZoom,
    right: (layout.width - layout.edgeRight - corner) * frameZoom,
    centre: viewportW / 2,
  };
}

/** How far the toast band moves down while the plate stands, in chrome css px: to clear the plate. */
export function toastBandShift(frameZoom: number, chromeZoom: number): number {
  return Math.max(0, nameplateBottom(frameZoom, chromeZoom) + PANEL_GAP - TOAST_BAND_TOP);
}

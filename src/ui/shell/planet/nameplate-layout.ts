/**
 * Where the planet session's nameplate stands: its row on the mode row's ink line, the span it may
 * slide in across the window, and how far the toast band moves to clear a plate over the map. The
 * plate draws at its own zoom (`plateZoom`), the chrome's raised in touch mode; the toast band stays
 * at the chrome's.
 */
import { TOAST_BAND_TOP } from '../../chrome/floating/toast-band';
import { MODE_ROW_INK_CENTRE, cornerArt, cornerWidth, modeRowRight } from '../frame';
import type { FrameLayout } from '../frame-plan';
import { EDGE, RAIL } from '../units';

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

/** The plate's box top in its own css px at `plateZoom`: its middle on the mode row's ink centre. */
export function nameplateTop(frameZoom: number, plateZoom: number): number {
  return (MODE_ROW_INK_CENTRE * frameZoom) / plateZoom - PLATE_ROW / 2;
}

/** Where the plate's box ends, in its own css px at `plateZoom`. */
export function nameplateBottom(frameZoom: number, plateZoom: number): number {
  return nameplateTop(frameZoom, plateZoom) + PLATE_ROW;
}

/** The span the plate may stand in and the centre it keeps while it fits there, in screen px. */
export interface NameplateSpan { left: number; right: number; centre: number }

/**
 * Where the plate may stand across the window in screen px: clear of the session's mode row and, while level
 * with it, of the corner, each by the least gap between groups.
 */
export function nameplateSpan(
  viewportW: number, frameZoom: number, plateZoom: number,
  layout: Pick<FrameLayout, 'width' | 'edgeRight' | 'cornerTop' | 'modeRow'>, modes: number,
): NameplateSpan {
  const level = layout.cornerTop < nameplateBottom(frameZoom, plateZoom) * plateZoom / frameZoom;
  const corner = level ? cornerWidth(cornerArt(true)) + RAIL.groupMin : 0;
  return {
    // An upright window's row stands at the foot, which leaves the top line to the window's margin.
    left: (layout.modeRow.placement === 'top' ? modeRowRight(modes, layout.modeRow) + RAIL.groupMin : EDGE) * frameZoom,
    right: (layout.width - layout.edgeRight - corner) * frameZoom,
    centre: viewportW / 2,
  };
}

/** How far the toast band moves down, in chrome css px, to clear by `PANEL_GAP` a plate whose box
 *  ends `bottom` of its own css px down at `plateZoom`. */
export function toastBandShift(bottom: number, plateZoom: number, chromeZoom: number): number {
  return Math.max(0, (bottom * plateZoom) / chromeZoom + PANEL_GAP - TOAST_BAND_TOP);
}

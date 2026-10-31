/**
 * The band the ordinary toasts stack in: where it starts, and how much room one toast takes with
 * the air under it, in css px.
 *
 * Its own module rather than a pair of exports on `Toast.tsx`, because the other reader is the
 * Arrival notice, which stands clear of this band so a refusal is never lost under a greeting — and
 * a surface that reached into the toast component for two numbers would be importing a whole live
 * region to find out where it may stand.
 *
 * The row is `Toast.tsx`'s own metrics: 11px of padding either side of a 21px line, plus the
 * container's 8px gap between one toast and the next.
 */
import { useEffect, useState } from 'react';
import { SPACE } from '../../design/styles';

export const TOAST_BAND_TOP = 64;
export const TOAST_BAND_ROW = 51;

/** The root custom property that moves the whole band down, in chrome css px, past the surfaces
 *  standing in its place (`useToastBandShift`). */
export const TOAST_BAND_SHIFT_VAR = '--toast-band-shift';

/** The shift each standing surface asks for, a page-wide registration: the band clears the lowest. */
const shifts = new Map<symbol, number>();

function publishShift(): void {
  const root = document.documentElement.style;
  if (shifts.size) root.setProperty(TOAST_BAND_SHIFT_VAR, `${Math.max(...shifts.values())}px`);
  else root.removeProperty(TOAST_BAND_SHIFT_VAR);
}

/** Moves the band down by `px` chrome css px for as long as the caller stands; with several callers
 *  standing (the nameplate and a plate under it) the band clears the one reaching lowest. */
export function useToastBandShift(px: number): void {
  const [id] = useState(() => Symbol('band-shift'));
  useEffect(() => {
    shifts.set(id, px);
    publishShift();
    return () => { shifts.delete(id); publishShift(); };
  }, [id, px]);
}

/** The root custom properties an upright frame publishes, in chrome css px: the margins it keeps at
 *  the window's left and right and where its top row ends, which a band tenant spanning the window keeps to. */
export const UPRIGHT_EDGE_LEFT_VAR = '--upright-edge-left';
export const UPRIGHT_EDGE_RIGHT_VAR = '--upright-edge-right';
export const UPRIGHT_TOP_VAR = '--upright-top';

/** The root custom property a wide frame publishes, in chrome css px: the top of its second row (the
 *  character and the layer rail), which the greeting stands level with, clear of the mode row above. */
export const WIDE_SECOND_ROW_VAR = '--wide-second-row';

/** What a band tenant keeps clear at the window's sides, in chrome px: a docked panel's strip, and
 *  upright the frame's side margins as well. */
const bandSides = (upright: boolean) => upright
  ? { left: `(var(${UPRIGHT_EDGE_LEFT_VAR}, 0px) + var(--pin-dock-left, 0px))`, right: `(var(${UPRIGHT_EDGE_RIGHT_VAR}, 0px) + var(--pin-dock-right, 0px))` }
  : { left: 'var(--pin-dock-left, 0px)', right: 'var(--pin-dock-right, 0px)' };

/** The widest a band tenant held at its words' width stands, in its own px (`zoom` screen px each,
 *  `ratio` chrome px each): within the upright frame's side margins, or `BAND_WINDOW_MARGIN` off the
 *  window's sides otherwise, and never over a docked panel's strip. */
export function bandMaxWidth(viewportW: number, zoom: number, ratio: number, upright: boolean): string {
  const sides = bandSides(upright);
  const margin = upright ? 0 : 2 * BAND_WINDOW_MARGIN;
  return `calc(${(viewportW - margin) / zoom}px - ${fromChromePx(`(${sides.left} + ${sides.right})`, ratio)})`;
}

/** A band tenant's `left`, with `translateX(-50%)`: the middle of the room `bandMaxWidth` caps it to. */
export function bandCentre(ratio: number, upright: boolean): string {
  const sides = bandSides(upright);
  return `calc(50% + ${fromChromePx(`(${sides.left} - ${sides.right}) / 2`, ratio)})`;
}

/** A band tenant's `top`: its place in the band, moved with the band. */
export function bandTop(px: number): string {
  return `calc(${px}px + var(${TOAST_BAND_SHIFT_VAR}, 0px))`;
}

/** The least air between a band tenant held at its words' width and the window's sides, in screen px. */
export const BAND_WINDOW_MARGIN = SPACE[8];

/** The air the greeting keeps under its card, inside its row. */
export const ARRIVAL_AIR = 12;
/** The arrival greeting's own row: its card is 72 tall (48px of planet art with 12px of padding
 *  above and below it) and `ARRIVAL_AIR` under that. The dev-build notice stands below this, so the
 *  band's three tenants (refusals, the greeting, the notice) are stacked here by declaration rather
 *  than by luck: the greeting at `arrivalTop`, the notice one row under it. They are placed in chrome
 *  px; the greeting, which touch mode can draw larger, publishes its measured row (`arrivalRow`). */
export const ARRIVAL_ROW = 72 + ARRIVAL_AIR;

/** The refusals' row in chrome px for a tenant whose own px are `ratio` chrome px: the toasts draw
 *  at the band's zoom, so their row is `TOAST_BAND_ROW` of the band's px. */
export function toastRow(ratio: number): number {
  return TOAST_BAND_ROW / ratio;
}

/** The greeting's `top` in the band: under the refusals' row (`toastRow`, chrome px), moved with the
 *  band, and on a wide frame never above its second row. */
export function arrivalTop(row: number): string {
  return `max(${bandTop(TOAST_BAND_TOP + row)}, var(${WIDE_SECOND_ROW_VAR}, 0px))`;
}

/** The refusals' `top` on an upright window: under the frame's top row, and never above their place
 *  in the band, which a plate over the map may have moved down. */
export const UPRIGHT_TOAST_TOP = `max(var(${UPRIGHT_TOP_VAR}, 0px), ${bandTop(TOAST_BAND_TOP)})`;

/** The greeting's `top` on an upright window: under the refusals' row (`row`, chrome px) there. */
export function uprightArrivalTop(row: number): string {
  return `max(calc(var(${UPRIGHT_TOP_VAR}, 0px) + ${row}px), ${arrivalTop(row)})`;
}

/** A CSS `length` written in chrome css px, for a surface whose own px are `ratio` chrome px
 *  (the chrome zoom over its own); unchanged where the two zooms agree. */
export function fromChromePx(length: string, ratio: number): string {
  return ratio === 1 ? length : `calc(${length} * ${ratio})`;
}

/** The root custom property the greeting publishes while mounted, in chrome css px: its measured
 *  row, the card and the air under it, never less than `ARRIVAL_ROW` at its zoom. */
export const ARRIVAL_ROW_VAR = '--arrival-row';

/** The greeting's row as a CSS length in chrome px: the measured one, or `fallback` px before it is. */
export function arrivalRow(fallback: number): string {
  return `var(${ARRIVAL_ROW_VAR}, ${fallback}px)`;
}

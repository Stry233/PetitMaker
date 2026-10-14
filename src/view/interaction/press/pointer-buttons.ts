/*
 * `PointerEvent.button` values the editor acts on.
 *
 * Middle is a second right: both navigate the camera, so a mouse without a usable right button, or
 * a hand already on the wheel, loses nothing.
 */

/** Left. Drives the tools, the selection and the region brush. */
export const PRIMARY_BUTTON = 0;

/** Middle and right. Both arm camera navigation; a tap on either opens the context menu. */
const NAV_BUTTONS: readonly number[] = [1, 2];

export function isNavButton(button: number): boolean {
  return NAV_BUTTONS.includes(button);
}

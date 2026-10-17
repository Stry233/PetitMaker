/*
 * How far a press travels before it is a drag rather than a tap, in screen px measured on each axis.
 */

/** A mouse press past this is a drag: every map gesture and a carried shelf card read it. */
export const DRAG_THRESHOLD = 3;

/** A finger or a pen tip wanders further than a mouse while it means to stay put; past this, a
 *  press that has not yet become a hold is the hand scrolling what it landed on. */
export const TOUCH_SLOP = 10;

/** Whether a press that moved `dx`, `dy` from where it landed has gone past `limit`. */
export function travelledPast(dx: number, dy: number, limit: number): boolean {
  return Math.abs(dx) > limit || Math.abs(dy) > limit;
}

/*
 * What a press on a list entry that can be carried to the map means while it is held.
 *
 * A tap is the entry's own click and stays untouched here; this answers only whether the held press
 * has become a carry, is still undecided, or has turned into the hand scrolling the list. Read
 * on every move and once when the hold time runs out, from the facts at that moment.
 *
 * A mouse never scrolls a list by dragging it (the wheel and the scrollbar do), so a mouse press that
 * moves past the drag threshold is a carry at once, the same threshold that turns a map press into
 * a drag. A finger or a pen tip pans the list it lands on, so movement before the hold means
 * scrolling and only a hold lifts the entry. A hold lifts it for every pointer, so the gesture
 * taught for touch works with a mouse too.
 */
import { DRAG_THRESHOLD, TOUCH_SLOP, travelledPast } from './travel';

/** How long a press stays put before the entry lifts, in milliseconds. */
export const LIST_HOLD_MS = 400;

export interface ListPressFacts {
  /** `PointerEvent.pointerType`: `mouse`, `pen`, `touch`, or an empty or unknown type a browser
   *  reports, which is read as a mouse. */
  pointerType: string;
  /** Milliseconds since the press landed. */
  heldMs: number;
  /** Travel from where the press landed, in screen px. */
  dx: number;
  dy: number;
}

/** `wait`: undecided, keep listening. `carry`: the entry is in the hand. `scroll`: the press is the
 *  list's to scroll, and nothing it does later carries the entry. */
export type ListPressOutcome = 'wait' | 'carry' | 'scroll';

/** Whether this pointer pans what it presses on: a finger or a pen tip. */
function pans(pointerType: string): boolean {
  return pointerType === 'touch' || pointerType === 'pen';
}

export function resolveListPress(f: ListPressFacts): ListPressOutcome {
  if (pans(f.pointerType)) {
    if (travelledPast(f.dx, f.dy, TOUCH_SLOP)) return 'scroll';
    return f.heldMs >= LIST_HOLD_MS ? 'carry' : 'wait';
  }
  if (travelledPast(f.dx, f.dy, DRAG_THRESHOLD)) return 'carry';
  return f.heldMs >= LIST_HOLD_MS ? 'carry' : 'wait';
}

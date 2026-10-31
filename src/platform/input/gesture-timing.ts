/*
 * One row of gesture thresholds and windows per input mode. The pointer that made an event picks
 * its row, so a finger gets touch timing even while the editor is laid out for a mouse.
 */
import type { InputMode } from '../device/input-mode';

export interface GestureTiming {
  /** Travel past which a press is a drag, in screen px on either axis (`travelledPast`). */
  dragThreshold: number;
  /** How long a press stays put before it is a hold, in ms. */
  holdMs: number;
  /** The longest gap between two taps or clicks that still makes a double, in ms. */
  doubleTapMs: number;
  /** How far apart two taps may land and still make a double tap, in screen px on either axis; 0
   *  where the browser's own double click decides. */
  doubleTapSlop: number;
  /** The longest a two-finger press may last and still be a tap, in ms; 0 where no such gesture exists. */
  twoFingerTapMs: number;
  /** Travel either finger of a two-finger tap may make, in screen px. */
  twoFingerTapSlop: number;
}

export const GESTURE_TIMING: Readonly<Record<InputMode, GestureTiming>> = {
  pc: { dragThreshold: 3, holdMs: 400, doubleTapMs: 400, doubleTapSlop: 0, twoFingerTapMs: 0, twoFingerTapSlop: 0 },
  touch: { dragThreshold: 10, holdMs: 400, doubleTapMs: 300, doubleTapSlop: 24, twoFingerTapMs: 250, twoFingerTapSlop: 10 },
};

/** A finger and a pen tip are touch; a mouse, and an empty or unknown pointer type, are pc. */
export function modalityOf(e: { pointerType: string }): InputMode {
  return e.pointerType === 'touch' || e.pointerType === 'pen' ? 'touch' : 'pc';
}

/** Whether the pointer reports a position while no button is down: a mouse and a pen do, a finger
 *  does not. Hover previews and re-sampling follow this, not the input mode. */
export function pointerHovers(e: { pointerType: string }): boolean {
  return e.pointerType !== 'touch';
}

export function timingFor(e: { pointerType: string }): GestureTiming {
  return GESTURE_TIMING[modalityOf(e)];
}

/** Whether a press that moved `dx`, `dy` from where it landed has gone past `limit`, in screen px
 *  measured on each axis. */
export function travelledPast(dx: number, dy: number, limit: number): boolean {
  return Math.abs(dx) > limit || Math.abs(dy) > limit;
}

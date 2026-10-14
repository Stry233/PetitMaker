/**
 * Touch: one finger drives the active tool (or, on a camera-only surface, slides the camera), a
 * second finger turns the gesture into camera navigation (pinch zoom, pan and twist) until every
 * finger lifts. The editor's pointer machine and `use-camera-only.ts` both run it. Fingers navigate; they never
 * draw mid-gesture. A cancelled finger's edits are the tool's to roll back (`onPointerCancel`);
 * the gesture holds no stroke of its own.
 */
import { clientPoint } from '../../../platform/device/viewport-space';
import { TouchPinch } from '../gestures';
import type { CameraGestures } from '../camera-gestures';

export class TouchGesture {
  /** On from the second finger landing until every finger lifts. */
  navigating = false;
  private readonly pinch = new TouchPinch();

  constructor(private readonly gestures: CameraGestures) {}

  /**
   * A press. A second finger turns the gesture into navigation, running `abandon` to cancel
   * whatever the first finger started; a single finger falls through to the tool/select path.
   * Returns whether the press is consumed here.
   */
  down(e: PointerEvent, abandon: (x: number, y: number) => void): boolean {
    if (e.pointerType !== 'touch') return false;
    const count = this.pinch.down(e.pointerId, clientPoint(e).x, clientPoint(e).y);
    if (count === 2) {
      // Second finger = navigation, never drawing: cancel whatever the first finger
      // started (stroke, drag, region brush) and hand the gesture to pinch/pan.
      e.preventDefault();
      abandon(clientPoint(e).x, clientPoint(e).y);
      this.navigating = true;
      return true;
    }
    if (count > 2) { e.preventDefault(); return true; } // extra fingers join the navigation gesture
    if (this.navigating) { e.preventDefault(); return true; } // still mid-gesture
    return false;
  }

  /** Keeps the pinch baseline fresh, and drives the camera while navigating. `leftPanning` is a
   *  one-finger drag the press resolved as a pan. Returns whether the move is consumed here. */
  move(e: PointerEvent, leftPanning: boolean): boolean {
    if (e.pointerType !== 'touch') return false;
    // Keep the tracker current on every touch move (so the pinch baseline is fresh the
    // instant a second finger lands); its deltas drive the camera only while navigating.
    const delta = this.pinch.move(e.pointerId, clientPoint(e).x, clientPoint(e).y);
    if (this.navigating) {
      if (delta) this.gestures.touch(delta);
      return true;
    }
    // A one-finger pan drag slides the camera, the touch analog of the desktop left-drag pan. A
    // second finger switches to the pinch/pan/twist gesture above.
    if (leftPanning && delta) {
      this.gestures.touch({ ...delta, scale: 1, twist: 0 }); // one finger slides, it does not zoom or twist
      return true;
    }
    return false;
  }

  /** A finger lifted. Returns whether the release belongs to navigation, which never reaches the
   *  tool/select paths. */
  up(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false;
    const count = this.pinch.up(e.pointerId);
    if (this.navigating) {
      if (count === 0) this.navigating = false;
      return true;
    }
    return false;
  }

  /** The browser cancelled a finger; the caller has already cancelled the tool's press. */
  cancelled(e: PointerEvent): void {
    if (this.pinch.up(e.pointerId) === 0) this.navigating = false;
  }
}

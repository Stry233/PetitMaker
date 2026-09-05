/**
 * The shared pointer-to-camera mapping. Both 3D surfaces run this module, so what it does with a
 * button IS the app's camera contract; the tests below are that contract written down.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createCameraGestures, DRAG_THRESHOLD } from '../../canvas/interaction/camera-gestures';
import type { DragKind } from '../../canvas/interaction/cursor-controller';
import type { ViewCamera } from '../../canvas/view-projection';

interface Call { verb: string; args: number[] }

/** A camera that records what it was asked to do. `orbit` present = a 3D view; absent = the 2D map. */
function fakeCamera(over: Partial<ViewCamera> = {}): { cam: ViewCamera; calls: Call[] } {
  const calls: Call[] = [];
  const rec = (verb: string) => (...args: number[]) => { calls.push({ verb, args }); };
  const cam: ViewCamera = {
    pan: rec('pan'),
    zoomStep: rec('zoomStep'),
    zoomBy: rec('zoomBy'),
    orbit: rec('orbit'),
    orbitTwist: rec('orbitTwist'),
    endGesture: rec('endGesture'),
    wheelZooms: true,
    ...over,
  };
  return { cam, calls };
}

const ptr = (over: Partial<PointerEvent> = {}): PointerEvent => ({
  button: 0, clientX: 0, clientY: 0, pointerType: 'mouse', preventDefault: () => {},
  ...over,
} as PointerEvent);

const wheel = (over: Partial<WheelEvent> = {}): WheelEvent => ({
  deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, clientX: 10, clientY: 20,
  preventDefault: () => {},
  ...over,
} as WheelEvent);

let drags: DragKind[] = [];
beforeEach(() => { drags = []; });

const make = (cam: ViewCamera | null) =>
  createCameraGestures({ camera: () => cam, onDragChange: (k) => drags.push(k) });

describe('which button does what', () => {
  it('orbits on a RIGHT drag, and on a MIDDLE drag, where the view can orbit', () => {
    // Middle is a second right: a mouse without a usable right button loses nothing.
    for (const button of [2, 1]) {
      const { cam, calls } = fakeCamera();
      const g = make(cam);
      expect(g.navDown(ptr({ button, clientX: 100, clientY: 100 }))).toBe(true);
      g.navMove(ptr({ clientX: 130, clientY: 90 }));
      expect(calls).toEqual([{ verb: 'orbit', args: [30, -10] }]);
    }
  });

  it('pans on a right drag where the view has no orbit, so the 2D map keeps its behaviour', () => {
    const { cam, calls } = fakeCamera({ orbit: undefined });
    const g = make(cam);
    g.navDown(ptr({ button: 2, clientX: 100, clientY: 100 }));
    g.navMove(ptr({ clientX: 130, clientY: 90 }));
    // Inverted: the verb slides the VIEW, so dragging right carries the map with the hand.
    expect(calls).toEqual([{ verb: 'pan', args: [-30, 10] }]);
    expect(drags[0]).toBe('pan');
  });

  it('leaves a LEFT press alone until the caller arms one', () => {
    // In the editor a left press may be a tool stroke, a selection, or a band; only the caller
    // knows which. The module never guesses.
    const { cam, calls } = fakeCamera();
    const g = make(cam);
    expect(g.navDown(ptr({ button: 0 }))).toBe(false);
    expect(g.navMove(ptr({ clientX: 50, clientY: 50 }))).toBe(false);
    expect(calls).toEqual([]);
    g.panFrom(0, 0);
    g.panStep(ptr({ clientX: 10, clientY: 5 }));
    expect(calls).toEqual([{ verb: 'pan', args: [-10, -5] }]);
  });

  it('re-anchors each pan step, so a slow drag is not one growing jump', () => {
    const { cam, calls } = fakeCamera();
    const g = make(cam);
    g.panFrom(0, 0);
    g.panStep(ptr({ clientX: 10, clientY: 0 }));
    g.panStep(ptr({ clientX: 25, clientY: 0 }));
    expect(calls.map((c) => c.args[0])).toEqual([-10, -15]);
  });

  it('accumulates a drag from the LAST position, not the press, so deltas do not compound', () => {
    const { cam, calls } = fakeCamera();
    const g = make(cam);
    g.navDown(ptr({ button: 2, clientX: 0, clientY: 0 }));
    g.navMove(ptr({ clientX: 10, clientY: 0 }));
    g.navMove(ptr({ clientX: 25, clientY: 0 }));
    expect(calls.map((c) => c.args[0])).toEqual([10, 15]);
  });
});

describe('tap versus drag', () => {
  it('reports a press that never travelled as NOT moved, so a tap can still open a menu', () => {
    const { cam } = fakeCamera();
    const g = make(cam);
    g.navDown(ptr({ button: 2, clientX: 100, clientY: 100 }));
    g.navMove(ptr({ clientX: 100 + DRAG_THRESHOLD, clientY: 100 }));
    expect(g.navUp().moved).toBe(false);
  });

  it('reports a press that cleared the threshold as moved', () => {
    const { cam } = fakeCamera();
    const g = make(cam);
    g.navDown(ptr({ button: 2, clientX: 100, clientY: 100 }));
    g.navMove(ptr({ clientX: 100 + DRAG_THRESHOLD + 1, clientY: 100 }));
    expect(g.navUp().moved).toBe(true);
  });
});

describe('a release that was not navigating', () => {
  it('reports neither navigated nor moved, so a stale travel cannot fake a drag', () => {
    // The caller reads this to decide whether a right-tap opens the context menu. A release with
    // no nav armed (the press landed elsewhere) must not inherit the last drag's answer.
    const { cam } = fakeCamera();
    const g = make(cam);
    g.navDown(ptr({ button: 2, clientX: 0, clientY: 0 }));
    g.navMove(ptr({ clientX: 200, clientY: 0 }));
    expect(g.navUp()).toEqual({ navigated: true, moved: true });
    expect(g.navUp()).toEqual({ navigated: false, moved: false });
  });
});

describe('what the cursor is told', () => {
  it('says orbit while a nav drag turns the camera, and clears on release', () => {
    const { cam } = fakeCamera();
    const g = make(cam);
    g.navDown(ptr({ button: 2 }));
    g.navUp();
    expect(drags).toEqual(['orbit', 'none']);
  });

  it('says pan for an armed pan, and clears on release', () => {
    const { cam } = fakeCamera();
    const g = make(cam);
    g.panFrom(0, 0);
    g.navUp();
    expect(drags).toEqual(['pan', 'none']);
  });

  it('says nothing on a release that was not dragging anything', () => {
    const { cam } = fakeCamera();
    make(cam).navUp();
    expect(drags).toEqual([]);
  });
});

describe('ending a gesture', () => {
  it('tells the camera the drag is over, so a view with inertia can coast', () => {
    const { cam, calls } = fakeCamera();
    const g = make(cam);
    g.navDown(ptr({ button: 2 }));
    g.navUp();
    expect(calls).toEqual([{ verb: 'endGesture', args: [] }]);
  });

  it('does NOT coast a cancelled gesture: a second finger or a lost pointer is not a release', () => {
    const { cam, calls } = fakeCamera();
    const g = make(cam);
    g.navDown(ptr({ button: 2 }));
    g.cancel();
    expect(calls).toEqual([]);
    expect(drags).toEqual(['orbit', 'none']);
    // The cancelled drag is really gone: a later move applies nothing.
    g.navMove(ptr({ clientX: 40, clientY: 40 }));
    expect(calls).toEqual([]);
  });

  it('survives a view with no inertia verb at all', () => {
    const { cam } = fakeCamera({ endGesture: undefined });
    const g = make(cam);
    g.navDown(ptr({ button: 2 }));
    expect(() => g.navUp()).not.toThrow();
  });
});

describe('the wheel, routed by intent', () => {
  it('steps the zoom for a mouse notch', () => {
    const { cam, calls } = fakeCamera();
    make(cam).wheel(wheel({ deltaY: 100 }));
    expect(calls).toEqual([{ verb: 'zoomStep', args: [-1, 10, 20] }]);
  });

  it('dollies smoothly for a touchpad scroll where the view opts into zoom-on-scroll', () => {
    // A ground-plane pan in 3D reads as W/S, so the 3D camera asks for a dolly instead.
    const { cam, calls } = fakeCamera();
    make(cam).wheel(wheel({ deltaY: 4 }));
    expect(calls[0]!.verb).toBe('zoomBy');
  });

  it('pans for a touchpad scroll on a view that does not', () => {
    const { cam, calls } = fakeCamera({ wheelZooms: false, orbit: undefined });
    make(cam).wheel(wheel({ deltaX: 3, deltaY: 4 }));
    expect(calls).toEqual([{ verb: 'pan', args: [3, 4] }]);
  });

  it('yaws on a dominant HORIZONTAL scroll where the view orbits', () => {
    const { cam, calls } = fakeCamera();
    make(cam).wheel(wheel({ deltaX: 20, deltaY: 1 }));
    expect(calls).toEqual([{ verb: 'orbit', args: [20, 0] }]);
  });

  it('zooms smoothly on a dominant HORIZONTAL scroll in 2D, from the horizontal magnitude', () => {
    const { cam, calls } = fakeCamera({ orbit: undefined });
    make(cam).wheel(wheel({ deltaX: 20, deltaY: 1 }));
    expect(calls[0]!.verb).toBe('zoomBy');
    expect(calls[0]!.args[0]).toBeCloseTo(Math.exp(-20 / 200), 5);
  });

  it('always zooms smoothly for ctrl+wheel, wherever the pointer is', () => {
    const { cam, calls } = fakeCamera();
    make(cam).pinchWheel(wheel({ deltaY: -30, ctrlKey: true }));
    expect(calls[0]!.verb).toBe('zoomBy');
    expect(calls[0]!.args.slice(1)).toEqual([10, 20]);
  });
});

describe('touch', () => {
  it('applies zoom, pan and twist from one two-finger delta', () => {
    const { cam, calls } = fakeCamera();
    make(cam).touch({ panX: 5, panY: -2, scale: 1.2, midX: 40, midY: 60, twist: 0.3 });
    expect(calls.map((c) => c.verb)).toEqual(['zoomBy', 'pan', 'orbitTwist']);
  });

  it('skips the verbs a delta does not ask for', () => {
    const { cam, calls } = fakeCamera();
    make(cam).touch({ panX: 0, panY: 0, scale: 1, midX: 0, midY: 0, twist: 0 });
    expect(calls).toEqual([]);
  });
});

describe('no view', () => {
  it('swallows every gesture without throwing while nothing is live', () => {
    const g = make(null);
    expect(() => {
      g.navDown(ptr({ button: 2 }));
      g.navMove(ptr({ clientX: 9, clientY: 9 }));
      g.wheel(wheel({ deltaY: 100 }));
      g.pinchWheel(wheel({ deltaY: 10 }));
      g.touch({ panX: 1, panY: 1, scale: 2, midX: 0, midY: 0, twist: 1 });
      g.navUp();
    }).not.toThrow();
  });
});

describe('a gesture taken by the browser', () => {
  it('reports a nav press whose release never came, when the next press arrives', () => {
    // Some browsers and extensions bind their own mouse gesture to a right drag and swallow the
    // release. A page cannot ask whether such a handler exists, so the failure itself is the signal.
    let lost = 0;
    const { cam } = fakeCamera();
    const g = createCameraGestures({ camera: () => cam, onGestureLost: () => { lost++; } });
    g.navDown(ptr({ button: 2 }));
    g.navDown(ptr({ button: 2 }));   // still armed from the last one
    expect(lost).toBe(1);
  });

  it('reports one whose release never came, when focus leaves instead', () => {
    let lost = 0;
    const { cam } = fakeCamera();
    const g = createCameraGestures({ camera: () => cam, onGestureLost: () => { lost++; } });
    g.navDown(ptr({ button: 2 }));
    g.windowBlurred();
    expect(lost).toBe(1);
    expect(g.isNavigating()).toBe(false);
  });

  it('says nothing when the gesture completed normally', () => {
    let lost = 0;
    const { cam } = fakeCamera();
    const g = createCameraGestures({ camera: () => cam, onGestureLost: () => { lost++; } });
    g.navDown(ptr({ button: 2 }));
    g.navUp();
    g.navDown(ptr({ button: 2 }));
    g.navUp();
    g.windowBlurred();
    expect(lost).toBe(0);
  });

  it('says nothing when focus leaves during a plain left pan', () => {
    // Only the nav buttons are contended; a left pan losing focus is ordinary.
    let lost = 0;
    const { cam } = fakeCamera();
    const g = createCameraGestures({ camera: () => cam, onGestureLost: () => { lost++; } });
    g.panFrom(0, 0);
    g.windowBlurred();
    expect(lost).toBe(0);
  });
});

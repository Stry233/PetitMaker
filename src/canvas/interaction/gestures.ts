// gestures.ts — pure input-gesture logic: wheel-intent classification (mouse wheel vs touchpad
// scroll vs pinch) and multi-touch pinch tracking. No DOM/Pixi imports, so it unit-tests headlessly;
// usePointerInteraction owns the wiring.

/** What KIND of gesture a wheel event is; the camera verb it drives is `wheelVerb`'s decision:
 *  - 'pinch-zoom'  — a touchpad pinch (browsers synthesize ctrl+wheel for it) or explicit ctrl+wheel:
 *                    smooth, magnitude-proportional zoom anchored at the cursor.
 *  - 'scroll-pan'  — a continuous touchpad-style scroll (small fractional deltas).
 *  - 'wheel-zoom'  — a discrete mouse-wheel notch. */
export type WheelIntent = 'pinch-zoom' | 'scroll-pan' | 'wheel-zoom';

export interface WheelLike { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }

/** Events closer together than this belong to one physical gesture — keep its classification
 *  (a touchpad fling's fast middle can cross the notch threshold; a re-check would flip it to zoom). */
const STICKY_MS = 300;
/** Pixel-mode |deltaY| at/above this — single-axis, integer — reads as a wheel notch. Mouse wheels
 *  deliver ~100/120 px per notch (or deltaMode=LINE); touchpad pans start small and fractional. */
const NOTCH_MIN = 50;

/** Heuristic mouse-wheel vs touchpad discrimination with per-gesture stickiness. One instance per
 *  listener; feed every non-ctrl wheel event through classify(). Deliberate bias: an ambiguous
 *  stream (e.g. macOS mice, which emit accelerated fractional deltas) classifies as a touchpad
 *  scroll, so it rides the smooth, magnitude-proportional path rather than the stepped one. */
export class WheelClassifier {
  private lastKind: Exclude<WheelIntent, 'pinch-zoom'> | null = null;
  private lastTime = -Infinity;

  classify(e: WheelLike, now: number): WheelIntent {
    if (e.ctrlKey) {
      // A pinch interleaves with nothing — reset the scroll gesture.
      this.lastKind = null;
      this.lastTime = -Infinity;
      return 'pinch-zoom';
    }
    let kind: Exclude<WheelIntent, 'pinch-zoom'>;
    if (this.lastKind !== null && now - this.lastTime < STICKY_MS) kind = this.lastKind;
    else if (e.deltaMode !== 0) kind = 'wheel-zoom';                                    // line/page = a real wheel
    else if (e.deltaX !== 0) kind = 'scroll-pan';                                       // diagonal motion = touchpad
    else if (Math.abs(e.deltaY) >= NOTCH_MIN && Number.isInteger(e.deltaY)) kind = 'wheel-zoom';
    else kind = 'scroll-pan';
    this.lastKind = kind;
    this.lastTime = now;
    return kind;
  }
}

/** Smooth, magnitude-proportional zoom factor for a pinch/ctrl-wheel delta. exp keeps equal deltas
 *  multiplying equally in both directions; the clamp stops a full mouse notch (±100) from leaping. */
export function pinchWheelFactor(deltaY: number): number {
  return Math.min(1.18, Math.max(0.85, Math.exp(-deltaY / 200)));
}

export interface PinchDelta {
  /** Viewport pan (screen px): previous centroid − current centroid. */
  panX: number;
  panY: number;
  /** Zoom multiplier: current finger spread / previous spread (1 with fewer than two fingers). */
  scale: number;
  /** Current centroid (screen px) — the zoom anchor. */
  midX: number;
  midY: number;
  /** Two-finger rotation since the last measure, radians (0 with one finger).
   *  Positive = the finger pair turned counter-clockwise on screen. */
  twist: number;
}

/** Tracks active touch points and turns their frame-to-frame motion into pan/zoom deltas.
 *  With two+ fingers: centroid delta = pan, spread ratio = zoom. With one remaining finger
 *  (after a pinch), its own delta keeps panning — the caller decides when deltas drive the
 *  camera (only while "navigating", i.e. once a second finger has landed). */
export class TouchPinch {
  private pts = new Map<number, { x: number; y: number }>();
  private prev: { midX: number; midY: number; dist: number; angle: number } | null = null;

  get count(): number {
    return this.pts.size;
  }

  down(id: number, x: number, y: number): number {
    this.pts.set(id, { x, y });
    this.prev = this.measure();
    return this.pts.size;
  }

  /** Update a point; returns the camera delta since the last measure (null for unknown ids). */
  move(id: number, x: number, y: number): PinchDelta | null {
    const p = this.pts.get(id);
    if (!p) return null;
    p.x = x;
    p.y = y;
    const cur = this.measure()!;
    const prev = this.prev ?? cur;
    this.prev = cur;
    let twist = 0;
    if (prev.dist > 0 && cur.dist > 0) {
      // Screen y grows downward, so the sign flip makes CCW-on-screen positive.
      twist = -(cur.angle - prev.angle);
      if (twist > Math.PI) twist -= 2 * Math.PI;
      if (twist < -Math.PI) twist += 2 * Math.PI;
    }
    return {
      panX: prev.midX - cur.midX,
      panY: prev.midY - cur.midY,
      scale: prev.dist > 0 && cur.dist > 0 ? cur.dist / prev.dist : 1,
      midX: cur.midX,
      midY: cur.midY,
      twist,
    };
  }

  up(id: number): number {
    this.pts.delete(id);
    this.prev = this.measure(); // re-anchor: the surviving finger must not inherit the lifted one's midpoint
    return this.pts.size;
  }

  clear(): void {
    this.pts.clear();
    this.prev = null;
  }

  private measure(): { midX: number; midY: number; dist: number; angle: number } | null {
    if (this.pts.size === 0) return null;
    const [a, b] = this.pts.values();
    if (!b) return { midX: a!.x, midY: a!.y, dist: 0, angle: 0 };
    return {
      midX: (a!.x + b.x) / 2,
      midY: (a!.y + b.y) / 2,
      dist: Math.hypot(b.x - a!.x, b.y - a!.y),
      angle: Math.atan2(b.y - a!.y, b.x - a!.x),
    };
  }
}

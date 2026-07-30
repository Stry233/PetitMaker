import { describe, it, expect } from 'vitest';
import { WheelClassifier, TouchPinch, pinchWheelFactor } from '../../canvas/interaction/gestures';

const wheel = (over: Partial<{ deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean }> = {}) =>
  ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...over });

describe('WheelClassifier', () => {
  it('ctrl+wheel (trackpad pinch or explicit) is pinch-zoom', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel({ deltaY: -4, ctrlKey: true }), 0)).toBe('pinch-zoom');
    expect(c.classify(wheel({ deltaY: 100, ctrlKey: true }), 10)).toBe('pinch-zoom');
  });

  it('line/page delta modes read as a real mouse wheel (Firefox mice)', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel({ deltaY: 3, deltaMode: 1 }), 0)).toBe('wheel-zoom');
  });

  it('large single-axis integer pixel deltas read as wheel notches (Chrome/Edge mice)', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel({ deltaY: 100 }), 0)).toBe('wheel-zoom');
    const c2 = new WheelClassifier();
    expect(c2.classify(wheel({ deltaY: -120 }), 0)).toBe('wheel-zoom');
  });

  it('small or fractional or diagonal pixel deltas read as touchpad scroll-pan', () => {
    expect(new WheelClassifier().classify(wheel({ deltaY: 8 }), 0)).toBe('scroll-pan');
    expect(new WheelClassifier().classify(wheel({ deltaY: 62.5 }), 0)).toBe('scroll-pan');
    expect(new WheelClassifier().classify(wheel({ deltaX: 14, deltaY: 90 }), 0)).toBe('scroll-pan');
  });

  it('classification is sticky within one gesture: a fast fling crossing the notch threshold stays a pan', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel({ deltaY: 6 }), 0)).toBe('scroll-pan');
    expect(c.classify(wheel({ deltaY: 120 }), 100)).toBe('scroll-pan'); // inertia spike, same gesture
    expect(c.classify(wheel({ deltaY: 120 }), 150)).toBe('scroll-pan');
    // ...but after the gesture gap, a fresh notch classifies on its own merits
    expect(c.classify(wheel({ deltaY: 120 }), 1000)).toBe('wheel-zoom');
  });

  it('a pinch resets gesture stickiness', () => {
    const c = new WheelClassifier();
    expect(c.classify(wheel({ deltaY: 6 }), 0)).toBe('scroll-pan');
    expect(c.classify(wheel({ deltaY: -4, ctrlKey: true }), 50)).toBe('pinch-zoom');
    expect(c.classify(wheel({ deltaY: 100 }), 100)).toBe('wheel-zoom'); // not glued to the pre-pinch pan
  });
});

describe('pinchWheelFactor', () => {
  it('is smooth, symmetric, and clamped', () => {
    expect(pinchWheelFactor(0)).toBe(1);
    expect(pinchWheelFactor(-10)).toBeGreaterThan(1);
    expect(pinchWheelFactor(10)).toBeLessThan(1);
    expect(pinchWheelFactor(-10) * pinchWheelFactor(10)).toBeCloseTo(1, 10); // equal deltas cancel
    expect(pinchWheelFactor(-1000)).toBe(1.18); // clamped
    expect(pinchWheelFactor(1000)).toBe(0.85);
  });
});

describe('TouchPinch', () => {
  it('two fingers moving apart zoom in around a steady midpoint', () => {
    const t = new TouchPinch();
    expect(t.down(1, 100, 200)).toBe(1);
    expect(t.down(2, 200, 200)).toBe(2);
    const d = t.move(1, 90, 200)!; // spread 100 → 110
    expect(d.scale).toBeCloseTo(110 / 100);
    expect(d.midX).toBe(145);
    expect(d.midY).toBe(200);
    expect(d.panX).toBeCloseTo(5); // midpoint moved left by 5 → pan +5 (prev − cur)
    expect(d.panY).toBe(0);
  });

  it('two fingers translating together pan without zooming', () => {
    const t = new TouchPinch();
    t.down(1, 100, 100);
    t.down(2, 200, 100);
    const d1 = t.move(1, 110, 120)!;
    const d2 = t.move(2, 210, 120)!;
    expect(d1.scale * d2.scale).toBeCloseTo(1, 5); // net spread unchanged
    expect(d1.panX + d2.panX).toBeCloseTo(-10);
    expect(d1.panY + d2.panY).toBeCloseTo(-20);
  });

  it('lifting one finger re-anchors: the survivor pans from its own position, no jump', () => {
    const t = new TouchPinch();
    t.down(1, 100, 100);
    t.down(2, 300, 100);
    expect(t.up(2)).toBe(1);
    const d = t.move(1, 90, 105)!;
    expect(d.scale).toBe(1);
    expect(d.panX).toBe(10);
    expect(d.panY).toBe(-5);
  });

  it('unknown ids are ignored; clear() empties the tracker', () => {
    const t = new TouchPinch();
    expect(t.move(9, 0, 0)).toBeNull();
    t.down(1, 0, 0);
    t.clear();
    expect(t.count).toBe(0);
  });
});


describe('TouchPinch twist', () => {
  it('reports the two-finger rotation delta in radians (zero for one finger)', () => {
    const tp = new TouchPinch();
    tp.down(1, 100, 100);
    expect(tp.move(1, 110, 100)!.twist).toBe(0);
    tp.down(2, 200, 100); // horizontal pair
    // Rotate finger 2 a quarter turn around finger 1 (up = -y).
    const d = tp.move(2, 110, 10)!;
    expect(Math.abs(d.twist - Math.PI / 2)).toBeLessThan(0.02);
  });

  it('re-anchors on finger changes so twist never jumps', () => {
    const tp = new TouchPinch();
    tp.down(1, 0, 0);
    tp.down(2, 100, 0);
    tp.up(2);
    tp.down(3, 0, 100); // vertical pair now
    const d = tp.move(3, 0, 110)!;
    expect(Math.abs(d.twist)).toBeLessThan(1e-6); // no phantom rotation from the swap
  });
});

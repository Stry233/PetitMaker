import { describe, expect, it } from 'vitest';
import { spec } from '../../_support/spec';
import { InputModeTracker, initialInputMode, watchInputMode } from '../../../platform/device/input-mode';

describe('input mode tracker', () => {
  spec('UI-26', 'a touch pointerdown switches a PC tracker to touch', () => {
    const t = new InputModeTracker('pc');
    expect(t.feed({ kind: 'pointerdown', pointerType: 'touch' }, 1)).toBe('pc');
    expect(t.feed({ kind: 'pointerup', pointersDown: 0 }, 0)).toBe('touch');
  });

  spec('UI-26', 'a pen counts as touch, a mouse, a wheel and a shortcut key as pc', () => {
    const t = new InputModeTracker('pc');
    t.feed({ kind: 'pointerdown', pointerType: 'pen' }, 1);
    expect(t.feed({ kind: 'pointerup', pointersDown: 0 }, 0)).toBe('touch');
    t.feed({ kind: 'pointerdown', pointerType: 'mouse' }, 1);
    expect(t.feed({ kind: 'pointerup', pointersDown: 0 }, 0)).toBe('pc');
    t.feed({ kind: 'pointerdown', pointerType: 'touch' }, 1);
    t.feed({ kind: 'pointerup', pointersDown: 0 }, 0);
    expect(t.feed({ kind: 'wheel' }, 0)).toBe('pc');
    t.feed({ kind: 'pointerdown', pointerType: 'touch' }, 1);
    t.feed({ kind: 'pointerup', pointersDown: 0 }, 0);
    expect(t.feed({ kind: 'key', key: 'v', inTextField: false }, 0)).toBe('pc');
  });

  spec('UI-26', 'modifier keys, typing in a field and compatibility mouse moves change nothing', () => {
    const t = new InputModeTracker('touch');
    expect(t.feed({ kind: 'key', key: 'Shift', inTextField: false }, 0)).toBe('touch');
    expect(t.feed({ kind: 'key', key: 'a', inTextField: true }, 0)).toBe('touch');
    expect(t.feed({ kind: 'mousemove', fromTouch: true }, 0)).toBe('touch');
    expect(t.feed({ kind: 'mousemove', fromTouch: false }, 0)).toBe('pc');
  });

  spec('UI-27', 'a touch during a mouse drag waits until both pointers lift', () => {
    const t = new InputModeTracker('pc');
    t.feed({ kind: 'pointerdown', pointerType: 'mouse' }, 1);
    expect(t.feed({ kind: 'pointerdown', pointerType: 'touch' }, 2)).toBe('pc');
    expect(t.feed({ kind: 'pointerup', pointersDown: 1 }, 1)).toBe('pc');
    expect(t.feed({ kind: 'pointerup', pointersDown: 0 }, 0)).toBe('touch');
  });

  it('starts in touch only when the only pointer is coarse', () => {
    expect(initialInputMode({ anyFine: false, maxTouchPoints: 5 })).toBe('touch');
    expect(initialInputMode({ anyFine: true, maxTouchPoints: 10 })).toBe('pc');
    expect(initialInputMode({ anyFine: false, maxTouchPoints: 0 })).toBe('pc');
  });

  it('watching without a window is a no-op', () => {
    expect(() => watchInputMode(() => {}, 'pc')()).not.toThrow();
  });
});

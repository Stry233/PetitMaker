// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchInputMode, type InputMode } from '../../../platform/device/input-mode';

function pointer(type: string, pointerType: string, pointerId = 1): void {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, { pointerType, pointerId });
  window.dispatchEvent(e);
}

describe('watchInputMode', () => {
  let modes: InputMode[];
  let stop: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    modes = [];
    stop = watchInputMode((m) => modes.push(m), 'pc');
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  /** The click a release dispatches, run to the end of its dispatch. */
  const click = () => {
    window.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(0);
  };

  it('[UI-26] a touch pointerdown and pointerup switches to touch once the release\'s click is dispatched', () => {
    pointer('pointerdown', 'touch');
    expect(modes).toEqual([]);
    pointer('pointerup', 'touch');
    expect(modes).toEqual([]);
    click();
    expect(modes).toEqual(['touch']);
  });

  it('[UI-27] a release that dispatches no click switches after a short wait', () => {
    pointer('pointerdown', 'touch');
    pointer('pointerup', 'touch');
    vi.advanceTimersByTime(299);
    expect(modes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(modes).toEqual(['touch']);
  });

  it('[UI-27] a new press during the wait holds the switch until it lifts', () => {
    pointer('pointerdown', 'touch');
    pointer('pointerup', 'touch');
    pointer('pointerdown', 'touch', 2);
    vi.advanceTimersByTime(1000);
    expect(modes).toEqual([]);
    pointer('pointerup', 'touch', 2);
    click();
    expect(modes).toEqual(['touch']);
  });

  it('[UI-26] a hovering pen stays touch', () => {
    pointer('pointerdown', 'pen');
    pointer('pointerup', 'pen');
    click();
    pointer('pointermove', 'pen');
    window.dispatchEvent(new Event('mousemove'));
    expect(modes).toEqual(['touch']);
  });

  it('[UI-27] a pointer lost to a blur does not block the pending switch', () => {
    pointer('pointerdown', 'touch', 7);
    window.dispatchEvent(new Event('blur'));
    expect(modes).toEqual(['touch']);
  });
});

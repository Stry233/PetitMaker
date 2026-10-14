// @vitest-environment jsdom
/**
 * Held pan keys, shared by the editor and the export shot editor.
 *
 * A surface running its own loop against literal w/a/s/d gives a user who rebound the pan keys their
 * keys everywhere except there. These pin that both surfaces read the one key map.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useCallback } from 'react';
import { useHeldPan } from '../../../view/interaction/use-view-shortcuts';
import { __resetHeldKeys, installKeyTracking } from '../../../platform/input/held-keys';
import { comboFromEvent } from '../../../platform/input/combo';
import { useKeybinds } from '../../../state/keymap/store';

function Panner({ onPan, enabled = true }: { onPan: (dx: number, dy: number) => void; enabled?: boolean }) {
  useHeldPan(useCallback(onPan, [onPan]), useCallback(() => enabled, [enabled]));
  return null;
}

/** Hold `key`, run one animation frame, release. */
function tap(key: string): void {
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
  act(() => { vi.advanceTimersByTime(20); });
  act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); });
}

let frames: FrameRequestCallback[] = [];
/** Milliseconds between the stubbed animation frames. */
let frameMs = 16;

beforeEach(() => {
  useKeybinds.setState({ overrides: {} });
  frames = [];
  frameMs = 16;
  // `performance` is faked too: the double-tap window is measured with performance.now(),
  // so advancing the clock has to move it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = setTimeout(() => cb(performance.now()), frameMs);
    frames.push(cb);
    return id as unknown as number;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useKeybinds.setState({ overrides: {} });
});

describe('held pan keys', () => {
  it('pans on the default WASD', () => {
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    tap('w');
    expect(pan).toHaveBeenCalled();
    expect(pan.mock.calls[0]![1]).toBeLessThan(0); // w walks the view up
  });

  it('follows a REBOUND pan key, and drops the key it replaced', () => {
    // The whole point of routing both surfaces through the keybind store: the shot editor honours
    // this too, which the hardcoded loop it replaced could not.
    useKeybinds.setState({ overrides: { 'camera.pan_up': 'k' } });
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    tap('k');
    expect(pan).toHaveBeenCalled();
    pan.mockClear();
    tap('w');
    expect(pan).not.toHaveBeenCalled();
  });

  it.each([
    ['a numpad key', { key: '8', code: 'Numpad8' }],
    ['Space', { key: ' ', code: 'Space' }],
    ['a top-row digit on AZERTY', { key: '&', code: 'Digit1' }],
  ])('pans on a pan key recorded as %s', (_name, init: KeyboardEventInit) => {
    useKeybinds.setState({ overrides: { 'camera.pan_up': comboFromEvent(new KeyboardEvent('keydown', init))! } });
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true })); });
    act(() => { vi.advanceTimersByTime(20); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { ...init, bubbles: true })); });
    expect(pan).toHaveBeenCalled();
    expect(pan.mock.calls[0]![1]).toBeLessThan(0);
  });

  it('stays quiet while the surface says it is not enabled', () => {
    const pan = vi.fn();
    render(<Panner onPan={pan} enabled={false} />);
    tap('w');
    expect(pan).not.toHaveBeenCalled();
  });

  it('ignores keys typed into a text field', () => {
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true })); });
    act(() => { vi.advanceTimersByTime(20); });
    expect(pan).not.toHaveBeenCalled();
    input.remove();
  });

  it('schedules no frame loop while nothing is held', () => {
    render(<Panner onPan={vi.fn()} />);
    expect(frames).toHaveLength(0);
  });

  it('stops panning when the window loses focus mid-hold, rather than running on', () => {
    // Without this the keyup never arrives (it goes to whatever took focus) and the camera drifts.
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true })); });
    act(() => { vi.advanceTimersByTime(20); });
    pan.mockClear();
    act(() => { window.dispatchEvent(new Event('blur')); });
    act(() => { vi.advanceTimersByTime(60); });
    expect(pan).not.toHaveBeenCalled();
  });
});

describe('pan speed', () => {
  beforeEach(() => installKeyTracking());
  afterEach(() => __resetHeldKeys());

  /** The first step of a press of `key`, with the precision modifier (Shift) held or not. */
  function step(pan: ReturnType<typeof vi.fn>, shiftKey: boolean, key = 'w'): number {
    pan.mockClear();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true })); });
    act(() => { vi.advanceTimersByTime(20); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key, shiftKey, bubbles: true })); });
    const [dx, dy] = pan.mock.calls[0] as [number, number];
    return Math.hypot(dx, dy);
  }

  it('creeps while the precision modifier is held', () => {
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    const plain = step(pan, false);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(step(pan, true)).toBeLessThan(plain);
  });

  it('lets creep TAKE BACK a run, rather than the run winning', () => {
    // The modifier is pressed during the sprint, so it has to be able to cancel it — otherwise a
    // double tap locks the camera fast until every key comes up.
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    step(pan, false, 's');
    const creep = step(pan, true);              // another key went first: no run, just the creep
    act(() => { vi.advanceTimersByTime(4000); });
    step(pan, false);
    expect(step(pan, true), 'a second press inside the double-tap window, modifier held').toBe(creep);
  });
});

describe('pan distance over time', () => {
  /** How far a hold of `ms` walks the view up on a display refreshing every `interval` ms. */
  function travel(interval: number, ms: number): number {
    frameMs = interval;
    const pan = vi.fn();
    const view = render(<Panner onPan={pan} />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true })); });
    act(() => { vi.advanceTimersByTime(ms); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true })); });
    view.unmount();
    return -pan.mock.calls.reduce((sum, call) => sum + (call[1] as number), 0);
  }

  it('walks the same distance whatever the frame rate', () => {
    const at60 = travel(1000 / 60, 500);
    const at144 = travel(1000 / 144, 500);
    expect(at144).toBeGreaterThan(at60 * 0.95);
    expect(at144).toBeLessThan(at60 * 1.05);
  });

  it('walks 8 pixels per frame at 60 Hz', () => {
    expect(travel(1000 / 60, 1000)).toBeCloseTo(480, -1);
  });
});

describe('double tap to run', () => {
  it('sprints on a second press inside the window, and not on the first', () => {
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    tap('w');
    const first = Math.abs(pan.mock.calls[0]![1] as number);
    pan.mockClear();
    tap('w');                       // straight after: within the double-tap window
    const second = Math.abs(pan.mock.calls[0]![1] as number);
    expect(second).toBeGreaterThan(first);
  });

  it('does not sprint when the two taps are far apart', () => {
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    tap('w');
    const first = Math.abs(pan.mock.calls[0]![1] as number);
    pan.mockClear();
    act(() => { vi.advanceTimersByTime(4000); });
    tap('w');
    expect(Math.abs(pan.mock.calls[0]![1] as number)).toBe(first);
  });

  it('does not read key auto-repeat as a second tap', () => {
    // A held key fires keydown repeatedly; that is one press, not a double tap.
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true })); });
    act(() => { vi.advanceTimersByTime(20); });
    const first = Math.abs(pan.mock.calls[0]![1] as number);
    pan.mockClear();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', repeat: true, bubbles: true })); });
    act(() => { vi.advanceTimersByTime(20); });
    expect(Math.abs(pan.mock.calls[0]![1] as number)).toBeCloseTo(first, 0);
    act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'w', bubbles: true })); });
  });

  it('drops the run when the key comes up, so the next plain hold is plain', () => {
    const pan = vi.fn();
    render(<Panner onPan={pan} />);
    tap('w'); tap('w');             // running
    pan.mockClear();
    act(() => { vi.advanceTimersByTime(4000); });
    tap('w');
    const after = Math.abs(pan.mock.calls[0]![1] as number);
    pan.mockClear();
    act(() => { vi.advanceTimersByTime(4000); });
    tap('w');
    expect(Math.abs(pan.mock.calls[0]![1] as number)).toBe(after);
  });
});

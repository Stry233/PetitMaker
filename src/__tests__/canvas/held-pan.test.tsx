/**
 * Held pan keys, shared by the editor and the export shot editor.
 *
 * The shot editor used to run its own loop hardcoded to literal w/a/s/d, so a user who rebound the
 * pan keys got them everywhere EXCEPT there. These pin that both surfaces read the one key map.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useCallback } from 'react';
import { panFactor, useHeldPan } from '../../canvas/interaction/use-view-shortcuts';
import { useKeybinds } from '../../ui/keybindings/store';

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

beforeEach(() => {
  useKeybinds.setState({ overrides: {} });
  frames = [];
  // `performance` is faked too: the double-tap window is measured with performance.now(),
  // so advancing the clock has to move it.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = setTimeout(() => cb(performance.now()), 16);
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
  it('walks at base speed for a plain hold', () => {
    expect(panFactor(false, false)).toBe(1);
  });

  it('runs after a double tap', () => {
    expect(panFactor(true, false)).toBeGreaterThan(1);
  });

  it('creeps while the precision modifier is held', () => {
    expect(panFactor(false, true)).toBeLessThan(1);
  });

  it('lets creep TAKE BACK a run, rather than the run winning', () => {
    // The modifier is pressed during the sprint, so it has to be able to cancel it — otherwise a
    // double tap locks the camera fast until every key comes up.
    expect(panFactor(true, true)).toBe(panFactor(false, true));
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
    expect(Math.abs(pan.mock.calls[0]![1] as number)).toBe(first);
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

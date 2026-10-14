// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { useObservedSize } from '../../../ui/primitives/use-observed-size';
import { useLatch } from '../../../ui/primitives/use-latch';
import { useNaturalWidth } from '../../../ui/shell/controls/use-natural-width';
import { useRootCssVars } from '../../../ui/primitives/use-root-css-vars';
import { afterPaint, onAfterPaint } from '../../../platform/async/after-paint';
import { framerMotion, presence } from '../../../ui/design/motion';
import { springs } from '../../../ui/design/styles';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

class FakeObserver {
  static all: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(public cb: () => void) { FakeObserver.all.push(this); }
  observe(el: Element) { this.observed.push(el); }
  disconnect() { this.disconnected = true; }
}

describe('useObservedSize', () => {
  it('measures once, observes every target and disconnects on unmount', () => {
    FakeObserver.all = [];
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const seen: number[] = [];
    function Probe() {
      const a = useRef<HTMLDivElement>(null);
      const b = useRef<HTMLDivElement>(null);
      useObservedSize(() => [a.current, b.current], (els) => seen.push(els.length), []);
      return <><div ref={a} /><div ref={b} /></>;
    }
    const { unmount } = render(<Probe />);
    expect(seen).toEqual([2]);
    expect(FakeObserver.all[0]!.observed).toHaveLength(2);
    act(() => FakeObserver.all[0]!.cb());
    expect(seen).toEqual([2, 2]);
    unmount();
    expect(FakeObserver.all[0]!.disconnected).toBe(true);
  });

  it('waits for the first change when not immediate, and does nothing without a target', () => {
    FakeObserver.all = [];
    vi.stubGlobal('ResizeObserver', FakeObserver);
    const calls = vi.fn();
    renderHook(() => useObservedSize(() => null, calls, []));
    expect(FakeObserver.all).toHaveLength(0);
    function Probe() {
      const a = useRef<HTMLDivElement>(null);
      useObservedSize(() => a.current, calls, [], { immediate: false });
      return <div ref={a} />;
    }
    render(<Probe />);
    expect(calls).not.toHaveBeenCalled();
    act(() => FakeObserver.all[0]!.cb());
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

describe('useLatch', () => {
  it('stays true once it has been true', () => {
    const { result, rerender } = renderHook(({ on }) => useLatch(on), { initialProps: { on: false } });
    expect(result.current).toBe(false);
    rerender({ on: true });
    rerender({ on: false });
    expect(result.current).toBe(true);
  });
});

describe('useNaturalWidth', () => {
  it('reads the layout width and keeps a reading within its tolerance', () => {
    let width = 40;
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => width);
    const seen: number[] = [];
    function Probe({ label }: { label: string }) {
      const ref = useRef<HTMLSpanElement>(null);
      seen.push(useNaturalWidth(ref, label, 0.5));
      return <span ref={ref}>{label}</span>;
    }
    const { rerender } = render(<Probe label="a" />);
    width = 40.3;
    rerender(<Probe label="b" />);
    width = 52;
    rerender(<Probe label="c" />);
    expect(seen[seen.length - 1]).toBe(52);
    expect(seen).toContain(40);
    expect(seen).not.toContain(40.3);
    vi.restoreAllMocks();
  });
});

describe('useRootCssVars', () => {
  it('publishes on the root, follows a change and removes on unmount', () => {
    const root = document.documentElement.style;
    const { rerender, unmount } = renderHook(({ v }) => useRootCssVars({ '--probe-a': v }), { initialProps: { v: '1px' } });
    expect(root.getPropertyValue('--probe-a')).toBe('1px');
    rerender({ v: '2px' });
    expect(root.getPropertyValue('--probe-a')).toBe('2px');
    unmount();
    expect(root.getPropertyValue('--probe-a')).toBe('');
  });
});

describe('afterPaint', () => {
  it('runs after a frame callback and the timer it sets, and cancels either step', () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const done = vi.fn();
    onAfterPaint(done);
    expect(done).not.toHaveBeenCalled();
    frames[0]!(0);
    expect(done).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(done).toHaveBeenCalledTimes(1);
    const cancelled = vi.fn();
    const cancel = onAfterPaint(cancelled);
    frames[1]!(0);
    cancel();
    vi.runAllTimers();
    expect(cancelled).not.toHaveBeenCalled();
    void afterPaint();
  });
});

describe('presence', () => {
  it('rests every value the surface arrives from and carries held values through every state', () => {
    const p = presence('surface.arrive', { opacity: 0, y: 6, scale: 0.9 }, { hold: { x: '-50%' }, leave: 'surface.leave' });
    expect(p.initial).toEqual({ opacity: 0, y: 6, scale: 0.9, x: '-50%' });
    expect(p.animate).toEqual({ opacity: 1, y: 0, scale: 1, x: '-50%' });
    expect(p.exit).toEqual({ opacity: 0, y: 6, scale: 0.9, x: '-50%', transition: framerMotion('surface.leave') });
    expect(p.transition).toEqual(springs.stiff);
  });

  it('lands at once under reduced motion', () => {
    expect(presence('surface.arrive', { opacity: 0 }, { reduced: true }).transition).toEqual({ duration: 0 });
  });
});

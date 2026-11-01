// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { createElement, createRef, startTransition, useRef, useState, type RefObject } from 'react';
import { MotionConfig } from 'framer-motion';
import { SCROLL_FADE, useScrollFade } from '../../../ui/primitives/scroll-fade';

function Probe({ innerRef }: { innerRef: RefObject<HTMLDivElement | null> }) {
  const style = useScrollFade(innerRef, 'x');
  return createElement('div', { ref: innerRef, style, 'data-testid': 'probe' });
}

/** The settle loop runs on `requestAnimationFrame` and `performance.now()`, so both are stubbed with a
 *  frame queue and a clock only this file advances. */
let queue: FrameRequestCallback[] = [];
let now = 0;

/** Run one frame: advance the clock and fire everything scheduled before it. */
function pump(ms = 16): void {
  now += ms;
  const q = queue;
  queue = [];
  for (const cb of q) cb(now);
}

/** Pump up to `max` frames or until `done`, so a stalled loop fails rather than hangs. */
function pumpUntil(done: () => boolean, max = 120): void {
  for (let i = 0; i < max && !done(); i++) act(() => pump());
}

beforeEach(() => {
  queue = [];
  now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { queue = []; });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('useScrollFade under reduced motion', () => {
  function ReducedProbe({ innerRef }: { innerRef: RefObject<HTMLDivElement | null> }) {
    return createElement(MotionConfig, { reducedMotion: 'always' }, createElement(Probe, { innerRef }));
  }

  it('swaps the mask at once in both directions, and schedules no frame to do it', () => {
    const ref = createRef<HTMLDivElement>();
    const { getByTestId } = render(createElement(ReducedProbe, { innerRef: ref }));
    const el = getByTestId('probe');

    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, configurable: true });
    fireEvent.scroll(el);
    expect(el.style.maskImage).toContain(`calc(100% - ${SCROLL_FADE}px)`);
    expect(queue.length, 'no settle loop under reduced motion').toBe(0);

    Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true });
    fireEvent.scroll(el);
    expect(el.style.maskImage).toBe('');
    expect(queue.length, 'the vanish is instant too').toBe(0);
  });
});

/** Mounts nothing until `mount` flips true, so the ref the hook was given goes null -> an
 *  overflowing element across a later render, with no `dep` passed. */
function LateMount({ mount }: { mount: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const style = useScrollFade(ref, 'x');
  if (!mount) return null;
  const attach = (node: HTMLDivElement | null) => {
    ref.current = node;
    if (!node) return;
    Object.defineProperty(node, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(node, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(node, 'scrollLeft', { value: 50, configurable: true });
  };
  return createElement('div', { ref: attach, style, 'data-testid': 'late' });
}

function LateMountHost() {
  const [mounted, setMounted] = useState(false);
  return createElement('div', null,
    createElement('button', { onClick: () => setMounted(true), 'data-testid': 'flip' }, 'mount'),
    createElement(LateMount, { mount: mounted }),
  );
}

describe('useScrollFade when the CONTENT changes under a standing box', () => {
  it('melts a fade whose overflow left with the children, with no scroll, resize or render to say so', async () => {
    // As in the layer panel's mode switch: exiting tiles are removed when their animation ends, with
    // no scroll event, resize or re-render, so the hook has to observe the mutation itself.
    const ref = createRef<HTMLDivElement>();
    const { getByTestId } = render(createElement(Probe, { innerRef: ref }));
    const el = getByTestId('probe');
    const child = document.createElement('div');
    el.appendChild(child);
    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, configurable: true });
    fireEvent.scroll(el);
    pumpUntil(() => el.style.maskImage.includes(`calc(100% - ${SCROLL_FADE}px)`));
    expect(el.style.maskImage).toContain(`calc(100% - ${SCROLL_FADE}px)`);

    Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true });
    await act(async () => {
      el.removeChild(child);
      await Promise.resolve(); // MutationObserver delivers on a microtask
    });
    pumpUntil(() => el.style.maskImage === '');
    expect(el.style.maskImage).toBe('');
  });
});

describe('useScrollFade on a scroller that mounts on a later render', () => {
  it('binds the element once it appears, with no dep passed, and settles its fade in', () => {
    const { getByTestId, queryByTestId } = render(createElement(LateMountHost));
    expect(queryByTestId('late')).toBeNull();

    fireEvent.click(getByTestId('flip'));
    const el = getByTestId('late');
    pumpUntil(() => el.style.maskImage.includes('linear-gradient(to right,'));
    expect(el.style.maskImage).toContain('linear-gradient(to right,');
  });
});

/**
 * Under reduced motion the binding effect re-measures on every render, so a render that measured
 * nothing new must queue no update: beside a pending lower-priority update it would re-render at once
 * and run the same effect again, an endless loop.
 */
describe('useScrollFade under reduced motion, re-rendered', () => {
  let renders = 0;
  let starve: (() => void) | null = null;

  function Host() {
    renders += 1;
    const ref = useRef<HTMLDivElement>(null);
    // An updater that always yields a new array.
    const [, setList] = useState<number[]>([]);
    starve = () => {
      startTransition(() => setList((l) => [...l, 1]));
      setList((l) => [...l]);
    };
    const style = useScrollFade(ref, 'x');
    return createElement('div', { ref, style, 'data-testid': 'host' });
  }
  const reducedHost = () => createElement(MotionConfig, { reducedMotion: 'always' }, createElement(Host));

  beforeEach(() => { renders = 0; });

  it('does not loop while another update of the same component waits its turn', () => {
    render(reducedHost());
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => act(() => starve!())).not.toThrow();
    expect(failed).not.toHaveBeenCalled();
    expect(renders, 'mount, the default update and the transition').toBeLessThanOrEqual(4);
  });
});

/** The settle glide is a frame-by-frame writer: it draws on the scroller past React. */
describe('useScrollFade glides past React', () => {
  let renders = 0;
  function Owner({ on = true }: { on?: boolean }) {
    renders += 1;
    const ref = useRef<HTMLDivElement>(null);
    const style = useScrollFade(ref, 'x', { on });
    return createElement('div', { ref, style, 'data-testid': 'owner' });
  }
  function overflow(el: HTMLElement): void {
    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, configurable: true });
  }
  beforeEach(() => { renders = 0; });

  it('carries the shade it has drawn through a later render of its owner', () => {
    const { getByTestId, rerender } = render(createElement(Owner));
    const el = getByTestId('owner');
    overflow(el);
    fireEvent.scroll(el);
    pumpUntil(() => el.style.maskImage.includes(`calc(100% - ${SCROLL_FADE}px)`));
    rerender(createElement(Owner));
    expect(el.style.maskImage).toContain(`calc(100% - ${SCROLL_FADE}px)`);
  });

  it('switched off, observes nothing and takes its shade off the scroller', () => {
    const { getByTestId, rerender } = render(createElement(Owner));
    const el = getByTestId('owner');
    overflow(el);
    fireEvent.scroll(el);
    pumpUntil(() => el.style.maskImage.includes(`calc(100% - ${SCROLL_FADE}px)`));
    rerender(createElement(Owner, { on: false }));
    expect(el.style.maskImage).toBe('');
    fireEvent.scroll(el);
    act(() => pump());
    expect(el.style.maskImage, 'a scroll while off draws nothing').toBe('');
    expect(queue.length, 'and arms no frame').toBe(0);
  });
});

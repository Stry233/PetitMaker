// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { createElement, createRef, startTransition, useRef, useState, type RefObject } from 'react';
import { MotionConfig } from 'framer-motion';
import { fadeMask, SCROLL_FADE, useScrollFade } from '../../../ui/primitives/scroll-fade';

type FadeAt = (el: HTMLElement, edge: number, atEnd: boolean) => number;

function FadeProbe({ axis, fadeAt, extent }: { axis: 'x' | 'y'; fadeAt?: FadeAt; extent?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const style = useScrollFade(ref, axis, { ...(fadeAt ? { fadeAt } : {}), ...(extent === undefined ? {} : { extent: () => extent }) });
  return createElement('div', { ref, style, 'data-testid': 'fade' });
}

/** The mask a box at `pos` of `size` content in a `client` window wears, settled at once. */
function maskOf(pos: number, size: number, client: number, axis: 'x' | 'y', { fadeAt, extent }: { fadeAt?: FadeAt; extent?: number } = {}): string | undefined {
  const { getByTestId, unmount } = render(createElement(MotionConfig, { reducedMotion: 'always' }, createElement(FadeProbe, { axis, fadeAt, extent })));
  const box = getByTestId('fade');
  const [at, scroll, view] = axis === 'x' ? ['scrollLeft', 'scrollWidth', 'clientWidth'] : ['scrollTop', 'scrollHeight', 'clientHeight'];
  Object.defineProperty(box, at, { value: pos, configurable: true });
  Object.defineProperty(box, scroll, { value: size, configurable: true });
  Object.defineProperty(box, view, { value: client, configurable: true });
  fireEvent.scroll(box);
  const mask = box.style.maskImage || undefined;
  unmount();
  return mask;
}

describe('the fade a scroller measures', () => {
  it('reports no travel for a fitted box, both ends mid-scroll, and one end at each stop', () => {
    expect(maskOf(0, 100, 100, 'x')).toBe(fadeMask('x', { start: 0, end: 0 }));
    expect(maskOf(50, 300, 100, 'y')).toBe(fadeMask('y', { start: SCROLL_FADE, end: SCROLL_FADE }));
    expect(maskOf(0, 300, 100, 'x')).toBe(fadeMask('x', { start: 0, end: SCROLL_FADE }));
    expect(maskOf(200, 300, 100, 'x')).toBe(fadeMask('x', { start: SCROLL_FADE, end: 0 }));
  });
  it('treats a spare half pixel as rounding, not room', () => {
    expect(maskOf(0, 100.5, 100, 'x')).toBeUndefined();
  });
  it('clears the fade within a hair of either stop, where zoomed metrics overstate the room', () => {
    // Under a CSS zoom the real maximum offset sits a couple of px short of scrollWidth - clientWidth.
    expect(maskOf(198, 300, 100, 'x')).toBe(fadeMask('x', { start: SCROLL_FADE, end: 0 }));
    expect(maskOf(2, 300, 100, 'y')).toBe(fadeMask('y', { start: 0, end: SCROLL_FADE }));
  });
  it('lets a custom fadeAt set per-edge widths', () => {
    expect(maskOf(50, 300, 100, 'x', { fadeAt: (_el, _edge, atEnd) => (atEnd ? 40 : 10) })).toBe(fadeMask('x', { start: 10, end: 40 }));
  });
  it('counts travel only up to the settled extent, which the scroll length caps', () => {
    expect(maskOf(0, 300, 100, 'x', { extent: 100 })).toBeUndefined();
    expect(maskOf(0, 300, 100, 'x', { extent: 200 })).toBe(fadeMask('x', { start: 0, end: SCROLL_FADE }));
    expect(maskOf(0, 100, 100, 'x', { extent: 400 })).toBeUndefined();
  });
});

describe('fadeMask', () => {
  it('is absent when neither end has travel', () => {
    expect(fadeMask('x', { start: 0, end: 0 })).toBeUndefined();
  });
  it('fades only the end that has travel, on the right axis', () => {
    expect(fadeMask('x', { start: 0, end: 24 }))
      .toBe('linear-gradient(to right, black 0, black calc(100% - 24px), transparent 100%)');
    expect(fadeMask('y', { start: 24, end: 0 }))
      .toBe('linear-gradient(to bottom, transparent 0, black 24px, black 100%)');
  });
});

function Probe({ innerRef }: { innerRef: RefObject<HTMLDivElement | null> }) {
  const style = useScrollFade(innerRef, 'x');
  return createElement('div', { ref: innerRef, style, 'data-testid': 'probe' });
}

function VProbe({ innerRef }: { innerRef: RefObject<HTMLDivElement | null> }) {
  const style = useScrollFade(innerRef, 'y');
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

describe('useScrollFade', () => {
  it('carries no mask for a fitted box, and a fade once scroll metrics say there is room', () => {
    const ref = createRef<HTMLDivElement>();
    const { getByTestId } = render(createElement(Probe, { innerRef: ref }));
    const el = getByTestId('probe');
    expect(el.style.maskImage).toBe('');

    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 50, configurable: true });
    fireEvent.scroll(el);
    pumpUntil(() => el.style.maskImage.includes('linear-gradient(to right,'));

    expect(el.style.maskImage).toContain('linear-gradient(to right,');
  });
});

/** A measurement only moves the target; a settle loop chases the shown width toward it. */
describe('useScrollFade transitions instead of popping', () => {
  it('grows in over several frames, sits at a fractional width mid-transition, then only clears the mask once it has fully settled', () => {
    const ref = createRef<HTMLDivElement>();
    const { getByTestId } = render(createElement(Probe, { innerRef: ref }));
    const el = getByTestId('probe');
    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, configurable: true });
    fireEvent.scroll(el); // only the end has travel

    // One frame in, the shade shows at a fractional width.
    act(() => pump());
    const early = /calc\(100% - ([\d.]+)px\)/.exec(el.style.maskImage);
    expect(early, 'the fade should already be under way, not popped in whole').not.toBeNull();
    const earlyWidth = Number(early![1]);
    expect(earlyWidth).toBeGreaterThan(0);
    expect(earlyWidth).toBeLessThan(SCROLL_FADE);

    pumpUntil(() => el.style.maskImage.includes(`calc(100% - ${SCROLL_FADE}px)`));
    expect(el.style.maskImage).toContain(`calc(100% - ${SCROLL_FADE}px)`);

    // Clearing all travel does not drop the mask on the triggering event...
    Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true });
    fireEvent.scroll(el);
    expect(el.style.maskImage, 'the shade melts, it does not vanish on the triggering event')
      .not.toBe('');

    // ...but within a bounded run of frames.
    pumpUntil(() => el.style.maskImage === '');
    expect(el.style.maskImage).toBe('');
  });
});

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
 * While the surface around a scroller tweens its height, the box is shorter than it is about to be and
 * the metrics report travel; the reading is re-derived on every resize so it does not latch there.
 */
describe('useScrollFade while the box it lives in is being tweened taller', () => {
  it('takes the shade back off once the box has finished growing', () => {
    const ref = createRef<HTMLDivElement>();
    const { getByTestId } = render(createElement(VProbe, { innerRef: ref }));
    const box = getByTestId('probe');
    Object.defineProperty(box, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(box, 'scrollTop', { value: 0, configurable: true });

    // Mid-tween, still short of its content.
    Object.defineProperty(box, 'clientHeight', { value: 150, configurable: true });
    fireEvent.scroll(box);
    pumpUntil(() => box.style.maskImage.includes('linear-gradient(to bottom,'));
    expect(box.style.maskImage).toContain('linear-gradient(to bottom,');

    // Settled, holding all of it.
    Object.defineProperty(box, 'clientHeight', { value: 300, configurable: true });
    fireEvent.scroll(box);
    pumpUntil(() => box.style.maskImage === '');
    expect(box.style.maskImage).toBe('');
  });
});

/**
 * Under reduced motion the binding effect re-measures on every render, so a render that measured
 * nothing new must queue no update: beside a pending lower-priority update it would re-render at once
 * and run the same effect again, an endless loop.
 */
describe('useScrollFade under reduced motion, re-rendered', () => {
  let renders = 0;
  let poke: (() => void) | null = null;
  let starve: (() => void) | null = null;

  function Host() {
    renders += 1;
    const ref = useRef<HTMLDivElement>(null);
    const [, setTick] = useState(0);
    // An updater that always yields a new array.
    const [, setList] = useState<number[]>([]);
    poke = () => setTick((n) => n + 1);
    starve = () => {
      startTransition(() => setList((l) => [...l, 1]));
      setList((l) => [...l]);
    };
    const style = useScrollFade(ref, 'x');
    return createElement('div', { ref, style, 'data-testid': 'host' });
  }
  const reducedHost = () => createElement(MotionConfig, { reducedMotion: 'always' }, createElement(Host));

  beforeEach(() => { renders = 0; });

  it('renders once per render asked of it, with the shade standing or not', () => {
    const { getByTestId } = render(reducedHost());
    const el = getByTestId('host');
    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, configurable: true });
    fireEvent.scroll(el);
    expect(el.style.maskImage).toContain(`calc(100% - ${SCROLL_FADE}px)`);

    const before = renders;
    for (let i = 0; i < 5; i++) act(() => poke!());
    expect(renders - before, 'one render per poke, none of its own').toBe(5);
    expect(el.style.maskImage).toContain(`calc(100% - ${SCROLL_FADE}px)`);
  });

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

  it('settles the shade over several frames without rendering the scroller\'s owner again', () => {
    const { getByTestId } = render(createElement(Owner));
    const el = getByTestId('owner');
    overflow(el);
    const before = renders;
    fireEvent.scroll(el);
    act(() => pump());
    expect(el.style.maskImage, 'one frame in, part of the way').toMatch(/calc\(100% - [\d.]+px\)/);
    pumpUntil(() => el.style.maskImage.includes(`calc(100% - ${SCROLL_FADE}px)`));
    expect(el.style.maskImage).toContain(`calc(100% - ${SCROLL_FADE}px)`);
    expect(renders - before, 'no render for any frame of the glide').toBe(0);
  });

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

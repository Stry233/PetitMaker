import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { createElement, createRef, useRef, useState, type RefObject } from 'react';
import { MotionConfig } from 'framer-motion';
import { fadeMask, measureFade, SCROLL_FADE, useScrollFade } from '../../../ui/primitives/scroll-fade';

const el = (pos: number, size: number, client: number) => ({
  scrollLeft: pos, scrollTop: pos,
  scrollWidth: size, scrollHeight: size,
  clientWidth: client, clientHeight: client,
}) as unknown as HTMLElement;

describe('measureFade', () => {
  it('reports no travel for a fitted box, both ends mid-scroll, and one end at each stop', () => {
    expect(measureFade(el(0, 100, 100), 'x')).toEqual({ start: 0, end: 0, offset: 0 });
    expect(measureFade(el(50, 300, 100), 'y')).toEqual({ start: SCROLL_FADE, end: SCROLL_FADE, offset: 0 });
    expect(measureFade(el(0, 300, 100), 'x')).toEqual({ start: 0, end: SCROLL_FADE, offset: 0 });
    expect(measureFade(el(200, 300, 100), 'x')).toEqual({ start: SCROLL_FADE, end: 0, offset: 0 });
  });
  it('treats a spare half pixel as rounding, not room', () => {
    expect(measureFade(el(0, 100.5, 100), 'x')).toEqual({ start: 0, end: 0, offset: 0 });
  });
  it('clears the fade within a hair of either stop, where zoomed metrics overstate the room', () => {
    // Under a CSS zoom the browser's real maximum offset sits a couple of px short of
    // scrollWidth - clientWidth, so a fully-scrolled row reports phantom travel at its end.
    expect(measureFade(el(198, 300, 100), 'x')).toEqual({ start: SCROLL_FADE, end: 0, offset: 0 });
    expect(measureFade(el(2, 300, 100), 'y')).toEqual({ start: 0, end: SCROLL_FADE, offset: 0 });
  });
  it('lets a custom fadeAt set per-edge widths', () => {
    const t = measureFade(el(50, 300, 100), 'x', (_el, _edge, atEnd) => (atEnd ? 40 : 10));
    expect(t).toEqual({ start: 10, end: 40, offset: 0 });
  });

  /**
   * A STICKY HEAD OWNS THE TOP OF THE SCROLLER, so the shade starts under it: the head is standing
   * still, nothing passes through the band it occupies, and a shade over it dims the one line meant
   * to stay readable. Asked for only where there IS a shade — a scroller at its own start has none,
   * and reading a band for it would be measuring a head nothing is behind.
   */
  it('takes a sticky head\'s band at the start edge, and only where a shade stands', () => {
    expect(measureFade(el(50, 300, 100), 'y', undefined, () => 30))
      .toEqual({ start: SCROLL_FADE, end: SCROLL_FADE, offset: 30 });
    expect(measureFade(el(0, 300, 100), 'y', undefined, () => 30))
      .toEqual({ start: 0, end: SCROLL_FADE, offset: 0 });
  });

  it('never takes a negative band', () => {
    expect(measureFade(el(50, 300, 100), 'y', undefined, () => -12).offset).toBe(0);
  });
});

describe('fadeMask', () => {
  it('is absent when neither end has travel', () => {
    expect(fadeMask('x', { start: 0, end: 0 })).toBeUndefined();
  });
  /** The band is HARD opaque and the ramp begins at its edge, so what emerges from under the head
   *  appears out of nothing rather than half-drawn. */
  it('holds a sticky head\'s band opaque and starts the ramp below it', () => {
    expect(fadeMask('y', { start: 24, end: 0, offset: 30 }))
      .toBe('linear-gradient(to bottom, #000 0, #000 30px, transparent 30px, #000 54px, #000 100%)');
  });
  it('ignores a band where there is no start shade to push down', () => {
    expect(fadeMask('y', { start: 0, end: 24, offset: 30 }))
      .toBe('linear-gradient(to bottom, #000 0, #000 calc(100% - 24px), transparent 100%)');
  });
  it('fades only the end that has travel, on the right axis', () => {
    expect(fadeMask('x', { start: 0, end: 24 }))
      .toBe('linear-gradient(to right, #000 0, #000 calc(100% - 24px), transparent 100%)');
    expect(fadeMask('y', { start: 24, end: 0 }))
      .toBe('linear-gradient(to bottom, transparent 0, #000 24px, #000 100%)');
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

/**
 * `useTravel`'s settle loop runs on `requestAnimationFrame` + `performance.now()`, so these two
 * tests drive it with the same pumped-clock stub `row-scroll.test.ts` established: a queue of
 * callbacks and a `now` this file alone advances, rather than real timers ticking on wall-clock
 * time underneath a synchronous test body.
 */
let queue: FrameRequestCallback[] = [];
let now = 0;

/** Run one frame: advance the clock and fire everything scheduled before it. */
function pump(ms = 16): void {
  now += ms;
  const q = queue;
  queue = [];
  for (const cb of q) cb(now);
}

/** Pump up to `max` frames, or until `done` reads true — a bounded stand-in for "however long the
 *  settle actually takes", so a stalled loop fails the test instead of hanging it. */
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

/**
 * Nothing pops: a measurement only ever moves the TARGET, and a settle loop chases the shown width
 * toward it, so both arriving and leaving take several frames rather than one.
 */
describe('useScrollFade transitions instead of popping', () => {
  it('grows in over several frames, sits at a fractional width mid-transition, then only clears the mask once it has fully settled', () => {
    const ref = createRef<HTMLDivElement>();
    const { getByTestId } = render(createElement(Probe, { innerRef: ref }));
    const el = getByTestId('probe');
    Object.defineProperty(el, 'scrollWidth', { value: 300, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(el, 'scrollLeft', { value: 0, configurable: true });
    fireEvent.scroll(el); // start stays at its stop (pos=0); the end gains SCROLL_FADE of travel

    // One frame in: the shade is already showing, but not yet at its full width — a fractional
    // px value in the gradient IS the transition, not a rounding artifact to tolerate.
    act(() => pump());
    const early = /calc\(100% - ([\d.]+)px\)/.exec(el.style.maskImage);
    expect(early, 'the fade should already be under way, not popped in whole').not.toBeNull();
    const earlyWidth = Number(early![1]);
    expect(earlyWidth).toBeGreaterThan(0);
    expect(earlyWidth).toBeLessThan(SCROLL_FADE);

    // A bounded run of frames reaches the settle, at the exact measured width.
    pumpUntil(() => el.style.maskImage.includes(`calc(100% - ${SCROLL_FADE}px)`));
    expect(el.style.maskImage).toContain(`calc(100% - ${SCROLL_FADE}px)`);

    // Now clear all travel (a fully fitted box): this is the pop this feature removes. The
    // mask must not vanish on the very frame that measured the change...
    Object.defineProperty(el, 'scrollWidth', { value: 100, configurable: true });
    fireEvent.scroll(el);
    expect(el.style.maskImage, 'the shade melts, it does not vanish on the triggering event')
      .not.toBe('');

    // ...but a bounded run of frames does reach the fully-cleared state.
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
 *  overflowing element across a LATER render, with no `dep` passed. */
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
    // The layer panel's mode switch: the outgoing tiles are removed by the animation library when
    // their exit finishes, so scrollHeight drops with no scroll event, no box resize and no host
    // re-render. The shade must notice the mutation itself, or it stands over a stack that is all
    // showing until something else happens to re-render the panel.
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
 * THE MID-TWEEN TRAP, which is what "the shade covers the content" turned out to be in the
 * prototype: the surface a scroller lives in TWEENS its own height (the panel does, to its new
 * content height), so for the length of that tween the box is shorter than it is about to be and the
 * metrics say the content scrolls. A reading LATCHED there leaves a shade standing over a record
 * that is all showing, with nothing left to scroll — which is why the answer is re-derived on every
 * resize rather than kept.
 */
describe('useScrollFade while the box it lives in is being tweened taller', () => {
  it('takes the shade back off once the box has finished growing', () => {
    const ref = createRef<HTMLDivElement>();
    const { getByTestId } = render(createElement(VProbe, { innerRef: ref }));
    const box = getByTestId('probe');
    Object.defineProperty(box, 'scrollHeight', { value: 300, configurable: true });
    Object.defineProperty(box, 'scrollTop', { value: 0, configurable: true });

    // Mid-tween: the panel is on its way to a taller height, so the zone is still short of its
    // content and there IS travel to report.
    Object.defineProperty(box, 'clientHeight', { value: 150, configurable: true });
    fireEvent.scroll(box);
    pumpUntil(() => box.style.maskImage.includes('linear-gradient(to bottom,'));
    expect(box.style.maskImage).toContain('linear-gradient(to bottom,');

    // Settled: the box now holds all of it. Nothing scrolls, so nothing may be shaded.
    Object.defineProperty(box, 'clientHeight', { value: 300, configurable: true });
    fireEvent.scroll(box);
    pumpUntil(() => box.style.maskImage === '');
    expect(box.style.maskImage).toBe('');
  });
});

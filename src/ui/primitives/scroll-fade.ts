/*
 * Soft scroll edges: a scroller that can still travel toward an end wears a fade there, so a hard
 * clip reads as "the row continues" instead of a drawing error; an end it cannot reach meets the
 * edge squarely because it is the end. The fade is a mask on the scroller itself, recomputed from
 * plain scroll geometry on scroll and resize. The widths are css px: the ambient `zoom` a surface
 * rides (frame or chrome) scales them with it.
 *
 * THE MASK ITSELF CANNOT BE TRANSITIONED — `mask-image` gradients are not animatable CSS — so what
 * animates is the FADE WIDTH that goes into it. `useTravel` keeps two numbers per edge: the
 * MEASURED target (what `measureFade` says right now) and the SHOWN width (what the mask actually
 * renders). A scroll/resize event only ever moves the target; a per-hook-instance rAF loop chases
 * the shown value toward it, so the shade grows in and melts away instead of popping.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';

export type FadeAxis = 'x' | 'y';
export const SCROLL_FADE = 24;

/** Within this many px of a stop counts as AT the stop, so the fade there clears. Under a CSS
 *  `zoom` the browser's real maximum scroll offset can sit a couple of px short of
 *  `scrollWidth - clientWidth`, and a shade that stays lit at the end of a fully-scrolled list
 *  says "there is more" about a list there is no more of. Clearing a hair early is invisible;
 *  the same tolerance at the start keeps the rule one rule. */
export const STOP_EPS = 3;

export interface EdgeTravel { start: number; end: number }

/** Fade width per end of `axis`, 0 where the box cannot travel that way. */
export function measureFade(
  el: HTMLElement, axis: FadeAxis,
  fadeAt?: (el: HTMLElement, edge: number, atEnd: boolean) => number,
): EdgeTravel {
  const pos = axis === 'x' ? el.scrollLeft : el.scrollTop;
  const client = axis === 'x' ? el.clientWidth : el.clientHeight;
  const room = (axis === 'x' ? el.scrollWidth : el.scrollHeight) - client;
  const at = (edge: number, atEnd: boolean) => (fadeAt ? fadeAt(el, edge, atEnd) : SCROLL_FADE);
  return {
    start: pos > STOP_EPS ? at(pos, false) : 0,
    end: room - pos > STOP_EPS ? at(pos + client, true) : 0,
  };
}

/** The mask for whichever ends have travel, or none, in which case the element is not masked. */
export function fadeMask(axis: FadeAxis, travel: EdgeTravel): string | undefined {
  if (!travel.start && !travel.end) return undefined;
  const stops = [
    travel.start ? `transparent 0, #000 ${travel.start}px` : '#000 0',
    travel.end ? `#000 calc(100% - ${travel.end}px), transparent 100%` : '#000 100%',
  ];
  return `linear-gradient(${axis === 'x' ? 'to right' : 'to bottom'}, ${stops.join(', ')})`;
}

const same = (a: EdgeTravel, b: EdgeTravel) => a.start === b.start && a.end === b.end;

/** How fast the shown width chases its measured target: the ms to close ~63% of the remaining gap
 *  on one exponential step. This file is `ui/primitives`, which keeps its own timings the way
 *  `TimedButton`'s `STEP_MS` does — the shell's motion registry's inline-duration test scans only
 *  `ui/shell`. */
const SETTLE_MS = 60;

/** Below this many px of the target, the shown width snaps to it exactly: an exponential decay
 *  never reaches its target on its own, so the loop needs a stop condition to actually stop. */
const SETTLE_EPS = 0.5;

interface Binding { el: HTMLElement; ro: ResizeObserver | null; measure: () => void }

function useTravel(
  ref: RefObject<HTMLElement | null>, axes: readonly FadeAxis[],
  fadeAt?: (el: HTMLElement, edge: number, atEnd: boolean) => number,
): EdgeTravel[] {
  const reduced = useReducedMotionConfig() ?? false;
  const [shown, setShown] = useState<EdgeTravel[]>(() => axes.map(() => ({ start: 0, end: 0 })));
  // The authoritative shown/target values the rAF loop reads and writes: React state alone would
  // make `tick` read a value one batched render behind the one it just committed.
  const shownRef = useRef<EdgeTravel[]>(shown);
  const targetRef = useRef<EdgeTravel[]>(shown);
  const axesRef = useRef(axes);
  axesRef.current = axes;
  const fadeAtRef = useRef(fadeAt);
  fadeAtRef.current = fadeAt;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const bound = useRef<Binding | null>(null);
  const raf = useRef<number | null>(null);
  const lastTime = useRef(0);

  /** Carry a computed shown array into render, with the same same-value bailout `measure` uses —
   *  a frame that moved nothing (a same-timestamp tick, a value already snapped) must not requeue
   *  a render for it. */
  const commit = (next: EdgeTravel[]) => {
    shownRef.current = next;
    setShown((was) => (was.every((t, i) => same(t, next[i]!)) ? was : next));
  };
  const cancelLoop = () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  const tick = (now: number) => {
    // Floored at zero: a first callback's frame-start timestamp can precede the mid-frame
    // `performance.now()` the loop was armed with, and a negative dt would step the shown width
    // AWAY from its target.
    const dt = Math.max(0, now - lastTime.current);
    lastTime.current = now;
    const factor = 1 - Math.exp(-dt / SETTLE_MS);
    const target = targetRef.current;
    let settled = true;
    const next = shownRef.current.map((s, i) => {
      const t = target[i]!;
      const close = (a: number, b: number) => Math.abs(a - b) < SETTLE_EPS;
      const start = close(s.start, t.start) ? t.start : s.start + (t.start - s.start) * factor;
      const end = close(s.end, t.end) ? t.end : s.end + (t.end - s.end) * factor;
      if (start !== t.start || end !== t.end) settled = false;
      return { start, end };
    });
    commit(next);
    if (settled) { raf.current = null; return; }
    raf.current = requestAnimationFrame(tick);
  };
  const ensureLoop = () => {
    if (raf.current != null) return;
    lastTime.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  };

  // No dependency list: a `RefObject`'s identity never changes and so never announces a scroller
  // that mounts later than this hook's first run (a panel opening, a row returning from behind a
  // screen), so every render re-checks what `ref.current` holds rather than trusting a stale bind.
  useLayoutEffect(() => {
    const el = ref.current;
    if (bound.current && bound.current.el === el) {
      // Same element as last run: re-measure only (free when nothing moved, via the same-value
      // bailout below) rather than rebinding listeners it already has.
      bound.current.measure();
      return;
    }
    if (bound.current) {
      bound.current.el.removeEventListener('scroll', bound.current.measure);
      bound.current.ro?.disconnect();
      bound.current = null;
      cancelLoop();
    }
    if (!el) return;
    const measure = () => {
      const next = axesRef.current.map((axis) => measureFade(el, axis, fadeAtRef.current));
      targetRef.current = next;
      if (reducedRef.current) {
        // The transition is ambient decoration, so reduced motion drops it whole: shown becomes
        // the target on the spot, exactly like the un-animated behaviour it stands in for.
        cancelLoop();
        commit(next);
        return;
      }
      // `next` is built from `axesRef.current` by `.map`, so it is the same length as `shownRef`.
      if (!next.every((t, i) => same(t, shownRef.current[i]!))) ensureLoop();
    };
    // Its own listener, so a caller's onScroll (autoscroll guards, wheel routing) is untouched.
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    bound.current = { el, ro, measure };
    measure();
  });
  useLayoutEffect(() => () => {
    cancelLoop();
    if (!bound.current) return;
    bound.current.el.removeEventListener('scroll', bound.current.measure);
    bound.current.ro?.disconnect();
    bound.current = null;
  }, []);
  return shown;
}

/** Mask style for a one-axis scroller. Spread into the scroller's own `style`. */
export function useScrollFade(
  ref: RefObject<HTMLElement | null>, axis: FadeAxis,
  opts?: { fadeAt?: (el: HTMLElement, edge: number, atEnd: boolean) => number },
): CSSProperties {
  // useTravel is called with one axis, so its result always holds exactly one entry.
  const [travel] = useTravel(ref, [axis], opts?.fadeAt);
  const mask = fadeMask(axis, travel!);
  return mask ? { maskImage: mask, WebkitMaskImage: mask } : {};
}

/** Mask style for the one both-axis scroller shape: two gradients INTERSECTED, so each axis keeps
 *  its own travel answer. Where mask-composite is unsupported the layers add up to no fade at all,
 *  which is exactly today's hard clip — degradation, not damage. */
export function useScrollFadeBoth(ref: RefObject<HTMLElement | null>): CSSProperties {
  // useTravel is called with two axes, so its result always holds exactly two entries.
  const [x, y] = useTravel(ref, ['x', 'y']);
  const masks = [fadeMask('x', x!), fadeMask('y', y!)].filter(Boolean) as string[];
  if (masks.length === 0) return {};
  if (masks.length === 1) return { maskImage: masks[0], WebkitMaskImage: masks[0] };
  return {
    maskImage: masks.join(', '), WebkitMaskImage: masks.join(', '),
    maskComposite: 'intersect', WebkitMaskComposite: 'source-in',
  };
}

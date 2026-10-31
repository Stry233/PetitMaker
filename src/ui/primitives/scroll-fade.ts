/**
 * Scroll-edge masks use local CSS pixels and share viewport/content observation. The fade's settle
 * glide writes the mask on the scroller past React, as every frame-by-frame writer does; a render
 * carries the width the glide last wrote, so a render and the writer never disagree.
 */
import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { followToward, frameDt } from '../design/motion';
import { observeScrollGeometry, readScrollGeometry, scrollTravel } from './scroll-geometry';

type FadeAxis = 'x' | 'y';
export const SCROLL_FADE = 24;

interface EdgeTravel {
  start: number;
  end: number;

}

type FadeAt = (el: HTMLElement, edge: number, atEnd: boolean) => number;

/** Where the scrolled content ends along the axis when some of it is on its way out and must not
 *  read as more to scroll to; the scroll length caps it. */
type Extent = (el: HTMLElement) => number;

export interface FadeOptions {
  fadeAt?: FadeAt;
  extent?: Extent;
  /** False where the caller draws the scroller without a fade: nothing is observed or written. */
  on?: boolean;
}

/** Fade width per end of `axis`, 0 where the box cannot travel that way. */
function measureFade(el: HTMLElement, axis: FadeAxis, fadeAt?: FadeAt, extent?: Extent): EdgeTravel {
  const g = readScrollGeometry(el);
  const pos = axis === 'x' ? g.left : g.top;
  const client = axis === 'x' ? g.width : g.height;
  const travel = scrollTravel(g, axis, extent?.(el));
  const at = (edge: number, atEnd: boolean) => (fadeAt ? fadeAt(el, edge, atEnd) : SCROLL_FADE);
  return {
    start: travel.start ? at(pos, false) : 0,
    end: travel.end ? at(pos + client, true) : 0,
  };
}

/** The mask for whichever ends have travel, or none, in which case the element is not masked. */
export function fadeMask(axis: FadeAxis, travel: EdgeTravel): string | undefined {
  if (!travel.start && !travel.end) return undefined;
  const head = travel.start ? `transparent 0, black ${travel.start}px` : 'black 0';
  const stops = [
    head,
    travel.end ? `black calc(100% - ${travel.end}px), transparent 100%` : 'black 100%',
  ];
  return `linear-gradient(${axis === 'x' ? 'to right' : 'to bottom'}, ${stops.join(', ')})`;
}

/** The mask style for the axes' travels: one gradient, or two intersected so each axis keeps its own
 *  travel answer (where mask-composite is unsupported the layers add up to no fade, a plain clip). */
function maskStyle(axes: readonly FadeAxis[], travels: readonly EdgeTravel[]): CSSProperties {
  const masks = axes.map((axis, i) => fadeMask(axis, travels[i]!)).filter(Boolean) as string[];
  if (masks.length === 0) return {};
  if (masks.length === 1) return { maskImage: masks[0], WebkitMaskImage: masks[0] };
  return {
    maskImage: masks.join(', '), WebkitMaskImage: masks.join(', '),
    maskComposite: 'intersect', WebkitMaskComposite: 'source-in',
  };
}

/** Every property `maskStyle` sets, as React names and writes them. */
const MASK_KEYS = ['maskImage', 'WebkitMaskImage', 'maskComposite', 'WebkitMaskComposite'] as const;

/** Writes `style`'s mask on `el` the way React writes a style prop, clearing what it leaves out. */
function paintMask(el: HTMLElement, style: CSSProperties): void {
  const inline = el.style as unknown as Record<string, string>;
  for (const key of MASK_KEYS) {
    const value = (style[key] as string | undefined) ?? '';
    if (inline[key] !== value) inline[key] = value;
  }
}

const same = (a: EdgeTravel, b: EdgeTravel) => a.start === b.start && a.end === b.end;

/** Below this many px of the target, the shown width snaps to it exactly: an exponential decay
 *  never reaches its target on its own, so the loop needs a stop condition to actually stop. */
const SETTLE_EPS = 0.5;

interface Binding { readonly el: HTMLElement; dispose: () => void; readonly measure: () => void }

const none = (axes: readonly FadeAxis[]): EdgeTravel[] => axes.map(() => ({ start: 0, end: 0 }));

/** The mask style the scroller wears at this render; frames between renders are written on it. */
function useFadeStyle(ref: RefObject<HTMLElement | null>, axes: readonly FadeAxis[], { fadeAt, extent, on = true }: FadeOptions = {}): CSSProperties {
  const reduced = useReducedMotionConfig() ?? false;
  // The shown and target widths the loop reads and writes; the element's mask is always `shown`'s.
  const shownRef = useRef<EdgeTravel[]>(none(axes));
  const targetRef = useRef<EdgeTravel[]>(shownRef.current);
  const axesRef = useRef(axes);
  axesRef.current = axes;
  const fadeAtRef = useRef(fadeAt);
  fadeAtRef.current = fadeAt;
  const extentRef = useRef(extent);
  extentRef.current = extent;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const bound = useRef<Binding | null>(null);
  const raf = useRef<number | null>(null);
  const lastTime = useRef(0);

  /** Draws `next` on the bound scroller; an equal one writes nothing. */
  const commit = (next: EdgeTravel[]) => {
    if (next.every((t, i) => same(t, shownRef.current[i]!))) return;
    shownRef.current = next;
    if (bound.current) paintMask(bound.current.el, maskStyle(axesRef.current, next));
  };
  const cancelLoop = () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  const tick = (now: number) => {
    const dt = frameDt(lastTime.current, now);
    lastTime.current = now;
    const target = targetRef.current;
    let settled = true;
    const next = shownRef.current.map((s, i) => {
      const t = target[i]!;
      const close = (a: number, b: number) => Math.abs(a - b) < SETTLE_EPS;
      const start = close(s.start, t.start) ? t.start : followToward(s.start, t.start, dt, 'scroll.fade.settle');
      const end = close(s.end, t.end) ? t.end : followToward(s.end, t.end, dt, 'scroll.fade.settle');
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
  const unbind = () => {
    cancelLoop();
    if (!bound.current) return;
    bound.current.dispose();
    bound.current = null;
  };

  // No dependency list: a `RefObject`'s identity never changes and so never announces a scroller
  // that mounts later than this hook's first run (a panel opening, a row returning from behind a
  // screen), so every render re-checks what `ref.current` holds rather than trusting a stale bind.
  useLayoutEffect(() => {
    const el = on ? ref.current : null;
    if (bound.current && bound.current.el === el) {
      // Same element as last run: re-measure only (free when nothing moved, via the same-value
      // bailout in `commit`) rather than rebinding listeners it already has.
      bound.current.measure();
      return;
    }
    const was = bound.current?.el ?? null;
    unbind();
    // Switched off, the scroller it stays on is drawn without a fade.
    if (!on && was) paintMask(was, {});
    if (!el) return;
    const measure = () => {
      const next = axesRef.current.map((axis) => measureFade(el, axis, fadeAtRef.current, extentRef.current));
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
    // Bound before observing: the observation measures at once, and `commit` paints the bound element.
    const binding: Binding = { el, dispose: () => {}, measure };
    bound.current = binding;
    binding.dispose = observeScrollGeometry(el, measure);
    measure();
  });
  useLayoutEffect(() => () => {
    cancelLoop();
    bound.current?.dispose();
    bound.current = null;
  }, []);
  return on ? maskStyle(axes, shownRef.current) : {};
}

/** Mask style for a one-axis scroller. Spread into the scroller's own `style`, and only there. */
export function useScrollFade(ref: RefObject<HTMLElement | null>, axis: FadeAxis, opts?: FadeOptions): CSSProperties {
  return useFadeStyle(ref, [axis], opts);
}

const BOTH: readonly FadeAxis[] = ['x', 'y'];

/** Mask style for the one both-axis scroller shape. Spread into the scroller's own `style`. */
export function useScrollFadeBoth(ref: RefObject<HTMLElement | null>): CSSProperties {
  return useFadeStyle(ref, BOTH);
}

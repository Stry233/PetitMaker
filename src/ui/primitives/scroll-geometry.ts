import { useLayoutEffect, useRef, type RefObject } from 'react';

export interface ScrollGeometry {
  top: number;
  left: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  insetLeft: number;
}

/** Within this many px of a stop counts as at the stop. Under a CSS `zoom` the browser's real
 *  maximum scroll offset can sit a couple of px short of `scrollWidth - clientWidth`, so a list
 *  scrolled fully would otherwise still read as having more; the start takes the same tolerance. */
const STOP_EPS = 3;

/** Whether a scroll distance of `px` to a stop counts as standing at it. */
export function withinStop(px: number): boolean {
  return px <= STOP_EPS;
}

/** How far `g` can still scroll toward each end of `axis`, in local px, 0 within the stop tolerance.
 *  `extent` is where the content ends when some of it is on its way out; the scroll length caps it. */
export function scrollTravel(g: ScrollGeometry, axis: 'x' | 'y', extent?: number): { start: number; end: number } {
  const pos = axis === 'x' ? g.left : g.top;
  const length = axis === 'x' ? g.scrollWidth : g.scrollHeight;
  const room = (extent === undefined ? length : Math.min(length, extent)) - (axis === 'x' ? g.width : g.height);
  return { start: withinStop(pos) ? 0 : pos, end: withinStop(room - pos) ? 0 : room - pos };
}

export type ScrollChange = 'initial' | 'scroll' | 'content';
type Listener = (geometry: ScrollGeometry, change: ScrollChange) => void;

export function readScrollGeometry(el: HTMLElement): ScrollGeometry {
  return {
    top: el.scrollTop, left: el.scrollLeft, width: el.clientWidth, height: el.clientHeight,
    scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, insetLeft: el.clientLeft,
  };
}

interface Watch { listeners: Set<Listener>; dispose: () => void }
const watches = new WeakMap<HTMLElement, Watch>();

/** Viewport and natural child sizes share one observation stream, in local CSS pixels. */
export function observeScrollGeometry(el: HTMLElement, listener: Listener): () => void {
  let watch = watches.get(el);
  if (!watch) {
    const listeners = new Set<Listener>();
    const publish = (change: ScrollChange) => {
      const geometry = readScrollGeometry(el);
      for (const notify of listeners) notify(geometry, change);
    };
    const contentChanged = () => publish('content');
    const scrolled = () => publish('scroll');
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(contentChanged);
    const children = new Set<Element>();
    const bindContent = () => {
      for (const child of children) if (child.parentElement !== el) { resize?.unobserve(child); children.delete(child); }
      for (const child of el.children) if (!children.has(child)) { resize?.observe(child); children.add(child); }
      contentChanged();
    };
    resize?.observe(el);
    bindContent();
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(bindContent);
    mutations?.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('scroll', scrolled, { passive: true });
    // Intrinsic media changes also matter when a child's fixed box overflows internally.
    el.addEventListener('load', contentChanged, true);
    watch = { listeners, dispose: () => {
      resize?.disconnect(); mutations?.disconnect();
      el.removeEventListener('scroll', scrolled); el.removeEventListener('load', contentChanged, true);
    } };
    watches.set(el, watch);
  }
  watch.listeners.add(listener);
  listener(readScrollGeometry(el), 'initial');
  return () => {
    watch.listeners.delete(listener);
    if (watch.listeners.size === 0) { watch.dispose(); watches.delete(el); }
  };
}

/** Rebinds when a keyed viewport replaces the DOM node without replacing its ref. */
export function useScrollGeometry(ref: RefObject<HTMLElement | null>, listener: Listener): void {
  const latest = useRef(listener);
  latest.current = listener;
  const binding = useRef<{ el: HTMLElement; dispose: () => void } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (binding.current?.el === el) return;
    binding.current?.dispose();
    binding.current = el ? { el, dispose: observeScrollGeometry(el, (geometry, change) => latest.current(geometry, change)) } : null;
  });
  useLayoutEffect(() => () => { binding.current?.dispose(); binding.current = null; }, []);
}

/** Whether `el` is a scroll container along `axis` with room to travel there: its overflow is `auto`,
 *  `scroll` or `overlay` (never `hidden` or `clip`, which only cut) and its content outgrows its box.
 *  The document's own scroller counts only under such an overflow, never through `visible`. */
export function scrollsAlong(el: Element, axis: 'x' | 'y'): boolean {
  const room = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
  if (room <= 1) return false;
  const style = getComputedStyle(el);
  const overflow = axis === 'x' ? style.overflowX : style.overflowY;
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
}

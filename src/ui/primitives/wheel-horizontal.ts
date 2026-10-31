import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { scrollsAlong, withinStop } from './scroll-geometry';
import { rowWheel, wheelGlider } from './scroll-input';

interface RowOptions { zoom: number; smooth: boolean; reduced: boolean | null }
interface Row { element: HTMLElement; options: { current: RowOptions }; glide: ReturnType<typeof wheelGlider> }

const rows = new Set<Row>();

/** A row that travels sideways and not down: a grid laid out in columns scrolls down by itself. */
const sidewaysOnly = (el: HTMLElement): boolean => scrollsAlong(el, 'x') && !scrollsAlong(el, 'y');

/** Whether a scroller other than `row` that a vertical wheel at `from` would chain to can take it. The
 *  walk follows containing blocks, as the browser's scroll chain does: a fixed box chains to no
 *  ancestor, and an absolute one skips to the positioned ancestor that holds it. A fixed box under a
 *  transformed ancestor, which that ancestor holds, is not followed. */
function verticalScrollerFrom(from: EventTarget | null, row: HTMLElement): boolean {
  for (let el = from instanceof Element ? from : null; el;) {
    if (el !== row && scrollsAlong(el, 'y')) return true;
    const position = getComputedStyle(el).position;
    if (position === 'fixed') return false;
    el = position === 'absolute' && el instanceof HTMLElement ? el.offsetParent : el.parentElement;
  }
  return false;
}

/** The overflowing row on top at the wheel's point whose padding or gap let the event pass beneath it.
 *  Hit testing ignores `pointer-events: none`, so each candidate is made hit-testable for one probe. */
function rowUnder(event: WheelEvent): Row | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  const target = event.target instanceof Node ? event.target : null;
  const candidates = [...rows].filter(({ element }) => element.isConnected && !(target && element.contains(target))
    && !element.closest('[inert]') && sidewaysOnly(element));
  if (!candidates.length) return null;
  const saved = candidates.map(({ element }) => element.style.pointerEvents);
  for (const { element } of candidates) element.style.pointerEvents = 'auto';
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  candidates.forEach(({ element }, i) => { element.style.pointerEvents = saved[i]!; });
  return hit ? candidates.find(({ element }) => element.contains(hit)) ?? null : null;
}

/** A wheel over a row's pointer-transparent space would reach whatever lies beneath; while the row
 *  overflows it scrolls the row instead and goes no further, at either stop included. */
function onWheelThrough(event: WheelEvent): void {
  if (event.ctrlKey || event.defaultPrevented) return;
  const row = rowUnder(event);
  if (!row) return;
  const { element, glide } = row;
  const { zoom, smooth, reduced } = row.options.current;
  const travel = rowWheel(event, element.clientWidth, zoom, () => verticalScrollerFrom(element.parentElement, element));
  if (!travel) return;
  glide.wheel(element, travel.by, !travel.redirected || !smooth || !!reduced);
  event.preventDefault();
  event.stopPropagation();
}

function enrol(row: Row): () => void {
  if (!rows.size) window.addEventListener('wheel', onWheelThrough, { capture: true, passive: false });
  rows.add(row);
  return () => {
    rows.delete(row);
    if (!rows.size) window.removeEventListener('wheel', onWheelThrough, { capture: true });
  };
}

/** A non-passive listener consumes redirected input only while the row can travel in that direction,
 *  by `scroll-input.ts:rowWheel`. A wheel over the row's pointer-transparent padding and gaps scrolls
 *  it while it overflows, held at either stop. */
export function useWheelToHorizontal(ref: RefObject<HTMLElement | null>, { zoom, smooth = false }: { zoom: number; smooth?: boolean }): void {
  const reduced = useReducedMotionConfig();
  const options = useRef<RowOptions>({ zoom, smooth, reduced });
  options.current = { zoom, smooth, reduced };
  const binding = useRef<{ element: HTMLElement; release(): void } | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (binding.current?.element === element) return;
    binding.current?.release();
    binding.current = null;
    if (!element) return;
    const glide = wheelGlider();
    const onWheel = (event: WheelEvent) => {
      const { zoom, smooth, reduced } = options.current;
      const room = element.scrollWidth - element.clientWidth;
      if (!sidewaysOnly(element)) return;
      // A sideways gesture is the browser's own scroll; only a redirected one is applied here.
      const push = rowWheel(event, element.clientWidth, zoom, () => verticalScrollerFrom(event.target, element));
      if (!push?.redirected || (push.by < 0 ? element.scrollLeft <= 0 : withinStop(room - element.scrollLeft))) return;
      glide.wheel(element, push.by, !smooth || !!reduced);
      event.preventDefault();
      event.stopPropagation();
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    const leave = enrol({ element, options, glide });
    binding.current = { element, release: () => { element.removeEventListener('wheel', onWheel); leave(); glide.stop(); } };
  });
  useLayoutEffect(() => () => { binding.current?.release(); binding.current = null; }, []);
}

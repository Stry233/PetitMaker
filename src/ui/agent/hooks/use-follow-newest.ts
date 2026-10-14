import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { readScrollGeometry, useScrollGeometry, type ScrollGeometry } from '../../primitives/scroll-geometry';
import { STOP_EPS } from '../../primitives/scroll-fade';
import { useEffectEvent } from '../../primitives/use-effect-event';

/** Native gestures can reach a painted edge that trails streamed content, in local CSS pixels. */
const FOLLOW_SLACK = 48;

/** Content growth follows only while the reader owns the foot; reading actions pause synchronously. */
export function useFollowNewest(
  ref: RefObject<HTMLDivElement | null>, key: unknown, epoch: string, active: boolean,
  initial: 'start' | 'end' = 'end',
): () => void {
  const following = useRef(initial === 'end');
  const position = useRef<{ top: number; limit: number } | null>(null);
  const inputLimit = useRef<number | null>(null);
  const inputBinding = useRef<{ el: HTMLElement; dispose(): void } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (inputBinding.current?.el === el) return;
    inputBinding.current?.dispose();
    inputBinding.current = null;
    if (!el) return;
    const input = (event: Event) => {
      if (!(event.target instanceof Element) || event.target.closest('[data-scroll-viewport]') !== el) return;
      if (event.type === 'pointermove' && (event as PointerEvent).buttons === 0) return;
      // A press on content in a record standing at its foot is a click, not a scroll. Scrollbar
      // presses target the viewport itself and arm, since the track and thumb scroll natively.
      if (event.type === 'pointerdown' && event.target !== el && el.scrollHeight - el.clientHeight - el.scrollTop <= STOP_EPS) return;
      const wheel = event.type === 'wheel' ? event as WheelEvent : null;
      if (wheel && (wheel.ctrlKey || Math.abs(wheel.deltaX) >= Math.abs(wheel.deltaY))) return;
      // Native scrolling can reach this foot after streamed text has already moved it.
      inputLimit.current = Math.max(0, el.scrollHeight - el.clientHeight);
      if (wheel && wheel.deltaY < 0) following.current = false;
    };
    const events = ['wheel', 'touchmove', 'pointerdown', 'pointermove', 'keydown'] as const;
    // Snapshot the target before native scrolling; passive handlers can run after it.
    for (const name of events) el.addEventListener(name, input, { passive: name !== 'wheel' && name !== 'touchmove' });
    inputBinding.current = { el, dispose: () => { for (const name of events) el.removeEventListener(name, input); } };
  });
  useLayoutEffect(() => () => { inputBinding.current?.dispose(); inputBinding.current = null; }, []);
  const readPosition = (g: ScrollGeometry) => {
    const previous = position.current;
    const limit = Math.max(0, g.scrollHeight - g.height);
    if (previous !== null) {
      // A shorter document can clamp the offset; CSS zoom rounds its actual limit. Only a move that
      // follows the reader's own input counts as scrolling away: the browser can drop the offset by
      // itself, as when a height animation is cancelled and the box briefly takes its natural size.
      if (inputLimit.current !== null && g.top < Math.min(previous.top, limit) - (previous.top > limit ? STOP_EPS : 0)) {
        following.current = false;
        inputLimit.current = null;
      } else if (g.top > previous.top) {
        const target = inputLimit.current ?? previous.limit;
        const slack = inputLimit.current !== null && limit > inputLimit.current ? FOLLOW_SLACK : STOP_EPS;
        following.current = Math.min(target, limit) - g.top <= slack;
      }
      // Input that ends at the foot has done its scrolling; a later drop is the browser's.
      if (g.top >= previous.top && limit - g.top <= STOP_EPS) inputLimit.current = null;
    }
    position.current = { top: g.top, limit };
  };
  const toFoot = () => {
    const el = ref.current;
    if (!el) return;
    const geometry = readScrollGeometry(el);
    // Rendering can precede the native scroll event for a reader's new offset.
    readPosition(geometry);
    if (!active || !following.current || geometry.scrollHeight - geometry.height - geometry.top <= STOP_EPS) return;
    el.scrollTop = el.scrollHeight;
    position.current = { top: el.scrollTop, limit: geometry.scrollHeight - geometry.height };
    inputLimit.current = null;
  };
  useScrollGeometry(ref, (g, change) => {
    if (change === 'initial') {
      position.current = null;
      inputLimit.current = null;
      following.current = initial === 'end' || g.scrollHeight <= g.height;
      if (initial === 'start' && ref.current) ref.current.scrollTop = 0;
    } else readPosition(g);
    if (change !== 'scroll') toFoot();
  });
  const followToFoot = useEffectEvent(toFoot);
  useLayoutEffect(() => {
    followToFoot();
  }, [ref, key, epoch, active]);
  return useCallback(() => { following.current = false; inputLimit.current = null; }, []);
}

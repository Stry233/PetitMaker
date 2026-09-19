import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Distance from the foot that still counts as following new content, in pixels. */
const FOLLOW_SLACK = 48;

/**
 * Follows new record content while the reader remains near the foot. Height changes preserve that
 * position, while scrolling within an unchanged box transfers control to the reader.
 */
export function useFollowNewest(
  ref: RefObject<HTMLDivElement | null>, key: unknown, epoch: string, active: boolean,
): void {
  const stuck = useRef(true);
  /** The zone's height at the last reading, so a reshape can be told from a scroll. */
  const boxHeight = useRef(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return undefined;
    const toFoot = () => {
      boxHeight.current = el.clientHeight;
      if (stuck.current) el.scrollTop = el.scrollHeight;
    };
    const onScroll = () => {
      if (el.clientHeight !== boxHeight.current) { toFoot(); return; }
      stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_SLACK;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    boxHeight.current = el.clientHeight;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(toFoot) : null;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [ref, active]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active || !stuck.current) return;
    el.scrollTop = el.scrollHeight;
    boxHeight.current = el.clientHeight;
  }, [ref, key, epoch, active]);
}


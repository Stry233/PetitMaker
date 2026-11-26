/*
 * The bar under a shelf's card row: the design's track and thumb drawn over the native scroll container
 * (whose own scrollbar `.pw-noscroll` hides), writing back to it. The thumb's length is the share of the
 * row on screen and it reaches both ends; it is placed by percentage so it follows any row width.
 */
import { clientPoint } from '../../../platform/device/viewport-space';
import { useEffect, useRef, useState, type DependencyList, type PointerEvent as ReactPointerEvent, type RefObject, type UIEvent } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { usePx } from '../../design/scale';
import { cursors } from '../../design/styles';
import { SCROLL } from './objects/object-shelf';
import { visualRect } from '../../design/visual-rect';
import { useMorphPresence } from '../../primitives/morph';
import { useObservedSize } from '../../primitives/use-observed-size';

/**
 * The row `rowRef` holds as its scrollbar reads it: `row` goes on the row, naming it `id` and reporting
 * its scroll, and `bar` on its `ShelfScrollbar`, which writes back to it. Where it stands and how far it
 * reaches are read off the row's own box in design px (over the shelf's scale), again whenever its box
 * changes or one of `content` does, which lengthens it without changing its box; a change of `reset`
 * starts it at its first card. A press on the track glides there, except under reduced motion; a drag
 * moves it at once, so it stays under the pointer.
 */
export function useShelfScrollbar(rowRef: RefObject<HTMLElement | null>, { id, content, reset }: {
  id: string; content: DependencyList; reset: string;
}): {
  scrollLeft: number;
  row: { id: string; onScroll: (e: UIEvent<HTMLElement>) => void };
  bar: Pick<Props, 'controls' | 'scrollLeft' | 'viewportW' | 'contentW' | 'onScrollTo'>;
} {
  const { scale } = usePx();
  const reduced = useReducedMotionConfig() === true;
  const [scrollLeft, setScrollLeft] = useState(0);
  const [reach, setReach] = useState({ viewportW: 0, contentW: 0 });
  // The row's own box, never a client rect: width, scroll width and offset are one coordinate space.
  useObservedSize(() => rowRef.current, ([row]) => {
    if (!row) return;
    const next = { viewportW: row.clientWidth / scale, contentW: row.scrollWidth / scale };
    setReach((was) => (was.viewportW === next.viewportW && was.contentW === next.contentW ? was : next));
  }, [...content, scale]);
  useEffect(() => {
    if (rowRef.current) rowRef.current.scrollLeft = 0;
    setScrollLeft(0);
  }, [reset, rowRef]);
  const scrollTo = (left: number, smooth: boolean) => {
    const row = rowRef.current;
    if (!row) return;
    const to = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, left));
    if (smooth && !reduced && typeof row.scrollTo === 'function') row.scrollTo({ left: to, behavior: 'smooth' });
    else row.scrollLeft = to;
  };
  return {
    scrollLeft,
    row: { id, onScroll: (e) => setScrollLeft(e.currentTarget.scrollLeft / scale) },
    bar: {
      controls: id, scrollLeft, viewportW: reach.viewportW, contentW: reach.contentW,
      onScrollTo: (left, smooth) => scrollTo(left * scale, smooth),
    },
  };
}

interface Props {
  /** Where the row is scrolled to, and how much of it there is — all in design px. */
  scrollLeft: number;
  viewportW: number;
  contentW: number;
  /** `glide` asks for the move to be arrived at rather than jumped to: a press on the track is a
   *  jump the eye has to follow, where a drag must stay under the pointer. */
  onScrollTo: (left: number, glide: boolean) => void;
  /** The id of the row it scrolls. */
  controls: string;
  /** The bar's name, where the row holds something other than the object shelf's cards. */
  label?: string;
}

export function ShelfScrollbar({ scrollLeft, viewportW, contentW, onScrollTo, label, controls }: Props) {
  const { px } = usePx();
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null);

  const room = Math.max(0, contentW - viewportW);
  const trackW = SCROLL.track.w;
  // With nothing to scroll the thumb is the whole track: the row is entirely on screen, which is
  // what a full thumb says. An empty track would leave the bar reading as a control that lost its
  // handle, and the three items in Facilities are as much a state to report as the forty in Flowers.
  const thumbW = room > 0
    ? Math.max(SCROLL.thumb.minW, trackW * (viewportW / contentW))
    : trackW;
  const travel = trackW - thumbW;
  const left = room > 0 ? (scrollLeft / room) * travel : 0;
  // Named by the share of the row it stands for: a re-arrangement that changes the share crossfades
  // the old thumb into the new one.
  const thumb = useMorphPresence(`shelf-thumb-${Math.round((thumbW / trackW) * 100)}`);

  /** A thumb position (design px from the track's left) back to a scroll offset. */
  const scrollFor = (thumbLeft: number): number => {
    if (travel <= 0) return 0;
    return Math.min(room, Math.max(0, (thumbLeft / travel) * room));
  };

  const pointerToTrack = (clientX: number): number | null => {
    const rect = ref.current ? visualRect(ref.current) : null;
    if (!rect || rect.width === 0) return null;
    return (clientX - rect.left) / (rect.width / trackW);
  };

  const down = (e: ReactPointerEvent, onThumb: boolean) => {
    const at = pointerToTrack(clientPoint(e).x);
    if (at === null) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // Grabbing the thumb keeps the point under the pointer; pressing the track jumps the thumb's
    // centre there, so the press lands where the user aimed rather than a thumb-width away.
    grab.current = onThumb ? at - left : thumbW / 2;
    onScrollTo(scrollFor(at - grab.current), !onThumb);
  };

  return (
    <div
      ref={ref}
      role="scrollbar"
      aria-label={label ?? t('shelf.scrollbar')}
      aria-controls={controls}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(room)}
      aria-valuenow={Math.round(scrollLeft)}
      onPointerDown={(e) => down(e, false)}
      onPointerMove={(e) => {
        if (!e.buttons || grab.current === null) return;
        const at = pointerToTrack(clientPoint(e).x);
        if (at !== null) onScrollTo(scrollFor(at - grab.current), false);
      }}
      onPointerUp={() => { grab.current = null; }}
      style={{
        position: 'absolute', left: 0, top: 0, width: '100%', height: px(SCROLL.thumb.h),
        pointerEvents: room > 0 ? 'auto' : 'none', touchAction: 'none',
        cursor: cursors.clickable,
      }}
    >
      <span
        style={{
          position: 'absolute', left: 0, top: px(SCROLL.track.y - SCROLL.thumb.y),
          width: '100%', height: px(SCROLL.track.h),
          borderRadius: px(SCROLL.track.h), background: SCROLL.track.fill,
        }}
      />
      <span
        data-testid="shell-shelf-thumb"
        {...thumb}
        onPointerDown={(e) => { e.stopPropagation(); down(e, true); }}
        style={{
          position: 'absolute', left: `${(left / trackW) * 100}%`, top: 0,
          width: `${(thumbW / trackW) * 100}%`, height: px(SCROLL.thumb.h),
          borderRadius: px(SCROLL.thumb.h), background: SCROLL.thumb.fill,
        }}
      />
    </div>
  );
}

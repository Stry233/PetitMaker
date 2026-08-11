/*
 * ShelfScrollbar.tsx — the bar under the item row.
 *
 * The row itself is a native scroll container (a wheel, a trackpad swipe and a keyboard tab all
 * move it for free); this draws the design's own track and thumb over it and writes back. The
 * platform scrollbar is hidden by `.pw-noscroll`, so this is the only one the user sees.
 *
 * The thumb's length reports how much of the row is on screen, which is the one thing that tells
 * someone browsing 40 flowers that there are 40, and it REACHES both ends: its travel is the track
 * less its own length, against the row's own scrollable room.
 *
 * It fills whatever box it is given and places the thumb as a PERCENTAGE of it. The drawn track is
 * one width in the design source and the row it reports on is as wide as the window, so a length in
 * design px would be the one number here that could not follow the row. Both shapes are drawn from
 * the design's fills rather than placed as art, for the reason `object-shelf.ts:SCROLL` gives.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../../../i18n/context';
import { usePx } from '../../design/scale';
import { cursors } from '../../design/styles';
import { SCROLL } from './object-shelf';

interface Props {
  /** Where the row is scrolled to, and how much of it there is — all in design px. */
  scrollLeft: number;
  viewportW: number;
  contentW: number;
  /** `glide` asks for the move to be arrived at rather than jumped to: a press on the track is a
   *  jump the eye has to follow, where a drag must stay under the pointer. */
  onScrollTo: (left: number, glide: boolean) => void;
}

export function ShelfScrollbar({ scrollLeft, viewportW, contentW, onScrollTo }: Props) {
  const { px } = usePx();
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null);

  const room = Math.max(0, contentW - viewportW);
  const trackW = SCROLL.track.w;
  // With nothing to scroll the thumb is the whole track: the row is entirely on screen, which is
  // what a full thumb says. An empty track would leave the bar reading as a control that lost its
  // handle, and the three items in 设施 are as much a state to report as the forty in 花草.
  const thumbW = room > 0
    ? Math.max(SCROLL.thumb.minW, trackW * (viewportW / contentW))
    : trackW;
  const travel = trackW - thumbW;
  const left = room > 0 ? (scrollLeft / room) * travel : 0;

  /** A thumb position (design px from the track's left) back to a scroll offset. */
  const scrollFor = (thumbLeft: number): number => {
    if (travel <= 0) return 0;
    return Math.min(room, Math.max(0, (thumbLeft / travel) * room));
  };

  const pointerToTrack = (clientX: number): number | null => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return (clientX - rect.left) / (rect.width / trackW);
  };

  const down = (e: ReactPointerEvent, onThumb: boolean) => {
    const at = pointerToTrack(e.clientX);
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
      aria-label={t('shelf.scrollbar')}
      aria-controls="shell-shelf-row"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(room)}
      aria-valuenow={Math.round(scrollLeft)}
      onPointerDown={(e) => down(e, false)}
      onPointerMove={(e) => {
        if (!e.buttons || grab.current === null) return;
        const at = pointerToTrack(e.clientX);
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

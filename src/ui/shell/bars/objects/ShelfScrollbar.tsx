/*
 * The bar under the item row: the design's track and thumb drawn over the native scroll container (whose
 * own scrollbar `.pw-noscroll` hides), writing back to it. The thumb's length is the share of the row on
 * screen and it reaches both ends; it is placed by percentage so it follows any row width.
 */
import { clientPoint } from '../../../../platform/device/viewport-space';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useT } from '../../../../i18n/context';
import { usePx } from '../../../design/scale';
import { cursors } from '../../../design/styles';
import { SCROLL } from './object-shelf';
import { visualRect } from '../../../design/visual-rect';

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
  // handle, and the three items in Facilities are as much a state to report as the forty in Flowers.
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
      aria-label={t('shelf.scrollbar')}
      aria-controls="shell-shelf-row"
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

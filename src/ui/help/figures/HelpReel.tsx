/*
 * A welcome tips reel standing in a Help page: the tips' own `TourReel`, the clip the reader's locale
 * and form play (`chrome/tour/reels.ts`), so a page that explains exactly what a card recorded shows
 * that recording, under the same loading, poster and reduced-motion rules. Where no reel ships (the
 * offline edition carries none) the page shows the figure's fallback instead (`PageView.tsx`).
 */
import { useMemo, useRef, useState } from 'react';
import { useLocale } from '../../../i18n/context';
import { useReading } from '../../design/reading';
import { useObservedSize } from '../../primitives/use-observed-size';
import { REEL_SIZE, reelFiles, reelForm } from '../../chrome/tour/reels';
import { TourReel } from '../../chrome/tour/TourReel';
import type { TourKind } from '../../chrome/tour/deck';
import { useInView } from './use-in-view';

/** The tallest an upright reel stands in a page, so a phone's reel leaves the words beside it in view. */
const TALL_REEL_MAX_H = 440;
/** The widest a wide reel stands, the column's figure width. */
const WIDE_REEL_MAX_W = 600;

/** The reel `kind` plays for the reader's locale and form in this edition, null where none ships. */
export function useHelpReel(kind: TourKind | null) {
  const locale = useLocale();
  const reading = useReading();
  const form = reelForm(reading.inputMode, reading.shape);
  const files = useMemo(() => (kind ? reelFiles(locale, form, kind) : null), [locale, form, kind]);
  return { files, form };
}

export function HelpReel({ kind }: { kind: TourKind }) {
  const { files, form } = useHelpReel(kind);
  const holdRef = useRef<HTMLDivElement>(null);
  const near = useInView(holdRef);
  const [room, setRoom] = useState(0);
  useObservedSize(() => holdRef.current, ([el]) => { if (el) setRoom(el.clientWidth); }, []);
  if (!files) return null;
  const recorded = REEL_SIZE[form];
  const tall = recorded.h > recorded.w;
  const most = tall ? Math.min(recorded.w, (TALL_REEL_MAX_H * recorded.w) / recorded.h) : Math.min(recorded.w, WIDE_REEL_MAX_W);
  const w = Math.round(Math.max(0, Math.min(most, room || most)));
  const h = Math.round((w * recorded.h) / recorded.w);
  return (
    // The hold states its width, so the column's centring flex does not shrink it to nothing, and clips
    // the reel's fingertip press areas, which reach past a phone column's edge.
    <div ref={holdRef} data-help-reel={kind} data-figure-sized style={{ width: '100%', display: 'flex', justifyContent: 'center', overflowX: 'clip' }}>
      <div style={{ width: w, minHeight: h }}>
        {near && w > 0 && <TourReel files={files} width={w} height={h} centred />}
      </div>
    </div>
  );
}

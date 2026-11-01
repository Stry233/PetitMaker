/*
 * The figure for the tour: the real shell, pictured, under the tour's own window standing on its
 * second card, the reel resting on its poster as every pictured clip does. The window is the live
 * `TourDeck` over a still controller; nothing runs.
 */
import { useMemo } from 'react';
import { INERT } from './PreviewFrame';
import { radii, z } from '../../../design/styles';
import { UiPreviewProvider } from '../../../design/preview';
import { hasWebGL2 } from '../../../../platform/device/device-quality';
import { tourCards } from '../../../chrome/tour/deck';
import { TourDeck } from '../../../chrome/tour/TourDeck';
import type { TourController } from '../../../chrome/tour/use-tour';
import { PicturedShell, useOverviewWidth, usePicturedUiZoom, useWindowSnapshot } from './frame-overview';

const noop = () => {};
/** The card pictured: the first one that teaches a gesture, so the reel and its bars show. */
const PICTURED_CARD = 1;

export function TourPreview() {
  const win = useWindowSnapshot();
  const width = useOverviewWidth(win);
  const scale = width / win.w;
  const cards = useMemo(() => tourCards(hasWebGL2()), []);
  const uiZoom = usePicturedUiZoom(win);
  const pose = useMemo(() => ({ viewport: win, uiZoom }), [win, uiZoom]);
  const tour = useMemo<TourController>(() => ({
    running: true, phase: { kind: 'deck', card: PICTURED_CARD }, cards,
    go: noop, next: noop, back: noop, showMe: noop, stepOn: noop, backToTips: noop, finish: noop,
  }), [cards]);
  return (
    <div
      aria-hidden
      data-figure-miniature
      data-figure-sized
      {...INERT}
      style={{
        position: 'relative', width, height: Math.round(win.h * scale), overflow: 'hidden',
        borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none',
      }}
    >
      {/* At rest, no mode armed, as the editor stands when the tips first open. */}
      <PicturedShell win={win} zoom={scale} mode={null}>
        {/* Posed like the shell under it, so the window draws in the figure rather than over the page,
            and on the tips' own rung over the pictured chrome, as live. */}
        <div style={{ position: 'absolute', inset: 0, zIndex: z.tour }}>
          <UiPreviewProvider pose={pose}><TourDeck tour={tour} open /></UiPreviewProvider>
        </div>
      </PicturedShell>
    </div>
  );
}

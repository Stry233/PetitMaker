/*
 * The figure for the tour: the real shell, pictured, under the tour's own window standing on its
 * second card, the reel resting on its poster as every pictured clip does. The window is the live
 * `TourDeck` over a still controller; nothing runs.
 */
import { useMemo } from 'react';
import { INERT } from './PreviewFrame';
import { radii } from '../../../design/styles';
import { UiPreviewProvider } from '../../../design/preview';
import { hasWebGL2 } from '../../../../platform/device/device-quality';
import { tourCards } from '../../../chrome/tour/deck';
import { TourDeck } from '../../../chrome/tour/TourDeck';
import type { TourController } from '../../../chrome/tour/use-tour';
import { PicturedShell, useWindowSnapshot } from './frame-overview';

const noop = () => {};
/** The card pictured: the first one that teaches a gesture, so the reel and its bars show. */
const PICTURED_CARD = 1;

export function TourPreview() {
  const win = useWindowSnapshot();
  const width = 560;
  const scale = width / win.w;
  const cards = useMemo(() => tourCards(hasWebGL2()), []);
  const pose = useMemo(() => ({ viewport: win }), [win]);
  const tour = useMemo<TourController>(() => ({
    running: true, phase: { kind: 'deck', card: PICTURED_CARD }, cards,
    go: noop, next: noop, back: noop, showMe: noop, stepOn: noop, backToTips: noop, finish: noop,
  }), [cards]);
  return (
    <div
      aria-hidden
      {...INERT}
      style={{
        position: 'relative', width, height: Math.round(win.h * scale), overflow: 'hidden',
        borderRadius: radii.md, pointerEvents: 'none', userSelect: 'none',
      }}
    >
      <PicturedShell win={win} zoom={scale}>
        {/* Posed like the shell under it, so the window draws in the figure rather than over the page. */}
        <UiPreviewProvider pose={pose}><TourDeck tour={tour} open /></UiPreviewProvider>
      </PicturedShell>
    </div>
  );
}

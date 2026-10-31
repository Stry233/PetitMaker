/** The running tour: its window of cards and recap, or the Show me standing in for it on the live interface. */
import { useEffect, useMemo } from 'react';
import { hasWebGL2 } from '../../../platform/device/device-quality';
import { useEditorStore } from '../../../state/store';
import { tourCards } from './deck';
import { ShowMe } from './ShowMe';
import { TourDeck } from './TourDeck';
import { useTour } from './use-tour';

export function Tour() {
  const cards = useMemo(() => tourCards(hasWebGL2()), []);
  const tour = useTour(cards);
  const { phase } = tour;
  const shown = phase.kind === 'show' ? cards[phase.card] : undefined;
  // A Show me needs its surface: the tour leaving the screen (a planet session's frame) returns it to its card.
  useEffect(() => () => useEditorStore.getState().leaveShowMe(), []);
  return (
    <>
      <TourDeck tour={tour} open={tour.running && phase.kind !== 'show'} />
      {tour.running && phase.kind === 'show' && shown && (
        <ShowMe key={shown.kind} card={shown} step={phase.step} onStepOn={tour.stepOn} onBack={tour.backToTips} />
      )}
    </>
  );
}

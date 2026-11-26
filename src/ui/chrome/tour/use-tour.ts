/*
 * The tour's run. A run is the deck of cards, a Show me standing in for the deck while it rings the
 * live controls, and the recap at the end; the store owns where it stands
 * (`state/slices/shell.ts:tourPhase`), which does not persist, because a tour resumed halfway through
 * reads worse than one started again.
 *
 * The offer is recorded as a run starts (`state/tour-offer.ts`), so a reload part-way through does not
 * replay it; Settings and Help are the way back, through the command `tour.start`.
 */
import { useCallback, useMemo } from 'react';
import { useEditorStore } from '../../../state/store';
import { firstLaunchTour, tourVisitStanding } from '../../../state/tour-offer';
import { FIRST_TOUR_PHASE, type TourPhase } from '../../../state/slices/shell';
import { hasAutosave } from '../../../io/storage/facts';
import { TOUR_KINDS, type TourCard } from './deck';
import { playedReel, reelFiles, reelForm } from './reels';

export type { TourPhase };

/** What a visit about to open the tour fetches while the loading screen stands: the opening card's
 *  poster, timing and the clip its `<video>` will choose, in the reader's locale and form. Nothing
 *  where the tour will not open. */
export function tourWarmFiles(): string[] {
  if (firstLaunchTour(tourVisitStanding(), hasAutosave()) !== 'run') return [];
  const { locale, inputMode, layoutShape } = useEditorStore.getState();
  const files = reelFiles(locale, reelForm(inputMode, layoutShape), TOUR_KINDS[0]);
  if (!files) return [];
  return [files.poster, files.timing, playedReel(files)].filter((url): url is string => url !== null);
}

export interface TourController {
  running: boolean;
  phase: TourPhase;
  cards: readonly TourCard[];
  go(card: number): void;
  next(): void;
  back(): void;
  showMe(): void;
  /** Moves a Show me on from `step`, or back to its card after the last. */
  stepOn(step: number): void;
  /** Leaves a Show me for its card. */
  backToTips(): void;
  /** Ends the run: Skip, Escape and the recap's Start building. */
  finish(): void;
}

/** Drives the run over `cards`, the deck this device offers, through the store's one transition. */
export function useTour(cards: readonly TourCard[]): TourController {
  const running = useEditorStore((s) => s.tourRunning);
  const phase = useEditorStore((s) => s.tourPhase);
  const move = useEditorStore((s) => s.moveTour);
  const finish = useEditorStore((s) => s.finishTour);
  const backToTips = useEditorStore((s) => s.leaveShowMe);
  const deck = useMemo(() => cards.map((card) => card.show?.length ?? 0), [cards]);
  const go = useCallback((card: number) => move({ kind: 'go', card }, deck), [deck, move]);
  const next = useCallback(() => move({ kind: 'next' }, deck), [deck, move]);
  const back = useCallback(() => move({ kind: 'back' }, deck), [deck, move]);
  const showMe = useCallback(() => move({ kind: 'showMe' }, deck), [deck, move]);
  const stepOn = useCallback((from: number) => move({ kind: 'stepOn', from }, deck), [deck, move]);

  return { running, phase: running ? phase : FIRST_TOUR_PHASE, cards, go, next, back, showMe, stepOn, backToTips, finish };
}

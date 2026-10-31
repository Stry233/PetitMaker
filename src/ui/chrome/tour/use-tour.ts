/*
 * The tour's run and its offer. A run is the deck of cards, a Show me standing in for the deck while
 * it rings the live controls, and the recap at the end; the store owns where it stands
 * (`state/slices/shell.ts:tourPhase`), which does not persist, because a tour resumed halfway through
 * reads worse than one started again.
 *
 * The offer is recorded as a run starts (`state/tour-offer.ts`), so a reload part-way through does not
 * replay it; Settings and Help are the way back.
 */
import { useCallback, useEffect } from 'react';
import { useEditorStore } from '../../../state/store';
import { firstLaunchTour, recordTourOffered, takeVisitStart, tourStanding, visitStanding, type TourStanding } from '../../../state/tour-offer';
import { FIRST_TOUR_PHASE, type TourPhase } from '../../../state/slices/shell';
import { hasAutosave } from '../../../io/storage/facts';
import { TOUR_KINDS, type TourCard } from './deck';
import { TOUR_VERSION } from './version';
import { playedReel, reelFiles, reelForm } from './reels';

export type { TourPhase };

/** Where this browser stood with the tour this build offers as this page found it, whatever the
 *  page has recorded since. */
export function tourVisitStanding(): TourStanding {
  return visitStanding(TOUR_VERSION);
}

/** Whether the offer is answered for this build's tour: the tour ran or was waived, or this
 *  browser cannot keep the answer. Until then a visit may be a frame away from opening it. */
export function tourSettled(): boolean {
  return tourStanding(TOUR_VERSION) === 'offered';
}

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

/** Run the tour from its first card. Used by the startup check, Settings and Help. */
export function startTour(): void {
  useEditorStore.getState().startTour(TOUR_VERSION);
}

/** Offer the tour once per version, as the editor first shows: the visit's start acts once a page,
 *  so a re-render or a remount after a skip cannot start it again. `hasSavedMap` is passed in: the
 *  app has already read the autosave for the welcome-back offer. A pictured shell (`live` false)
 *  never offers it. */
export function useFirstLaunchTour(hasSavedMap: boolean, live = true): void {
  useEffect(() => {
    if (!live) return;
    const decision = takeVisitStart(TOUR_VERSION, hasSavedMap);
    if (decision === 'waive') recordTourOffered(TOUR_VERSION);
    else if (decision === 'run') startTour();
  }, [hasSavedMap, live]);
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

const phaseNow = (): TourPhase => useEditorStore.getState().tourPhase;

/** Drives the run over `cards`, the deck this device offers, through the store's one transition. */
export function useTour(cards: readonly TourCard[]): TourController {
  const running = useEditorStore((s) => s.tourRunning);
  const phase = useEditorStore((s) => s.tourPhase);
  const setPhase = useEditorStore((s) => s.setTourPhase);
  const finish = useEditorStore((s) => s.finishTour);
  const backToTips = useEditorStore((s) => s.leaveShowMe);
  const go = useCallback((card: number) => setPhase({ kind: 'deck', card: Math.max(0, Math.min(cards.length - 1, card)) }), [cards.length, setPhase]);
  const next = useCallback(() => {
    const p = phaseNow();
    if (p.kind === 'deck') setPhase(p.card < cards.length - 1 ? { kind: 'deck', card: p.card + 1 } : { kind: 'recap' });
  }, [cards.length, setPhase]);
  const back = useCallback(() => {
    const p = phaseNow();
    if (p.kind === 'deck' && p.card > 0) setPhase({ kind: 'deck', card: p.card - 1 });
  }, [setPhase]);
  const showMe = useCallback(() => {
    const p = phaseNow();
    if (p.kind === 'deck' && cards[p.card]?.show?.length) setPhase({ kind: 'show', card: p.card, step: 0 });
  }, [cards, setPhase]);
  const stepOn = useCallback((from: number) => {
    const p = phaseNow();
    if (p.kind !== 'show' || p.step !== from) return;
    const steps = cards[p.card]?.show?.length ?? 0;
    setPhase(from + 1 < steps ? { ...p, step: from + 1 } : { kind: 'deck', card: p.card });
  }, [cards, setPhase]);

  return { running, phase: running ? phase : FIRST_TOUR_PHASE, cards, go, next, back, showMe, stepOn, backToTips, finish };
}

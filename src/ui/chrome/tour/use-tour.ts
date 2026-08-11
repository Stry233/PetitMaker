/*
 * The tour's state: whether it has been seen, and whether it is running now.
 *
 * "Seen" persists; the step index does not, because a tour resumed halfway through is a worse
 * experience than one started again. Skipping counts as seen: the tour is a courtesy, and someone
 * who skipped has made their choice.
 *
 * "Seen" is written when the tour STARTS, not when it ends: a reload halfway through would
 * otherwise replay it from step one, which is the same tour again for someone who was already
 * partway out of it. The cost is that a reload during the first minute spends the one automatic
 * offer; the Settings row is the way back, and it is the way anyone replays it anyway.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../../../state/store';
import { PREFS } from '../../../core/runtime/prefs';
import type { TourStep } from './steps';

export const TOUR_SEEN_KEY = PREFS.tourSeen.key;

/** Whether this browser has already been offered the tour. A browser without localStorage reads as
 *  seen: the alternative is showing the tour on every single visit. Bypasses `readPref`: an
 *  unreadable/absent flag means "seen" here, the opposite of readPref's generic false fallback,
 *  since a browser this offer cannot persist to must not repeat it. */
export function hasSeenTour(): boolean {
  if (typeof localStorage === 'undefined') return true;
  try {
    return localStorage.getItem(PREFS.tourSeen.key) === '1';
  } catch {
    return true; // storage present but refusing (private mode, quota) — same reasoning
  }
}

export function markTourSeen(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PREFS.tourSeen.key, '1');
  } catch { /* nothing to do: the tour simply offers itself again next time */ }
}

/** Run the tour from its first step. Used by the startup check and by the Settings replay row. */
export function startTour(): void {
  markTourSeen();
  useEditorStore.getState().setTourRunning(true);
}

export interface TourController {
  running: boolean;
  step: TourStep | null;
  index: number;
  /** How many steps THIS run has, which is not always how many the array has. */
  total: number;
  isLast: boolean;
  /** Where a step sits in this run, 0-based, or -1 for one the run left out. The overlay's card can
   *  be showing a step the index has already moved past, so its counter is numbered from the step
   *  ON it rather than from the current index. */
  indexOf(step: TourStep): number;
  next(): void;
  /** Advance from a NAMED step rather than from the current index. The overlay's card can lag the
   *  current step while a target settles, and a Next press in that window must move on from the
   *  step the visitor actually read, not from the one already being measured. */
  advanceFrom(from: TourStep): void;
  skip(): void;
}

/** Drives one run of the tour. The index resets as a run ends, so the next one opens on step one.
 *
 *  `steps` is the mounted shell's own step list, since what a step can point at is whatever that
 *  interface draws. */
export function useTour(steps: readonly TourStep[]): TourController {
  const running = useEditorStore((s) => s.tourRunning);
  const setTourRunning = useEditorStore((s) => s.setTourRunning);
  const setModal = useEditorStore((s) => s.setModal);
  const [index, setIndex] = useState(0);

  // The index is reset HERE, as a run ends, rather than by an effect watching `running`: the overlay
  // stays mounted for the app's life, so a passive reset lands a commit late and the first commit of
  // a replay renders (announces, applies the menu action of, and paints) the step the last run
  // stopped on. `finish` is the only path out of a run, so this is the whole reset.
  const finish = useCallback((completed: boolean) => {
    markTourSeen(); // already written by startTour; repeated here so a run opened any other way ends seen
    setIndex(0);
    setTourRunning(false);
    // The send-off is for reaching the end. Skipping is a request to be left alone, and a
    // congratulation on top of it would be the tour talking back.
    if (completed) setModal('tourDone', true);
  }, [setTourRunning, setModal]);

  const skip = useCallback(() => finish(false), [finish]);

  const advanceFrom = useCallback((from: TourStep) => {
    // The updater stays pure: StrictMode invokes it twice, so a side effect placed inside would fire twice on the final step.
    const i = steps.indexOf(from);
    if (i < 0 || i >= steps.length - 1) { finish(true); return; }
    setIndex(() => i + 1);
  }, [finish, steps]);

  const next = useCallback(() => {
    const current = steps[index];
    if (current) advanceFrom(current); else finish(true);
  }, [index, steps, advanceFrom, finish]);

  const indexOf = useCallback((step: TourStep) => steps.indexOf(step), [steps]);

  return {
    running,
    step: running ? steps[index] ?? null : null,
    index,
    total: steps.length,
    isLast: index === steps.length - 1,
    indexOf,
    next,
    advanceFrom,
    skip,
  };
}

/** Offer the tour once, on the first visit this browser has made. Runs its check a single time, so
 *  a re-render after a skip cannot start it again.
 *
 *  `blocked` defers the offer while something else owns the screen: App passes the portrait guard's
 *  state, since a tour that points at panels covered by a "please rotate" overlay points at nothing.
 *
 *  `hasSavedMap` is passed in rather than read here: App already deserializes the autosave for the
 *  restore offer, and reading it a second time on the cold-start path costs a full parse of a map
 *  that can be 169x140. */
export function useFirstLaunchTour(blocked: boolean, hasSavedMap: boolean): void {
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current || blocked) return;
    checked.current = true;
    if (hasSeenTour()) return;
    // A saved map with real content proves this browser has used the editor before (every existing
    // user reaches this build with an autosave and no seen flag), so the first-launch offer does
    // not apply to it; Settings still carries the replay for anyone who wants the tour anyway.
    if (hasSavedMap) { markTourSeen(); return; }
    startTour();
  }, [blocked, hasSavedMap]);
}

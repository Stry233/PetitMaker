/** A generate card's click on its way to the map: which card is landing, which landed, and which failed. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Outcome } from '../../../../editor/operations';
import { landCandidate, type Landing, type LandingRequest } from '../../../../editor/editing/generate-batch';

/** How long a card says it did not build, in ms: read where the eye is, gone before the next click. */
const FAILED_MS = 4000;

export function useCandidateLanding(onLanded: (outcome: Outcome) => void) {
  const [landingIndex, setLandingIndex] = useState<number | null>(null);
  const [appliedIndex, setAppliedIndex] = useState<number | null>(null);
  const [failedIndex, setFailedIndex] = useState<number | null>(null);
  const failedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The landing on its way; closing the shelf cancels it. */
  const landing = useRef<Landing | null>(null);

  const clearFailed = useCallback(() => {
    if (failedTimer.current) clearTimeout(failedTimer.current);
    failedTimer.current = null;
    setFailedIndex(null);
  }, []);
  useEffect(() => () => {
    clearFailed();
    landing.current?.abort();
  }, [clearFailed]);

  /** Lets go of the landed card and leaves its run standing: the click was the answer, and undo is the way back. */
  const forgetApplied = useCallback(() => setAppliedIndex(null), []);

  /** One card lands at a time; a run that threw rolled itself back, so the card says so. */
  const land = useCallback(async (index: number, ask: LandingRequest) => {
    if (landingIndex !== null) return;
    const run = landCandidate(ask);
    if (!run) return;
    forgetApplied();
    clearFailed();
    setLandingIndex(index);
    landing.current = run;
    try {
      const outcome = await run.done;
      if (!outcome) return;
      setAppliedIndex(index);
      onLanded(outcome);
    } catch {
      setFailedIndex(index);
      failedTimer.current = setTimeout(() => { failedTimer.current = null; setFailedIndex(null); }, FAILED_MS);
    } finally {
      if (landing.current === run) landing.current = null;
      setLandingIndex(null);
    }
  }, [landingIndex, forgetApplied, clearFailed, onLanded]);

  return { landingIndex, appliedIndex, failedIndex, land, forgetApplied, clearFailed };
}

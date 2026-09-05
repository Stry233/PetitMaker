/**
 * Produces the one-shot celebration pose when a newly settled job's projected `celebrate` flag is
 * true. The first render seeds the seen sequence so restored sessions stay quiet. State stores the
 * celebrated order id, allowing either the timer or any newer settlement to end the pose.
 */
import { useEffect, useRef, useState } from 'react';
import type { PanelView } from '../../../agent/core/project-view';
import { POSES, type PoseName } from './poses';

/** How long the one-shot runs before settling back to `idle`, per its own spec. */
const CELEBRATE_MS = POSES.celebrating.settleAt ?? 0;

export function useCelebrateEdge(view: PanelView): PoseName | undefined {
  const newest = view.jobs[view.jobs.length - 1];
  const seq = newest?.orderSeq;
  const worth = newest?.celebrate === true;

  const seen = useRef<number | undefined>(undefined);
  const seeded = useRef(false);
  /** The `orderSeq` being celebrated, or undefined for nobody. */
  const [celebratingFor, setCelebratingFor] = useState<number | undefined>(undefined);

  useEffect(() => {
    const first = !seeded.current;
    seeded.current = true;
    if (seq === seen.current) return undefined;
    seen.current = seq;
    // The first run only records what was already on the log. There is no edge to a session that
    // was restored mid-sentence, and a panel that danced on every mount would be lying about when.
    if (first || seq === undefined || !worth) {
      // Any other settlement ENDS a dance in progress rather than leaving it standing. Setting
      // undefined over undefined is a no-op React bails out of, so the ordinary path costs nothing.
      setCelebratingFor(undefined);
      return undefined;
    }
    setCelebratingFor(seq);
    const timer = setTimeout(() => setCelebratingFor(undefined), CELEBRATE_MS);
    return () => clearTimeout(timer);
  }, [seq, worth]);

  // The equality, not just the presence: a state that named a job the log has moved past cannot
  // paint, whatever order the render and the effect happen to run in.
  return celebratingFor !== undefined && celebratingFor === seq ? 'celebrating' : undefined;
}

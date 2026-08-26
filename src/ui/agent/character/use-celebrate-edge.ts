/*
 * use-celebrate-edge.ts — the one pose that is a MOMENT rather than a state.
 *
 * `poseForPhase` answers from the phase, which is what the session IS; celebrating is what just
 * HAPPENED, and the two cannot come from the same reading. A job finishing well leaves the session
 * at `idle`, and `idle` is also where a session sits an hour later, where a stopped job leaves it,
 * and where a restored log opens — so a pose driven off the phase would either celebrate forever or
 * celebrate on arrival at a map somebody else built.
 *
 * SO IT IS AN EDGE, and the edge is the newest SETTLED job's `orderSeq` CHANGING while that job is
 * one worth dancing about. Not the phase, not the job count, not the outcome:
 *  - the seq is the identity of the job, so a second celebrated job is a second celebration and a
 *    re-render of the same one is none;
 *  - the ref is SEEDED on the first run rather than starting empty, which is what makes a restored
 *    session silent: the job was already there when the panel opened, so nothing changed;
 *  - WHETHER IT IS WORTH DANCING ABOUT IS `JobView.celebrate`, DECIDED IN THE PROJECTION and never
 *    re-derived here. `settle` answers it once — done, at least one write LANDED, and not ended on
 *    a question — so the two hosts that read this hook, the history line and the dock all agree by
 *    construction. Read off `outcome` instead, this danced over a refusal, over a map question
 *    answered from three reads, over a silent giveup, and over a job that had just asked the user
 *    something and was waiting for the reply.
 *
 * It holds for `POSES.celebrating.settleAt` — the pose's own one-shot length, read from the table
 * rather than restated, so the pose and the state it is shown in end together.
 *
 * AND IT BELONGS TO THE JOB IT IS ABOUT. The state is the celebrated job's `orderSeq`, not a
 * boolean, because the dance has TWO ways to end and a flag only covers one of them: the clock
 * running out, and the next job settling. A flag made the second one unreachable — the effect's
 * cleanup killed the timer, the new job took the non-firing branch and never lowered it, and the
 * character danced on over its own failure banner until something else finished well. Held as a seq
 * it cannot outlive its job: the moment a newer one settles, the seq no longer matches and the pose
 * is over, before the effect has even run.
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

/**
 * The one safety model every take-back in the panel reads, and the job readings beside it.
 *
 * A rewind must not pop the user's own later edits off the undo stack in silence. The model's job is
 * to state what a press costs and which part of that cost was never the job's, and where taking a job
 * back rewinds to.
 */
import { describe, it, expect } from 'vitest';
import {
  editCount, jobStanding, jobTotals, keyGone, readCount, rewindBlock, rollbackCost, rolledBackSeqs, stageTotals, takeBackStanding,
  type StandingInputs,
} from '../../../agent/core/job-readings';
import type { JobView, OpRow, PanelView } from '../../../agent/core/view-types';

/** A job with checkpoints at these undo watermarks. */
const job = (orderSeq: number, ...marks: number[]) => ({ orderSeq, checkpoints: marks.map((undoIndex) => ({ undoIndex })) }) as unknown as JobView;

describe('rollbackCost: what a press would pop', () => {
  it('counts every entry above the watermark, not the job\'s own edits', () => {
    // The job wrote 4 (depth 3 -> 7), and the user then laid 12 by hand.
    expect(rollbackCost(3, 19, 7)).toEqual({ steps: 16, mine: 12 });
  });

  it('reports no later work of the user\'s where the map has not moved since the job', () => {
    expect(rollbackCost(3, 7, 7)).toEqual({ steps: 4, mine: 0 });
  });

  it('leaves the split UNKNOWN rather than guessing where the record banked no settle depth', () => {
    const cost = rollbackCost(3, 19);
    expect(cost).toEqual({ steps: 16 });
    expect(cost?.mine).toBeUndefined();
  });

  it('answers nothing at all where the live depth is unknown', () => {
    expect(rollbackCost(3, undefined, 7)).toBeNull();
  });

  it('measures a MID-JOB watermark against the same settle depth', () => {
    // Rewinding to the job's second checkpoint (depth 5) with 12 later hand edits standing.
    expect(rollbackCost(5, 19, 7)).toEqual({ steps: 14, mine: 12 });
  });

  it('never reports a negative count when the stack already stands below the watermark', () => {
    expect(rollbackCost(7, 3, 9)).toEqual({ steps: 0, mine: 0 });
  });
});

describe('takeBackStanding: whether a take-back may run, where it rewinds to and what it costs', () => {
  /** A settled job with checkpoints at depths 3 and 5, settled at depth 7. */
  const built = { ...job(4, 3, 5), endUndoIndex: 7 } as JobView;
  const idle = { running: false, undoDepth: 19 };

  it('rewinds the whole job to its first checkpoint and one step to its own, at the stated cost', () => {
    expect(takeBackStanding(built, 'whole', idle)).toEqual({ at: 3, cost: { steps: 16, mine: 12 } });
    expect(takeBackStanding(built, 1, idle)).toEqual({ at: 5, cost: { steps: 14, mine: 12 } });
  });

  it('states no cost where the live depth is unknown, and still names where it rewinds to', () => {
    expect(takeBackStanding(built, 'whole', { running: false })).toEqual({ at: 3, cost: null });
  });

  it('refuses while a job runs', () => {
    expect(takeBackStanding(built, 'whole', { ...idle, running: true })).toEqual({ refused: 'busy' });
    expect(takeBackStanding(built, 1, { ...idle, running: true })).toEqual({ refused: 'busy' });
  });

  it('refuses a record of another map, and one whose map cannot be told', () => {
    expect(takeBackStanding(built, 'whole', { ...idle, otherMap: new Set([4]) })).toEqual({ refused: 'other-map' });
    expect(takeBackStanding(built, 0, { ...idle, unknownMap: new Set([4]) })).toEqual({ refused: 'unknown-map' });
  });

  it('refuses where the press would pop nothing: no such checkpoint, or a stack already at or below it', () => {
    expect(takeBackStanding(job(1), 'whole', idle)).toEqual({ refused: 'nothing' });
    expect(takeBackStanding(built, 2, idle)).toEqual({ refused: 'nothing' });
    expect(takeBackStanding(built, 'whole', { running: false, undoDepth: 3 })).toEqual({ refused: 'nothing' });
    expect(takeBackStanding(built, 1, { running: false, undoDepth: 4 })).toEqual({ refused: 'nothing' });
  });

  it('says a lasting refusal before the passing one, so a control that never returns is not drawn as waiting', () => {
    const running = { running: true, undoDepth: 19 };
    expect(takeBackStanding(built, 'whole', { ...running, otherMap: new Set([4]) })).toEqual({ refused: 'other-map' });
    expect(takeBackStanding(built, 'whole', { running: true, undoDepth: 3 })).toEqual({ refused: 'nothing' });
  });
});

describe('taking a whole job back', () => {
  it('rewinds to its first checkpoint, and has nowhere to go without one', () => {
    expect(takeBackStanding(job(1, 3, 5), 'whole', { running: false, undoDepth: 9 })).toMatchObject({ at: 3 });
    expect(takeBackStanding(job(1), 'whole', { running: false, undoDepth: 9 })).toEqual({ refused: 'nothing' });
  });

  it('counts a job rolled back once the undo depth falls to its first checkpoint', () => {
    const jobs = [job(1, 3, 5), job(2, 8), job(3)];
    expect([...rolledBackSeqs(jobs, 3)]).toEqual([1, 2]);
    expect([...rolledBackSeqs(jobs, 9)]).toEqual([]);
    expect([...rolledBackSeqs(jobs, undefined)]).toEqual([]);
  });
});

/** A projected job, settled or current as `over` says. */
function jobOf(over: Partial<JobView> = {}): JobView {
  return {
    orderSeq: 1, orderText: 'Build', orderAt: 0, ops: [], steerNotes: [], checkpoints: [], stamps: [],
    celebrate: false, asks: [], skills: [], ...over,
  };
}

function viewOf(over: Partial<PanelView> = {}): PanelView {
  return { phase: 'idle', jobs: [], queuedSteers: [], vitals: { cells: 0, objects: 0, reverts: 0, jobs: 0 }, suggestion: null, lastEventAt: 0, ...over };
}

function standingOf(over: Partial<StandingInputs> = {}): ReturnType<typeof jobStanding> {
  return jobStanding({
    view: viewOf(), connected: true, openedSeq: null, filed: new Set(), cleared: new Set(), restored: false, dismissed: null, ...over,
  });
}

describe('jobStanding: where each job of the session stands', () => {
  it('stands the newest settled job as its card and keeps it out of history', () => {
    const done = jobOf({ orderSeq: 2, outcome: 'done' });
    const standing = standingOf({ view: viewOf({ jobs: [jobOf({ outcome: 'done' }), done] }) });
    expect(standing.settled?.job).toBe(done);
    expect(standing.past.map((j) => j.orderSeq)).toEqual([1]);
  });

  it('offers a restored pause for resumption instead of a live ticket card', () => {
    const held = jobOf({ orderSeq: 3 });
    expect(standingOf({ view: viewOf({ phase: 'paused', current: held }), restored: true }).offered).toBe(held);
  });

  it('keeps a keyless session\'s stopped job and offers it for repair, until it is filed', () => {
    const stopped = jobOf();
    const standing = standingOf({ connected: false, view: viewOf({ phase: 'paused', current: stopped }) });
    expect([standing.keyCleared, standing.offered]).toEqual([true, stopped]);
    expect(standingOf({ connected: false, view: viewOf({ phase: 'paused', current: stopped }), filed: new Set([1]) }).keyCleared).toBe(false);
  });

  it('replaces the card with an opened past record, and opens none over a current job', () => {
    const jobs = [jobOf({ orderSeq: 1, outcome: 'done' }), jobOf({ orderSeq: 2, outcome: 'done' })];
    const standing = standingOf({ view: viewOf({ jobs }), openedSeq: 1 });
    expect([standing.opened, standing.settled]).toEqual([jobs[0], null]);
    expect(standingOf({ view: viewOf({ jobs, current: jobOf({ orderSeq: 3 }) }), openedSeq: 1 }).opened).toBeUndefined();
  });

  it('demotes the incident the user dismissed to its standing strip', () => {
    const jobs = [jobOf({ orderSeq: 4, outcome: 'incident', errorCls: 'network' })];
    const standing = standingOf({ view: viewOf({ phase: 'incident', jobs }), dismissed: 4 });
    expect([standing.incident, standing.standingTrouble]).toEqual([{ cls: 'network', seq: 4 }, true]);
  });

});

describe('jobTotals and stageTotals: what a job and each of its stages amounted to', () => {
  const op = (over: Partial<OpRow>): OpRow => ({ callId: 'c', name: 'build_road', status: 'ok', summary: '', isRead: false, ...over });
  const built = jobOf({
    ops: [
      op({ isRead: true, stageIndex: 0 }),
      op({ detail: { cells: 118 }, stageIndex: 0 }),
      op({ detail: { cells: 4, objects: 6 }, stageIndex: 1 }),
      op({ isRead: true, stageIndex: 1 }),
    ],
  });

  it('sums the cells and objects the results report and counts the reads, over the whole job', () => {
    expect(jobTotals(built)).toEqual({ cells: 122, objects: 6, reads: 2 });
    expect([editCount(built), readCount(built)]).toEqual([128, 2]);
  });

  it('gives a stage the figures of the operations filed under it, and none to a stage with no work', () => {
    expect(stageTotals(built, 0)).toEqual({ cells: 118, objects: 0, reads: 1 });
    expect(stageTotals(built, 1)).toEqual({ cells: 4, objects: 6, reads: 1 });
    expect(stageTotals(built, 2)).toEqual({ cells: 0, objects: 0, reads: 0 });
  });
});

describe('keyGone: the key went missing under a job that needed it', () => {
  it('never while connected', () => {
    expect(keyGone(viewOf({ phase: 'executing' }), true, undefined)).toBe(false);
  });

  it('keyless while a job is in flight, held or stopped, not at an idle rest', () => {
    expect((['executing', 'gated', 'paused', 'aborted', 'idle'] as const).map((phase) => keyGone(viewOf({ phase }), false, undefined)))
      .toEqual([true, true, true, true, false]);
  });

  it('on an incident only when authentication failed', () => {
    expect([keyGone(viewOf({ phase: 'incident' }), false, 'auth'), keyGone(viewOf({ phase: 'incident' }), false, 'network')]).toEqual([true, false]);
  });
});

describe('rewindBlock: why taking a job back may not rewind this map', () => {
  it('names another map before an unknown one, and nothing for a job of this map', () => {
    const one = jobOf({ orderSeq: 1 });
    expect(rewindBlock(one, new Set([1]), new Set([1]))).toBe('other-map');
    expect(rewindBlock(one, new Set(), new Set([1]))).toBe('unknown-map');
    expect(rewindBlock(one)).toBeUndefined();
  });
});

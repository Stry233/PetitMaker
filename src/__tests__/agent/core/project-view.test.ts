import { describe, expect, it } from 'vitest';
import { append, createLog } from '../../../agent/core/log';
import { deriveView, type JobView, type PanelView } from '../../../agent/core/project-view';
import type { Part, PlanStage } from '../../../agent/core/types';

describe('deriveView', () => {
  it('1. empty log: phase idle, no jobs, no current', () => {
    const log = createLog(() => 0);
    const view = deriveView(log);
    expect(view.phase).toBe('idle');
    expect(view.jobs).toEqual([]);
    expect(view.current).toBeUndefined();
  });

  it('2. an order alone: phase thinking, current job holds the order text', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'build a village', mapContext: '' });
    const view = deriveView(log);
    expect(view.phase).toBe('thinking');
    expect(view.current?.orderText).toBe('build a village');
  });

  it('2b. JobView.region reads the order\'s filed region; a job whose order carried none has it undefined', () => {
    const withRegion = createLog(() => 0);
    const region = { count: 3, x1: 1, y1: 2, x2: 4, y2: 5 };
    append(withRegion, { kind: 'order', text: 'build a village', mapContext: '', region });
    expect(deriveView(withRegion).current?.region).toEqual(region);

    const withoutRegion = createLog(() => 0);
    append(withoutRegion, { kind: 'order', text: 'build a village', mapContext: '' });
    expect(deriveView(withoutRegion).current?.region).toBeUndefined();

    // Survives to a settled job too, not only the live one.
    const settled = createLog(() => 0);
    append(settled, { kind: 'order', text: 'go', mapContext: '', region });
    append(settled, { kind: 'jobEnd', outcome: 'done' });
    expect(deriveView(settled).jobs[0]?.region).toEqual(region);
  });

  it('3. a live text part over an active job: phase streaming, current.says mirrors it', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    const live: Part[] = [{ kind: 'text', text: 'thinking about it', done: false }];
    const view = deriveView(log, { live });
    expect(view.phase).toBe('streaming');
    expect(view.current?.says).toBe('thinking about it');
  });

  it('4. an OpRow joins a live tool part with its result: run before, ok with a summary after, isRead from readTools', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    const live: Part[] = [{ kind: 'tool', callId: 'c1', name: 'view_map', input: {}, argsDone: true }];

    const before = deriveView(log, { live, readTools: new Set(['view_map']) });
    expect(before.current?.ops).toEqual([
      { callId: 'c1', name: 'view_map', status: 'run', summary: '', isRead: true },
    ]);

    append(log, { kind: 'toolResult', callId: 'c1', name: 'view_map', content: 'a flat plain\nmore detail', isError: false });
    const after = deriveView(log, { live, readTools: new Set(['view_map']) });
    expect(after.current?.ops).toEqual([
      { callId: 'c1', name: 'view_map', status: 'ok', summary: 'a flat plain', isRead: true },
    ]);
  });

  it('a toolResult carrying a picture projects it onto the row, so the record can show what the model saw', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    const live: Part[] = [{ kind: 'tool', callId: 'c1', name: 'view_map', input: {}, argsDone: true }];
    append(log, { kind: 'toolResult', callId: 'c1', name: 'view_map', content: 'Rendered view attached.', isError: false, image: 'data:image/png;base64,AAAA' });
    const view = deriveView(log, { live, readTools: new Set(['view_map']) });
    expect(view.current?.ops[0]?.image).toBe('data:image/png;base64,AAAA');
  });

  it('5. a toolResult detail decides revert/blocked/error status', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'reverted', isError: true, detail: { reverted: true } });
    append(log, { kind: 'toolResult', callId: 'c2', name: 'place_object', content: 'blocked', isError: true, detail: { regionBlocked: true } });
    append(log, { kind: 'toolResult', callId: 'c3', name: 'place_object', content: 'failed', isError: true });

    const view = deriveView(log);
    const statusOf = (callId: string) => view.current?.ops.find((o) => o.callId === callId)?.status;
    expect(statusOf('c1')).toBe('revert');
    expect(statusOf('c2')).toBe('blocked');
    expect(statusOf('c3')).toBe('error');
  });

  it('6. an unanswered gate: phase gated, gate populated, the row pending-gate; a skip answer: row skipped, phase leaves gated', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });

    const gated = deriveView(log);
    expect(gated.phase).toBe('gated');
    expect(gated.gate).toEqual({ gateId: 'g1', scope: 'tool', summary: 'paint a mountain', callId: 'c1' });
    expect(gated.current?.ops.find((o) => o.callId === 'c1')?.status).toBe('pending-gate');

    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'skip' });
    const answered = deriveView(log);
    expect(answered.phase).not.toBe('gated');
    expect(answered.current?.ops.find((o) => o.callId === 'c1')?.status).toBe('skipped');
  });

  /**
   * A DECLINE AND A CUT ARE DIFFERENT FACTS. The user answering "no" is a decision of theirs; a call
   * that never ran because the job ended under it is not. The panel draws them with different marks,
   * so the fold that knows the difference has to keep it: `skipped` is the decline and nothing else.
   */
  it('6b. a declined call stays `skipped` once the job settles, beside a cut one', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [
        { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true },
        { kind: 'tool', callId: 'c2', name: 'place_object', input: {}, argsDone: true },
      ],
    });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 's' });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'skip' });
    append(log, { kind: 'jobEnd', outcome: 'aborted' });

    const job = deriveView(log).jobs[0];
    expect(job?.ops.find((o) => o.callId === 'c1')?.status).toBe('skipped');
    expect(job?.ops.find((o) => o.callId === 'c2')?.status).toBe('cut');
  });

  /**
   * THE SUMMARY IS THE LINE THAT SAYS SOMETHING. Every write tool words its own refusal as a banner
   * ("REVERTED:", "All commands rejected:") and puts the rule text on the line below, so reading
   * line 0 handed the panel a header and left the one fact a person can act on unread.
   */
  it('6c. a result summary skips the tool\'s own banner and carries the rule line', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'toolResult',
      callId: 'c1',
      name: 'carve_river',
      isError: true,
      content: 'REVERTED:\n[V-WTR-02] Water: the pond needs a closed bank at (3,4).',
      detail: { reverted: true },
    });
    expect(deriveView(log).current?.ops[0]?.summary)
      .toBe('[V-WTR-02] Water: the pond needs a closed bank at (3,4).');
  });

  it('6d. a result that is ALL banner reports nothing rather than the banner', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'undo', isError: true, content: 'REVERTED:' });
    expect(deriveView(log).current?.ops[0]?.summary).toBe('');
  });

  it('6f. the "all rejected"/"partially applied" banners are skipped like REVERTED is', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'toolResult', callId: 'c1', name: 'paint_terrain', isError: true,
      content: 'All commands rejected:\n(3,4): Terrain: cannot build on cells occupied by objects',
    });
    append(log, {
      kind: 'toolResult', callId: 'c2', name: 'paint_terrain', isError: false,
      content: 'Painted 5 cells.\nPartially applied — 2 command(s) rejected:\n(3,4): out of bounds',
    });
    const ops = deriveView(log).current?.ops;
    expect(ops?.find((o) => o.callId === 'c1')?.summary)
      .toBe('(3,4): Terrain: cannot build on cells occupied by objects');
    // The success line leads here, so the header rule is never even consulted for it.
    expect(ops?.find((o) => o.callId === 'c2')?.summary).toBe('Painted 5 cells.');
  });

  /** A colon at the end of a line is not by itself a refusal banner: a SUCCESS result routinely
   *  opens on one too ("Legal … anchors (…):", "Available skills:"), and treating every trailing
   *  colon as a header buried the model's own answer behind the sentence introducing it. */
  it('6g. a success result leading with a colon is its own summary, not skipped as a header', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'toolResult', callId: 'c1', name: 'find_bridge_sites', isError: false,
      content: 'Legal bridge-plank anchors (pass x,y straight to place_object):\n(12,4) rot=0 span=4 elev=2',
    });
    append(log, {
      kind: 'toolResult', callId: 'c2', name: 'list_skills', isError: false,
      content: 'Available skills:\ncozy-village (style)\nUse load_skill to get the full playbook.',
    });
    const ops = deriveView(log).current?.ops;
    expect(ops?.find((o) => o.callId === 'c1')?.summary)
      .toBe('Legal bridge-plank anchors (pass x,y straight to place_object):');
    expect(ops?.find((o) => o.callId === 'c2')?.summary).toBe('Available skills:');
  });

  /** The caret on the ticket's says line reports the WORDS still arriving, which the phase cannot:
   *  a turn whose text has landed while a tool runs on reads `executing`, and one whose text has
   *  landed with nothing after it is a finished line rather than a line being typed. */
  it('6e. reports the says line as streaming only while its own text part is unfinished', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    const arriving = deriveView(log, { live: [{ kind: 'text', text: 'Boardwalk fi', done: false }] });
    expect(arriving.current?.saysStreaming).toBe(true);
    const landed = deriveView(log, { live: [{ kind: 'text', text: 'Boardwalk first.', done: true }] });
    expect(landed.current?.says).toBe('Boardwalk first.');
    expect(landed.current?.saysStreaming).toBeUndefined();
  });

  it('7. a steer sits in queuedSteers until delivered (then joins steerNotes) or recalled (then vanishes)', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    const steerA = append(log, { kind: 'steer', text: 'go wider' });
    const queued = deriveView(log);
    expect(queued.queuedSteers).toEqual([{ seq: steerA.seq, text: 'go wider' }]);

    append(log, { kind: 'steerDelivered', steerSeq: steerA.seq });
    const delivered = deriveView(log);
    expect(delivered.queuedSteers).toEqual([]);
    expect(delivered.current?.steerNotes).toEqual(['go wider']);

    const steerB = append(log, { kind: 'steer', text: 'never mind' });
    append(log, { kind: 'steerRecalled', steerSeq: steerB.seq });
    const recalled = deriveView(log);
    expect(recalled.queuedSteers).toEqual([]);
    expect(recalled.current?.steerNotes).toEqual(['go wider']);
  });

  it('8. a retry event: phase retrying with its payload, until a later assistant clears it', () => {
    const log = createLog(() => 5000);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'retry', attempt: 2, cls: 'overloaded', delayMs: 1500 });

    const retrying = deriveView(log);
    expect(retrying.phase).toBe('retrying');
    expect(retrying.retry).toEqual({ attempt: 2, cls: 'overloaded', delayMs: 1500, since: 5000 });

    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'ok', done: true }] });
    const cleared = deriveView(log);
    expect(cleared.phase).not.toBe('retrying');
    expect(cleared.retry).toBeUndefined();
  });

  it('9. pause/resume events move the phase pausing -> paused -> thinking', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'pauseRequested' });
    expect(deriveView(log).phase).toBe('pausing');
    append(log, { kind: 'paused' });
    expect(deriveView(log).phase).toBe('paused');
    append(log, { kind: 'resumed' });
    expect(deriveView(log).phase).toBe('thinking');
  });

  it('10. jobEnd done settles the current job into jobs with its outcome, and the phase returns idle', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'built a village' });

    const view = deriveView(log);
    expect(view.phase).toBe('idle');
    expect(view.current).toBeUndefined();
    expect(view.jobs).toHaveLength(1);
    expect(view.jobs[0]?.outcome).toBe('done');
    expect(view.jobs[0]?.summary).toBe('built a village');
    expect(view.jobs[0]?.orderText).toBe('go');
  });

  it('11. plan + stage events shape current.plan (currentIndex/doneCount from the latest stage)', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    const stages: PlanStage[] = [{ label: 'clear land' }, { label: 'lay roads' }, { label: 'plant trees' }];
    append(log, { kind: 'plan', stages, revision: 1 });
    append(log, { kind: 'stage', index: 0 });
    expect(deriveView(log).current?.plan).toEqual({ stages, currentIndex: 0, doneCount: 0, revision: 1 });

    append(log, { kind: 'stage', index: 2 });
    expect(deriveView(log).current?.plan).toEqual({ stages, currentIndex: 2, doneCount: 2, revision: 1 });
  });

  /**
   * WHICH STAGE A CALL RAN UNDER. The view carries ONE flat op list for the whole job, so without a
   * stamp there is no partition and a finished record can report no per-stage figure at all, which
   * leaves the capped ledger showing stage names and ticks and nothing else. The log names a
   * stage twice, and both are read: the `stage` event the model advances with, and the `stageIndex`
   * the next step boundary banks on a checkpoint.
   */
  it('11b. stamps every call with the plan stage the log had reached when it was registered', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    const stages: PlanStage[] = [{ label: 'read' }, { label: 'pave' }, { label: 'build' }];
    append(log, { kind: 'plan', stages, revision: 1 });
    append(log, { kind: 'toolResult', callId: 'r1', name: 'view_map', content: 'ok', isError: false, write: false });

    // The loop's own order: the model advances, the next boundary banks the watermark.
    append(log, { kind: 'stage', index: 1 });
    append(log, { kind: 'checkpoint', undoIndex: 4, label: 'stage', stageIndex: 1 });
    append(log, { kind: 'toolResult', callId: 'w1', name: 'build_road', content: 'ok', isError: false, write: true, detail: { cells: 118 } });

    // And a checkpoint ALONE names a stage too, which is the only carrier a replayed log may have.
    append(log, { kind: 'checkpoint', undoIndex: 9, label: 'stage', stageIndex: 2 });
    append(log, { kind: 'toolResult', callId: 'w2', name: 'place_object', content: 'ok', isError: false, write: true, detail: { objects: 6 } });

    const ops = deriveView(log).current?.ops ?? [];
    expect(ops.map((op) => [op.callId, op.stageIndex])).toEqual([['r1', 0], ['w1', 1], ['w2', 2]]);
  });

  /** It only ever goes FORWARD: a checkpoint banks a stage the `stage` event already announced, so
   *  taking the later of the two would step a later call back under an earlier stage. */
  it('11c. never walks a call back under an earlier stage, and stamps nothing without a plan', () => {
    const planned = createLog(() => 0);
    append(planned, { kind: 'order', text: 'go', mapContext: '' });
    append(planned, { kind: 'plan', stages: [{ label: 'a' }, { label: 'b' }], revision: 1 });
    append(planned, { kind: 'stage', index: 1 });
    append(planned, { kind: 'checkpoint', undoIndex: 2, label: 'stage', stageIndex: 0 });
    append(planned, { kind: 'toolResult', callId: 'c1', name: 'build_road', content: 'ok', isError: false, write: true });
    expect(deriveView(planned).current?.ops[0]?.stageIndex).toBe(1);

    const planless = createLog(() => 0);
    append(planless, { kind: 'order', text: 'go', mapContext: '' });
    append(planless, { kind: 'toolResult', callId: 'c1', name: 'build_road', content: 'ok', isError: false, write: true });
    expect(deriveView(planless).current?.ops[0]?.stageIndex).toBeUndefined();
  });

  it('12. vitals accumulate cells/objects/reverts/jobs across settled jobs', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'one', mapContext: '' });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'ok', isError: false, detail: { cells: 10, objects: 1 } });
    append(log, { kind: 'jobEnd', outcome: 'done' });

    append(log, { kind: 'order', text: 'two', mapContext: '' });
    append(log, { kind: 'toolResult', callId: 'c2', name: 'place_object', content: 'reverted', isError: true, detail: { reverted: true, cells: 3 } });
    append(log, { kind: 'jobEnd', outcome: 'aborted' });

    const view = deriveView(log);
    expect(view.vitals).toEqual({ cells: 13, objects: 1, reverts: 1, jobs: 2 });
  });

  it('13. a compaction stamps the job, and an incident ends the phase incident with the job settled as an incident', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'compaction', summary: 'trimmed old turns', retainedFromSeq: 2 });
    append(log, { kind: 'incident', error: { cls: 'unknown', detail: 'boom' } });

    const view = deriveView(log);
    expect(view.phase).toBe('incident');
    expect(view.current).toBeUndefined();
    expect(view.jobs).toHaveLength(1);
    expect(view.jobs[0]?.outcome).toBe('incident');
    expect(view.jobs[0]?.stamps).toEqual([{ kind: 'compaction', beforeIndex: 0 }]);
  });

  it("13b. two compaction events fold 'compaction' into stamps exactly once, guarded like its 'damper'/'interrupted' siblings", () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'compaction', summary: 'trimmed old turns', retainedFromSeq: 2 });
    append(log, { kind: 'compaction', summary: 'trimmed more', retainedFromSeq: 4 });

    const view = deriveView(log);
    expect(view.current?.stamps).toEqual([{ kind: 'compaction', beforeIndex: 0 }]);
  });

  it('13c. a compaction mid-run files at the op it preceded, not at the end of the list', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'place_object', content: 'placed', isError: false });
    append(log, { kind: 'toolResult', callId: 'c2', name: 'place_object', content: 'placed', isError: false });
    append(log, { kind: 'compaction', summary: 'trimmed old turns', retainedFromSeq: 4 });
    append(log, { kind: 'toolResult', callId: 'c3', name: 'place_object', content: 'placed', isError: false });

    const view = deriveView(log);
    expect(view.current?.ops).toHaveLength(3);
    expect(view.current?.stamps).toEqual([{ kind: 'compaction', beforeIndex: 2 }]);
  });

  it("14. a dampered result folds 'damper' into stamps exactly once, however many dampers fired", () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'refused', isError: true, detail: { damper: true } });
    append(log, { kind: 'toolResult', callId: 'c2', name: 'paint_terrain', content: 'refused again', isError: true, detail: { damper: true } });
    append(log, { kind: 'jobEnd', outcome: 'aborted' });

    const view = deriveView(log);
    // The stamp files where the damper fired: after the first call's row, not at the foot.
    expect(view.jobs[0]?.stamps).toEqual([{ kind: 'damper', beforeIndex: 1 }]);
  });

  it("15. a resumed job folds 'interrupted' once; a job never paused carries neither stamp", () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'pauseRequested' });
    append(log, { kind: 'paused' });
    append(log, { kind: 'resumed' });
    append(log, { kind: 'jobEnd', outcome: 'done' });

    append(log, { kind: 'order', text: 'go again', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done' });

    const view = deriveView(log);
    expect(view.jobs[0]?.stamps).toEqual([{ kind: 'interrupted', beforeIndex: 0 }]);
    expect(view.jobs[1]?.stamps).toEqual([]);
  });

  describe('gate/retry markers do not leak past a job boundary', () => {
    it('(a) a retry marker is cleared when its job settles: view.retry is undefined and phase reflects the outcome', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'retry', attempt: 3, cls: 'overloaded', delayMs: 1000 });
      append(log, { kind: 'jobEnd', outcome: 'aborted' });

      const view = deriveView(log);
      expect(view.retry).toBeUndefined();
      expect(view.phase).toBe('aborted');
    });

    it('(b) an unanswered gate is cleared when its job settles, and does not haunt the next job', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
      append(log, { kind: 'jobEnd', outcome: 'aborted' });
      append(log, { kind: 'order', text: 'go again', mapContext: '' });

      const view = deriveView(log);
      expect(view.gate).toBeUndefined();
      expect(view.phase).toBe('thinking');
      expect(view.current?.ops.some((o) => o.callId === 'c1')).toBe(false);
    });

    it('(c) an open unanswered gate wins over an open retry regardless of which event landed later, and holds the retry unsurfaced', () => {
      // Ordering 1: the gate is asked, then a retry lands on top of it.
      const gateFirst = createLog(() => 0);
      append(gateFirst, { kind: 'order', text: 'go', mapContext: '' });
      append(gateFirst, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(gateFirst, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
      append(gateFirst, { kind: 'retry', attempt: 1, cls: 'network', delayMs: 500 });

      const gateFirstView = deriveView(gateFirst);
      expect(gateFirstView.phase).toBe('gated');
      expect(gateFirstView.gate).toBeDefined();
      expect(gateFirstView.retry).toBeUndefined();

      // Ordering 2: the retry lands first, and the gate is asked on top of it.
      const retryFirst = createLog(() => 0);
      append(retryFirst, { kind: 'order', text: 'go', mapContext: '' });
      append(retryFirst, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(retryFirst, { kind: 'retry', attempt: 1, cls: 'network', delayMs: 500 });
      append(retryFirst, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });

      const retryFirstView = deriveView(retryFirst);
      expect(retryFirstView.phase).toBe('gated');
      expect(retryFirstView.gate).toBeDefined();
      expect(retryFirstView.retry).toBeUndefined();
    });
  });

  describe('stage.index is clamped to the filed plan', () => {
    it('a stage index past the last stage clamps currentIndex/doneCount to the last stage', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      const stages: PlanStage[] = [{ label: 'clear land' }, { label: 'lay roads' }, { label: 'plant trees' }];
      append(log, { kind: 'plan', stages, revision: 1 });
      append(log, { kind: 'stage', index: 99 });

      expect(deriveView(log).current?.plan).toEqual({ stages, currentIndex: 2, doneCount: 2, revision: 1 });
    });
  });

  describe('suggestion is log-derived off the newest suggest_reply call, not pushed through the executor', () => {
    it('surfaces from a suggest_reply call in the CURRENT job', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: 'Yes, add the bridge' }, argsDone: true }],
      });

      expect(deriveView(log).suggestion).toBe('Yes, add the bridge');
    });

    it('survives into the settled job (last-settled semantics) until a new order nulls it', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: 'Sure, go ahead' }, argsDone: true }],
      });
      append(log, { kind: 'jobEnd', outcome: 'done' });

      const settled = deriveView(log);
      expect(settled.suggestion).toBe('Sure, go ahead');
      expect(settled.phase).toBe('idle');
      expect(settled.current).toBeUndefined();

      append(log, { kind: 'order', text: 'go again', mapContext: '' });
      expect(deriveView(log).suggestion).toBeNull();
    });

    it('the newest suggest_reply call in a job wins over an earlier one', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: 'first guess' }, argsDone: true }],
      });
      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c2', name: 'suggest_reply', input: { reply: 'second guess' }, argsDone: true }],
      });

      expect(deriveView(log).suggestion).toBe('second guess');
    });

    it('a multiline or oversized reply is run through the same firstLine treatment as a tool-result summary', () => {
      const multiline = createLog(() => 0);
      append(multiline, { kind: 'order', text: 'go', mapContext: '' });
      append(multiline, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: 'first line\nsecond line' }, argsDone: true }],
      });
      expect(deriveView(multiline).suggestion).toBe('first line');

      const oversized = createLog(() => 0);
      append(oversized, { kind: 'order', text: 'go', mapContext: '' });
      const long = 'a'.repeat(120);
      append(oversized, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: long }, argsDone: true }],
      });
      expect(deriveView(oversized).suggestion).toBe(long.slice(0, 96));
      expect(deriveView(oversized).suggestion).toHaveLength(96);
    });

    it('a missing, non-string, or empty-after-trim reply resolves to null, never throwing', () => {
      const missing = createLog(() => 0);
      append(missing, { kind: 'order', text: 'go', mapContext: '' });
      append(missing, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: {}, argsDone: true }],
      });
      expect(deriveView(missing).suggestion).toBeNull();

      const nonString = createLog(() => 0);
      append(nonString, { kind: 'order', text: 'go', mapContext: '' });
      append(nonString, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: 42 }, argsDone: true }],
      });
      expect(deriveView(nonString).suggestion).toBeNull();

      const blank = createLog(() => 0);
      append(blank, { kind: 'order', text: 'go', mapContext: '' });
      append(blank, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: '   ' }, argsDone: true }],
      });
      expect(deriveView(blank).suggestion).toBeNull();
    });

    it('an empty log, or an order with no suggest_reply call yet, has suggestion: null', () => {
      expect(deriveView(createLog(() => 0)).suggestion).toBeNull();

      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      expect(deriveView(log).suggestion).toBeNull();
    });

    /** `project-messages.ts` drops an aborted/errored/length-stopped turn from the conversation
     *  entirely; a suggestion projected out of one would be the composer offering text no later
     *  turn knows was ever said. */
    it('a suggest_reply inside an aborted, errored or length-capped turn never surfaces', () => {
      for (const stop of ['aborted', 'error', 'length'] as const) {
        const log = createLog(() => 0);
        append(log, { kind: 'order', text: 'go', mapContext: '' });
        append(log, {
          kind: 'assistant', stop,
          parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: 'half a thou' }, argsDone: true }],
        });
        expect(deriveView(log).suggestion, `stop: ${stop}`).toBeNull();
      }
    });

    it('an earlier clean suggestion survives a later dropped turn rather than being replaced by it', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'suggest_reply', input: { reply: 'a whole sentence' }, argsDone: true }],
      });
      append(log, {
        kind: 'assistant', stop: 'aborted',
        parts: [{ kind: 'tool', callId: 'c2', name: 'suggest_reply', input: { reply: 'half a thou' }, argsDone: true }],
      });
      expect(deriveView(log).suggestion).toBe('a whole sentence');
    });
  });

  describe("an op's read-ness comes off its own result before it comes off readTools", () => {
    function opFor(log: ReturnType<typeof createLog>, callId: string, readTools?: ReadonlySet<string>) {
      return deriveView(log, readTools ? { readTools } : undefined).current?.ops.find((o) => o.callId === callId);
    }

    it('a stamped result answers with no readTools passed at all', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'toolResult', callId: 'r1', name: 'view_map', content: 'a flat plain', isError: false, write: false });
      append(log, { kind: 'toolResult', callId: 'w1', name: 'paint_terrain', content: 'painted', isError: false, write: true });

      expect(opFor(log, 'r1')?.isRead).toBe(true);
      expect(opFor(log, 'w1')?.isRead).toBe(false);
    });

    it('a stamped result outranks a readTools set that disagrees with it', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'toolResult', callId: 'w1', name: 'paint_terrain', content: 'painted', isError: false, write: true });

      expect(opFor(log, 'w1', new Set(['paint_terrain']))?.isRead).toBe(false);
    });

    it('a legacy result with no stamp falls back to readTools, and to false with neither', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'toolResult', callId: 'c1', name: 'view_map', content: 'a flat plain', isError: false });

      expect(opFor(log, 'c1', new Set(['view_map']))?.isRead).toBe(true);
      expect(opFor(log, 'c1')?.isRead).toBe(false);
    });
  });

  describe('an incident-settled job carries the class of what ended it', () => {
    it('reads the class off the settling incident event', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'incident', error: { cls: 'auth', detail: 'refused' } });
      append(log, { kind: 'jobEnd', outcome: 'incident' });

      const view = deriveView(log);
      expect(view.phase).toBe('incident');
      expect(view.jobs).toHaveLength(1);
      expect(view.jobs[0]?.outcome).toBe('incident');
      expect(view.jobs[0]?.errorCls).toBe('auth');
    });

    it('leaves errorCls unset on a job that settled any other way', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'jobEnd', outcome: 'done' });
      expect(deriveView(log).jobs[0]?.errorCls).toBeUndefined();
    });

    it('keeps every incident job to the class of its own failure when several settle in one session', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'first', mapContext: '' });
      append(log, { kind: 'incident', error: { cls: 'quota', detail: 'out of credit' } });
      append(log, { kind: 'jobEnd', outcome: 'incident' });
      append(log, { kind: 'order', text: 'second', mapContext: '' });
      append(log, { kind: 'incident', error: { cls: 'network', detail: 'offline' } });
      append(log, { kind: 'jobEnd', outcome: 'incident' });

      expect(deriveView(log).jobs.map((j) => j.errorCls)).toEqual(['quota', 'network']);
    });
  });

  describe('a settled job says whether it built or answered, and whether that is worth celebrating', () => {
    it('done with one applied write is a build, and celebrates', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted 12 cells',
        isError: false, write: true, detail: { cells: 12 },
      });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'the hill stands' });

      const job = deriveView(log).jobs[0];
      expect(job?.kind).toBe('build');
      expect(job?.celebrate).toBe(true);
      expect(job?.question).toBeUndefined();
    });

    it('done with a REFUSED write keeps the build receipt and does not celebrate', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'paint_terrain',
        content: 'Terrain: cannot build on cells occupied by objects', isError: true, write: true,
      });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'the ground was taken' });

      const job = deriveView(log).jobs[0];
      expect(job?.kind).toBe('build');
      expect(job?.celebrate).toBe(false);
    });

    it('done with a write the stroke REVERTED is a build that does not celebrate', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'REVERTED: no base',
        isError: false, write: true, detail: { reverted: true },
      });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'it would not stand' });

      const job = deriveView(log).jobs[0];
      expect(job?.kind).toBe('build');
      expect(job?.celebrate).toBe(false);
    });

    it('done with a write SKIPPED at its gate is still a build, with nothing to celebrate', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
      append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'skip' });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'left it alone' });

      const job = deriveView(log).jobs[0];
      expect(job?.kind).toBe('build');
      expect(job?.celebrate).toBe(false);
      expect(job?.ops.find((o) => o.callId === 'c1')?.status).toBe('skipped');
    });

    it('done over reads alone is an answer, and answers never celebrate', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'what is on the east shore?', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'view_map', content: 'a flat plain',
        isError: false, write: false,
      });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'the east shore is flat grass' });

      const job = deriveView(log).jobs[0];
      expect(job?.kind).toBe('answer');
      expect(job?.celebrate).toBe(false);
    });

    it('done with no ops and nothing said is quiet', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'jobEnd', outcome: 'done' });

      const job = deriveView(log).jobs[0];
      expect(job?.kind).toBe('quiet');
      expect(job?.celebrate).toBe(false);
    });

    it('a closing QUESTION holds the celebration back however much landed', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted 12 cells',
        isError: false, write: true, detail: { cells: 12 },
      });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'shall I plant it too?', question: true });

      const job = deriveView(log).jobs[0];
      expect(job?.kind).toBe('build');
      expect(job?.question).toBe(true);
      expect(job?.celebrate).toBe(false);
    });

    it('a job that did not finish classifies nothing and never celebrates', () => {
      for (const outcome of ['capped', 'aborted'] as const) {
        const log = createLog(() => 0);
        append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
        append(log, {
          kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted 12 cells',
          isError: false, write: true, detail: { cells: 12 },
        });
        append(log, { kind: 'jobEnd', outcome, summary: 'as far as I got' });

        const job = deriveView(log).jobs[0];
        expect(job?.kind, outcome).toBeUndefined();
        expect(job?.celebrate, outcome).toBe(false);
      }

      const incident = createLog(() => 0);
      append(incident, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(incident, {
        kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted 12 cells',
        isError: false, write: true, detail: { cells: 12 },
      });
      append(incident, { kind: 'incident', error: { cls: 'network', detail: 'offline' } });
      append(incident, { kind: 'jobEnd', outcome: 'incident' });

      const job = deriveView(incident).jobs[0];
      expect(job?.kind).toBeUndefined();
      expect(job?.celebrate).toBe(false);
    });

    it('the still-running job classifies nothing and never celebrates', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted 12 cells',
        isError: false, write: true, detail: { cells: 12 },
      });

      const view = deriveView(log);
      expect(view.current?.kind).toBeUndefined();
      expect(view.current?.celebrate).toBe(false);
    });

    it("a gate answered in WORDS folds as its own status, not a forever-run", () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });
      append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'words', words: 'lower, and further east' });

      expect(deriveView(log).current?.ops.find((o) => o.callId === 'c1')?.status).toBe('words');

      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'moved it east' });
      const job = deriveView(log).jobs[0];
      expect(job?.ops.find((o) => o.callId === 'c1')?.status).toBe('words');
      expect(job?.kind).toBe('build');
      expect(job?.celebrate).toBe(false);
    });

    it('every job view carries the moment its own order was filed', () => {
      let clock = 1000;
      const log = createLog(() => clock);
      append(log, { kind: 'order', text: 'first', mapContext: '' });
      clock = 1500;
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'done' });
      clock = 2000;
      append(log, { kind: 'order', text: 'second', mapContext: '' });
      clock = 2500;

      const view = deriveView(log);
      expect(view.jobs.map((j) => j.orderAt)).toEqual([1000]);
      expect(view.current?.orderAt).toBe(2000);
    });

    /** The `write` stamp ships before the panel that reads it, so a log written by the older loop
     *  has no write-ness to read: its done jobs read as an answer (or a quiet one), never as a
     *  build. A session log is short-lived, so this misreads at most the run in progress. */
    it('a legacy log with no write stamps reads its done job as an answer', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'raise a hill', mapContext: '' });
      append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted 12 cells', isError: false });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'the hill stands' });

      const job = deriveView(log).jobs[0];
      expect(job?.kind).toBe('answer');
      expect(job?.celebrate).toBe(false);
    });
  });

  /** A thinking model streams reasoning deltas for as long as it likes before it says a word, and
   *  a phase read off the newest part alone would say `streaming` throughout — the panel claiming
   *  the assistant is speaking while nothing has been said. */
  describe('a thought in flight reads as thinking, never as speech', () => {
    function withLive(live: Part[]) {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      return deriveView(log, { live });
    }

    it('reasoning alone leaves the phase thinking', () => {
      expect(withLive([{ kind: 'reasoning', text: 'weighing the ridge', done: false }]).phase).toBe('thinking');
    });

    /** THE SAYS LINE MUST NEVER CARRY REASONING: `saysFromLive` matches a `text` part only, and a
     *  stream that has ONLY thought so far must leave `current.says` unset (the dots, never the
     *  chain-of-thought, stand in for it) — not merely "not yet", which a fallback to the reasoning
     *  part would also satisfy while still printing it as the assistant's own line. */
    it('a reasoning-only stream leaves current.says unset, whether the thought is done or not', () => {
      expect(withLive([{ kind: 'reasoning', text: 'weighing the ridge', done: false }]).current?.says)
        .toBeUndefined();
      expect(withLive([{ kind: 'reasoning', text: 'weighed it', done: true }]).current?.says)
        .toBeUndefined();
    });

    it('a thought that FINISHED with nothing said yet still reads as thinking', () => {
      expect(withLive([{ kind: 'reasoning', text: 'weighed it', done: true }]).phase).toBe('thinking');
    });

    it('the first text delta after a thought is what turns the phase to streaming', () => {
      const view = withLive([
        { kind: 'reasoning', text: 'weighed it', done: true },
        { kind: 'text', text: 'Raising the ridge', done: false },
      ]);
      expect(view.phase).toBe('streaming');
      expect(view.current?.says).toBe('Raising the ridge');
    });

    it('a tool call the results have not answered still reads as executing, with a thought beside it', () => {
      expect(withLive([
        { kind: 'text', text: 'one moment', done: true },
        { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true },
      ]).phase).toBe('executing');

      expect(withLive([
        { kind: 'reasoning', text: 'weighed it', done: true },
        { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true },
      ]).phase).toBe('executing');
    });

    it('a thought that follows an ANSWERED call reads as streaming, not as a second execution', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'toolResult', callId: 'c1', name: 'paint_terrain', content: 'painted', isError: false });
      const live: Part[] = [
        { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true },
        { kind: 'reasoning', text: 'now the trees', done: false },
      ];
      expect(deriveView(log, { live }).phase).toBe('streaming');
    });

    it('a higher-precedence marker outranks a live thought exactly as it outranks live text', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'paint a mountain' });

      const live: Part[] = [{ kind: 'reasoning', text: 'while it waits', done: false }];
      expect(deriveView(log, { live }).phase).toBe('gated');
    });
  });

  /** The dock's "thought for …" line stands on this, because eight of the nine providers report no
   *  usage at all: characters are the only reading of a thought's size the session can be sure of. */
  describe('a job carries how much was thought inside it', () => {
    /** The SIZE reading alone, so a test about counting stays about counting: the per-turn marks
     *  and the total span are their own subject, right below. */
    const size = (t: JobView['thought']) => (t ? { chars: t.chars, turns: t.turns } : t);

    it('folds characters and turns from committed turns, and counts nothing when nothing was thought', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'ok', done: true }] });
      expect(deriveView(log).current?.thought).toBeUndefined();

      append(log, {
        kind: 'assistant', stop: 'tool-calls',
        parts: [
          { kind: 'reasoning', text: 'a'.repeat(100), done: true },
          { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true },
        ],
      });
      expect(size(deriveView(log).current?.thought)).toEqual({ chars: 100, turns: 1 });

      append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'reasoning', text: 'b'.repeat(50), done: true }] });
      expect(size(deriveView(log).current?.thought)).toEqual({ chars: 150, turns: 2 });
    });

    it('a turn that thought twice counts as one thinking turn', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'stop',
        parts: [
          { kind: 'reasoning', text: 'a'.repeat(30), done: true },
          { kind: 'reasoning', text: 'b'.repeat(12), done: true },
        ],
      });
      expect(size(deriveView(log).current?.thought)).toEqual({ chars: 42, turns: 1 });
    });

    it('the live stream is counted as it arrives, so the reading grows during the turn', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      const live: Part[] = [{ kind: 'reasoning', text: 'x'.repeat(40), done: false }];
      expect(size(deriveView(log, { live }).current?.thought)).toEqual({ chars: 40, turns: 1 });

      append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'reasoning', text: 'y'.repeat(10), done: true }] });
      const later: Part[] = [{ kind: 'reasoning', text: 'z'.repeat(5), done: false }];
      expect(size(deriveView(log, { live: later }).current?.thought)).toEqual({ chars: 15, turns: 2 });
    });

    /** A STORED thought is an EXCERPT: the log keeps a readable head plus the original length, so
     *  the count must come off `chars` and never off the head it kept. */
    it('a stored excerpt reports the thought it stands for, not the head that survived storage', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'stop',
        parts: [{ kind: 'reasoning', text: 'h'.repeat(240), done: true, chars: 10_000 }],
      });
      expect(size(deriveView(log).current?.thought)).toEqual({ chars: 10_000, turns: 1 });
    });

    /** ABSENT IS UNKNOWN, NOT ZERO. A log written before the excerpt existed carries no `chars`
     *  key at all, and its part still holds the whole thought — so the honest reading measures the
     *  text. Reading a missing key as 0 would report a session that thought at length as one that
     *  never thought, which is the same reading a provider that sends no reasoning gets. */
    it('a legacy part with no chars key is measured, never read as nothing', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      const legacy = { kind: 'reasoning', text: 'q'.repeat(500), done: true } as Part;
      expect(Object.prototype.hasOwnProperty.call(legacy, 'chars')).toBe(false);
      append(log, { kind: 'assistant', stop: 'stop', parts: [legacy] });

      const thought = deriveView(log).current?.thought;
      expect(size(thought)).toEqual({ chars: 500, turns: 1 });
      expect(thought?.chars).not.toBe(0);
    });

    /** The same presence test the governor's silent-turn reading uses: an adapter that emits an
     *  empty or whitespace reasoning delta produced a part, not a thought. */
    it('an empty or whitespace-only thought is no thought at all', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'stop',
        parts: [{ kind: 'reasoning', text: '   \n ', done: true }, { kind: 'reasoning', text: '', done: true }],
      });
      expect(deriveView(log).current?.thought).toBeUndefined();
    });

    it('every job carries its own thinking, and a settled one keeps it', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'first', mapContext: '' });
      append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'reasoning', text: 'a'.repeat(20), done: true }] });
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'one' });
      append(log, { kind: 'order', text: 'second', mapContext: '' });
      append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'reasoning', text: 'b'.repeat(7), done: true }] });

      const view = deriveView(log);
      expect(size(view.jobs[0]?.thought)).toEqual({ chars: 20, turns: 1 });
      expect(size(view.current?.thought)).toEqual({ chars: 7, turns: 1 });
    });

    /** A truncated turn is dropped from the conversation, but the thinking inside it was still
     *  spent: what `thought` reports is effort, not content the session stands behind. */
    it('a thought inside a turn the provider cut off is still counted', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, { kind: 'assistant', stop: 'length', parts: [{ kind: 'reasoning', text: 'c'.repeat(64), done: false }] });
      expect(size(deriveView(log).current?.thought)).toEqual({ chars: 64, turns: 1 });
    });
  });

  /** THE TURN IS THE UNIT, and the record's own thought rows stand on this: one digest per turn
   *  that thought, in log order, each knowing where in the op list it files. */
  describe('the per-turn thought digest', () => {
    it('files one mark per thinking turn, above the row that turn opened', () => {
      let clock = 1_000;
      const log = createLog(() => clock);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      clock = 103_000;
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [
          { kind: 'reasoning', text: 'the long one', done: true },
          { kind: 'tool', callId: 'c1', name: 'build_road', input: {}, argsDone: true },
        ],
      });
      clock = 104_000;
      append(log, { kind: 'toolResult', callId: 'c1', name: 'build_road', content: 'laid', isError: false });
      clock = 132_000;
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [
          { kind: 'reasoning', text: 'the short one', done: true },
          { kind: 'tool', callId: 'c2', name: 'place_object', input: {}, argsDone: true },
        ],
      });

      const thought = deriveView(log).current?.thought;
      expect(thought?.turns).toBe(2);
      expect(thought?.marks.map((m) => ({ ms: m.ms, chars: m.chars, text: m.text, at: m.beforeIndex })))
        .toEqual([
          { ms: 102_000, chars: 12, text: 'the long one', at: 0 },
          { ms: 28_000, chars: 13, text: 'the short one', at: 1 },
        ]);
      // The receipt's one honest total is the marks' own spans, and nothing else.
      expect(thought?.ms).toBe(130_000);
    });

    /** A turn is measured from whatever the log last recorded, so a question the user sat on is the
     *  GATE's time and not the model's. */
    it('measures a turn from the event before it, gate answer included', () => {
      let clock = 0;
      const log = createLog(() => clock);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      clock = 300_000; // five minutes of the user reading the question
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', summary: 'place it?', callId: 'c1' });
      clock = 302_000;
      append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'allow' });
      clock = 309_000;
      append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'reasoning', text: 'right then', done: true }] });

      expect(deriveView(log).current?.thought?.marks[0]?.ms).toBe(7_000);
    });

    /** A HIDDEN-CoT TURN GETS A MARK WITH NO TEXT, which is what keeps the panel from offering a
     *  box that would open on nothing. Nothing here reads a provider capability: the reading is of
     *  what arrived. */
    it('carries no text for a turn whose reasoning was never exposed', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'stop',
        parts: [{ kind: 'reasoning', text: '', done: true, chars: 8_000 }],
      });
      // An empty part is no thought at all (`thoughtSize`), so there is nothing to mark either.
      expect(deriveView(log).current?.thought).toBeUndefined();
    });

    /** A STORED thought is a HEAD plus its original length: the box shows what survived, the count
     *  reports what was thought. */
    it('keeps the stored head as the mark text while the count stays the whole thought', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'assistant', stop: 'stop',
        parts: [{ kind: 'reasoning', text: 'h'.repeat(240), done: true, chars: 10_000 }],
      });
      const mark = deriveView(log).current?.thought?.marks[0];
      expect(mark?.chars).toBe(10_000);
      expect(mark?.text).toHaveLength(240);
    });

    /** The turn still streaming has no mark yet — it is not logged — so its text rides beside them
     *  and the affordance the says row offers stands on it alone. */
    it('carries the live turn beside the marks, and drops it when the turn commits', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      const live: Part[] = [{ kind: 'reasoning', text: 'still working it out', done: false }];

      const running = deriveView(log, { live }).current?.thought;
      expect(running?.live).toBe('still working it out');
      expect(running?.marks).toEqual([]);

      append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'reasoning', text: 'still working it out', done: true }] });
      const committed = deriveView(log).current?.thought;
      expect(committed?.live).toBeUndefined();
      expect(committed?.marks).toHaveLength(1);
    });
  });

  describe('the newest event stamps the view, so the panel has a clock to tick from', () => {
    it('is 0 on an empty log and follows the newest append', () => {
      let clock = 0;
      const log = createLog(() => clock);
      expect(deriveView(log).lastEventAt).toBe(0);

      clock = 1000;
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      expect(deriveView(log).lastEventAt).toBe(1000);

      clock = 1750;
      append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'ok', done: true }] });
      expect(deriveView(log).lastEventAt).toBe(1750);

      clock = 2400;
      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'ok' });
      expect(deriveView(log).lastEventAt).toBe(2400);
    });
  });

  /** "Always allow" is a SESSION-wide answer (`gates.ts`), so it is read off the whole log and does
   *  not settle with the job that gave it: the dock says the asking is off, and it stays off. */
  describe('an always-allow answer marks the view for the rest of the session', () => {
    it('is absent until one is given, then holds through the job settling', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      expect(deriveView(log).allowAll).toBeUndefined();

      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'roads' });
      append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'allow' });
      expect(deriveView(log).allowAll).toBeUndefined();

      append(log, { kind: 'gateAsked', gateId: 'g2', scope: 'tool', callId: 'c2', summary: 'roads' });
      append(log, { kind: 'gateAnswered', gateId: 'g2', answer: 'allow-always' });
      expect(deriveView(log).allowAll).toBe(true);

      append(log, { kind: 'jobEnd', outcome: 'done', summary: 'ok' });
      append(log, { kind: 'order', text: 'again', mapContext: '' });
      expect(deriveView(log).allowAll).toBe(true);
    });
  });

  describe('a loaded skill\'s identity reaches the op row and the job view', () => {
    it('a load_skill success folds OpRow.skill, blanks summary (the chip carries the title), and joins JobView.skills', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'load_skill', content: '# RIVER CROSSING\n...', isError: false,
        detail: { skill: { name: 'river-crossing', kind: 'style', title: 'River Crossing' } },
      });

      const view = deriveView(log);
      const row = view.current?.ops.find((o) => o.callId === 'c1');
      expect(row?.skill).toEqual({ name: 'river-crossing', kind: 'style', title: 'River Crossing' });
      expect(row?.summary).toBe('');
      expect(view.current?.skills).toEqual([{ name: 'river-crossing', kind: 'style', title: 'River Crossing' }]);
    });

    it('a failed load_skill folds status error with the error text as summary and no skill anywhere', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'load_skill',
        content: 'Unknown skill "nope". Call list_skills for the catalogue.', isError: true,
      });

      const view = deriveView(log);
      const row = view.current?.ops.find((o) => o.callId === 'c1');
      expect(row?.status).toBe('error');
      expect(row?.summary).toBe('Unknown skill "nope". Call list_skills for the catalogue.');
      expect(row?.skill).toBeUndefined();
      expect(view.current?.skills).toEqual([]);
    });

    it('an errored result carrying detail.skill (unreachable from a live producer today, guarded anyway) keeps its error text as summary', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'load_skill', content: 'refused mid-load', isError: true,
        detail: { skill: { name: 'river-crossing', kind: 'style', title: 'River Crossing' } },
      });

      const view = deriveView(log);
      const row = view.current?.ops.find((o) => o.callId === 'c1');
      expect(row?.summary).toBe('refused mid-load');
      expect(row?.skill).toBeUndefined();
    });

    it('two loads of different skills both join skills in order; reloading the first moves it to the newest position without duplicating', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'go', mapContext: '' });
      append(log, {
        kind: 'toolResult', callId: 'c1', name: 'load_skill', content: 'a', isError: false,
        detail: { skill: { name: 'river-crossing', kind: 'style', title: 'River Crossing' } },
      });
      append(log, {
        kind: 'toolResult', callId: 'c2', name: 'load_skill', content: 'b', isError: false,
        detail: { skill: { name: 'site-analysis', kind: 'method', title: 'Site Analysis' } },
      });
      expect(deriveView(log).current?.skills).toEqual([
        { name: 'river-crossing', kind: 'style', title: 'River Crossing' },
        { name: 'site-analysis', kind: 'method', title: 'Site Analysis' },
      ]);

      append(log, {
        kind: 'toolResult', callId: 'c3', name: 'load_skill', content: 'a again', isError: false,
        detail: { skill: { name: 'river-crossing', kind: 'style', title: 'River Crossing' } },
      });
      expect(deriveView(log).current?.skills).toEqual([
        { name: 'site-analysis', kind: 'method', title: 'Site Analysis' },
        { name: 'river-crossing', kind: 'style', title: 'River Crossing' },
      ]);
    });
  });

  /* A HELD SESSION SAYS ONE THING. Published independently of the phase, every marker below would
   * surface live questions and live waits on a paused log that no loop is left to answer. */
  describe('a hold outranks every open marker', () => {
    /** The tail a reload leaves on an active log: `persist.ts:loadLog` appends the synthetic
     *  `paused` because the loop that was running is gone. */
    function gatedThenPaused() {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build', mapContext: '' });
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'raise 86 cells' });
      append(log, { kind: 'paused' });
      return log;
    }

    it('does not surface a gate a reload has left standing: the ask returns when the job does', () => {
      const log = gatedThenPaused();
      const held = deriveView(log);
      expect(held.phase).toBe('paused');
      // The question is not answerable while nothing is asking it.
      expect(held.gate).toBeUndefined();

      // Resume re-enters the job, and the loop re-issues the unresolved call onto the SAME gate
      // (`loop.ts:existingGateId`), so the ask is the one the log already holds.
      append(log, { kind: 'resumed' });
      const resumed = deriveView(log);
      expect(resumed.phase).toBe('gated');
      expect(resumed.gate).toEqual({ gateId: 'g1', scope: 'tool', summary: 'raise 86 cells', callId: 'c1' });
    });

    it('does not surface a retry a hold has ended, and a resumed job wears no retry face', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build', mapContext: '' });
      append(log, { kind: 'retry', attempt: 1, cls: 'network', delayMs: 4000 });
      append(log, { kind: 'paused' });
      const held = deriveView(log);
      expect(held.phase).toBe('paused');
      expect(held.retry).toBeUndefined();

      append(log, { kind: 'resumed' });
      const resumed = deriveView(log);
      // Not 'retrying': the backoff the marker described died with the loop that was keeping it.
      expect(resumed.phase).toBe('thinking');
      expect(resumed.retry).toBeUndefined();
    });
  });

  describe('a retry attempt that is streaming says so', () => {
    it('lifts the retry face the moment the new attempt speaks', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build', mapContext: '' });
      append(log, { kind: 'retry', attempt: 1, cls: 'rate-limit', delayMs: 30_000 });
      expect(deriveView(log).phase).toBe('retrying');

      const live: Part[] = [{ kind: 'text', text: 'Laying the first road...', done: false }];
      const streaming = deriveView(log, { live });
      expect(streaming.phase).toBe('streaming');
      expect(streaming.current?.says).toBe('Laying the first road...');

      // A stream carrying only THOUGHT is not speech, so the wait still stands.
      const thinking = deriveView(log, { live: [{ kind: 'reasoning', text: 'hmm', done: false }] });
      expect(thinking.phase).toBe('retrying');
    });

    it('lifts to executing where the attempt opens a call', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build', mapContext: '' });
      append(log, { kind: 'retry', attempt: 2, cls: 'overloaded', delayMs: 8000 });
      const live: Part[] = [{ kind: 'tool', callId: 'c9', name: 'paint_terrain', input: {}, argsDone: true }];
      expect(deriveView(log, { live }).phase).toBe('executing');
    });

    it('leaves a gate standing: a held question is not lifted by anything streaming behind it', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build', mapContext: '' });
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 's' });
      const live: Part[] = [{ kind: 'text', text: 'meanwhile', done: false }];
      expect(deriveView(log, { live }).phase).toBe('gated');
    });
  });

  describe('a settled job\'s op rows settle with it', () => {
    const lastJob = (view: PanelView) => view.jobs[view.jobs.length - 1];

    it('folds an unanswered gate on a stopped job to CUT, not a question that asks forever', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build', mapContext: '' });
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [{ kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true }],
      });
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 's' });
      // The user stopped the job AT the gate. They never answered it, so this is a call the end of
      // the job cut short — NOT one they declined, which is a decision of theirs and wears its own
      // quiet mark.
      append(log, { kind: 'jobEnd', outcome: 'aborted' });

      expect(lastJob(deriveView(log))?.ops[0]?.status).toBe('cut');
    });

    it('folds a call cut off mid-flight to cut, on an abort and on an incident alike', () => {
      for (const settle of ['abort', 'incident'] as const) {
        const log = createLog(() => 0);
        append(log, { kind: 'order', text: 'build', mapContext: '' });
        append(log, {
          kind: 'assistant',
          stop: 'tool-calls',
          parts: [{ kind: 'tool', callId: 'c1', name: 'place_object', input: {}, argsDone: true }],
        });
        expect(deriveView(log).current?.ops[0]?.status, 'live, before the end').toBe('run');

        if (settle === 'abort') append(log, { kind: 'jobEnd', outcome: 'aborted' });
        else append(log, { kind: 'incident', error: { cls: 'network', detail: 'gone' } });

        expect(lastJob(deriveView(log))?.ops[0]?.status, settle).toBe('cut');
      }
    });

    it('leaves a LIVE job\'s rows alone: a running call still reads run, an open ask still asks', () => {
      const log = createLog(() => 0);
      append(log, { kind: 'order', text: 'build', mapContext: '' });
      append(log, {
        kind: 'assistant',
        stop: 'tool-calls',
        parts: [
          { kind: 'tool', callId: 'c1', name: 'paint_terrain', input: {}, argsDone: true },
          { kind: 'tool', callId: 'c2', name: 'place_object', input: {}, argsDone: true },
        ],
      });
      append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 's' });
      const ops = deriveView(log).current?.ops ?? [];
      expect(ops.map((o) => o.status)).toEqual(['pending-gate', 'run']);
    });
  });
});

/* ── the two carriers a card cannot be built without ─────────────────────── */

describe('an ask records WHAT IT OFFERED, not only what was asked', () => {
  it('folds the quick answers and the options off the gateAsked event onto the AskRecord', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'gateAsked', gateId: 'g1', scope: 'tool', summary: 'Two lanes or one?',
      quickAnswers: ['Two', 'One', 'You decide'],
    });
    append(log, {
      kind: 'gateAsked', gateId: 'g2', scope: 'tool', summary: 'Which shore?',
      options: [{ cap: 'The north shore', rect: { x1: 1, y1: 2, x2: 3, y2: 4 } }, { cap: 'The bay' }],
    });
    const asks = deriveView(log).current?.asks ?? [];
    expect(asks[0]?.quickAnswers).toEqual(['Two', 'One', 'You decide']);
    expect(asks[0]?.options).toBeUndefined();
    expect(asks[1]?.options).toEqual([
      { cap: 'The north shore', rect: { x1: 1, y1: 2, x2: 3, y2: 4 } },
      { cap: 'The bay' },
    ]);
    expect(asks[1]?.quickAnswers).toBeUndefined();
  });

  /** An offer nobody made is absent, never an empty list: a card keys on presence to decide which
   *  member of the family it is, and `[]` would make a plain gate render as a pick with no cards. */
  it('carries no offer at all for an ask that made none, empty list included', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'Paint it?' });
    append(log, {
      kind: 'gateAsked', gateId: 'g2', scope: 'tool', summary: 'Empty offer?',
      quickAnswers: [], options: [],
    });
    const asks = deriveView(log).current?.asks ?? [];
    expect(asks[0]?.quickAnswers).toBeUndefined();
    expect(asks[0]?.options).toBeUndefined();
    expect(asks[1]?.quickAnswers).toBeUndefined();
    expect(asks[1]?.options).toBeUndefined();
  });

  /** The offer outlives the answer, exactly as the ask does: a settled card still has to say what
   *  the tapped word was one OF. */
  it('keeps the offer on the record once the ask is answered', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, {
      kind: 'gateAsked', gateId: 'g1', scope: 'tool', summary: 'Two lanes or one?',
      quickAnswers: ['Two', 'One'],
    });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'words', words: 'Two' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'Two it is.' });
    const ask = deriveView(log).jobs[0]?.asks[0];
    expect(ask?.quickAnswers).toEqual(['Two', 'One']);
    expect(ask?.verdict).toBe('words');
    expect(ask?.words).toBe('Two');
  });
});

describe('a record says which map it was built on', () => {
  it('folds the order\'s mapId onto the job, live and settled', () => {
    const live = createLog(() => 0);
    append(live, { kind: 'order', text: 'go', mapContext: '', mapId: 'hexia' });
    expect(deriveView(live).current?.mapId).toBe('hexia');

    const settled = createLog(() => 0);
    append(settled, { kind: 'order', text: 'go', mapContext: '', mapId: 'tafa' });
    append(settled, { kind: 'jobEnd', outcome: 'done' });
    expect(deriveView(settled).jobs[0]?.mapId).toBe('tafa');
  });

  /** ABSENT IS UNVERIFIABLE, NOT "THE OPEN MAP". A log written before the field existed carries
   *  none, and the fold must hand that absence on rather than filling it in. */
  it('leaves it undefined for an order that carried none', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'go', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    expect(deriveView(log).jobs[0]?.mapId).toBeUndefined();
  });
});

describe('deriveView: a systemNote wears the damper stamp', () => {
  it('stamps the job once, where the note landed', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'bridge the river', mapContext: '' });
    append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: 'All done.', done: true }] });
    append(log, { kind: 'systemNote', note: 'delivery', text: '(system) Nothing has landed on the map yet.' });
    expect(deriveView(log).current?.stamps).toEqual([{ kind: 'damper', beforeIndex: 0 }]);
  });
});

describe('deriveView: the settle depth', () => {
  it('carries jobEnd.undoIndex onto the settled job, and reports nothing where the log has none', () => {
    const log = createLog(() => 0);
    append(log, { kind: 'order', text: 'build', mapContext: '' });
    append(log, { kind: 'checkpoint', undoIndex: 3, label: 'job' });
    append(log, { kind: 'jobEnd', outcome: 'done', undoIndex: 7 });
    expect(deriveView(log).jobs[0]?.endUndoIndex).toBe(7);

    const older = createLog(() => 0);
    append(older, { kind: 'order', text: 'build', mapContext: '' });
    append(older, { kind: 'jobEnd', outcome: 'done' });
    expect(deriveView(older).jobs[0]?.endUndoIndex).toBeUndefined();
  });
});

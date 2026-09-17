/*
 * agent-core.perf.test.ts — the agent harness's own floor: THE LOG IS THE STATE, and everything
 * else (the panel view, the provider messages) is a fold over it, recomputed on every append (the
 * store bumps an epoch per append and re-derives both). Covers building a ~500-event session log
 * through its own append API, folding it into the panel's `PanelView`, folding it into the
 * provider's message list, and the fold's own per-append cost (one more event, same full walk —
 * this layer has no incremental memoization, so the number should track the steady-state fold).
 * See `_harness.ts` for the gate and methodology.
 */
import { describe, it } from 'vitest';
import { PERF, perfSuite } from './_harness';
import { append, createLog } from '../../agent/core/log';
import type { SessionLog } from '../../agent/core/log';
import { deriveView } from '../../agent/core/project-view';
import { deriveMessages } from '../../agent/core/project-messages';
import type { Part } from '../../agent/core/types';

const s = perfSuite('agent-core');

/** One job's worth of realistic events: an order, a tool-calling turn (occasionally reasoning
 *  first), its results, an occasional gate ask/answer and mid-job steer, a closing turn, a
 *  checkpoint and the jobEnd — about 7-9 events, so ~500 events is ~60-70 jobs. */
function populateJob(log: SessionLog, k: number): void {
  append(log, {
    kind: 'order', text: `build district ${k} with a plaza and two roads`,
    mapContext: 'a 169x140 planet, richness 0.7, max elevation 8',
  });
  const parts: Part[] = [];
  if (k % 3 === 0) {
    parts.push({
      kind: 'reasoning', done: true,
      text: `Thinking about district ${k}'s layout: the road should curve around the pond and the plaza wants a wide approach.`,
    });
  }
  parts.push({ kind: 'text', text: `Laying out district ${k} now.`, done: true });
  parts.push({
    kind: 'tool', callId: `c${k}a`, name: 'paint_terrain', argsDone: true,
    input: { shape: 'rect', x: k % 100, y: k % 80, w: 5, h: 5 },
  });
  parts.push({
    kind: 'tool', callId: `c${k}b`, name: 'place_object', argsDone: true,
    input: { catalogId: 'tree-apple', x: (k % 100) + 1, y: (k % 80) + 1 },
  });
  append(log, { kind: 'assistant', stop: 'tool-calls', parts });
  if (k % 5 === 0) {
    append(log, { kind: 'gateAsked', gateId: `g${k}`, scope: 'tool', callId: `c${k}a`, summary: 'paint a mountain near the shore' });
    append(log, { kind: 'gateAnswered', gateId: `g${k}`, answer: 'allow' });
  }
  append(log, { kind: 'toolResult', callId: `c${k}a`, name: 'paint_terrain', content: 'Painted 25 cells.', isError: false, write: true });
  append(log, { kind: 'toolResult', callId: `c${k}b`, name: 'place_object', content: 'Placed tree-apple.', isError: false, write: true });
  if (k % 7 === 0) {
    const steerEv = append(log, { kind: 'steer', text: 'also add a fountain in the middle' });
    append(log, { kind: 'steerDelivered', steerSeq: steerEv.seq });
  }
  append(log, { kind: 'assistant', stop: 'stop', parts: [{ kind: 'text', text: `District ${k} is laid out with a small orchard.`, done: true }] });
  append(log, { kind: 'checkpoint', undoIndex: k * 3, label: 'job' });
  append(log, { kind: 'jobEnd', outcome: 'done', summary: `Built district ${k}.` });
}

function buildSessionLog(targetEvents: number): SessionLog {
  const log = createLog(() => 0);
  let k = 0;
  while (log.events.length < targetEvents) { populateJob(log, k); k++; }
  return log;
}

describe.runIf(PERF)('perf: agent-core', () => {
  it('append ~500 realistic events into a fresh log', async () => {
    let log = createLog(() => 0);
    await s.bench('log/append-500', () => {
      let k = 0;
      while (log.events.length < 500) { populateJob(log, k); k++; }
    }, {
      setup: () => { log = createLog(() => 0); },
      minSamples: 5, maxSamples: 30,
    });
  });

  it('fold the panel view over a 500-event log', async () => {
    const log = buildSessionLog(500);
    await s.bench('project/panel-view', () => { deriveView(log); }, {
      meta: { events: log.events.length },
    });
  });

  it('fold the provider messages over the same 500-event log', async () => {
    const log = buildSessionLog(500);
    await s.bench('project/messages', () => { deriveMessages(log, { budgetTokens: 20_000 }); }, {
      meta: { events: log.events.length },
    });
  });

  it('panel view fold right after one more append (the live per-append cost)', async () => {
    let log = buildSessionLog(500);
    await s.bench('project/panel-view-incremental', () => {
      append(log, { kind: 'steer', text: 'keep going, and widen the main street' });
      deriveView(log);
    }, {
      setup: () => { log = buildSessionLog(500); },
      minSamples: 5, maxSamples: 50,
    });
  });
});

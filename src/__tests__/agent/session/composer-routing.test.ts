import { describe, expect, it } from 'vitest';

import { askGate, answerGate, pendingGate } from '../../../agent/core/gates';
import { append, createLog } from '../../../agent/core/log';
import type { LoopDeps, ToolExecutor } from '../../../agent/core/loop';
import { runJob } from '../../../agent/core/loop';
import type { SessionPhase } from '../../../agent/core/project-view';
import { undeliveredSteers } from '../../../agent/core/steering';
import { createScriptedAdapter } from '../../../agent/eval/scripted-adapter';
import { composerRoute, submitComposer } from '../../../agent/session/composer-routing';

const now = () => 1000;

describe('composerRoute', () => {
  it('routes idle/aborted/incident to order', () => {
    for (const phase of ['idle', 'aborted', 'incident'] as SessionPhase[]) {
      expect(composerRoute(phase)).toBe('order');
    }
  });

  it('routes thinking/streaming/executing/retrying/pausing to steer', () => {
    for (const phase of ['thinking', 'streaming', 'executing', 'retrying', 'pausing'] as SessionPhase[]) {
      expect(composerRoute(phase)).toBe('steer');
    }
  });

  it('routes gated to gate-words', () => {
    expect(composerRoute('gated')).toBe('gate-words');
  });

  it('routes paused to resume-note', () => {
    expect(composerRoute('paused')).toBe('resume-note');
  });
});

describe('submitComposer: order routes (idle/aborted/incident)', () => {
  it('appends an order event with the supplied mapContext and starts a job', () => {
    for (const phase of ['idle', 'aborted', 'incident'] as SessionPhase[]) {
      const log = createLog(now);
      const result = submitComposer(log, phase, 'build a village', { mapContext: 'ctx-1' });
      expect(result).toEqual({ route: 'order', startsJob: true });
      expect(log.events).toHaveLength(1);
      expect(log.events[0]).toMatchObject({ kind: 'order', text: 'build a village', mapContext: 'ctx-1' });
    }
  });

  it('defaults mapContext to the empty string when opts is omitted', () => {
    const log = createLog(now);
    submitComposer(log, 'idle', 'build a village');
    expect(log.events[0]).toMatchObject({ kind: 'order', mapContext: '' });
  });

  it('stamps opts.region onto the order event, at push time', () => {
    const log = createLog(now);
    const region = { count: 6, x1: 2, y1: 3, x2: 9, y2: 11 };
    submitComposer(log, 'idle', 'build a village', { mapContext: 'ctx-1', region });
    expect(log.events[0]).toMatchObject({ kind: 'order', region });
  });

  it('carries no region field when opts.region is absent', () => {
    const log = createLog(now);
    submitComposer(log, 'idle', 'build a village', { mapContext: 'ctx-1' });
    expect((log.events[0] as { region?: unknown }).region).toBeUndefined();
  });
});

describe('submitComposer: steer routes (thinking/streaming/executing/retrying/pausing)', () => {
  it('queues a steer and does not start a job', () => {
    for (const phase of ['thinking', 'streaming', 'executing', 'retrying', 'pausing'] as SessionPhase[]) {
      const log = createLog(now);
      const result = submitComposer(log, phase, 'go faster');
      expect(result).toEqual({ route: 'steer', startsJob: false });
      expect(log.events).toHaveLength(1);
      expect(log.events[0]).toMatchObject({ kind: 'steer', text: 'go faster' });
    }
  });

  it('a supplied opts.region rides on no event at all: a steer event has no such field', () => {
    const region = { count: 3, x1: 0, y1: 0, x2: 1, y2: 1 };
    for (const phase of ['thinking', 'streaming', 'executing', 'retrying', 'pausing'] as SessionPhase[]) {
      const log = createLog(now);
      submitComposer(log, phase, 'go faster', { region });
      expect(log.events[0]).toEqual({ seq: expect.any(Number), at: expect.any(Number), kind: 'steer', text: 'go faster' });
    }
  });
});

describe('submitComposer: gated route', () => {
  it('answers the pending gate with words and does not start a job', () => {
    const log = createLog(now);
    const gateId = askGate(log, { scope: 'tool', callId: 'call-1', summary: 'paint mountain' });
    const result = submitComposer(log, 'gated', 'go ahead but slower');
    expect(result).toEqual({ route: 'gate-words', startsJob: false });
    const answered = log.events.find((e) => e.kind === 'gateAnswered');
    expect(answered).toMatchObject({ kind: 'gateAnswered', gateId, answer: 'words', words: 'go ahead but slower' });
    expect(pendingGate(log)).toBeUndefined();
  });

  it('falls back to steer when the phase says gated but no gate is pending', () => {
    const log = createLog(now);
    const result = submitComposer(log, 'gated', 'go ahead anyway');
    expect(result).toEqual({ route: 'steer', startsJob: false });
    expect(log.events).toHaveLength(1);
    expect(log.events[0]).toMatchObject({ kind: 'steer', text: 'go ahead anyway' });
  });

  it('falls back to steer when the only gate on the log is already answered', () => {
    const log = createLog(now);
    const gateId = askGate(log, { scope: 'plan', summary: 'approve plan' });
    answerGate(log, gateId, 'allow');
    const result = submitComposer(log, 'gated', 'note for later');
    expect(result).toEqual({ route: 'steer', startsJob: false });
    expect(undeliveredSteers(log)).toEqual([{ seq: log.events[log.events.length - 1]!.seq, text: 'note for later' }]);
  });

  it('a supplied opts.region rides on no gateAnswered event: the words answer has no such field', () => {
    const log = createLog(now);
    askGate(log, { scope: 'tool', callId: 'call-1', summary: 'paint mountain' });
    submitComposer(log, 'gated', 'go ahead but slower', { region: { count: 1, x1: 0, y1: 0, x2: 0, y2: 0 } });
    const answered = log.events.find((e) => e.kind === 'gateAnswered');
    expect((answered as { region?: unknown } | undefined)?.region).toBeUndefined();
  });
});

describe('submitComposer: paused route', () => {
  it('appends a resumed event carrying the note AND queues a steer with the same text, since the note reaches the model only through the steer', () => {
    const log = createLog(now);
    const result = submitComposer(log, 'paused', 'watch out for the cliff');
    expect(result).toEqual({ route: 'resume-note', startsJob: false });
    expect(log.events).toHaveLength(2);
    expect(log.events[0]).toMatchObject({ kind: 'resumed', note: 'watch out for the cliff' });
    expect(log.events[1]).toMatchObject({ kind: 'steer', text: 'watch out for the cliff' });
    expect(undeliveredSteers(log)).toEqual([{ seq: log.events[1]!.seq, text: 'watch out for the cliff' }]);
  });

  it('a supplied opts.region rides on neither the resumed nor the steer event', () => {
    const log = createLog(now);
    submitComposer(log, 'paused', 'watch out for the cliff', { region: { count: 1, x1: 0, y1: 0, x2: 0, y2: 0 } });
    expect((log.events[0] as { region?: unknown }).region).toBeUndefined();
    expect((log.events[1] as { region?: unknown }).region).toBeUndefined();
  });

  it('end-to-end: the resumed job\'s first request carries the note as a user message (ScriptedAdapter)', async () => {
    const log = createLog(now);
    append(log, { kind: 'order', text: 'place a house', mapContext: '' });
    append(log, { kind: 'paused' }); // a prior job paused mid-run

    submitComposer(log, 'paused', 'watch out for the cliff');

    const adapter = createScriptedAdapter([
      { events: [{ t: 'text', delta: 'ok' }, { t: 'done', stop: 'stop' }] },
    ]);
    const executor: ToolExecutor = {
      execute: async () => ({ content: 'ok', isError: false }),
      isWrite: () => false,
      isWide: () => false,
      describe: () => 'run',
    };
    const deps: LoopDeps = {
      adapter, model: 'scripted-model', system: 'system prompt', tools: [], executor,
      oversight: 'yolo', sameModel: true, budgetTokens: 100_000,
      signal: new AbortController().signal, undoStackSize: () => 0,
    };

    const outcome = await runJob(log, deps);

    expect(outcome).toBe('done');
    expect(adapter.requests).toHaveLength(1);
    const messages = adapter.requests[0]!.messages;
    expect(messages.some((m) => m.role === 'user' && m.text.startsWith('watch out for the cliff\n(language) '))).toBe(true);
  });
});

describe('submitComposer: empty/whitespace text is a no-op for every route', () => {
  const phases: SessionPhase[] = [
    'idle', 'thinking', 'streaming', 'executing', 'gated', 'retrying', 'pausing', 'paused', 'aborted', 'incident',
  ];

  it('returns the route with startsJob false and appends nothing, for "" and whitespace-only text', () => {
    for (const phase of phases) {
      for (const text of ['', '   ', '\n\t ']) {
        const log = createLog(now);
        if (phase === 'gated') askGate(log, { scope: 'tool', summary: 'x' });
        const before = log.events.length;
        const result = submitComposer(log, phase, text);
        expect(result).toEqual({ route: composerRoute(phase), startsJob: false });
        expect(log.events).toHaveLength(before);
      }
    }
  });

  it('leaves an outstanding gate unanswered when the composer text is blank', () => {
    const log = createLog(now);
    const gateId = askGate(log, { scope: 'tool', summary: 'x' });
    submitComposer(log, 'gated', '   ');
    expect(pendingGate(log)?.gateId).toBe(gateId);
  });
});

describe('submitComposer: text is trimmed before it lands on the log', () => {
  it('trims surrounding whitespace on an order', () => {
    const log = createLog(now);
    submitComposer(log, 'idle', '  build a bridge  ', { mapContext: 'ctx' });
    expect(log.events[0]).toMatchObject({ text: 'build a bridge' });
  });

  it('trims surrounding whitespace on a steer', () => {
    const log = createLog(now);
    submitComposer(log, 'thinking', '  go faster  ');
    expect(log.events[0]).toMatchObject({ text: 'go faster' });
  });
});

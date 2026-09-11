import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { append, createLog, eventsOf, type SessionLog } from '../../../agent/core/log';
import { deriveView } from '../../../agent/core/project-view';
import { REASONING_EXCERPT_CHARS, type SessionEvent, type SessionEventInput } from '../../../agent/core/types';
import { deserializeLog, loadLog, saveLog, serializeLog } from '../../../agent/session/persist';
import { PREFS } from '../../../core/runtime/prefs';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

/** One input per SessionEvent kind, none carrying `raw` or a toolResult `image` so a plain
 *  round trip (no stripping) reproduces every field exactly. */
function everyKindInputs(): SessionEventInput[] {
  return [
    { kind: 'order', text: 'build a village', mapContext: 'ctx', mapId: 'hexia' },
    { kind: 'assistant', parts: [{ kind: 'text', text: 'hi', done: true }], stop: 'stop' },
    { kind: 'toolResult', callId: 'c1', name: 'place_object', content: 'ok', isError: false },
    { kind: 'steer', text: 'go faster' },
    { kind: 'steerRecalled', steerSeq: 4 },
    { kind: 'steerDelivered', steerSeq: 4 },
    {
      kind: 'gateAsked', gateId: 'g1', scope: 'tool', callId: 'c1', summary: 'placing tree',
      quickAnswers: ['Yes', 'No'], options: [{ cap: 'The north shore', rect: { x1: 1, y1: 2, x2: 3, y2: 4 } }],
    },
    { kind: 'gateAnswered', gateId: 'g1', answer: 'allow' },
    { kind: 'plan', stages: [{ label: 'stage one' }], revision: 1 },
    { kind: 'stage', index: 0 },
    { kind: 'checkpoint', undoIndex: 3, label: 'job' },
    { kind: 'pauseRequested' },
    { kind: 'paused' },
    { kind: 'resumed', note: 'continue' },
    { kind: 'retry', attempt: 1, cls: 'network', delayMs: 500 },
    { kind: 'compaction', summary: 'summary text', retainedFromSeq: 5 },
    { kind: 'incident', error: { cls: 'quota', detail: 'no quota' } },
    { kind: 'jobEnd', outcome: 'done', summary: 'done well' },
  ];
}

function buildLog(): SessionLog {
  let t = 1000;
  const log = createLog(() => t++);
  for (const input of everyKindInputs()) append(log, input);
  return log;
}

describe('agent session persist', () => {
  it.each([
    [null],
    [{ seq: 1, at: 0, kind: 'assistant', parts: [null], stop: 'stop' }],
    [{ seq: 1, at: 0, kind: 'assistant', parts: [], stop: 'unknown' }],
    [{ seq: 1, at: 0, kind: 'order', text: {}, mapContext: '' }],
    [{ seq: 1, at: 0, kind: 'toolResult', callId: 'c', name: 'paint', content: '', isError: false, detail: { violations: [null] } }],
    [{ seq: 1, at: 0, kind: 'plan', stages: [null], revision: 1 }],
    [{ seq: 1, at: 0, kind: 'gateAsked', gateId: 'g', scope: 'unknown', summary: '' }],
    [{ seq: 1, at: 0, kind: 'incident', error: {} }],
    [{ seq: 1, at: 0, kind: 'unknown' }],
    [{ seq: 0, at: 0, kind: 'paused' }],
    [{ seq: 1, at: 0, kind: 'paused' }, { seq: 1, at: 0, kind: 'paused' }],
    [{ seq: 2, at: 0, kind: 'paused' }, { seq: 1, at: 0, kind: 'paused' }],
  ].map((events) => ({ events })))('preserves malformed event payloads for recovery: $events', ({ events }) => {
    const raw = JSON.stringify({ v: 3, events });
    expect(deserializeLog(raw)).toBeNull();
    localStorage.setItem(PREFS.agentLogV3.key, raw);
    expect(loadLog()).toEqual({ log: null, corrupt: true, corruptRaw: raw });
  });

  it('round-trips one of every event kind, and nextSeq continues after the highest seq', () => {
    const log = buildLog();
    const original = eventsOf(log);
    const revived = deserializeLog(serializeLog(log), () => 9999);
    expect(revived).not.toBeNull();
    expect(eventsOf(revived!)).toEqual(original);
    const maxSeq = Math.max(...original.map((e) => e.seq));
    const appended = append(revived!, { kind: 'steer', text: 'more' });
    expect(appended.seq).toBe(maxSeq + 1);
  });

  /** THE TWO CARRIERS SURVIVE A RELOAD, or the record they feed is a session-only fact: the ask's
   *  own offer is what tells a tapped pill from a typed sentence, and the map identity is what the
   *  rollback guard refuses on. Read back through the FOLD, not off the bytes, since the fold is
   *  what the panel actually renders. */
  it('carries an ask\'s offer and a record\'s map identity through storage', () => {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build', mapContext: 'ctx', mapId: 'hexia' });
    append(log, {
      kind: 'gateAsked', gateId: 'g1', scope: 'tool', summary: 'Which shore?',
      quickAnswers: ['North', 'South'],
      options: [{ cap: 'The north shore', rect: { x1: 1, y1: 2, x2: 3, y2: 4 } }, { cap: 'The bay' }],
    });
    append(log, { kind: 'gateAnswered', gateId: 'g1', answer: 'words', words: 'North' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'North it is.' });

    const revived = deserializeLog(serializeLog(log), () => 9999);
    const job = deriveView(revived!).jobs[0];
    expect(job?.mapId).toBe('hexia');
    expect(job?.asks[0]?.quickAnswers).toEqual(['North', 'South']);
    expect(job?.asks[0]?.options).toEqual([
      { cap: 'The north shore', rect: { x1: 1, y1: 2, x2: 3, y2: 4 } },
      { cap: 'The bay' },
    ]);
  });

  it('strips a toolResult image for storage without touching the in-memory event', () => {
    const log = createLog(() => 1);
    const ev = append(log, {
      kind: 'toolResult', callId: 'c1', name: 'export_map', content: 'ok', isError: false,
      image: 'data:image/png;base64,AAAA',
    });
    const stored = JSON.parse(serializeLog(log));
    expect(stored.events[0].image).toBeUndefined();
    expect((ev as Extract<SessionEvent, { kind: 'toolResult' }>).image).toBe('data:image/png;base64,AAAA');
  });

  it('deserializes corrupt JSON, a foreign version envelope, and null all to null', () => {
    expect(deserializeLog('{not json')).toBeNull();
    expect(deserializeLog(JSON.stringify({ v: 2, events: [] }))).toBeNull();
    expect(deserializeLog(null)).toBeNull();
  });

  /** AND HANDS THE BYTES BACK WITH THE VERDICT. They are about to be overwritten by the fresh log
   *  the store adopts, so a notice offering to export the evidence has to be given it here or have
   *  nothing to write. Nothing else may read them: an unparseable blob is not a log. */
  it('loadLog reports corrupt only when bytes existed and did not deserialize', () => {
    expect(loadLog()).toEqual({ log: null, corrupt: false }); // nothing stored yet

    localStorage.setItem(PREFS.agentLogV3.key, '{not json');
    expect(loadLog()).toEqual({ log: null, corrupt: true, corruptRaw: '{not json' });

    const wrongVersion = JSON.stringify({ v: 2, events: [] });
    localStorage.setItem(PREFS.agentLogV3.key, wrongVersion);
    expect(loadLog()).toEqual({ log: null, corrupt: true, corruptRaw: wrongVersion });
  });

  it('loadLog reports a valid envelope with corrupt: false', () => {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build', mapContext: 'ctx' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'done' });
    saveLog(log);

    const { log: revived, corrupt } = loadLog();
    expect(corrupt).toBe(false);
    expect(revived).not.toBeNull();
    expect(eventsOf(revived!)).toHaveLength(2);
  });

  it('appends a paused event on load when the last job is still active, and does not double it up', () => {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build', mapContext: 'ctx' });
    saveLog(log);

    const { log: revived, corrupt } = loadLog();
    expect(revived).not.toBeNull();
    expect(corrupt).toBe(false);
    const events = eventsOf(revived!);
    expect(events[events.length - 1]?.kind).toBe('paused');

    saveLog(revived!);
    const { log: revivedAgain } = loadLog();
    const eventsAgain = eventsOf(revivedAgain!);
    expect(eventsAgain.filter((e) => e.kind === 'paused')).toHaveLength(1);
  });

  it('loads a trailing pauseRequested with a synthetic paused too, not stranded in phase pausing forever', () => {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build', mapContext: 'ctx' });
    append(log, { kind: 'assistant', parts: [{ kind: 'text', text: 'hi', done: true }], stop: 'stop' });
    append(log, { kind: 'pauseRequested' });
    saveLog(log);

    const { log: revived, corrupt } = loadLog();
    expect(revived).not.toBeNull();
    expect(corrupt).toBe(false);
    const events = eventsOf(revived!);
    expect(events[events.length - 1]?.kind).toBe('paused');
    expect(deriveView(revived!).phase).toBe('paused');
  });

  it('strips an assistant raw payload for storage without touching the in-memory event', () => {
    const log = createLog(() => 1);
    const ev = append(log, {
      kind: 'assistant', parts: [{ kind: 'text', text: 'hi', done: true }], stop: 'stop',
      raw: { huge: 'x'.repeat(1000) },
    });
    const stored = JSON.parse(serializeLog(log));
    expect(stored.events[0].raw).toBeUndefined();
    expect((ev as Extract<SessionEvent, { kind: 'assistant' }>).raw).toEqual({ huge: 'x'.repeat(1000) });
  });

  it('stores a reasoning part as a digest carrying its original length, never the transcript', () => {
    const log = createLog(() => 1);
    const thought = 'r'.repeat(10000);
    const ev = append(log, {
      kind: 'assistant', parts: [{ kind: 'reasoning', text: thought, done: true }], stop: 'stop',
    });

    const raw = serializeLog(log);
    expect(raw).not.toContain('r'.repeat(REASONING_EXCERPT_CHARS + 1));

    const revived = deserializeLog(raw)!;
    const stored = eventsOf(revived)[0] as Extract<SessionEvent, { kind: 'assistant' }>;
    expect(stored.parts).toEqual([
      { kind: 'reasoning', text: 'r'.repeat(REASONING_EXCERPT_CHARS), done: true, chars: 10000 },
    ]);

    // The in-memory event keeps the whole thought: the digest is a STORAGE form.
    const live = (ev as Extract<SessionEvent, { kind: 'assistant' }>).parts[0];
    expect(live?.kind === 'reasoning' ? live.text : '').toHaveLength(10000);

    // Load-then-save must not re-measure the excerpt as the original: `chars` survives a second trip.
    const twice = eventsOf(deserializeLog(serializeLog(revived))!)[0] as Extract<SessionEvent, { kind: 'assistant' }>;
    expect(twice.parts).toEqual(stored.parts);
  });

  it('leaves text and tool parts untouched, and a short reasoning part keeps its text but gains its length', () => {
    const log = createLog(() => 1);
    append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [
        { kind: 'text', text: 'placing a tree', done: true },
        // An unfinished part: the reload it survives into gets no further deltas, so it stores done.
        { kind: 'reasoning', text: 'a brief thought', done: false },
        { kind: 'tool', callId: 'c1', name: 'place_object', input: { id: 'tree-oak' }, argsDone: true },
      ],
    });

    const stored = eventsOf(deserializeLog(serializeLog(log))!)[0] as Extract<SessionEvent, { kind: 'assistant' }>;
    expect(stored.parts).toEqual([
      { kind: 'text', text: 'placing a tree', done: true },
      { kind: 'reasoning', text: 'a brief thought', done: true, chars: 15 },
      { kind: 'tool', callId: 'c1', name: 'place_object', input: { id: 'tree-oak' }, argsDone: true },
    ]);
  });

  it('prunes to the last compaction and retries once on a write failure, landing the pruned save', () => {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build a village', mapContext: 'ctx' });
    append(log, { kind: 'steer', text: 'be faster' });
    append(log, { kind: 'compaction', summary: 'summary', retainedFromSeq: 2 });
    append(log, { kind: 'steer', text: 'after compaction' });

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw new DOMException('quota exceeded', 'QuotaExceededError'); });
    let health: unknown;
    expect(() => { health = saveLog(log); }).not.toThrow();
    expect(health).toBe('pruned');
    expect(setItem).toHaveBeenCalledTimes(2);

    const stored = JSON.parse(localStorage.getItem(PREFS.agentLogV3.key)!);
    expect(stored.events).toHaveLength(2);
    expect(stored.events[0].kind).toBe('compaction');
    // The retry pruned a COPY; the caller's log is untouched.
    expect(eventsOf(log)).toHaveLength(4);
  });

  it('saveLog returns saved on a plain successful write', () => {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build a village', mapContext: 'ctx' });
    expect(saveLog(log)).toBe('saved');
  });

  it('the prune keeps the newest non-error playbook load per name ahead of the compaction head', () => {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build a village', mapContext: 'ctx' });
    append(log, {
      kind: 'toolResult', callId: 'c1', name: 'load_skill', content: 'STALE COZY BODY', isError: false,
      detail: { skill: { name: 'cozy-village', kind: 'style', title: 'Cozy Village' } },
    });
    append(log, {
      kind: 'toolResult', callId: 'c2', name: 'load_skill', content: 'COZY BODY', isError: false,
      detail: { skill: { name: 'cozy-village', kind: 'style', title: 'Cozy Village' } },
    });
    append(log, {
      kind: 'toolResult', callId: 'c3', name: 'load_skill', content: 'Unknown skill "nope".', isError: true,
      detail: { skill: { name: 'zen-garden', kind: 'style', title: 'Zen Garden' } },
    });
    append(log, {
      kind: 'toolResult', callId: 'c4', name: 'load_skill', content: 'SITE ANALYSIS BODY', isError: false,
      detail: { skill: { name: 'site-analysis', kind: 'method', title: 'Site Analysis' } },
    });
    append(log, { kind: 'toolResult', callId: 'c5', name: 'place_object', content: 'placed', isError: false });
    const compaction = append(log, { kind: 'compaction', summary: 'summary', retainedFromSeq: 6 });
    append(log, { kind: 'steer', text: 'after compaction' });

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementationOnce(() => { throw new DOMException('quota exceeded', 'QuotaExceededError'); });
    expect(saveLog(log)).toBe('pruned');
    expect(setItem).toHaveBeenCalledTimes(2);

    const stored = JSON.parse(localStorage.getItem(PREFS.agentLogV3.key)!) as { events: SessionEvent[] };
    // Two retained loads (newest per name, the failed one dropped), then the compaction head.
    expect(stored.events.map((e) => (e.kind === 'toolResult' ? e.content : e.kind)))
      .toEqual(['COZY BODY', 'SITE ANALYSIS BODY', 'compaction', 'steer']);
    expect(stored.events.map((e) => e.seq)).toEqual([...stored.events].map((e) => e.seq).sort((a, b) => a - b));
    expect(stored.events.every((e) => e.kind !== 'compaction' || e.seq === compaction.seq)).toBe(true);
    expect(eventsOf(log)).toHaveLength(8);
  });

  it('reports lost on a second consecutive write failure, giving up rather than losing the return value too', () => {
    const log = createLog(() => 1);
    append(log, { kind: 'order', text: 'build a village', mapContext: 'ctx' });
    append(log, { kind: 'steer', text: 'be faster' });
    append(log, { kind: 'compaction', summary: 'summary', retainedFromSeq: 2 });
    append(log, { kind: 'steer', text: 'after compaction' });

    const setItem = vi.spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => { throw new DOMException('quota exceeded', 'QuotaExceededError'); });
    expect(saveLog(log)).toBe('lost');
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(PREFS.agentLogV3.key)).toBeNull();
    expect(eventsOf(log)).toHaveLength(4);
  });

  it('re-freezes deserialized events', () => {
    const log = buildLog();
    const revived = deserializeLog(serializeLog(log))!;
    const ev = eventsOf(revived)[0] as unknown as { text?: string };
    expect(() => { ev.text = 'mutated'; }).toThrow();
  });
});

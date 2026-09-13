import { describe, expect, it } from 'vitest';
import { append, createLog, eventsOf } from '../../../agent/core/log';
import { deriveMessages } from '../../../agent/core/project-messages';
import { eraseRecords } from '../../../agent/session/erase-records';
import { deserializeLog, serializeLog } from '../../../agent/session/persist';

const messages = (log: ReturnType<typeof createLog>) => JSON.stringify(deriveMessages(log, { budgetTokens: 100000 }));

describe('transcript erasure', () => {
  it('removes one complete record, its skill replay and later summaries, while retaining other records and checkpoint identities', () => {
    const log = createLog(() => 1);
    const gone = append(log, { kind: 'order', text: 'ERASE_ORDER', mapContext: 'ERASE_MAP' });
    append(log, { kind: 'assistant', parts: [{ kind: 'text', text: 'ERASE_REPLY', done: true }], stop: 'stop', raw: ['ERASE_RAW'] });
    append(log, { kind: 'toolResult', callId: 'skill', name: 'load_skill', content: 'ERASE_SKILL', isError: false,
      detail: { skill: { name: 'old', kind: 'method', title: 'ERASE_TITLE' } } });
    append(log, { kind: 'steer', text: 'ERASE_STEER' });
    append(log, { kind: 'jobEnd', outcome: 'done', summary: 'ERASE_SUMMARY' });
    const kept = append(log, { kind: 'order', text: 'keep this request', mapContext: 'retained map' });
    const checkpoint = append(log, { kind: 'checkpoint', label: 'job', undoIndex: 17 });
    append(log, { kind: 'assistant', parts: [{ kind: 'text', text: 'kept reply', done: true }], stop: 'stop', raw: ['ERASE_CARRIED_REASONING'], rawModel: 'm' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    append(log, { kind: 'compaction', summary: 'ERASE_COMPACTED_ORDER', retainedFromSeq: kept.seq });

    const erased = eraseRecords(log, new Set([gone.seq]));
    expect(erased).not.toBe(log);
    expect(JSON.stringify(eventsOf(erased))).not.toContain('ERASE_');
    expect(messages(erased)).not.toContain('ERASE_');
    expect(messages(erased)).toContain('keep this request');
    expect(messages(erased)).toContain('kept reply');
    expect(eventsOf(erased)).toContain(checkpoint);
    expect(erased.nextSeq).toBe(log.nextSeq);
  });

  it('removes deleted fragments and summaries after quota pruning removed their order event', () => {
    const log = createLog();
    const order = append(log, { kind: 'order', text: 'SECRET', mapContext: '' });
    append(log, { kind: 'assistant', parts: [{ kind: 'text', text: 'SECRET fragment', done: true }], stop: 'stop' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    const kept = append(log, { kind: 'order', text: 'keep', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    append(log, { kind: 'compaction', summary: 'SECRET summary', retainedFromSeq: kept.seq });
    const pruned = { ...log, events: log.events.slice(1) };
    const erased = eraseRecords(pruned, new Set([order.seq]));
    expect(JSON.stringify(eventsOf(erased))).not.toContain('SECRET');
    expect(messages(erased)).toContain('keep');
  });

  it('retains summaries made before the deleted record existed', () => {
    const log = createLog();
    const summary = append(log, { kind: 'compaction', summary: 'earlier context', retainedFromSeq: 1 });
    const gone = append(log, { kind: 'order', text: 'erase', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    expect(eventsOf(eraseRecords(log, new Set([gone.seq])))).toEqual([summary]);
  });

  it('never reuses a deleted order ID after an empty-log storage round trip', () => {
    const log = createLog();
    const gone = append(log, { kind: 'order', text: 'erase', mapContext: '' });
    append(log, { kind: 'jobEnd', outcome: 'done' });
    const erased = eraseRecords(log, new Set([gone.seq]));
    const restored = deserializeLog(serializeLog(erased))!;
    expect(eventsOf(restored)).toEqual([]);
    expect(append(restored, { kind: 'order', text: 'new', mapContext: '' }).seq).toBe(log.nextSeq);
  });

  it.each([0, -1, 1.5, '3'])('rejects an invalid persisted sequence watermark %s', (nextSeq) => {
    expect(deserializeLog(JSON.stringify({ v: 3, events: [], nextSeq }))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { append, createLog, eventsOf } from '../../../agent/core/log';
import { answerGate, askGate, awaitGate, pendingGate, shouldGate } from '../../../agent/core/gates';
import type { Oversight } from '../../../agent/core/gates';

describe('shouldGate', () => {
  const base = { tool: 'paint_terrain', isWrite: true, isWide: true, oversight: 'strict' as Oversight, allowAll: false };

  it('allowAll never gates, whatever else is true', () => {
    expect(shouldGate({ ...base, allowAll: true })).toBe(false);
  });

  it('a non-write never gates, whatever else is true', () => {
    expect(shouldGate({ ...base, isWrite: false, oversight: 'strict' })).toBe(false);
  });

  it('yolo never gates', () => {
    expect(shouldGate({ ...base, oversight: 'yolo' })).toBe(false);
  });

  it('strict gates every write, wide or narrow', () => {
    expect(shouldGate({ ...base, oversight: 'strict', isWide: true })).toBe(true);
    expect(shouldGate({ ...base, oversight: 'strict', isWide: false })).toBe(true);
  });

  it('checkpoint gates every wide write and no narrow one', () => {
    expect(shouldGate({ ...base, oversight: 'checkpoint', isWide: true })).toBe(true);
    expect(shouldGate({ ...base, oversight: 'checkpoint', isWide: false })).toBe(false);
  });
});

describe('askGate / pendingGate / answerGate', () => {
  it('does not carry an unanswered gate into a later job', () => {
    const log = createLog();
    append(log, { kind: 'order', text: 'old job', mapContext: '' });
    askGate(log, { scope: 'tool', callId: 'old', summary: 'paint' });
    append(log, { kind: 'jobEnd', outcome: 'aborted' });
    expect(pendingGate(log)).toBeUndefined();
    append(log, { kind: 'order', text: 'new job', mapContext: '' });
    expect(pendingGate(log)).toBeUndefined();
    const next = askGate(log, { scope: 'tool', callId: 'new', summary: 'paint' });
    expect(pendingGate(log)?.gateId).toBe(next);
  });

  it('askGate appends gateAsked with a fresh gateId; pendingGate returns it until answerGate appends the pair', () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', callId: 'call-1', summary: 'paint a mountain' });
    expect(typeof gateId).toBe('string');
    expect(gateId.length).toBeGreaterThan(0);

    const pending = pendingGate(log);
    expect(pending).toEqual({ gateId, scope: 'tool', callId: 'call-1', summary: 'paint a mountain' });

    answerGate(log, gateId, 'allow');
    expect(pendingGate(log)).toBeUndefined();
  });

  it('askGate mints a fresh gateId on every call', () => {
    const log = createLog();
    const a = askGate(log, { scope: 'plan', summary: 'approve the plan' });
    answerGate(log, a, 'allow');
    const b = askGate(log, { scope: 'plan', summary: 'approve again' });
    expect(b).not.toBe(a);
  });

  it('answerGate throws for an unknown gateId', () => {
    const log = createLog();
    expect(() => answerGate(log, 'gate-nope', 'allow')).toThrow();
  });

  /**
   * THE SETTLE RACE, which is the reachable one. The double answer above cannot happen through the
   * UI (the buttons unmount the moment the verdict lands), but a press landing in the frame between
   * `jobEnd` reaching the log and React removing the card takes this path: the append was legal, the
   * fold attached it to nothing, and the event sat in the persisted session invisible forever.
   */
  it('answerGate throws once the gate\'s job has SETTLED under it', () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', summary: 'paint' });
    append(log, { kind: 'jobEnd', outcome: 'aborted' });
    expect(() => answerGate(log, gateId, 'allow')).toThrow();
    expect(eventsOf(log).some((e) => e.kind === 'gateAnswered')).toBe(false);
  });

  it('answerGate throws once an INCIDENT has ended the job under it', () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', summary: 'paint' });
    append(log, { kind: 'incident', error: { cls: 'network', detail: 'gone' } });
    expect(() => answerGate(log, gateId, 'skip')).toThrow();
  });

  /** A PAUSE is not a settle: the loop re-enters the same gate on resume, so the question is held
   *  rather than lost and an answer to it is still legal. */
  it('answerGate still accepts an answer across a pause', () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', summary: 'paint' });
    append(log, { kind: 'pauseRequested' });
    append(log, { kind: 'paused' });
    expect(() => answerGate(log, gateId, 'allow')).not.toThrow();
  });

  /** A gate answered in an EARLIER job is untouched by the settle of a later one. */
  it('answerGate does not look past a jobEnd that came BEFORE the ask', () => {
    const log = createLog();
    append(log, { kind: 'jobEnd', outcome: 'done' });
    const gateId = askGate(log, { scope: 'tool', summary: 'paint' });
    expect(() => answerGate(log, gateId, 'allow')).not.toThrow();
  });

  it('answerGate throws for an already-answered gateId', () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', summary: 'do it' });
    answerGate(log, gateId, 'allow');
    expect(() => answerGate(log, gateId, 'skip')).toThrow();
  });
});

describe('awaitGate', () => {
  it('resolves with the answer when answerGate is called AFTER the wait began (subscription, not polling)', async () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', summary: 'paint' });
    const controller = new AbortController();
    const waiting = awaitGate(log, gateId, controller.signal);
    // Give the promise a tick to attach its subscription before the answer lands.
    await Promise.resolve();
    answerGate(log, gateId, 'words', 'go bigger');
    const result = await waiting;
    expect(result).toEqual({ answer: 'words', words: 'go bigger' });
  });

  it('resolves immediately when the answer is ALREADY in the log (reload-resume)', async () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', summary: 'paint' });
    answerGate(log, gateId, 'allow-always');
    const controller = new AbortController();
    const result = await awaitGate(log, gateId, controller.signal);
    expect(result).toEqual({ answer: 'allow-always', words: undefined });
  });

  it('aborting the signal rejects the wait with an AbortError, and removes the subscription', async () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', summary: 'paint' });
    const sizeBefore = log.listeners.size;
    const controller = new AbortController();
    const waiting = awaitGate(log, gateId, controller.signal);
    await Promise.resolve();
    expect(log.listeners.size).toBe(sizeBefore + 1);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    expect(log.listeners.size).toBe(sizeBefore);
  });

  it('rejects immediately when the signal is already aborted before the wait begins', async () => {
    const log = createLog();
    const gateId = askGate(log, { scope: 'tool', summary: 'paint' });
    const controller = new AbortController();
    controller.abort();
    await expect(awaitGate(log, gateId, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

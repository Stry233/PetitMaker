import { describe, expect, it } from 'vitest';
import { append, createLog, eventsOf } from '../../../agent/core/log';
import type { Part } from '../../../agent/core/types';

describe('session log', () => {
  it('stamps strictly increasing seq starting at 1', () => {
    const log = createLog();
    const a = append(log, { kind: 'order', text: 'a village', mapContext: 'ctx' });
    const b = append(log, { kind: 'pauseRequested' });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(eventsOf(log).map((e) => e.seq)).toEqual([1, 2]);
  });

  it('is append-only: the events array identity is stable and entries are frozen', () => {
    const log = createLog();
    const ev = append(log, { kind: 'steer', text: 'wider' });
    expect(Object.isFrozen(ev)).toBe(true);
    expect(() => { (ev as { text: string }).text = 'x'; }).toThrow();
  });

  it('accepts a clock injection so tests are deterministic', () => {
    const log = createLog(() => 1234);
    expect(append(log, { kind: 'paused' }).at).toBe(1234);
  });

  it('deep-freezes nested structures: parts array and its elements cannot be mutated', () => {
    const log = createLog();
    const ev = append(log, {
      kind: 'assistant',
      stop: 'tool-calls',
      parts: [{ kind: 'text', text: 'hi', done: true }],
    });
    if (ev.kind !== 'assistant') throw new Error('expected assistant event');
    expect(() => { (ev.parts as Part[]).push({ kind: 'text', text: 'more', done: true }); }).toThrow();
    expect(() => { (ev.parts[0] as { text: string }).text = 'bye'; }).toThrow();
  });

  it('leaves the raw field unfrozen: it is the provider SDK\'s own opaque object, echoed verbatim', () => {
    const log = createLog();
    const raw = { some: 'sdk-object' };
    const ev = append(log, { kind: 'assistant', stop: 'stop', parts: [], raw });
    if (ev.kind !== 'assistant') throw new Error('expected assistant event');
    expect(Object.isFrozen(ev.raw)).toBe(false);
  });
});

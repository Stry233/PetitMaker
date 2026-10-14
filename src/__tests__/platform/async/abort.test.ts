import { describe, it, expect, vi, afterEach } from 'vitest';
import { abortError, isAbortError, linkedController, nextMacrotask, throwIfAborted, withDeadline } from '../../../platform/async/abort';

afterEach(() => vi.useRealTimers());

describe('abort helpers', () => {
  it('names a cancellation AbortError and tells it from a failure', () => {
    expect(abortError().name).toBe('AbortError');
    expect(abortError('The gate wait was aborted.').message).toBe('The gate wait was aborted.');
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });

  it('throws only for an aborted signal', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(expect.objectContaining({ name: 'AbortError' }));
  });

  it('a linked child aborts with its parent and leaves the parent alone', () => {
    const parent = new AbortController();
    const child = linkedController(parent.signal);
    child.abort();
    expect(parent.signal.aborted).toBe(false);
    const second = linkedController(parent.signal);
    parent.abort();
    expect(second.signal.aborted).toBe(true);
  });

  it('a child of an already-aborted parent starts aborted', () => {
    const parent = new AbortController();
    parent.abort();
    expect(linkedController(parent.signal).signal.aborted).toBe(true);
  });

  it('a disposed child no longer follows its parent', () => {
    const parent = new AbortController();
    const child = linkedController(parent.signal);
    child.dispose();
    parent.abort();
    expect(child.signal.aborted).toBe(false);
  });

  it('a deadline aborts after its time and not once disposed', () => {
    vi.useFakeTimers();
    const timed = withDeadline(100);
    vi.advanceTimersByTime(99);
    expect(timed.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(timed.signal.aborted).toBe(true);
    const disposed = withDeadline(100);
    disposed.dispose();
    vi.advanceTimersByTime(200);
    expect(disposed.signal.aborted).toBe(false);
  });

  it('resumes after a pending timer, not before', async () => {
    const order: string[] = [];
    setTimeout(() => order.push('timer'), 0);
    await nextMacrotask();
    order.push('resumed');
    expect(order).toEqual(['timer', 'resumed']);
  });
});

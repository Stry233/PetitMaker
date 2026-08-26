import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSkippableSleeper } from '../../../agent/core/skippable-sleep';

afterEach(() => { vi.useRealTimers(); });

describe('createSkippableSleeper', () => {
  it('1. skip() resolves a pending sleep without advancing timers, and clears its timer', async () => {
    vi.useFakeTimers();
    const sleeper = createSkippableSleeper();
    const controller = new AbortController();

    let resolved = false;
    const p = sleeper.sleep(30000, controller.signal).then(() => { resolved = true; });

    expect(resolved).toBe(false);
    sleeper.skip();
    await p;

    expect(resolved).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('2. skip() with nothing pending is a no-op; a sleep STARTED after a skip waits normally', async () => {
    vi.useFakeTimers();
    const sleeper = createSkippableSleeper();
    const controller = new AbortController();

    expect(() => sleeper.skip()).not.toThrow();

    let resolved = false;
    const p = sleeper.sleep(1000, controller.signal).then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(resolved).toBe(false); // the earlier skip did not latch onto this later sleep

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(resolved).toBe(true);
  });

  it('3. an abort still rejects with AbortError and removes the skip registration', async () => {
    vi.useFakeTimers();
    const sleeper = createSkippableSleeper();
    const controller = new AbortController();

    const p = sleeper.sleep(30000, controller.signal);
    controller.abort();

    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);

    // The aborted sleep's own registration is gone; a skip now finds nothing pending and is a no-op.
    expect(() => sleeper.skip()).not.toThrow();
  });

  it('4. skip() fired from an abort listener registered BEFORE the sleeper\'s own still rejects, never resolves', async () => {
    vi.useFakeTimers();
    const sleeper = createSkippableSleeper();
    const controller = new AbortController();

    // Registered on the SAME signal ahead of the sleep call, so it runs ahead of the sleeper's own
    // onAbort listener when the signal fires: the race in which `resolve` can beat the rejection.
    controller.signal.addEventListener('abort', () => sleeper.skip());

    const p = sleeper.sleep(30000, controller.signal);
    controller.abort();

    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
});

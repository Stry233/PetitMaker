import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reviewText, ReviewUnavailable, ReviewWorkerLease } from '../../../io/moderation/text/reviewer';

interface Fake { posted: unknown[]; terminate: ReturnType<typeof vi.fn>; onmessage: ((e: { data: unknown }) => void) | null }
const workers: Fake[] = [];

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal('Worker', class {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    posted: unknown[] = [];
    terminate = vi.fn();
    constructor() { workers.push(this); }
    postMessage(message: unknown) { this.posted.push(message); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const parts = [{ field: 'title' as const, text: 'Garden' }];

it('reports progress, answers, and keeps a leased worker warm for 30 s', async () => {
  vi.useFakeTimers();
  const lease = new ReviewWorkerLease();
  const progress = vi.fn();
  const first = reviewText(parts, new AbortController().signal, progress, lease);
  workers[0]!.onmessage?.({ data: { progress: { phase: 'checking' } } });
  workers[0]!.onmessage?.({ data: { result: { allowed: true } } });
  await expect(first).resolves.toEqual({ allowed: true });
  expect(progress).toHaveBeenCalledWith({ phase: 'checking' });

  const second = reviewText(parts, new AbortController().signal, vi.fn(), lease);
  expect(workers).toHaveLength(1);
  workers[0]!.onmessage?.({ data: { result: { allowed: true } } });
  await second;
  await vi.advanceTimersByTimeAsync(29_999);
  expect(workers[0]!.terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it('refuses a concurrent check on a busy lease and drops a worker whose check failed', async () => {
  const lease = new ReviewWorkerLease();
  const first = reviewText(parts, new AbortController().signal, vi.fn(), lease);
  await expect(reviewText(parts, new AbortController().signal, vi.fn(), lease)).rejects.toBeInstanceOf(ReviewUnavailable);
  workers[0]!.onmessage?.({ data: { error: true } });
  await expect(first).rejects.toBeInstanceOf(ReviewUnavailable);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it('retires an unleased worker after its one check', async () => {
  const check = reviewText(parts, new AbortController().signal, vi.fn());
  workers[0]!.onmessage?.({ data: { result: { allowed: true } } });
  await check;
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

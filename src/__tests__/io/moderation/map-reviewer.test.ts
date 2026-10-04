import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { reviewMap, type MapRaster } from '../../../io/moderation/map/reviewer';

const workers: { posted: unknown[][]; terminate: ReturnType<typeof vi.fn>; onmessage: ((e: { data: unknown }) => void) | null; onerror: (() => void) | null }[] = [];

beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal('Worker', class {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    posted: unknown[][] = [];
    terminate = vi.fn();
    constructor() { workers.push(this); }
    postMessage(...args: unknown[]) { this.posted.push(args); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const view = (): MapRaster => ({ pixels: new Uint8ClampedArray(4) } as unknown as MapRaster);

it('transfers the views to a worker of its own and returns its verdict', async () => {
  const v = view();
  const review = reviewMap([v], new AbortController().signal);
  expect(workers).toHaveLength(1);
  const [message, transfer] = workers[0]!.posted[0]!;
  expect((message as { views: MapRaster[] }).views).toEqual([v]);
  expect(transfer).toEqual([v.pixels.buffer]);
  workers[0]!.onmessage?.({ data: { status: 'clear' } });
  await expect(review).resolves.toEqual({ status: 'clear' });
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

it('reads a slow or broken check as unavailable', async () => {
  vi.useFakeTimers();
  const slow = reviewMap([view()], new AbortController().signal);
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(slow).resolves.toEqual({ status: 'unavailable' });
  const broken = reviewMap([view()], new AbortController().signal);
  workers[1]!.onerror?.();
  await expect(broken).resolves.toEqual({ status: 'unavailable' });
  expect(workers.every((w) => w.terminate.mock.calls.length === 1)).toBe(true);
});

it('rejects a cancelled check', async () => {
  const controller = new AbortController();
  const review = reviewMap([view()], controller.signal);
  controller.abort();
  await expect(review).rejects.toMatchObject({ name: 'AbortError' });
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
});

// @vitest-environment jsdom
/**
 * The map picture check on a slow device: the worker that runs it is the browser's, so a stand-in
 * Worker speaking the check's protocol plays a device that needs far longer than a desktop does.
 */
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { reviewMap, type MapRaster } from '../../../pipelines/moderation';
import type { MapReviewReply } from '../../../pipelines/moderation/map/review.worker';

/** A check worker that reports progress every `stepMs` for `steps` steps, then answers clear;
 *  with `stallAfter` it falls silent after that many steps. */
function slowDevice({ steps, stepMs, stallAfter = Infinity }: { steps: number; stepMs: number; stallAfter?: number }) {
  return class SlowWorker {
    onmessage: ((event: MessageEvent<MapReviewReply>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];
    postMessage(): void {
      const reply = (data: MapReviewReply) => this.onmessage?.({ data } as MessageEvent<MapReviewReply>);
      for (let step = 1; step <= Math.min(steps, stallAfter); step++) {
        this.timers.push(setTimeout(() => reply(step === steps ? { status: 'clear' } : { status: 'working' }), step * stepMs));
      }
    }
    terminate(): void { this.timers.forEach(clearTimeout); }
  };
}

const VIEW: MapRaster = { width: 1, height: 1, pixels: new Uint8ClampedArray(4) };

describe('the map check on a slow device', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  spec('UI-20', 'a check that keeps making progress finishes however long it takes', async () => {
    vi.stubGlobal('Worker', slowDevice({ steps: 12, stepMs: 1_500 }));
    const verdict = reviewMap([VIEW], new AbortController().signal);
    await vi.advanceTimersByTimeAsync(12 * 1_500);
    await expect(verdict).resolves.toEqual({ status: 'clear' });
  });

  spec('UI-20', 'a check that stops making progress reports that it could not finish', async () => {
    vi.stubGlobal('Worker', slowDevice({ steps: 12, stepMs: 1_500, stallAfter: 3 }));
    const verdict = reviewMap([VIEW], new AbortController().signal);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(verdict).resolves.toEqual({ status: 'unavailable' });
  });
});

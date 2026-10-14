import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultListModels } from '../../../agent/connection/model-discovery';
import { __resetModelCatalog } from '../../../agent/providers/model-catalog';
import { classify } from '../../../agent/core/errors';

/** What the mocked endpoint does with a model-list request; it answers at once unless a test says otherwise. */
const endpoint = vi.hoisted(() => ({ listModels: (_signal: AbortSignal): Promise<string[]> => Promise.resolve(['deepseek-flash', 'deepseek-v4-pro']) }));
vi.mock('../../../agent/providers/openai', () => ({
  createOpenAIAdapter: () => ({ listModels: (signal: AbortSignal) => endpoint.listModels(signal) }),
}));

const ANSWER = endpoint.listModels;
const stalledFetch = () => vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
  init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
}));

afterEach(async () => {
  endpoint.listModels = ANSWER;
  await vi.advanceTimersByTimeAsync(21_000);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  __resetModelCatalog();
});

describe('model discovery', () => {
  it('lists the account models without waiting out a stalled capability download', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stalledFetch());
    const listing = defaultListModels({ provider: 'deepseek', apiKey: 'sk-test' });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(listing).resolves.toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  });

  it('gives up on a silent endpoint at the deadline, aborts the request, and reads as a network fault', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stalledFetch());
    let handed: AbortSignal | undefined;
    endpoint.listModels = (signal) => { handed = signal; return new Promise<string[]>(() => {}); };
    const outcome = defaultListModels({ provider: 'deepseek', apiKey: 'sk-test' }).then(() => 'answered').catch((err: unknown) => err);

    await vi.advanceTimersByTimeAsync(7999);
    expect(handed?.aborted, 'the request stands while the deadline has not passed').toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    const err = await outcome;
    expect(err).toBeInstanceOf(Error);
    expect(handed?.aborted, 'a late answer is worth nothing, so the request goes').toBe(true);
    expect(classify({ message: (err as Error).message }).cls).toBe('network');
  });

  it('hands back the list an endpoint does answer, and the deadline never fires after it', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stalledFetch());
    let handed: AbortSignal | undefined;
    endpoint.listModels = (signal) => { handed = signal; return Promise.resolve(['deepseek-flash']); };
    const listing = defaultListModels({ provider: 'deepseek', apiKey: 'sk-test' });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(listing).resolves.toEqual(['deepseek-flash']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(handed?.aborted, 'the deadline is cleared by the answer').toBe(false);
  });
});

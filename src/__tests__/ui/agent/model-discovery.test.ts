import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultListModels } from '../../../ui/agent/model-discovery';
import { resetModelCatalog } from '../../../agent/providers/model-catalog';

vi.mock('../../../agent/providers/openai', () => ({
  createOpenAIAdapter: () => ({ listModels: async () => ['deepseek-flash', 'deepseek-v4-pro'] }),
}));

afterEach(async () => { await vi.advanceTimersByTimeAsync(21_000); vi.unstubAllGlobals(); vi.useRealTimers(); resetModelCatalog(); });

describe('model discovery', () => {
  it('lists the account models without waiting out a stalled capability download', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const listing = defaultListModels({ provider: 'deepseek', apiKey: 'sk-test' });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(listing).resolves.toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  });
});

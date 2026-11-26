import { afterEach, describe, expect, it, vi } from 'vitest';
import { __resetJsonReads, readJsonOnce } from '../../../platform/async/json-read';

const answer = (body: unknown, ok = true) => ({ ok, json: async () => body });

afterEach(() => { __resetJsonReads(); vi.unstubAllGlobals(); });

describe('readJsonOnce', () => {
  it('reads a file once for every caller, and each file by its own URL', async () => {
    const fetched = vi.fn(async (url: string) => answer({ from: url }));
    vi.stubGlobal('fetch', fetched);
    const [a, again, b] = await Promise.all([readJsonOnce('/a.json'), readJsonOnce('/a.json'), readJsonOnce('/b.json')]);
    expect(a).toEqual({ from: '/a.json' });
    expect(again).toBe(a);
    expect(b).toEqual({ from: '/b.json' });
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it('answers null for a file that does not arrive and reads it again on the next call', async () => {
    const fetched = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(answer(null, false))
      .mockResolvedValueOnce(answer({ ok: 1 }));
    vi.stubGlobal('fetch', fetched);
    expect(await readJsonOnce('/a.json')).toBeNull();
    expect(await readJsonOnce('/a.json')).toBeNull();
    expect(await readJsonOnce('/a.json')).toEqual({ ok: 1 });
    expect(fetched).toHaveBeenCalledTimes(3);
  });
});

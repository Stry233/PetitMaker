import { describe, expect, it, vi } from 'vitest';
import { memoLoad } from '../../../platform/async/memo-load';

describe('memoLoad', () => {
  it('runs the load once and hands every caller the same promise', async () => {
    const load = vi.fn(async () => ({ module: 1 }));
    const get = memoLoad(load);
    const [a, b] = [get(), get()];
    expect(a).toBe(b);
    expect(await a).toBe(await get());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load, so the next caller fetches afresh', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('ok');
    const get = memoLoad(load as () => Promise<string>);
    await expect(get()).rejects.toThrow('offline');
    expect(await get()).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });
});

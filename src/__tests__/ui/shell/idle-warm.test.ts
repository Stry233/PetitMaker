import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeIcon, resetIdleWarmForTest } from '../../../ui/shell/splash/idle-warm';

beforeEach(() => { resetIdleWarmForTest(); });
afterEach(() => { vi.unstubAllGlobals(); });

function images(decode?: () => Promise<void>) {
  const created: unknown[] = [];
  class TestImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    decode = decode;
    constructor() { created.push(this); }
    set src(_url: string) { queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', TestImage);
  return created;
}

describe('shared icon decoding', () => {
  it('uses the image load event without refetching on browsers without decode', async () => {
    const created = images();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await decodeIcon('/icon.png')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it('shares pending and completed decoding across splash and idle callers', async () => {
    let release!: () => void;
    const decode = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const created = images(decode);
    const first = decodeIcon('/icon.png');
    expect(decodeIcon('/icon.png')).toBe(first);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    release();
    expect(await first).toBe(true);
    expect(await decodeIcon('/icon.png')).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('drains a cache repair before trying to decode the replacement', async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error('truncated')).mockResolvedValue(undefined);
    const created = images(decode);
    let release!: () => void;
    const body = new Promise<void>(resolve => { release = resolve; });
    const fetch = vi.fn(async () => ({ ok: true, blob: () => body }));
    vi.stubGlobal('fetch', fetch);
    const work = decodeIcon('/icon.png');
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(created).toHaveLength(1);
    release();
    expect(await work).toBe(true);
    expect(created).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith('/icon.png', { cache: 'reload' });
  });

  it('stops after one failed cache repair', async () => {
    images(vi.fn().mockRejectedValue(new Error('invalid image')));
    const fetch = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    expect(await decodeIcon('/missing.png')).toBe(false);
    expect(await decodeIcon('/missing.png')).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

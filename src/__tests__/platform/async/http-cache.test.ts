import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeImage, fetchIntoCache, __resetDecodes } from '../../../platform/async/http-cache';

beforeEach(() => { __resetDecodes(); });
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
    expect(await decodeImage('/icon.png')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it('shares pending and completed decoding across splash and idle callers', async () => {
    let release!: () => void;
    const decode = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
    const created = images(decode);
    const first = decodeImage('/icon.png');
    expect(decodeImage('/icon.png')).toBe(first);
    await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
    release();
    expect(await first).toBe(true);
    expect(await decodeImage('/icon.png')).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('drains a cache repair before trying to decode the replacement', async () => {
    const decode = vi.fn().mockRejectedValueOnce(new Error('truncated')).mockResolvedValue(undefined);
    const created = images(decode);
    let release!: () => void;
    const body = new Promise<void>(resolve => { release = resolve; });
    const fetch = vi.fn(async () => ({ ok: true, blob: () => body }));
    vi.stubGlobal('fetch', fetch);
    const work = decodeImage('/icon.png');
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
    expect(await decodeImage('/missing.png')).toBe(false);
    expect(await decodeImage('/missing.png')).toBe(false);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('fetching into the cache', () => {
  it('reports every body byte as it streams, and whether the file arrived', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(3000)); controller.enqueue(new Uint8Array(500)); controller.close(); },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    const chunks: number[] = [];
    expect(await fetchIntoCache('/font.woff2', undefined, (bytes) => chunks.push(bytes))).toBe(true);
    expect(chunks).toEqual([3000, 500]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await fetchIntoCache('/font.woff2')).toBe(false);
  });
});

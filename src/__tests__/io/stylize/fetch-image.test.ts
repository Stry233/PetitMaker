// A provider-returned image URL is fetched only over HTTPS, only as a bounded PNG, JPEG, or WebP body.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchProviderImage, MAX_IMAGE_BYTES } from '../../../io/stylize/dialects/fetch-image';
import { StylizeError } from '../../../io/stylize/dialects/types';

function reply(body: Uint8Array, contentType: string, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  } as unknown as Response;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = Uint8Array.from('RIFF\0\0\0\0WEBP', (c) => c.charCodeAt(0));
const HTML = new Uint8Array([...'<html>'].map((c) => c.charCodeAt(0)));

afterEach(() => vi.unstubAllGlobals());

describe('fetchProviderImage', () => {
  it('returns a data URL whose media type comes from the image signature', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(PNG, 'application/octet-stream')));
    await expect(fetchProviderImage('https://cdn.example/i.png')).resolves.toBe(`data:image/png;base64,${btoa('\x89PNG')}`);
  });

  it('accepts a CDN host that differs from the API origin', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(WEBP, 'image/webp')));
    await expect(fetchProviderImage('https://images.cdn.other/i')).resolves.toContain('data:image/webp;base64,');
  });

  it.each(['http://cdn.example/i.png', 'data:image/png;base64,AAAA', 'file:///etc/passwd', 'blob:https://x/y', 'not a url'])(
    'rejects %s before any request',
    async (url) => {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      await expect(fetchProviderImage(url)).rejects.toMatchObject({ status: 'bad_response' });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('rejects a body that is not a PNG, JPEG, or WebP whatever the header says', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(HTML, 'image/png')));
    await expect(fetchProviderImage('https://cdn.example/i')).rejects.toMatchObject({ status: 'bad_response' });
  });

  it('rejects an empty body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(new Uint8Array(), 'image/png')));
    await expect(fetchProviderImage('https://cdn.example/i')).rejects.toMatchObject({ status: 'bad_response' });
  });

  it('labels a JPEG body as image/jpeg even under a mislabeled header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(JPEG, 'image/png')));
    await expect(fetchProviderImage('https://cdn.example/i')).resolves.toContain('data:image/jpeg;base64,');
  });

  it('rejects a declared body past the size cap without reading it', async () => {
    const arrayBuffer = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) }),
      arrayBuffer,
    } as unknown as Response)));
    await expect(fetchProviderImage('https://cdn.example/i')).rejects.toMatchObject({ status: 'bad_response' });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('rejects an undeclared body past the size cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(new Uint8Array(MAX_IMAGE_BYTES + 1), 'image/png')));
    await expect(fetchProviderImage('https://cdn.example/i')).rejects.toMatchObject({ status: 'bad_response' });
  });

  it('rejects a non-2xx reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(PNG, 'image/png', { ok: false, status: 404 })));
    await expect(fetchProviderImage('https://cdn.example/i')).rejects.toMatchObject({ status: 'bad_response' });
  });

  it('reports a rejected fetch as a network failure with the message scrubbed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('failed with Bearer sk-abcdefghijklmnop'); }));
    const err = await fetchProviderImage('https://cdn.example/i').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StylizeError);
    expect((err as StylizeError).status).toBe('network');
    expect((err as StylizeError).message).not.toContain('sk-abcdefghijklmnop');
  });
});

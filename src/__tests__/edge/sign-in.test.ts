/**
 * The mainland site's token exchange: it adds the application's secret to a signing-in user's code
 * for the site's own pages only, and gives away nothing else: no secret and no refresh token.
 */
import { describe, expect, it, vi } from 'vitest';
import routine, { SIGN_IN_PATH, handleSignIn } from '../../../edge/sign-in.js';

const SITE = 'https://site.test';
const ENV = {
  MODELSCOPE_CLIENT_ID: 'app-id',
  MODELSCOPE_CLIENT_SECRET: 'app-secret',
  MODELSCOPE_REDIRECT_URI: `${SITE}/connect/`,
  SIGN_IN_ALLOWED_ORIGINS: `${SITE}, https://www.site.test`,
};

function post(body: unknown, init: { origin?: string | null; type?: string; method?: string; path?: string } = {}): Request {
  const headers = new Headers({ 'Content-Type': init.type ?? 'application/json' });
  if (init.origin !== null) headers.set('Origin', init.origin ?? SITE);
  const method = init.method ?? 'POST';
  return new Request(`${SITE}${init.path ?? SIGN_IN_PATH}`, { method, headers, ...(method === 'GET' ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
}

const upstreamOf = (reply: unknown) => vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(JSON.stringify(reply), { status: 200 }));
const sentForm = (upstream: ReturnType<typeof upstreamOf>) => Object.fromEntries(new URLSearchParams(String(upstream.mock.calls[0]![1]!.body)));

describe('the sign-in token exchange', () => {
  it('trades a code and its verifier for the access token alone, adding the secret and the registered return address', async () => {
    const upstream = upstreamOf({ access_token: 'at', refresh_token: 'rt', expires_in: 2592000, scope: 'openid api-inference', token_type: 'bearer', id_token: 'jwt' });
    const response = await handleSignIn(post({ grant: 'code', code: 'the-code', verifier: 'the-verifier' }), ENV, upstream);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accessToken: 'at', expiresIn: 2592000, scope: 'openid api-inference' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(upstream.mock.calls[0]![0]).toBe('https://www.modelscope.cn/oauth/token');
    expect(sentForm(upstream)).toEqual({
      grant_type: 'authorization_code', code: 'the-code', code_verifier: 'the-verifier',
      redirect_uri: `${SITE}/connect/`, client_id: 'app-id', client_secret: 'app-secret',
    });
  });

  it('tells the page which application this environment signs in against, and nothing more', async () => {
    const upstream = upstreamOf({});
    const response = await handleSignIn(post(null, { method: 'GET' }), ENV, upstream);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clientId: 'app-id' });
    expect((await handleSignIn(post(null, { method: 'GET' }), {}, upstream)).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('renews nothing: a refresh token is not a body it accepts', async () => {
    const upstream = upstreamOf({ access_token: 'at2', refresh_token: 'rt2', expires_in: 2592000 });
    const response = await handleSignIn(post({ grant: 'refresh', refreshToken: 'rt' }), ENV, upstream);
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('never returns the secret, and reports a refusal ModelScope sends as HTTP 200', async () => {
    const upstream = upstreamOf({ error: 'invalid_grant', error_description: 'invalid or expired code for app-secret' });
    const response = await handleSignIn(post({ grant: 'code', code: 'spent', verifier: 'v' }), ENV, upstream);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: 'invalid_grant' });
    expect(text).not.toContain('app-secret');
  });

  it('answers only its own path, only POST, only JSON and only the site own pages, without calling out', async () => {
    const upstream = upstreamOf({ access_token: 'at' });
    const valid = { grant: 'code', code: 'c', verifier: 'v' };
    expect((await handleSignIn(post(valid, { path: '/api/other' }), ENV, upstream)).status).toBe(404);
    expect((await handleSignIn(post(valid, { method: 'PUT' }), ENV, upstream)).status).toBe(405);
    expect((await handleSignIn(post(valid, { origin: 'https://elsewhere.test' }), ENV, upstream)).status).toBe(403);
    expect((await handleSignIn(post(valid, { origin: null }), ENV, upstream)).status).toBe(403);
    expect((await handleSignIn(post(valid, { type: 'text/plain' }), ENV, upstream)).status).toBe(415);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses a body of another shape, or one too large, without calling out', async () => {
    const upstream = upstreamOf({ access_token: 'at' });
    for (const body of ['not json', { grant: 'code', code: 'c' }, { grant: 'password', username: 'u' }, { grant: 'code', code: 'has space', verifier: 'v' }, null]) {
      expect((await handleSignIn(post(body), ENV, upstream)).status).toBe(400);
    }
    expect((await handleSignIn(post({ grant: 'code', code: 'x'.repeat(9000), verifier: 'v' }), ENV, upstream)).status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('reads its variables from the third argument the edge runtime passes, and hands every other path back to the static site', async () => {
    const assets = { fetch: vi.fn(async () => new Response('site page', { status: 404 })) };
    const other = await routine.fetch(post({}, { path: '/no-such-page', method: 'GET' }), {}, { ...ENV, Assets: assets });
    expect(await other.text()).toBe('site page');
    expect(assets.fetch).toHaveBeenCalledTimes(1);
    const refused = await routine.fetch(post({ grant: 'code', code: 'c', verifier: 'v' }, { origin: 'https://elsewhere.test' }), {}, { ...ENV, Assets: assets });
    expect(refused.status).toBe(403);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });

  it('says it is not configured when a variable is missing, and unavailable when ModelScope cannot be reached', async () => {
    const upstream = upstreamOf({ access_token: 'at' });
    const { MODELSCOPE_CLIENT_SECRET: _secret, ...unset } = ENV;
    expect((await handleSignIn(post({ grant: 'code', code: 'c', verifier: 'v' }), unset, upstream)).status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
    const down = vi.fn(async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect((await handleSignIn(post({ grant: 'code', code: 'c', verifier: 'v' }), ENV, down)).status).toBe(502);
  });
});

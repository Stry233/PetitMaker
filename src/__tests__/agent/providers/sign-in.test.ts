/** Signing in sends the user out with a PKCE challenge and trades the returned code for their key. */
import { describe, expect, it, vi } from 'vitest';
import { SIGN_IN_PATH } from '../../../../edge/sign-in.js';
import { MODELSCOPE_EXCHANGE_PATH, PROVIDER_SIGN_INS } from '../../../agent/providers/sign-in';

const REQUEST = { returnUrl: 'https://example.test/connect/', challenge: 'abc', state: 'round-1' };
const replies = (...bodies: [number, unknown][]) => {
  const queue = [...bodies];
  return vi.fn(async (..._args: Parameters<typeof fetch>) => {
    const [status, body] = queue.shift()!;
    return new Response(JSON.stringify(body), { status });
  });
};

describe('OpenRouter sign-in', () => {
  const signIn = PROVIDER_SIGN_INS.openrouter!;

  it('sends the user to the consent page with the challenge, the state and a capped, expiring key', async () => {
    const url = new URL(await signIn.authorizeUrl(REQUEST, replies()));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    const { limit, expiration, ...rest } = Object.fromEntries(url.searchParams);
    expect(rest).toEqual({ callback_url: REQUEST.returnUrl, code_challenge: 'abc', code_challenge_method: 'S256', state: 'round-1' });
    expect(Number(limit)).toBeGreaterThan(0);
    expect(expiration).toMatch(/\S/);
  });

  it('trades the code and the verifier for the key, with no secret of its own', async () => {
    const fetchFn = replies([200, { key: 'user-key' }]);
    await expect(signIn.exchange('the-code', 'the-verifier', fetchFn)).resolves.toBe('user-key');
    const [address, init] = fetchFn.mock.calls[0]!;
    expect(address).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(JSON.parse(String(init!.body))).toEqual({ code: 'the-code', code_verifier: 'the-verifier', code_challenge_method: 'S256' });
  });

  it('fails when the provider refuses the code or returns no key', async () => {
    await expect(signIn.exchange('c', 'v', replies([403, {}]))).rejects.toThrow();
    await expect(signIn.exchange('c', 'v', replies([200, {}]))).rejects.toThrow();
  });
});

describe('ModelScope sign-in', () => {
  const signIn = PROVIDER_SIGN_INS.modelscope!;

  it('reaches the exchange the site serves', () => {
    expect(MODELSCOPE_EXCHANGE_PATH).toBe(SIGN_IN_PATH);
  });

  it('asks the site exchange for its application, then sends the user to consent with inference access', async () => {
    const fetchFn = replies([200, { clientId: 'app-id' }]);
    const url = new URL(await signIn.authorizeUrl(REQUEST, fetchFn));
    expect(fetchFn.mock.calls[0]![0]).toBe(MODELSCOPE_EXCHANGE_PATH);
    expect(url.origin + url.pathname).toBe('https://www.modelscope.cn/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'app-id', redirect_uri: REQUEST.returnUrl, response_type: 'code', scope: 'openid profile api-inference',
      state: 'round-1', code_challenge: 'abc', code_challenge_method: 'S256',
    });
  });

  it('trades the code through the site exchange for the access token', async () => {
    const fetchFn = replies([200, { accessToken: 'ms_oauth_token', refreshToken: 'r', expiresIn: 2592000 }]);
    await expect(signIn.exchange('the-code', 'the-verifier', fetchFn)).resolves.toBe('ms_oauth_token');
    const [address, init] = fetchFn.mock.calls[0]!;
    expect(address).toBe(MODELSCOPE_EXCHANGE_PATH);
    expect(JSON.parse(String(init!.body))).toEqual({ grant: 'code', code: 'the-code', verifier: 'the-verifier' });
  });

  it('fails when the exchange is not configured or refuses the code', async () => {
    await expect(signIn.authorizeUrl(REQUEST, replies([503, { error: 'not_configured' }]))).rejects.toThrow();
    await expect(signIn.exchange('c', 'v', replies([400, { error: 'invalid_grant' }]))).rejects.toThrow();
  });
});

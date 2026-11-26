/**
 * Sign-in with a provider: the user consents on the provider's own page and the page receives a key
 * of that user's account, billed to that account. No flow here holds a secret, since a static page
 * can keep none; where a provider demands one, the site's own exchange adds it (`edge/sign-in.js`).
 */
import type { ProviderId } from './defaults';

/** What a sign-in round sends the user to the provider with. */
interface SignInRequest {
  /** The address the provider returns the user to. */
  readonly returnUrl: string;
  /** The PKCE challenge of the verifier this page keeps. */
  readonly challenge: string;
  /** Returned unchanged with the code, so an answer is matched to its round. */
  readonly state: string;
}

interface ProviderSignIn {
  /** The provider's consent page for `request`. */
  authorizeUrl(request: SignInRequest, fetchFn: typeof fetch): Promise<string>;
  /** Trades the returned `code` and the kept `verifier` for the user's key; throws on a refusal. */
  exchange(code: string, verifier: string, fetchFn: typeof fetch): Promise<string>;
}

/** The spending cap the consent page opens with, in US dollars; the user may change it there. */
const OPENROUTER_KEY_LIMIT_USD = 5;
/** The lifetime the consent page opens with, one of the provider's own choices. */
const OPENROUTER_KEY_EXPIRATION = '30-days';

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`sign-in request refused: ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

function textField(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value === '') throw new Error(`sign-in answer lacks ${field}`);
  return value;
}

const openrouter: ProviderSignIn = {
  authorizeUrl({ returnUrl, challenge, state }) {
    const url = new URL('https://openrouter.ai/auth');
    url.searchParams.set('callback_url', returnUrl);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('limit', String(OPENROUTER_KEY_LIMIT_USD));
    url.searchParams.set('expiration', OPENROUTER_KEY_EXPIRATION);
    return Promise.resolve(url.toString());
  },
  async exchange(code, verifier, fetchFn) {
    const body = await jsonOf(await fetchFn('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    }));
    return textField(body, 'key');
  },
};

/** The site's own exchange, which holds ModelScope's client secret; `edge/sign-in.js` answers it. */
export const MODELSCOPE_EXCHANGE_PATH = '/api/sign-in/modelscope';

const modelscope: ProviderSignIn = {
  async authorizeUrl({ returnUrl, challenge, state }, fetchFn) {
    // Each environment's exchange names its own application, so no build carries a client id.
    const clientId = textField(await jsonOf(await fetchFn(MODELSCOPE_EXCHANGE_PATH)), 'clientId');
    const url = new URL('https://www.modelscope.cn/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', returnUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid profile api-inference');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  },
  async exchange(code, verifier, fetchFn) {
    const body = await jsonOf(await fetchFn(MODELSCOPE_EXCHANGE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant: 'code', code, verifier }),
    }));
    return textField(body, 'accessToken');
  },
};

/** The providers a user can sign in with instead of pasting a key. */
export const PROVIDER_SIGN_INS: Partial<Record<ProviderId, ProviderSignIn>> = { openrouter, modelscope };

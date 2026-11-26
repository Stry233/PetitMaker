// @ts-check
/**
 * The one piece of server code the mainland site runs: it trades a ModelScope authorization code
 * for the signing-in user's own access token. The refresh token ModelScope issues with it is dropped
 * here, so no page ever holds the longer-lived credential, and a user signs in again when the
 * access token expires.
 *
 * ModelScope's token endpoint demands the application's client secret, which a static page cannot
 * hold, so the page sends the code here and this function adds the secret. It reaches one fixed
 * upstream address, stores and logs nothing, and carries no model traffic: the browser calls the
 * models itself with the token it gets back.
 *
 * Runs as an Alibaba Cloud ESA edge function: a plain ES module whose `fetch` receives the request,
 * a context and, third, the environment's variables with the `Assets` binding of the static site.
 */

/** The path this function answers; every other path is a 404. */
export const SIGN_IN_PATH = '/api/sign-in/modelscope';
const TOKEN_URL = 'https://www.modelscope.cn/oauth/token';
/** A request body past this many characters is refused unread by the parser. */
const MAX_BODY_CHARS = 8192;
/** The edge gateway drops a request with no answer after 10 s, so the upstream call gives up first. */
const UPSTREAM_TIMEOUT_MS = 8000;
/** A code, verifier or token: printable ASCII with no space, as OAuth issues them. */
const CREDENTIAL = /^[\x21-\x7e]{1,4096}$/;

/**
 * @typedef {{ MODELSCOPE_CLIENT_ID?: string, MODELSCOPE_CLIENT_SECRET?: string,
 *   MODELSCOPE_REDIRECT_URI?: string, SIGN_IN_ALLOWED_ORIGINS?: string }} SignInEnv
 */

/** @param {number} status @param {Record<string, unknown>} body @param {Record<string, string>} [extra] */
function answer(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}

/** @param {unknown} value @returns {value is string} */
const credential = (value) => typeof value === 'string' && CREDENTIAL.test(value);

/**
 * The upstream form for a request body, or null where the body is not `{ grant: 'code', code, verifier }`.
 * @param {unknown} body @param {string} redirectUri
 * @returns {Record<string, string> | null}
 */
function grantFields(body, redirectUri) {
  if (typeof body !== 'object' || body === null) return null;
  const { grant, code, verifier } = /** @type {Record<string, unknown>} */ (body);
  if (grant === 'code' && credential(code) && credential(verifier)) {
    return { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri };
  }
  return null;
}

/**
 * @param {Request} request
 * @param {SignInEnv} env
 * @param {typeof fetch} fetchFn
 * @returns {Promise<Response>}
 */
export async function handleSignIn(request, env, fetchFn) {
  if (new URL(request.url).pathname !== SIGN_IN_PATH) return answer(404, { error: 'not_found' });
  // The page asks which application this environment signs in against; the id is public, and each
  // environment answers with its own, so no build carries one.
  if (request.method === 'GET') {
    return env.MODELSCOPE_CLIENT_ID ? answer(200, { clientId: env.MODELSCOPE_CLIENT_ID }) : answer(503, { error: 'not_configured' });
  }
  if (request.method !== 'POST') return answer(405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' });

  // Only the site's own pages may call. A browser always sends Origin on a cross-origin POST, and
  // requiring JSON keeps any other site's page behind a preflight this function never answers.
  const allowed = (env.SIGN_IN_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  if (origin === null || !allowed.includes(origin)) return answer(403, { error: 'forbidden_origin' });
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) return answer(415, { error: 'unsupported_media_type' });

  const { MODELSCOPE_CLIENT_ID: clientId, MODELSCOPE_CLIENT_SECRET: clientSecret, MODELSCOPE_REDIRECT_URI: redirectUri } = env;
  if (!clientId || !clientSecret || !redirectUri) return answer(503, { error: 'not_configured' });

  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return answer(413, { error: 'too_large' });
  /** @type {unknown} */
  let body;
  try { body = JSON.parse(text); } catch { return answer(400, { error: 'invalid_request' }); }
  const fields = grantFields(body, redirectUri);
  if (!fields) return answer(400, { error: 'invalid_request' });

  /** @type {Record<string, unknown>} */
  let upstream;
  try {
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('timeout')), UPSTREAM_TIMEOUT_MS); });
    const call = fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ ...fields, client_id: clientId, client_secret: clientSecret }).toString(),
    }).then((response) => response.json());
    upstream = /** @type {Record<string, unknown>} */ (await Promise.race([call, timeout]).finally(() => clearTimeout(timer)));
  } catch {
    return answer(502, { error: 'upstream_unavailable' });
  }

  // ModelScope reports a refusal as HTTP 200 with an `error` field, so the body decides.
  if (typeof upstream !== 'object' || upstream === null || typeof upstream.access_token !== 'string') {
    const code = upstream && typeof upstream.error === 'string' && /^[a-z_]{1,40}$/.test(upstream.error) ? upstream.error : 'refused';
    return answer(400, { error: code });
  }
  return answer(200, {
    accessToken: upstream.access_token,
    ...(typeof upstream.expires_in === 'number' ? { expiresIn: upstream.expires_in } : {}),
    ...(typeof upstream.scope === 'string' ? { scope: upstream.scope } : {}),
  });
}

export default {
  /**
   * ESA runs this for every request no static file answers, so a path that is not the exchange goes
   * back to the static site, which serves its own not-found answer.
   * @param {Request} request
   * @param {unknown} _context
   * @param {SignInEnv & { Assets?: { fetch(request: Request): Promise<Response> } }} env
   */
  fetch(request, _context, env) {
    if (new URL(request.url).pathname !== SIGN_IN_PATH && env && env.Assets) return env.Assets.fetch(request);
    return handleSignIn(request, env ?? {}, fetch);
  },
};

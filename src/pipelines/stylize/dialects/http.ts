// The one HTTP exchange every dialect speaks: the key in the dialect's own header, a JSON or
// multipart body, and a non-2xx reply classified from its status and body.
import { classify, keyRefusal, scrub } from './errors';
import { isAbortError, withDeadline } from '../../../platform/async/abort';
import { StylizeError, type DialectConfig } from './types';

/** Where the key rides: an OpenAI-style bearer token, or Google's `x-goog-api-key` header. */
export type KeyHeader = 'bearer' | 'goog';

export interface HttpCall {
  auth?: KeyHeader;
  /** A JSON body; the call is a POST. */
  json?: unknown;
  /** A multipart body; the call is a POST and the browser writes its own content type. */
  form?: FormData;
  signal?: AbortSignal;
}

function keyHeaders(cfg: DialectConfig, auth: KeyHeader): Record<string, string> {
  return auth === 'goog' ? { 'x-goog-api-key': cfg.key } : { Authorization: `Bearer ${cfg.key}` };
}

function send(cfg: DialectConfig, path: string, call: HttpCall): Promise<Response> {
  const auth = keyHeaders(cfg, call.auth ?? 'bearer');
  const init: RequestInit = call.json !== undefined
    ? { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: JSON.stringify(call.json) }
    : call.form !== undefined
      ? { method: 'POST', headers: auth, body: call.form }
      : { headers: auth };
  return fetch(`${cfg.baseUrl}${path}`, { ...init, signal: call.signal });
}

/** The parsed reply of a 2xx call (a non-JSON body stays text; an empty one is undefined). Throws
 *  the classified `StylizeError` for any other reply, `network` when the request never landed, and
 *  the abort itself when the caller cancelled. */
export async function requestJson(cfg: DialectConfig, path: string, call: HttpCall = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await send(cfg, path, call);
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new StylizeError('network', scrub(String(err instanceof Error ? err.message : err)));
  }
  const raw = await res.text();
  let json: unknown;
  try { json = raw ? JSON.parse(raw) : undefined; } catch { json = raw; }
  if (!res.ok) throw classify(res.status, json);
  return json;
}

export interface ModelListing {
  auth?: KeyHeader;
  /** The reply field holding the model rows. */
  field: string;
  /** The row field holding the model id. */
  idKey: string;
  signal?: AbortSignal;
}

/** The model ids a list reply carries, or null when `field` is not an array of rows. Rows without
 *  a string id are skipped. */
function readModelIds(json: unknown, field: string, idKey: string): string[] | null {
  const rows = json && typeof json === 'object' ? (json as Record<string, unknown>)[field] : undefined;
  if (!Array.isArray(rows)) return null;
  return rows.flatMap((row) => {
    const id = row && typeof row === 'object' ? (row as Record<string, unknown>)[idKey] : undefined;
    return typeof id === 'string' ? [id] : [];
  });
}

/** How long a model list may take to answer before the endpoint counts as one that will not
 *  enumerate. */
const LIST_DEADLINE_MS = 8000;

/** The ids an endpoint's model list names, per the `listModels` contract on `StylizeDialect`: null
 *  when the endpoint would not enumerate or answers nothing within `LIST_DEADLINE_MS`, and the
 *  classified refusal thrown for a 401 or 403. */
export async function listModelIds(cfg: DialectConfig, path: string, listing: ModelListing): Promise<string[] | null> {
  const bound = withDeadline(LIST_DEADLINE_MS, listing.signal);
  try {
    let res: Response;
    try {
      res = await send(cfg, path, { auth: listing.auth, signal: bound.signal });
    } catch {
      return null;
    }
    const refusal = await keyRefusal(res);
    if (refusal) throw refusal;
    if (!res.ok) return null;
    return readModelIds(await res.json().catch(() => null), listing.field, listing.idKey);
  } finally {
    bound.dispose();
  }
}

/** Newest first: model ids carry their version or date, so a reverse sort leads with the latest. */
export function newestFirst(ids: readonly string[]): string[] {
  return [...ids].sort().reverse();
}

// Classification for a non-2xx HTTP reply, and the scrub every thrown message passes through.
// A rejected fetch never carries a status or body, so `http.ts` reads it as `network`; a
// cancellation passes through unclassified.
import { httpFailureKind } from '../../../platform/remote/http-failure';
import { StylizeError, type StylizeStatus } from './types';
import { redactSecrets } from '../../../platform/remote/redact';
import { isAbortError } from '../../../platform/async/abort';

/** The generic Bearer/api-key fragment matters most here: the custom row points at arbitrary
 *  gateways whose error pages may echo the request's own auth header, in whatever shape the key has. */
export function scrub(text: string): string {
  return redactSecrets(text, undefined, '***');
}

function bodyText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body === undefined || body === null) return '';
  try { return JSON.stringify(body); } catch { return String(body); }
}

/** A body naming the model, moderation or content policy is the provider's own refusal wording;
 *  anything else on a 400 is an address or shape problem, not a request the provider understood
 *  and declined. */
const REFUSAL_WORDING = /\b(model|moderation|content)\b/i;

/** The refusal a model-list reply carries when the provider turned the key away (401 or 403), or
 *  null for any other reply, which only means the endpoint will not enumerate. */
export async function keyRefusal(res: Response): Promise<StylizeError | null> {
  if (res.status !== 401 && res.status !== 403) return null;
  const text = await res.text().catch(() => '');
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* a plain-text error page stays text */ }
  return classify(res.status, body);
}

export function classify(status: number, body: unknown): StylizeError {
  const detail = scrub(bodyText(body));
  const kind = httpFailureKind(status, detail);
  if (kind === 'auth') return new StylizeError('bad_key', detail);
  // An account that may not spend, or one asked to slow down: the status slot reads both as a
  // declined request, not a rejected key.
  if (kind === 'quota' || kind === 'rate-limit') return new StylizeError('refused', detail);
  if (status === 400 && REFUSAL_WORDING.test(detail)) return new StylizeError('refused', detail);
  return new StylizeError('bad_response', detail);
}

/** The status slot's face for a failure, or null for a cancelled call, which says nothing. An
 *  unclassified failure reads as `fallback`: the network for a provider call, the device for a
 *  local render. */
export function toStylizeStatus(err: unknown, fallback: StylizeStatus = 'network'): StylizeStatus | null {
  if (err instanceof StylizeError) return err.status;
  return isAbortError(err) ? null : fallback;
}

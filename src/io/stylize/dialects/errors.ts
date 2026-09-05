// Classification for a non-2xx HTTP reply, and the scrub every thrown message passes through.
// Network failures (a rejected fetch, an abort) are classified at the call site, since they never
// carry a status or body to read.
import { StylizeError } from './types';

/** Mirrors the token shapes `agent/security/redact.ts` guards against; duplicated rather than
 *  imported since `io` and `agent` share a rank and a few regexes are cheaper than that edge. The
 *  generic Bearer/api-key fragment matters most here: the custom row points at arbitrary gateways
 *  whose error pages may echo the request's own auth header, in whatever shape the key has. */
const SECRET_PATTERNS: RegExp[] = [
  /\bAIza[\w-]{20,}\b/g,
  /\bsk-[\w-]{10,}\b/g,
  /\b[0-9a-f]{32}\.[A-Za-z0-9]{16}\b/g,
  /\b(Bearer\s+|api[-_]?key[=:]\s*)[A-Za-z0-9._~+/-]{16,}/gi,
];

export function scrub(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '***');
  return out;
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

export function classify(status: number, body: unknown): StylizeError {
  const detail = scrub(bodyText(body));
  if (status === 401 || status === 403) return new StylizeError('bad_key', detail);
  if (status === 429) return new StylizeError('refused', detail);
  if (status === 400 && REFUSAL_WORDING.test(detail)) return new StylizeError('refused', detail);
  return new StylizeError('bad_response', detail);
}

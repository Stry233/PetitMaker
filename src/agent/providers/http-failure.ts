/**
 * Turns a thrown SDK/gateway error into the raw shape `classify` (in `core/errors`) expects.
 * Shared by both dialect adapters (`anthropic.ts`, `openai.ts`): the two SDKs throw errors with
 * the same duck-typed `status`/`headers`/`message` shape, so a mocked/gateway error double works
 * against either without an `instanceof` check on the SDK's own error class.
 */
import { redactSecrets } from '../security/redact';
import { classify } from '../core/errors';
import type { StreamEvent } from '../core/types';

/** Reads a `Retry-After` value off either a real `Headers` object or a plain record (a
 *  mocked/gateway error shape), in seconds -> ms. */
export function retryAfterMsOf(headers: unknown): number | undefined {
  if (headers == null) return undefined;
  const getter = (headers as { get?: (key: string) => string | null }).get;
  const raw = typeof getter === 'function' ? getter.call(headers, 'retry-after') : (headers as Record<string, string>)['retry-after'];
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export function toRawFailure(err: unknown, aborted: boolean): { status?: number; message: string; retryAfterMs?: number; aborted: boolean } {
  const e = err as { status?: unknown; message?: unknown; headers?: unknown } | null;
  const rawMessage = typeof e?.message === 'string' ? e.message : String(err);
  const status = typeof e?.status === 'number' ? e.status : undefined;
  return { status, message: redactSecrets(rawMessage), retryAfterMs: retryAfterMsOf(e?.headers), aborted };
}

/** The one event a stream's catch yields, the same for both dialects: an abort settles the turn,
 *  anything else classifies and stands in front of the retry ladder. */
export function streamFailureEvent(err: unknown, aborted: boolean): StreamEvent {
  const error = classify(toRawFailure(err, aborted));
  return error.cls === 'abort' ? { t: 'done', stop: 'aborted' } : { t: 'error', error };
}

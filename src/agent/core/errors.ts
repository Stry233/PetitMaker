import type { ErrorClass, TurnError } from './types';

export interface RawFailure { status?: number; message: string; retryAfterMs?: number; aborted?: boolean }

// Provider quota codes and billing-limit messages.
const QUOTA_MESSAGE = /insufficient_quota|billing|usage limit|paid credits?/i;
// Context-window and request-size messages across supported providers.
const OVERFLOW_MESSAGE = /context.length|maximum context|too many tokens|prompt is too long|exceed context limit/i;
// Browser, Node, Safari and SDK connection-failure messages.
const NETWORK_MESSAGE = /failed to fetch|networkerror|econnreset|enotfound|load failed|connection error/i;
// SDK, gateway and local idle-stream timeout messages.
const TIMEOUT_MESSAGE = /timed out|timeout/i;

/** Empty successful-response messages emitted by supported SDKs and adapters. */
const SILENCE_MESSAGE = /response with no body|no response body|no status code or body|without producing a Message/i;

/** Adapter message for a successful response that carried no frames. Classified as retryable overload. */
export const PROVIDER_SILENCE = 'The provider sent no response body.';

/**
 * Custom-endpoint configuration error raised before any request. This prevents an absent base URL
 * from falling through to an SDK's default host with the user's private-gateway key.
 */
export const NO_ENDPOINT_ADDRESS = 'No endpoint address is configured for the custom provider; nothing was sent.';

/** The one wording above, as the pattern `classify` reads it by. */
const CONFIG_MESSAGE = /no endpoint address is configured/i;

/** Model-specific absence or invalidity messages. Bare `not found` remains an endpoint error. */
const MODEL_MESSAGE = new RegExp([
  "invalid value for 'model'",
  'invalid model',
  'unknown model',
  'model_not_found',
  'model not found',
  'no such model',
  'not a valid model',
  'no endpoints found',
  'model `[^`]*` (?:does not exist|not found)',
  "model '[^']*' (?:does not exist|not found)",
  'model "[^"]*" (?:does not exist|not found)',
].join('|'), 'i');

/** Classifies failures using abort state, then status, then provider-message patterns. */
export function classify(input: RawFailure): TurnError {
  const { status, message, retryAfterMs, aborted } = input;
  const cls = classifyCls(status, message, aborted);
  return { cls, detail: message, retryAfterMs, status };
}

function classifyCls(status: number | undefined, message: string, aborted: boolean | undefined): ErrorClass {
  if (aborted) return 'abort';
  if (status !== undefined) {
    if (status === 401) return 'auth';
    // A bare 403 is authentication; quota wording makes it a billing limit.
    if (status === 402) return 'quota';
    if (status === 403) return QUOTA_MESSAGE.test(message) ? 'quota' : 'auth';
    if (status === 408 || status === 409 || status === 429) return 'rate-limit';
    // Status zero represents the custom adapter's opaque browser response.
    if (status === 0) return 'cors';
    // A 404 is a model error only when the response identifies the model.
    if (status === 404 && /\bmodel\b/i.test(message)) return 'model';
    if (status >= 500) return 'overloaded'; // Anthropic overloaded_error and every other 5xx fold in here
  }
  // Configuration failures precede provider-message matching because no request was made.
  if (CONFIG_MESSAGE.test(message)) return 'config';
  // SDK empty-response messages precede text parsed from provider bodies.
  if (SILENCE_MESSAGE.test(message)) return 'overloaded';
  if (QUOTA_MESSAGE.test(message)) return 'quota';
  if (OVERFLOW_MESSAGE.test(message)) return 'overflow';
  // Overflow precedes model matching because context-limit messages also name the model.
  if (MODEL_MESSAGE.test(message)) return 'model';
  if (NETWORK_MESSAGE.test(message) || TIMEOUT_MESSAGE.test(message)) return 'network';
  return 'unknown';
}

const RETRYABLE: ReadonlySet<ErrorClass> = new Set(['rate-limit', 'overloaded', 'network']);

export function isRetryable(cls: ErrorClass): boolean {
  return RETRYABLE.has(cls);
}

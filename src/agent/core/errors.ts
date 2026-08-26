import type { ErrorClass, TurnError } from './types';

export interface RawFailure { status?: number; message: string; retryAfterMs?: number; aborted?: boolean }

// OpenAI insufficient_quota, DeepSeek/gateway billing pages, and a plain 402/403 that names its own limit.
const QUOTA_MESSAGE = /insufficient_quota|billing|usage limit|paid credits?/i;
// DeepSeek context length, Anthropic/OpenAI token-limit wording, OpenRouter's own phrasing, and
// Anthropic's "input length and max_tokens exceed context limit" (a max_tokens set too high for
// what is left, not a raw overlong prompt, but the harness's answer is the same: compact).
const OVERFLOW_MESSAGE = /context.length|maximum context|too many tokens|prompt is too long|exceed context limit/i;
// browser fetch TypeError ("Failed to fetch" / "NetworkError when attempting to fetch resource."),
// Node's ECONNRESET/ENOTFOUND, Safari's "Load failed", and both SDKs' APIConnectionError
// ("Connection error."), which wraps whichever of those the runtime produced and is the message a
// caller actually reads off it.
const NETWORK_MESSAGE = /failed to fetch|networkerror|econnreset|enotfound|load failed|connection error/i;
// Both SDKs' APIConnectionTimeoutError ("Request timed out."), a gateway's own timeout prose, and
// the harness's own idle-stream fault. None of them carries a status, so without this family a
// transient stall lands in the unretryable `unknown` and ends the job for good.
const TIMEOUT_MESSAGE = /timed out|timeout/i;

/**
 * THE PLATFORM ANSWERED AND THERE WAS NOTHING IN THE ANSWER, which is a provider fault and not a
 * quiet model — see the note on `PROVIDER_SILENCE`.
 *
 * Four wordings, quoted from where they are produced: `response with no body` is either SDK's SSE
 * reader on a 200 whose body the host never wrote; `no status code or body` is an APIError built
 * with neither; `without producing a Message` is the Anthropic message stream refusing to hand back
 * a message it never assembled; `no response body` is this harness's own, for the case only an
 * adapter can see (a stream that completes carrying no frame at all). None of them carries a
 * status, so without this family they land in the unretryable `unknown` and one empty answer from a
 * gateway ends the job.
 */
const SILENCE_MESSAGE = /response with no body|no response body|no status code or body|without producing a Message/i;

/**
 * What an adapter reports when the wire carried a successful response with nothing in it.
 *
 * IT IS A MESSAGE RATHER THAN A CLASS because an adapter states what it SAW and this file decides
 * what it means, the same way it does for every wording a provider sends. `classify` reads it as
 * `overloaded`: retryable, and worded to the user as the provider having no answer, which is what
 * happened.
 */
export const PROVIDER_SILENCE = 'The provider sent no response body.';

/**
 * What an adapter reports when the connection cannot be BUILT: the armed provider is the user's own
 * server and no address is filed for it, so there is no host to send anything to.
 *
 * NOTHING IS SENT ON THIS PATH, which is why it is a fault of its own rather than a network one. The
 * `openai` SDK reads an absent base URL as its own default host, so building a client here would
 * carry a key issued for a private gateway to another company's API — the adapter refuses instead,
 * and this is the sentence it refuses with.
 */
export const NO_ENDPOINT_ADDRESS = 'No endpoint address is configured for the custom provider; nothing was sent.';

/** The one wording above, as the pattern `classify` reads it by. */
const CONFIG_MESSAGE = /no endpoint address is configured/i;

/**
 * THE ENDPOINT ANSWERED AND DOES NOT SERVE THE MODEL THAT WAS ASKED FOR.
 *
 * Each alternative is one family, quoted from the platform that produces it: OpenAI's
 * `Invalid value for 'model'` and its `The model \`x\` does not exist or you do not have access to
 * it`, the Perplexity router's `Invalid model 'creator/name'`, an Ollama `not found, try pulling it
 * first`, OpenRouter's `No endpoints found`, and the bare `model_not_found` code a gateway forwards
 * with no prose around it.
 *
 * TWO THINGS ARE TRUE OF EVERY ROW AND NEITHER HALF IS ENOUGH ALONE, which is the test any addition
 * has to pass: the subject is the MODEL, and the complaint is that the endpoint has no such one.
 * "Rate limit reached for gpt-4o in organization org-x" names a model and is a wait; a bare "not
 * found" is as likely to be a wrong URL path, whose repair is the address and not this.
 *
 * It is unretryable by omission from `RETRYABLE`: the next attempt would name the same model.
 */
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

/** Classifies a failure into one value the rest of the harness can switch on. Order matters: an
 *  abort is never something to interpret, a status code is a stronger signal than prose scraped
 *  off a message, and message patterns are the last resort for a provider that answers 200-shaped
 *  errors or no status at all (a browser `fetch` rejection carries none). */
export function classify(input: RawFailure): TurnError {
  const { status, message, retryAfterMs, aborted } = input;
  const cls = classifyCls(status, message, aborted);
  return { cls, detail: message, retryAfterMs, status };
}

function classifyCls(status: number | undefined, message: string, aborted: boolean | undefined): ErrorClass {
  if (aborted) return 'abort';
  if (status !== undefined) {
    if (status === 401) return 'auth';
    // 402 (payment required) and 403 read as quota only when the provider names a billing/limit
    // reason in the body (OpenAI insufficient_quota can arrive on either status); a bare 403 with
    // no such wording is an ordinary auth refusal (bad key, wrong org).
    if (status === 402) return 'quota';
    if (status === 403) return QUOTA_MESSAGE.test(message) ? 'quota' : 'auth';
    if (status === 408 || status === 409 || status === 429) return 'rate-limit';
    // status 0: the browser hides the real cause behind a CORS-shaped opaque response, which only
    // a custom-endpoint adapter can set (a preflight failure carries no status at all otherwise).
    if (status === 0) return 'cors';
    // Anthropic's unknown-model refusal is a 404 whose whole message is `model: <name>`, which none
    // of the wording families below would catch. A 404 that does NOT name the model is a wrong URL
    // path — the address's repair, not the model's — so the status decides nothing on its own.
    if (status === 404 && /\bmodel\b/i.test(message)) return 'model';
    if (status >= 500) return 'overloaded'; // Anthropic overloaded_error and every other 5xx fold in here
  }
  // FIRST of all the message tests: nothing was sent, so no wording below this line can be about
  // this failure. It is unretryable by omission from `RETRYABLE` — another attempt against an
  // address that is still absent does the same nothing.
  if (CONFIG_MESSAGE.test(message)) return 'config';
  // FIRST among the tests over prose a PROVIDER sent, because these four are strings a CLIENT built:
  // an SDK that reports no body has already told us the body was never read, so nothing scraped out
  // of it afterwards could be a better signal.
  if (SILENCE_MESSAGE.test(message)) return 'overloaded';
  if (QUOTA_MESSAGE.test(message)) return 'quota';
  if (OVERFLOW_MESSAGE.test(message)) return 'overflow';
  // AFTER overflow, because "this model's maximum context length is 8192 tokens" is about the
  // request's size and not about whether the model exists, and both sentences name the model.
  if (MODEL_MESSAGE.test(message)) return 'model';
  if (NETWORK_MESSAGE.test(message) || TIMEOUT_MESSAGE.test(message)) return 'network';
  return 'unknown';
}

const RETRYABLE: ReadonlySet<ErrorClass> = new Set(['rate-limit', 'overloaded', 'network']);

export function isRetryable(cls: ErrorClass): boolean {
  return RETRYABLE.has(cls);
}

/**
 * Exercises representative SDK and gateway failure payloads through adapters, classification,
 * retries, redaction, and user-facing banners. Empty provider streams remain distinct from valid
 * model responses with no text.
 */
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { append, createLog, eventsOf, type SessionLog } from '../../../agent/core/log';
import { classify, isRetryable } from '../../../agent/core/errors';
import { MAX_TURN_RETRIES } from '../../../agent/core/retry';
import { runJob, type ExecutedResult, type LoopDeps, type ToolExecutor } from '../../../agent/core/loop';
import type { ErrorClass, StreamEvent } from '../../../agent/core/types';
import { toRawFailure } from '../../../agent/providers/http-failure';
import { QUIRKS } from '../../../agent/providers/defaults';
import type { Adapter, AdapterRequest } from '../../../agent/providers/types';
import { I18nProvider } from '../../../i18n/context';
import { Banner, BANNER_CLASSES } from '../../../ui/agent/Banner';

const { createMock, streamMock, ctorMock, listMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  streamMock: vi.fn(),
  ctorMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: createMock } };
    models = { list: listMock };
    constructor(opts: unknown) { ctorMock(opts); }
  }
  return { default: MockOpenAI };
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { stream: streamMock };
    models = { list: listMock };
    constructor(opts: unknown) { ctorMock(opts); }
  }
  return { default: MockAnthropic };
});

import { createAnthropicAdapter } from '../../../agent/providers/anthropic';
import { createOpenAIAdapter } from '../../../agent/providers/openai';

/* ── the payloads ─────────────────────────────────────────────────────────── */

/**
 * An SDK-thrown error as either SDK shapes one. `status` is present exactly when the response
 * carried one; `headers` is a plain record, which `retryAfterMsOf` reads like a real `Headers`.
 */
function apiError(status: number | undefined, message: string, headers?: Record<string, string>): unknown {
  return { status, message, headers, name: 'APIError' };
}

/** What the SDKs build when the response has a status and no body at all. */
function bareStatus(status: number): unknown {
  return apiError(status, `${status} status code (no body)`);
}

/** An OpenAI-dialect error body, as the SDK folds it into `message`: the status, then the body's
 *  own `error.message`. */
function openAiBody(status: number, message: string): unknown {
  return apiError(status, `${status} ${message}`);
}

/**
 * THE FOUR PLATFORM SILENCES, verbatim from the SDKs that produce them.
 *
 * `noBody` is thrown by both SDKs' SSE readers when `response.body` is null — a 200 whose body the
 * host never wrote, which is what a real gateway answers at its per-minute cap. `noStatus` is
 * an `APIError` built with neither a status nor a body. `noMessage` is the Anthropic message
 * stream's own complaint when the SSE frames ended before any assistant message was assembled.
 */
const SILENCE = {
  noBody: 'Attempted to iterate over a response with no body',
  noStatus: '(no status code or body)',
  noMessage: 'stream ended without producing a Message with role=assistant',
} as const;

/** A gateway's HTML error page, folded into the message by the SDK the same way a JSON body is. */
const HTML_502 = '502 <html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx/1.24.0</center></body></html>';

/** An Open-WebUI-style per-minute cap: a FastAPI `detail` body under a 429. */
const GATEWAY_429 = '429 {"detail":"Rate limit exceeded: 20 per 1 minute"}';

interface Shape {
  /** What it is, in the words a reader would use. */
  what: string;
  thrown: unknown;
  cls: ErrorClass;
  /** Whether the ladder must take another attempt at it. */
  retry: boolean;
}

/**
 * The zoo, as one table. Both adapters are driven over every row, so a dialect that classified a
 * shape differently from its sibling would show up here rather than in production.
 */
const ZOO: Shape[] = [
  // ── OpenAI-dialect bodies, `{error:{message,type,code}}` ──
  { what: 'openai 400 invalid_request_error naming the model', cls: 'model', retry: false, thrown: openAiBody(400, "Invalid value for 'model': the model `gpt-nope` does not exist") },
  { what: 'openai 400 invalid_request_error naming a parameter', cls: 'unknown', retry: false, thrown: openAiBody(400, "Invalid value for 'temperature': must be <= 2") },
  { what: 'openai 401 invalid_api_key', cls: 'auth', retry: false, thrown: openAiBody(401, 'Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.') },
  { what: 'openai 429 rate_limit_exceeded', cls: 'rate-limit', retry: true, thrown: apiError(429, '429 Rate limit reached for gpt-4o in organization org-x on requests per min (RPM): Limit 500, Used 500.', { 'retry-after': '2' }) },
  { what: 'openai 429 insufficient_quota', cls: 'rate-limit', retry: true, thrown: openAiBody(429, 'You exceeded your current quota, please check your plan and billing details.') },
  { what: 'openai 403 with a billing reason', cls: 'quota', retry: false, thrown: openAiBody(403, 'Your account is not active, please check your billing details on our website.') },
  { what: 'the perplexity-router 403 gating an unpaid organization', cls: 'quota', retry: false, thrown: openAiBody(403, 'The Router API requires paid credits. Add paid credit at https://console.perplexity.ai to upgrade your organization.') },
  { what: 'openai 500 server_error', cls: 'overloaded', retry: true, thrown: openAiBody(500, 'The server had an error while processing your request. Sorry about that!') },

  // ── Anthropic-dialect bodies, `{type:'error',error:{type,message}}` ──
  { what: 'anthropic 401 authentication_error', cls: 'auth', retry: false, thrown: apiError(401, '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}') },
  { what: 'anthropic 429 rate_limit_error', cls: 'rate-limit', retry: true, thrown: apiError(429, '429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}', { 'retry-after': '30' }) },
  { what: 'anthropic 529 overloaded_error', cls: 'overloaded', retry: true, thrown: apiError(529, '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}') },
  { what: 'anthropic 400 invalid_request_error over context', cls: 'overflow', retry: false, thrown: apiError(400, '400 {"type":"error","error":{"type":"invalid_request_error","message":"input length and max_tokens exceed context limit: 200000 + 32000 > 200000"}}') },

  // ── bare statuses, empty bodies ──
  { what: 'a bare 401 with no body', cls: 'auth', retry: false, thrown: bareStatus(401) },
  { what: 'a bare 429 with no body', cls: 'rate-limit', retry: true, thrown: bareStatus(429) },
  { what: 'a bare 500 with no body', cls: 'overloaded', retry: true, thrown: bareStatus(500) },
  { what: 'a bare 503 with no body', cls: 'overloaded', retry: true, thrown: bareStatus(503) },

  // ── a gateway between the harness and the model ──
  { what: 'an nginx HTML 502 page', cls: 'overloaded', retry: true, thrown: apiError(502, HTML_502) },
  { what: 'an Open-WebUI per-minute cap', cls: 'rate-limit', retry: true, thrown: apiError(429, GATEWAY_429) },
  { what: 'an Open-WebUI cap with the body dropped', cls: 'rate-limit', retry: true, thrown: bareStatus(429) },

  // ── the endpoint answered and does not serve the model that was asked for ──
  // One row per wording family the classifier names, so a platform reworded is caught here. Each is
  // unretryable: the next attempt would name the same model.
  { what: 'openai naming a model it has no access to', cls: 'model', retry: false, thrown: openAiBody(404, 'The model `gpt-nope` does not exist or you do not have access to it.') },
  { what: 'a perplexity-router model outside the catalog', cls: 'model', retry: false, thrown: openAiBody(400, "Invalid model 'example/does-not-exist'. Permitted models can be found in the documentation at https://docs.perplexity.ai/docs/getting-started/models.") },
  { what: 'an anthropic not_found_error whose whole message is the model', cls: 'model', retry: false, thrown: apiError(404, '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-nope"}}') },
  { what: 'an ollama pull hint', cls: 'model', retry: false, thrown: openAiBody(404, 'model "llama-nope" not found, try pulling it first') },
  { what: 'an openrouter routing refusal', cls: 'model', retry: false, thrown: openAiBody(400, 'No endpoints found for vendor/model-nope.') },
  { what: 'a gateway forwarding the bare code', cls: 'model', retry: false, thrown: openAiBody(400, 'model_not_found') },
  // A 404 THAT NAMES NO MODEL IS A WRONG URL PATH, which is the address's repair and not the
  // model's, so the status alone must never decide this class.
  { what: 'a 404 from a gateway with the wrong path', cls: 'unknown', retry: false, thrown: openAiBody(404, 'Not Found') },
  // A MODEL NAMED IN A SENTENCE ABOUT SOMETHING ELSE stays what that something else is. Both of
  // these mention a model and neither is one the endpoint refuses to serve.
  { what: 'a rate limit that names the model it applies to', cls: 'rate-limit', retry: true, thrown: apiError(429, '429 Rate limit reached for gpt-4o in organization org-x on requests per min (RPM): Limit 500, Used 500.') },
  { what: 'an overflow that names the model whose window it is', cls: 'overflow', retry: false, thrown: openAiBody(400, "This model's maximum context length is 8192 tokens, however you requested 9000 tokens.") },

  // ── the platform sending nothing at all: a provider fault, never a quiet model ──
  { what: 'a 200 whose body is null', cls: 'overloaded', retry: true, thrown: apiError(undefined, SILENCE.noBody) },
  { what: 'an error with neither status nor body', cls: 'overloaded', retry: true, thrown: apiError(undefined, SILENCE.noStatus) },
  { what: 'a stream that assembled no message', cls: 'overloaded', retry: true, thrown: apiError(undefined, SILENCE.noMessage) },

  // ── the transport, with no status to read ──
  { what: 'a browser fetch rejection', cls: 'network', retry: true, thrown: { message: 'NetworkError when attempting to fetch resource.' } },
  { what: 'a connection timeout', cls: 'network', retry: true, thrown: { message: 'Request timed out.' } },
  // Both SDKs wrap the runtime's own fetch rejection in APIConnectionError, and this wording is the
  // message a caller reads off it.
  { what: 'an SDK that could not connect at all', cls: 'network', retry: true, thrown: { message: 'Connection error.' } },
  { what: 'an opaque CORS response', cls: 'cors', retry: false, thrown: apiError(0, 'Failed to fetch') },

  // ── a frame the wire cut in half ──
  { what: 'a truncated SSE frame', cls: 'unknown', retry: false, thrown: new SyntaxError('Unexpected end of JSON input') },
];

/* ── the harnesses ────────────────────────────────────────────────────────── */

function baseRequest(): AdapterRequest {
  return {
    system: 'You are an agent.',
    messages: [],
    tools: [{ name: 'place_object', description: 'Places an object', parameters: { type: 'object', properties: {} } }],
    model: 'model-x',
    sameModel: true,
  };
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** An openai `create()` stand-in: iterable over scripted chunks, optionally throwing partway. */
function chunkStream(chunks: unknown[], throwAfter?: unknown): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
      if (throwAfter !== undefined) throw throwAfter;
    },
  };
}

/** An anthropic `messages.stream()` stand-in. `finalMessage` may throw, as the real one does when
 *  the SSE frames ended before any assistant message was assembled. */
function sdkStream(events: unknown[], finalMessage: () => unknown, throwAfter?: unknown): unknown {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
      if (throwAfter !== undefined) throw throwAfter;
    },
    finalMessage: async () => finalMessage(),
  };
}

function openAi(): ReturnType<typeof createOpenAIAdapter> {
  return createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://gateway.example/v1', quirks: QUIRKS.custom });
}

function anthropic(): ReturnType<typeof createAnthropicAdapter> {
  return createAnthropicAdapter({ apiKey: 'sk-ant-test' });
}

/** The one terminal event of a failed turn, or a plain description of what came instead. */
function terminal(events: StreamEvent[]): StreamEvent | undefined {
  return events[events.length - 1];
}

/* ── the loop, over a REAL adapter on a mocked wire ───────────────────────── */

function noopExecutor(): ToolExecutor {
  return {
    async execute(): Promise<ExecutedResult> { return { content: 'ok', isError: false }; },
    isWrite: () => false,
    isWide: () => false,
    describe: () => 'a call',
  };
}

/**
 * Every request the loop built, in order, so the SYSTEM NOTES can be read back: a nudge rides the
 * next request rather than landing in the log, so the log alone cannot say whether the model was
 * told it produced nothing.
 */
function withRequests(inner: Adapter): { adapter: Adapter; sent: AdapterRequest[] } {
  const sent: AdapterRequest[] = [];
  return {
    sent,
    adapter: {
      stream: (req, signal) => { sent.push(req); return inner.stream(req, signal); },
      listModels: (signal) => inner.listModels(signal),
    },
  };
}

/** The trailing system note of a request, which is the only channel a nudge rides. */
function notesOf(sent: AdapterRequest[]): string {
  return sent
    .map((req) => {
      const last = req.messages[req.messages.length - 1];
      return last && last.role === 'user' ? last.text : '';
    })
    .join('\n');
}

/** `runJob`'s dependencies with the REAL openai adapter in the seat, so what the loop reads is
 *  whatever the adapter made of the mocked wire rather than a hand-written event list. */
function loopDeps(adapter: Adapter, sleep: LoopDeps['sleep']): LoopDeps {
  return {
    adapter,
    executor: noopExecutor(),
    model: 'model-x',
    system: 'system prompt',
    tools: [],
    oversight: 'yolo',
    sameModel: true,
    budgetTokens: 100_000,
    signal: new AbortController().signal,
    undoStackSize: () => 0,
    sleep,
  };
}

function seeded(): SessionLog {
  const log = createLog(() => 0);
  append(log, { kind: 'order', text: 'raise the ridge', mapContext: '' });
  return log;
}

/** What the job's own terminal events say, which is what every panel surface reads it off. */
function outcomeOf(log: SessionLog): { end?: { outcome: string; summary?: string }; incident?: { cls: ErrorClass } } {
  const events = eventsOf(log);
  const end = events.find((e) => e.kind === 'jobEnd');
  const incident = events.find((e) => e.kind === 'incident');
  return {
    ...(end?.kind === 'jobEnd' ? { end: { outcome: end.outcome, ...(end.summary !== undefined && { summary: end.summary }) } } : {}),
    ...(incident?.kind === 'incident' ? { incident: { cls: incident.error.cls } } : {}),
  };
}

afterEach(() => {
  // RESET, not clear: a queued `mockResolvedValueOnce` left standing would feed the next test.
  vi.resetAllMocks();
});

/* ── 1. classification is total ───────────────────────────────────────────── */

describe('the zoo: every shape lands a class', () => {
  it.each(ZOO)('classifies $what', ({ thrown, cls }) => {
    expect(classify(toRawFailure(thrown, false)).cls).toBe(cls);
  });

  it.each(ZOO)('agrees on whether to retry $what', ({ thrown, retry }) => {
    expect(isRetryable(classify(toRawFailure(thrown, false)).cls)).toBe(retry);
  });

  /** `toRawFailure` takes ANY thrown value, including the ones that are not errors at all: a
   *  gateway's own code can reject with a string, a number or nothing. None of them may throw
   *  inside the classifier, which is the layer that exists so the adapters have one answer. */
  it('classifies a thrown value that is not an error shape at all', () => {
    for (const odd of [undefined, null, 'gateway exploded', 42, {}, [], new Error('')]) {
      const out = classify(toRawFailure(odd, false));
      expect(typeof out.cls).toBe('string');
      expect(typeof out.detail).toBe('string');
    }
  });

  /** An abort outranks every shape above: a user's Stop landing while a 429 was in flight is a stop,
   *  not a rate limit, and the panel says so. */
  it('reads an abort as an abort whatever the payload underneath says', () => {
    for (const { thrown } of ZOO) {
      expect(classify(toRawFailure(thrown, true)).cls).toBe('abort');
    }
  });

  /** A `Retry-After` is honoured wherever the provider sent one, and absent rather than invented
   *  where it did not. The ladder waits the provider's own time when it has it. */
  it('carries the provider\'s own Retry-After through, in ms', () => {
    expect(classify(toRawFailure(apiError(429, '429 slow down', { 'retry-after': '30' }), false)).retryAfterMs).toBe(30_000);
    expect(classify(toRawFailure(bareStatus(429), false)).retryAfterMs).toBeUndefined();
  });
});

/* ── 2. both adapters end their generator with exactly one terminal event ──── */

describe('the zoo: both adapters answer every shape with one terminal event', () => {
  it.each(ZOO)('the openai dialect surfaces $what without throwing', async ({ thrown, cls, retry }) => {
    createMock.mockRejectedValue(thrown);
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events).toHaveLength(1);
    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls }) });
    expect(isRetryable(cls)).toBe(retry);
  });

  it.each(ZOO)('the anthropic dialect surfaces $what without throwing', async ({ thrown, cls }) => {
    streamMock.mockImplementation(() => { throw thrown; });
    const events = await collect(anthropic().stream(baseRequest(), new AbortController().signal));

    expect(events).toHaveLength(1);
    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls }) });
  });

  /** THE ABORT IS THE ONE FAILURE THAT IS NOT AN ERROR EVENT. It ends the stream `done/aborted`,
   *  because the user asked for it and the panel has nothing to repair. */
  it('ends an aborted turn as done, on both dialects', async () => {
    const controller = new AbortController();
    controller.abort();

    createMock.mockRejectedValue(apiError(undefined, 'Request was aborted.'));
    expect(await collect(openAi().stream(baseRequest(), controller.signal))).toEqual([{ t: 'done', stop: 'aborted' }]);

    streamMock.mockImplementation(() => { throw apiError(undefined, 'Request was aborted.'); });
    expect(await collect(anthropic().stream(baseRequest(), controller.signal))).toEqual([{ t: 'done', stop: 'aborted' }]);
  });
});

/* ── 3. a platform that sent nothing is not a model that said nothing ─────── */

describe('the zoo: silence on a 200, which is the platform\'s and not the model\'s', () => {
  /**
   * A GATEWAY AT ITS PER-MINUTE CAP: HTTP 200, and a body with no frames in it. The SSE
   * reader completes without yielding, so nothing about the turn is populated — and the LOOP reads
   * an unpopulated turn as the model having chosen to say nothing, nudges it twice and closes the
   * job "Ended. nothing was said". The adapter is the only layer that can tell the two apart: a
   * model that genuinely produced an empty turn still sends a finish reason.
   */
  it('reads a stream with no frames at all as a provider fault, not an empty model turn', async () => {
    createMock.mockResolvedValue(chunkStream([]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events).toHaveLength(1);
    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'overloaded' }) });
    expect(isRetryable('overloaded')).toBe(true);
  });

  /** The same silence one step less bare: frames arrive, every one of them carries an empty
   *  `choices` array, and no finish reason ever lands. Still the platform, still retryable. */
  it('reads frames that never carry a choice as a provider fault too', async () => {
    createMock.mockResolvedValue(chunkStream([{ choices: [] }, { choices: [] }]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'overloaded' }) });
  });

  /**
   * AND THE MODEL'S OWN SILENCE IS UNTOUCHED, which is the other half of the same fact: a finish
   * reason is the model ending its turn, so an empty turn that carries one is an empty MODEL turn
   * and goes on down the loop's silent-turn path to be nudged. Confusing this for a fault would
   * banner a provider trouble every time a model answered a tool result with nothing.
   */
  it('leaves a genuinely empty model turn as done, because it carries a finish reason', async () => {
    createMock.mockResolvedValue(chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([{ t: 'done', stop: 'stop', final: [] }]);
  });

  /** A turn whose only content was a thought is the model's own silence as well: it did work, it
   *  simply kept it to itself, and the loop has a separate sentence for that. */
  it('leaves a reasoning-only turn as done', async () => {
    createMock.mockResolvedValue(chunkStream([
      { choices: [{ index: 0, delta: { reasoning_content: 'weighing the ridge' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'reasoning', delta: 'weighing the ridge' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
  });

  /** A stream that carried CONTENT and then ended with no finish reason is not silence: the words
   *  arrived, and a gateway that forgets the terminal frame must not cost the turn its text. */
  it('keeps a turn that said something but never sent a finish reason', async () => {
    createMock.mockResolvedValue(chunkStream([
      { choices: [{ index: 0, delta: { content: 'The ridge is up.' }, finish_reason: null }] },
    ]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: 'The ridge is up.' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
  });

  /** THE ANTHROPIC DIALECT REACHES THE SAME PLACE BY ITS OWN ROUTE: its message stream refuses to
   *  hand back a final message it never assembled, so the silence arrives as a throw. What matters
   *  is that it classifies as the platform's fault and not as `unknown`, which is not retried. */
  it('reads the anthropic stream\'s own no-message complaint as a provider fault', async () => {
    streamMock.mockReturnValue(sdkStream([], () => { throw apiError(undefined, SILENCE.noMessage); }));
    const events = await collect(anthropic().stream(baseRequest(), new AbortController().signal));

    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'overloaded' }) });
  });
});

/* ── 4. a stream that dies partway keeps what it delivered ────────────────── */

describe('the zoo: a stream that dies after partial content', () => {
  /** The deltas already yielded are already the user's: they were painted as they arrived, so the
   *  fault is appended to them rather than replacing them. */
  it('keeps the text and the tool call it delivered, then names the fault', async () => {
    createMock.mockResolvedValue(chunkStream(
      [
        { choices: [{ index: 0, delta: { content: 'Raising the ' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: 'ridge' }, finish_reason: null }] },
      ],
      { message: 'NetworkError when attempting to fetch resource.' },
    ));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events.slice(0, 2)).toEqual([
      { t: 'text', delta: 'Raising the ' },
      { t: 'text', delta: 'ridge' },
    ]);
    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'network' }) });
  });

  /** A mid-stream error FRAME is how a gateway reports a fault it discovered after committing to a
   *  200: both SDKs raise it out of the iterator, so it arrives here as a throw with a real status. */
  it('surfaces a mid-stream error frame with the status the frame carried', async () => {
    createMock.mockResolvedValue(chunkStream(
      [{ choices: [{ index: 0, delta: { content: 'Working' }, finish_reason: null }] }],
      apiError(429, GATEWAY_429),
    ));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events[0]).toEqual({ t: 'text', delta: 'Working' });
    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'rate-limit' }) });
  });

  /** The same on the other dialect: text streamed live, and the failure lands where the iteration
   *  stopped rather than as a `done` over a half-read answer. */
  it('surfaces a mid-stream fault on the anthropic dialect too', async () => {
    streamMock.mockReturnValue(sdkStream(
      [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Raising' } }],
      () => ({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }),
      apiError(500, '500 internal'),
    ));
    const events = await collect(anthropic().stream(baseRequest(), new AbortController().signal));

    expect(events[0]).toEqual({ t: 'text', delta: 'Raising' });
    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'overloaded' }) });
  });
});

/* ── 5. the detail is safe to show, and the class has a face ──────────────── */

describe('the zoo: what reaches the user', () => {
  /** A provider that quotes the request back can quote the KEY back with it. The detail is bound
   *  for the transcript, the banner and an exported log, so the redaction happens at the producer. */
  it('redacts a key quoted inside a provider\'s own error body', async () => {
    const leaky = openAiBody(401, 'Incorrect API key provided: sk-abcdef0123456789abcdef. Check your key.');
    createMock.mockRejectedValue(leaky);
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    const failure = terminal(events);
    expect(failure?.t).toBe('error');
    const detail = failure?.t === 'error' ? failure.error.detail : '';
    expect(detail).not.toContain('sk-abcdef0123456789abcdef');
    expect(detail).toContain('<redacted-key>');
  });

  /** Every class the zoo can produce has a banner row, so no fault reaches the panel with no face
   *  to wear. The banner table covers more than `ErrorClass` (storage, map scope), which is why
   *  this asks the question the other way round. */
  it('gives every class in the zoo a banner row', () => {
    const produced = new Set<ErrorClass>(ZOO.map((s) => s.cls));
    produced.add('overloaded'); // the platform-silence class, produced by the adapters themselves
    for (const cls of produced) {
      expect(BANNER_CLASSES, cls).toContain(cls);
    }
  });

  /** And the platform-silence class wears the RIGHT face, which `trouble.test.tsx` asserts by
   *  rendering: a WAIT paper offering `try-again`, never a danger paper asking for a key. A gateway
   *  that answered nothing is not the user's credential being wrong. `retryOrFile` names both. */
  it('puts the platform silence in the retryable family, apart from the credential classes', () => {
    for (const cls of ['overloaded', 'rate-limit', 'network'] as const) {
      expect(isRetryable(cls), cls).toBe(true);
    }
    for (const cls of ['auth', 'quota', 'overflow', 'cors', 'unknown'] as const) {
      expect(isRetryable(cls), cls).toBe(false);
    }
  });

  /** The face itself, rendered: a WAIT paper offering `try-again`, never the danger paper the
   *  credential classes wear. A gateway that answered nothing is not a key that is wrong, and the
   *  two must not read the same on the glass. */
  it('draws the platform silence on the wait paper, with a retry on it', () => {
    const view = render(createElement(I18nProvider, null, createElement(Banner, { cls: 'overloaded', onAction: () => {} })));
    const banner = view.getByTestId('banner');
    expect(banner.getAttribute('data-paper')).toBe('wait');
    expect(banner.querySelector('[data-action="try-again"]')).toBeTruthy();
    expect(banner.querySelector('[data-action="fix-key"]')).toBeNull();
    view.unmount();
  });
});

/* ── 6. the loop, over the real adapter: which path a platform fault takes ── */

describe('the zoo: a platform that sent nothing does not read as a model that said nothing', () => {
  /**
   * THE WHOLE POINT OF THE GUARD, PROVEN THROUGH `runJob`.
   *
   * A gateway at its per-minute cap answers 200 with an empty body, every turn. Read as an empty
   * MODEL turn, the loop nudges twice, gives up politely and settles with no summary — the panel's
   * "Ended. nothing was said" face over a platform fault, with nothing to press and nothing naming
   * the cause. Read as the provider fault it is, the turn goes up the retry ladder and the job ends
   * on an INCIDENT that says which trouble it was and offers Try again.
   */
  it('ends on a named incident rather than a quiet settle', async () => {
    createMock.mockResolvedValue(chunkStream([]));
    const log = seeded();
    const slept: number[] = [];

    const outcome = await runJob(log, loopDeps(openAi(), async (ms) => { slept.push(ms); }));

    expect(outcome).toBe('incident');
    expect(outcomeOf(log)).toEqual({
      end: { outcome: 'incident' },
      incident: { cls: 'overloaded' },
    });
    // AND IT ACTUALLY TRIED AGAIN: the ladder spends its attempts before the incident lands, which
    // is what makes a gateway hiccup survivable rather than fatal.
    expect(slept).toHaveLength(MAX_TURN_RETRIES - 1);
  });

  /** No nudge is ever written, which is the other half: the model is never told it "produced no
   *  text and no tool calls" about a turn it was never asked. */
  it('never tells the model it produced nothing', async () => {
    createMock.mockResolvedValue(chunkStream([]));
    const { adapter, sent } = withRequests(openAi());

    await runJob(seeded(), loopDeps(adapter, async () => {}));

    expect(notesOf(sent)).not.toContain('produced no text and no tool calls');
  });

  /** AND THE MODEL'S OWN SILENCE STILL TAKES THE SILENT-TURN PATH. A finish reason with nothing
   *  under it is the model choosing to say nothing, so the loop nudges it as before and settles
   *  `done` rather than bannering a fault the provider never had. */
  it('leaves the empty MODEL turn on the nudge path it has always taken', async () => {
    createMock.mockResolvedValue(chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]));
    const { adapter, sent } = withRequests(openAi());
    const log = seeded();

    const outcome = await runJob(log, loopDeps(adapter, async () => {}));

    expect(outcome).toBe('done');
    expect(outcomeOf(log).incident).toBeUndefined();
    expect(notesOf(sent)).toContain('produced no text and no tool calls');
  });

  /** A rate limit the gateway DID name is the same ladder from the other side: the status is read,
   *  the provider's own wait is honoured, and the incident names the rate limit. */
  it('honours a named 429\'s own Retry-After on the way to the same incident', async () => {
    createMock.mockRejectedValue(apiError(429, GATEWAY_429, { 'retry-after': '4' }));
    const log = seeded();
    const slept: number[] = [];

    expect(await runJob(log, loopDeps(openAi(), async (ms) => { slept.push(ms); }))).toBe('incident');
    expect(outcomeOf(log).incident).toEqual({ cls: 'rate-limit' });
    expect(slept).toEqual(Array<number>(MAX_TURN_RETRIES - 1).fill(4000));
  });

  /** An UNRETRYABLE shape spends no attempt at all: a wrong key is not a thing another request
   *  fixes, so the incident is immediate and the ladder stays out of it. */
  it('spends no attempt on a credential refusal', async () => {
    createMock.mockRejectedValue(openAiBody(401, 'Incorrect API key provided.'));
    const log = seeded();
    const slept: number[] = [];

    expect(await runJob(log, loopDeps(openAi(), async (ms) => { slept.push(ms); }))).toBe('incident');
    expect(outcomeOf(log).incident).toEqual({ cls: 'auth' });
    expect(slept).toEqual([]);
  });
});

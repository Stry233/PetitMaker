// @vitest-environment jsdom
/**
 * Exercises representative SDK and gateway failure payloads through adapters, classification,
 * retries, redaction, and user-facing banners. Empty provider streams remain distinct from valid
 * model responses with no text.
 */
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFacts } from '../../_support/tool-facts';

import { append, createLog, eventsOf, type SessionLog } from '../../../agent/core/log';
import { classify, isRetryable } from '../../../agent/core/errors';
import { MAX_TURN_ATTEMPTS } from '../../../agent/core/retry';
import { runJob, type ExecutedResult, type LoopDeps, type ToolExecutor } from '../../../agent/core/loop';
import type { ErrorClass, StreamEvent } from '../../../agent/core/types';
import { toRawFailure } from '../../../agent/providers/http-failure';
import { QUIRKS } from '../../../agent/providers/defaults';
import type { Adapter, AdapterRequest } from '../../../agent/core/adapter';
import { I18nProvider } from '../../../i18n/context';
import { Banner, BANNER_CLASSES } from '../../../ui/agent/desk/Banner';

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

/**
 * An error as either SDK throws it: `status` only when the response carried one; `headers` is a
 * plain record, which `retryAfterMsOf` reads like a real `Headers`.
 */
function apiError(status: number | undefined, message: string, headers?: Record<string, string>): unknown {
  return { status, message, headers, name: 'APIError' };
}

/** What the SDKs build when the response has a status and no body at all. */
function bareStatus(status: number): unknown {
  return apiError(status, `${status} status code (no body)`);
}

/** An OpenAI-dialect error as the SDK folds it into `message`: the status, then `error.message`. */
function openAiBody(status: number, message: string): unknown {
  return apiError(status, `${status} ${message}`);
}

/**
 * Platform silences, verbatim from the SDKs. `noBody`: both SSE readers on a null `response.body`,
 * as a gateway at its per-minute cap answers. `noStatus`: an `APIError` with neither status nor
 * body. `noMessage`: the Anthropic stream when the frames ended before any assistant message.
 */
const SILENCE = {
  noBody: 'Attempted to iterate over a response with no body',
  noStatus: '(no status code or body)',
  noMessage: 'stream ended without producing a Message with role=assistant',
} as const;

/** A gateway's HTML error page, folded into the message like a JSON body. */
const HTML_502 = '502 <html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx/1.24.0</center></body></html>';

/** An Open-WebUI-style per-minute cap: a FastAPI `detail` body under a 429. */
const GATEWAY_429 = '429 {"detail":"Rate limit exceeded: 20 per 1 minute"}';

interface Shape {
  what: string;
  thrown: unknown;
  cls: ErrorClass;
  retry: boolean;
}

/** Both adapters run over every row, so the two dialects classify each shape alike. */
const ZOO: Shape[] = [
  // OpenAI-dialect bodies, `{error:{message,type,code}}`
  { what: 'openai 400 invalid_request_error naming the model', cls: 'model', retry: false, thrown: openAiBody(400, "Invalid value for 'model': the model `gpt-nope` does not exist") },
  { what: 'openai 400 invalid_request_error naming a parameter', cls: 'unknown', retry: false, thrown: openAiBody(400, "Invalid value for 'temperature': must be <= 2") },
  { what: 'openai 401 invalid_api_key', cls: 'auth', retry: false, thrown: openAiBody(401, 'Incorrect API key provided. You can find your API key at https://platform.openai.com/account/api-keys.') },
  { what: 'openai 429 rate_limit_exceeded', cls: 'rate-limit', retry: true, thrown: apiError(429, '429 Rate limit reached for gpt-4o in organization org-x on requests per min (RPM): Limit 500, Used 500.', { 'retry-after': '2' }) },
  { what: 'openai 429 insufficient_quota', cls: 'rate-limit', retry: true, thrown: openAiBody(429, 'You exceeded your current quota, please check your plan and billing details.') },
  { what: 'openai 403 with a billing reason', cls: 'quota', retry: false, thrown: openAiBody(403, 'Your account is not active, please check your billing details on our website.') },
  { what: 'the perplexity-router 403 gating an unpaid organization', cls: 'quota', retry: false, thrown: openAiBody(403, 'The Router API requires paid credits. Add paid credit at https://console.perplexity.ai to upgrade your organization.') },
  { what: 'openai 500 server_error', cls: 'overloaded', retry: true, thrown: openAiBody(500, 'The server had an error while processing your request. Sorry about that!') },

  // Anthropic-dialect bodies, `{type:'error',error:{type,message}}`
  { what: 'anthropic 401 authentication_error', cls: 'auth', retry: false, thrown: apiError(401, '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}') },
  { what: 'anthropic 429 rate_limit_error', cls: 'rate-limit', retry: true, thrown: apiError(429, '429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}', { 'retry-after': '30' }) },
  { what: 'anthropic 529 overloaded_error', cls: 'overloaded', retry: true, thrown: apiError(529, '529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}') },
  { what: 'anthropic 400 invalid_request_error over context', cls: 'overflow', retry: false, thrown: apiError(400, '400 {"type":"error","error":{"type":"invalid_request_error","message":"input length and max_tokens exceed context limit: 200000 + 32000 > 200000"}}') },

  // bare statuses, empty bodies
  { what: 'a bare 401 with no body', cls: 'auth', retry: false, thrown: bareStatus(401) },
  { what: 'a bare 429 with no body', cls: 'rate-limit', retry: true, thrown: bareStatus(429) },
  { what: 'a bare 500 with no body', cls: 'overloaded', retry: true, thrown: bareStatus(500) },
  { what: 'a bare 503 with no body', cls: 'overloaded', retry: true, thrown: bareStatus(503) },

  // a gateway between the harness and the model
  { what: 'an nginx HTML 502 page', cls: 'overloaded', retry: true, thrown: apiError(502, HTML_502) },
  { what: 'an Open-WebUI per-minute cap', cls: 'rate-limit', retry: true, thrown: apiError(429, GATEWAY_429) },
  { what: 'an Open-WebUI cap with the body dropped', cls: 'rate-limit', retry: true, thrown: bareStatus(429) },

  // the endpoint does not serve the model: one row per wording family the classifier names, each
  // unretryable because the next attempt would name the same model
  { what: 'openai naming a model it has no access to', cls: 'model', retry: false, thrown: openAiBody(404, 'The model `gpt-nope` does not exist or you do not have access to it.') },
  { what: 'a perplexity-router model outside the catalog', cls: 'model', retry: false, thrown: openAiBody(400, "Invalid model 'example/does-not-exist'. Permitted models can be found in the documentation at https://docs.perplexity.ai/docs/getting-started/models.") },
  { what: 'an anthropic not_found_error whose whole message is the model', cls: 'model', retry: false, thrown: apiError(404, '404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-nope"}}') },
  { what: 'an ollama pull hint', cls: 'model', retry: false, thrown: openAiBody(404, 'model "llama-nope" not found, try pulling it first') },
  { what: 'an openrouter routing refusal', cls: 'model', retry: false, thrown: openAiBody(400, 'No endpoints found for vendor/model-nope.') },
  { what: 'a gateway forwarding the bare code', cls: 'model', retry: false, thrown: openAiBody(400, 'model_not_found') },
  // A 404 that names no model is a wrong path, so the status alone never decides the model class.
  { what: 'a 404 from a gateway with the wrong path', cls: 'unknown', retry: false, thrown: openAiBody(404, 'Not Found') },
  // A model named in another kind of error keeps that error's class.
  { what: 'a rate limit that names the model it applies to', cls: 'rate-limit', retry: true, thrown: apiError(429, '429 Rate limit reached for gpt-4o in organization org-x on requests per min (RPM): Limit 500, Used 500.') },
  { what: 'an overflow that names the model whose window it is', cls: 'overflow', retry: false, thrown: openAiBody(400, "This model's maximum context length is 8192 tokens, however you requested 9000 tokens.") },

  // the platform sending nothing at all: a provider fault, never a quiet model
  { what: 'a 200 whose body is null', cls: 'overloaded', retry: true, thrown: apiError(undefined, SILENCE.noBody) },
  { what: 'an error with neither status nor body', cls: 'overloaded', retry: true, thrown: apiError(undefined, SILENCE.noStatus) },
  { what: 'a stream that assembled no message', cls: 'overloaded', retry: true, thrown: apiError(undefined, SILENCE.noMessage) },

  // the transport, with no status to read
  { what: 'a browser fetch rejection', cls: 'network', retry: true, thrown: { message: 'NetworkError when attempting to fetch resource.' } },
  { what: 'a connection timeout', cls: 'network', retry: true, thrown: { message: 'Request timed out.' } },
  // The message of the APIConnectionError both SDKs wrap a fetch rejection in.
  { what: 'an SDK that could not connect at all', cls: 'network', retry: true, thrown: { message: 'Connection error.' } },
  { what: 'an opaque CORS response', cls: 'cors', retry: false, thrown: apiError(0, 'Failed to fetch') },

  // a frame the wire cut in half
  { what: 'a truncated SSE frame', cls: 'unknown', retry: false, thrown: new SyntaxError('Unexpected end of JSON input') },
];

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

/** An anthropic `messages.stream()` stand-in; `finalMessage` may throw, as the real one does. */
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
  return createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://gateway.example/v1', providerId: 'custom', quirks: QUIRKS.custom });
}

function anthropic(): ReturnType<typeof createAnthropicAdapter> {
  return createAnthropicAdapter({ apiKey: 'sk-ant-test' });
}

/** The last event of a turn. */
function terminal(events: StreamEvent[]): StreamEvent | undefined {
  return events[events.length - 1];
}

function noopExecutor(): ToolExecutor {
  return {
    async execute(): Promise<ExecutedResult> { return { content: 'ok', isError: false }; },
    facts: stubFacts(),
    describe: () => 'a call',
  };
}

/** Records every request the loop sends: a nudge rides the next request, never the log. */
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

/** The trailing user message of each request, joined. */
function notesOf(sent: AdapterRequest[]): string {
  return sent
    .map((req) => {
      const last = req.messages[req.messages.length - 1];
      return last && last.role === 'user' ? last.text : '';
    })
    .join('\n');
}

/** `runJob`'s dependencies around a real adapter on the mocked wire. */
function loopDeps(adapter: Adapter, sleep: LoopDeps['sleep']): LoopDeps {
  return {
    adapter,
    executor: noopExecutor(),
    model: 'model-x',
    system: 'system prompt',
    tools: [],
    oversight: 'yolo',
    sameModel: true,
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

/** The job's end and incident events, which the panel reads. */
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
  // Reset, not clear: a queued `mockResolvedValueOnce` left standing would feed the next test.
  vi.resetAllMocks();
});

describe('the zoo: every shape lands a class', () => {
  it.each(ZOO)('classifies $what', ({ thrown, cls }) => {
    expect(classify(toRawFailure(thrown, false)).cls).toBe(cls);
  });

  it.each(ZOO)('agrees on whether to retry $what', ({ thrown, retry }) => {
    expect(isRetryable(classify(toRawFailure(thrown, false)).cls)).toBe(retry);
  });

  /** Gateway code can reject with a string, a number or nothing. */
  it('classifies a thrown value that is not an error shape at all', () => {
    for (const odd of [undefined, null, 'gateway exploded', 42, {}, [], new Error('')]) {
      const out = classify(toRawFailure(odd, false));
      expect(typeof out.cls).toBe('string');
      expect(typeof out.detail).toBe('string');
    }
  });

  /** A Stop pressed while a 429 was in flight is a stop, not a rate limit. */
  it('reads an abort as an abort whatever the payload underneath says', () => {
    for (const { thrown } of ZOO) {
      expect(classify(toRawFailure(thrown, true)).cls).toBe('abort');
    }
  });

  /** Absent when the provider sent none. */
  it('carries the provider\'s own Retry-After through, in ms', () => {
    expect(classify(toRawFailure(apiError(429, '429 slow down', { 'retry-after': '30' }), false)).retryAfterMs).toBe(30_000);
    expect(classify(toRawFailure(bareStatus(429), false)).retryAfterMs).toBeUndefined();
  });
});

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

  /** An abort is the one failure that ends without an error event. */
  it('ends an aborted turn as done, on both dialects', async () => {
    const controller = new AbortController();
    controller.abort();

    createMock.mockRejectedValue(apiError(undefined, 'Request was aborted.'));
    expect(await collect(openAi().stream(baseRequest(), controller.signal))).toEqual([{ t: 'done', stop: 'aborted' }]);

    streamMock.mockImplementation(() => { throw apiError(undefined, 'Request was aborted.'); });
    expect(await collect(anthropic().stream(baseRequest(), controller.signal))).toEqual([{ t: 'done', stop: 'aborted' }]);
  });
});

describe('the zoo: silence on a 200, which is the platform\'s and not the model\'s', () => {
  /**
   * A gateway at its per-minute cap answers 200 with no frames. Only the adapter can tell this from
   * an empty model turn, which still carries a finish reason.
   */
  it('reads a stream with no frames at all as a provider fault, not an empty model turn', async () => {
    createMock.mockResolvedValue(chunkStream([]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events).toHaveLength(1);
    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'overloaded' }) });
    expect(isRetryable('overloaded')).toBe(true);
  });

  it('reads frames that never carry a choice as a provider fault too', async () => {
    createMock.mockResolvedValue(chunkStream([{ choices: [] }, { choices: [] }]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'overloaded' }) });
  });

  it('leaves a genuinely empty model turn as done, because it carries a finish reason', async () => {
    createMock.mockResolvedValue(chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([{ t: 'done', stop: 'stop', final: [] }]);
  });

  it('leaves a reasoning-only turn as done', async () => {
    createMock.mockResolvedValue(chunkStream([
      { choices: [{ index: 0, delta: { reasoning_content: 'weighing the ridge' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'reasoning', delta: 'weighing the ridge' },
      expect.objectContaining({ t: 'done', stop: 'stop', final: [] }),
    ]);
  });

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

  /** On the anthropic dialect the silence arrives as a throw from `finalMessage`. */
  it('reads the anthropic stream\'s own no-message complaint as a provider fault', async () => {
    streamMock.mockReturnValue(sdkStream([], () => { throw apiError(undefined, SILENCE.noMessage); }));
    const events = await collect(anthropic().stream(baseRequest(), new AbortController().signal));

    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'overloaded' }) });
  });
});

describe('the zoo: a stream that dies after partial content', () => {
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

  /** Both SDKs raise a mid-stream error frame out of the iterator as a throw with its status. */
  it('surfaces a mid-stream error frame with the status the frame carried', async () => {
    createMock.mockResolvedValue(chunkStream(
      [{ choices: [{ index: 0, delta: { content: 'Working' }, finish_reason: null }] }],
      apiError(429, GATEWAY_429),
    ));
    const events = await collect(openAi().stream(baseRequest(), new AbortController().signal));

    expect(events[0]).toEqual({ t: 'text', delta: 'Working' });
    expect(terminal(events)).toEqual({ t: 'error', error: expect.objectContaining({ cls: 'rate-limit' }) });
  });

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

describe('the zoo: what reaches the user', () => {
  /** The detail reaches the transcript, the banner and exported logs, so the adapter redacts it. */
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

  /** The banner table also covers classes outside `ErrorClass`, so the check runs from the zoo side. */
  it('gives every class in the zoo a banner row', () => {
    const produced = new Set<ErrorClass>(ZOO.map((s) => s.cls));
    produced.add('overloaded'); // the adapters' own platform-silence class
    for (const cls of produced) {
      expect(BANNER_CLASSES, cls).toContain(cls);
    }
  });

  it('puts the platform silence in the retryable family, apart from the credential classes', () => {
    for (const cls of ['overloaded', 'rate-limit', 'network'] as const) {
      expect(isRetryable(cls), cls).toBe(true);
    }
    for (const cls of ['auth', 'quota', 'overflow', 'cors', 'unknown'] as const) {
      expect(isRetryable(cls), cls).toBe(false);
    }
  });

  /** A silent gateway must not read like a wrong key. */
  it('draws the platform silence on the wait paper, with a retry on it', () => {
    const view = render(createElement(I18nProvider, null, createElement(Banner, { cls: 'overloaded', onAction: () => {} })));
    const banner = view.getByTestId('banner');
    expect(banner.getAttribute('data-paper')).toBe('wait');
    expect(banner.querySelector('[data-action="try-again"]')).toBeTruthy();
    expect(banner.querySelector('[data-action="fix-key"]')).toBeNull();
    view.unmount();
  });
});

describe('the zoo: a platform that sent nothing does not read as a model that said nothing', () => {
  /** A gateway at its cap answers 200 with an empty body every turn; the job retries, then ends on a named incident. */
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
    expect(slept).toHaveLength(MAX_TURN_ATTEMPTS - 1);
  });

  it('never tells the model it produced nothing', async () => {
    createMock.mockResolvedValue(chunkStream([]));
    const { adapter, sent } = withRequests(openAi());

    await runJob(seeded(), loopDeps(adapter, async () => {}));

    expect(notesOf(sent)).not.toContain('produced no text and no tool calls');
  });

  it('leaves the empty MODEL turn on the nudge path it has always taken', async () => {
    createMock.mockResolvedValue(chunkStream([{ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]));
    const { adapter, sent } = withRequests(openAi());
    const log = seeded();

    const outcome = await runJob(log, loopDeps(adapter, async () => {}));

    expect(outcome).toBe('done');
    expect(outcomeOf(log).incident).toBeUndefined();
    expect(notesOf(sent)).toContain('produced no text and no tool calls');
  });

  it('honours a named 429\'s own Retry-After on the way to the same incident', async () => {
    createMock.mockRejectedValue(apiError(429, GATEWAY_429, { 'retry-after': '4' }));
    const log = seeded();
    const slept: number[] = [];

    expect(await runJob(log, loopDeps(openAi(), async (ms) => { slept.push(ms); }))).toBe('incident');
    expect(outcomeOf(log).incident).toEqual({ cls: 'rate-limit' });
    expect(slept).toEqual(Array<number>(MAX_TURN_ATTEMPTS - 1).fill(4000));
  });

  it('spends no attempt on a credential refusal', async () => {
    createMock.mockRejectedValue(openAiBody(401, 'Incorrect API key provided.'));
    const log = seeded();
    const slept: number[] = [];

    expect(await runJob(log, loopDeps(openAi(), async (ms) => { slept.push(ms); }))).toBe('incident');
    expect(outcomeOf(log).incident).toEqual({ cls: 'auth' });
    expect(slept).toEqual([]);
  });
});

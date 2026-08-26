import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUIRKS, type Quirks } from '../../../agent/providers/defaults';
import type { ProviderMessage } from '../../../agent/core/project-messages';
import type { StreamEvent } from '../../../agent/core/types';
import type { AdapterRequest } from '../../../agent/providers/types';

const { createMock, ctorMock, listMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  ctorMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: createMock } };
    models = { list: listMock };
    constructor(opts: unknown) {
      ctorMock(opts);
    }
  }
  return { default: MockOpenAI };
});

import { createOpenAIAdapter, toOpenAIMessages } from '../../../agent/providers/openai';

/** A `client.chat.completions.create(...)` stand-in: async-iterable over scripted raw chunks,
 *  mirroring the real `Stream<ChatCompletionChunk>`. */
function fakeChunkStream(chunks: unknown[]): { [Symbol.asyncIterator]: () => AsyncGenerator<unknown> } {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

function baseRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    system: 'You are an agent.',
    messages: [],
    tools: [{ name: 'place_object', description: 'Places an object', parameters: { type: 'object', properties: {} } }],
    model: 'gpt-x',
    sameModel: true,
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('providers/openai: streaming', () => {
  afterEach(() => {
    // RESET, not clear: `clearAllMocks` leaves a queued `mockResolvedValueOnce` standing, so one
    // failing retry test would feed its unconsumed value to the next test and cascade.
    vi.resetAllMocks();
  });

  it('streams text deltas from delta.content and reasoning deltas from the quirks-declared field', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { reasoning_content: 'thinking...' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', quirks: QUIRKS.deepseek });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'reasoning', delta: 'thinking...' },
      { t: 'text', delta: 'Hello' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
  });

  it('reads reasoning_content under zhipu\'s quirks and plain reasoning under openrouter\'s', async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { reasoning_content: 'zhipu thinks' }, finish_reason: 'stop' }] },
    ]));
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { reasoning: 'routed model thinks' }, finish_reason: 'stop' }] },
    ]));

    const zhipu = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.z.ai/api/paas/v4', quirks: QUIRKS.zhipu });
    const router = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1', quirks: QUIRKS.openrouter });

    expect(await collect(zhipu.stream(baseRequest(), new AbortController().signal))).toEqual([
      { t: 'reasoning', delta: 'zhipu thinks' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
    expect(await collect(router.stream(baseRequest(), new AbortController().signal))).toEqual([
      { t: 'reasoning', delta: 'routed model thinks' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
  });

  it('yields exactly one reasoning event for a chunk carrying both spellings, taking the provider\'s first declared field', async () => {
    const bothFields = [
      { choices: [{ index: 0, delta: { reasoning_content: 'from reasoning_content', reasoning: 'from reasoning' }, finish_reason: 'stop' }] },
    ];
    createMock.mockResolvedValueOnce(fakeChunkStream(bothFields));
    createMock.mockResolvedValueOnce(fakeChunkStream(bothFields));

    const deepseek = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', quirks: QUIRKS.deepseek });
    const router = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1', quirks: QUIRKS.openrouter });

    expect(await collect(deepseek.stream(baseRequest(), new AbortController().signal))).toEqual([
      { t: 'reasoning', delta: 'from reasoning_content' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
    expect(await collect(router.stream(baseRequest(), new AbortController().signal))).toEqual([
      { t: 'reasoning', delta: 'from reasoning' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
  });

  it('ignores a reasoning_content field on the wire when the quirks table declares no reasoning field for this provider', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { reasoning_content: 'nope' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks: QUIRKS.openai });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: 'hi' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
  });

  it('accumulates two interleaved tool calls by index without cross-contamination, firing tool-start once per call even when a chunk repeats the name', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'place_object' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'remove_object' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'place_object' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"x":1' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '{"id":"a"}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks: QUIRKS.openai });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'tool-start', callId: 'call_a', name: 'place_object' },
      { t: 'tool-start', callId: 'call_b', name: 'remove_object' },
      { t: 'tool-args', callId: 'call_a', delta: '{"x":1' },
      { t: 'tool-args', callId: 'call_b', delta: '{"id":"a"}' },
      { t: 'tool-args', callId: 'call_a', delta: '}' },
      {
        t: 'done',
        stop: 'tool-calls',
        final: [
          { callId: 'call_a', name: 'place_object', args: { x: 1 }, rawArgs: '{"x":1}' },
          { callId: 'call_b', name: 'remove_object', args: { id: 'a' }, rawArgs: '{"id":"a"}' },
        ],
      },
    ]);
  });

  /** Chunks lifted from a live Ivy (vLLM-style) gateway's SSE: every chunk's choice carries BOTH a
   *  cumulative `message` and a `delta`, a tool call arrives COMPLETE in one chunk (id + name + whole
   *  arguments), and no tool call carries an `index`. Several calls in one turn are several such
   *  chunks, so keying the accumulator on `index` alone merged them all into one buffer of
   *  concatenated JSON. */
  it('assembles complete-in-one-chunk index-less tool calls (Ivy shape: cumulative message beside delta) as distinct calls', async () => {
    const callA = { id: '29ba38e8-1289-4c8d-8651-02889b04b6c6', type: 'function', function: { name: 'place_object', arguments: '{"catalogId":"building-bamboo-cabin","x":68,"y":48}' } };
    const callB = { id: '1f161f97-e566-478b-99de-184084617fa8', type: 'function', function: { name: 'place_object', arguments: '{"catalogId":"building-sunset-cabin","x":75,"y":48}' } };
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, message: { role: 'assistant', content: 'Good' }, delta: { role: 'assistant', content: 'Good' } }], usage: { prompt_tokens: 14020, completion_tokens: 1, total_tokens: 14021 } },
      { choices: [{ index: 0, message: { role: 'assistant', content: 'Good, plenty of flat space.\n\n' }, delta: { role: 'assistant', content: ', plenty of flat space.\n\n' } }], usage: { prompt_tokens: 14020, completion_tokens: 8, total_tokens: 14028 } },
      { choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [callA] }, delta: { role: 'assistant', content: '', tool_calls: [callA] } }], usage: { prompt_tokens: 14020, completion_tokens: 98, total_tokens: 14118 } },
      { choices: [{ index: 0, message: { role: 'assistant', content: '', tool_calls: [callB] }, delta: { role: 'assistant', content: '', tool_calls: [callB] } }], usage: { prompt_tokens: 14020, completion_tokens: 155, total_tokens: 14175 } },
      { choices: [{ index: 0, message: { role: 'assistant', content: '' }, delta: { role: 'assistant', content: '' }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 14020, completion_tokens: 155, total_tokens: 14175 } },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'none', baseUrl: 'http://gateway.example/v1', quirks: QUIRKS.custom });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: 'Good' },
      { t: 'text', delta: ', plenty of flat space.\n\n' },
      { t: 'tool-start', callId: callA.id, name: 'place_object' },
      { t: 'tool-args', callId: callA.id, delta: callA.function.arguments },
      { t: 'tool-start', callId: callB.id, name: 'place_object' },
      { t: 'tool-args', callId: callB.id, delta: callB.function.arguments },
      {
        t: 'done',
        stop: 'tool-calls',
        final: [
          { callId: callA.id, name: 'place_object', args: { catalogId: 'building-bamboo-cabin', x: 68, y: 48 }, rawArgs: callA.function.arguments },
          { callId: callB.id, name: 'place_object', args: { catalogId: 'building-sunset-cabin', x: 75, y: 48 }, rawArgs: callB.function.arguments },
        ],
        usage: { input: 14020, output: 155 },
      },
    ]);
  });

  it('keeps accumulating an index-less FRAGMENTED call by its id when a gateway splits one call across chunks', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { tool_calls: [{ id: 'call_f', type: 'function', function: { name: 'place_object', arguments: '{"x":1' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ id: 'call_f', type: 'function', function: { arguments: '}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'none', baseUrl: 'http://gateway.example/v1', quirks: QUIRKS.custom });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'tool-start', callId: 'call_f', name: 'place_object' },
      { t: 'tool-args', callId: 'call_f', delta: '{"x":1' },
      { t: 'tool-args', callId: 'call_f', delta: '}' },
      { t: 'done', stop: 'tool-calls', final: [{ callId: 'call_f', name: 'place_object', args: { x: 1 }, rawArgs: '{"x":1}' }] },
    ]);
  });

  it('leaves args undefined in done.final when the accumulated buffer never parses as JSON', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'noop', arguments: 'not json' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks: QUIRKS.openai });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events[events.length - 1]).toEqual({
      t: 'done',
      stop: 'tool-calls',
      final: [{ callId: 'call_x', name: 'noop', args: undefined, rawArgs: 'not json' }],
    });
  });

  it('synthesizes call-<index>-<n> when a tool-call chunk omits id, and still executes it', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'place_object', arguments: '{}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1', quirks: QUIRKS.openrouter });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'tool-start', callId: 'call-0-0', name: 'place_object' },
      { t: 'tool-args', callId: 'call-0-0', delta: '{}' },
      { t: 'done', stop: 'tool-calls', final: [{ callId: 'call-0-0', name: 'place_object', args: {}, rawArgs: '{}' }] },
    ]);
  });

  it('synthesizes a DIFFERENT id-less callId on a second stream() call from the same adapter instance (no cross-turn collision)', async () => {
    const oneIdLessCallChunks = [
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: 'place_object', arguments: '{}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    createMock.mockResolvedValueOnce(fakeChunkStream(oneIdLessCallChunks));
    createMock.mockResolvedValueOnce(fakeChunkStream(oneIdLessCallChunks));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1', quirks: QUIRKS.openrouter });
    const firstEvents = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    const secondEvents = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    const firstCallId = firstEvents.find((e) => e.t === 'tool-start')?.callId;
    const secondCallId = secondEvents.find((e) => e.t === 'tool-start')?.callId;

    expect(firstCallId).toBeDefined();
    expect(secondCallId).toBeDefined();
    expect(secondCallId).not.toBe(firstCallId);
  });

  it('maps finish_reason "length" to done.stop "length"', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: 'partial' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks: QUIRKS.openai });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: 'partial' },
      { t: 'done', stop: 'length', final: [] },
    ]);
  });

  it('maps a usage-bearing final chunk onto the done event, including the cached-prompt read', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }] },
      // The usage chunk carries NO choice at all, which is how the wire sends it.
      { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 84, total_tokens: 1284, prompt_tokens_details: { cached_tokens: 1024 } } },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', quirks: QUIRKS.deepseek });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: 'hi' },
      { t: 'done', stop: 'stop', final: [], usage: { input: 1200, output: 84, cacheRead: 1024 } },
    ]);
  });

  it('leaves cacheRead undefined when the usage chunk carries no prompt-token breakdown, and carries no usage key at all when none arrived', async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
    ]));
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks: QUIRKS.openai });

    expect(await collect(adapter.stream(baseRequest(), new AbortController().signal))).toEqual([
      { t: 'done', stop: 'stop', final: [], usage: { input: 10, output: 2, cacheRead: undefined } },
    ]);
    const withoutUsage = await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(withoutUsage).toEqual([{ t: 'done', stop: 'stop', final: [] }]);
    expect(withoutUsage[0] && 'usage' in withoutUsage[0]).toBe(false);
  });

  it('asks for streamed usage where the quirk is set and omits the parameter for a custom gateway', async () => {
    createMock.mockResolvedValue(fakeChunkStream([]));

    const zhipu = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.z.ai/api/paas/v4', quirks: QUIRKS.zhipu });
    await collect(zhipu.stream(baseRequest(), new AbortController().signal));
    const [zhipuParams] = createMock.mock.calls[0] as [Record<string, unknown>];
    expect(zhipuParams.stream_options).toEqual({ include_usage: true });

    createMock.mockClear();
    const custom = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://my-gateway.example/v1', quirks: QUIRKS.custom });
    await collect(custom.stream(baseRequest(), new AbortController().signal));
    const [customParams] = createMock.mock.calls[0] as [Record<string, unknown>];
    expect('stream_options' in customParams).toBe(false);
  });

  it.each([
    ['an OpenAI-shaped 400', 400, "Unrecognized request argument supplied: stream_options"],
    ['a schema-validated 422', 422, 'body -> stream_options: extra fields not permitted'],
  ])('retries once without stream_options when a gateway refuses it (%s), completing the stream with no incident and no usage', async (_shape, status, message) => {
    createMock.mockRejectedValueOnce(Object.assign(new Error(message), { status }));
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: 'served anyway' }, finish_reason: 'stop' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://my-gateway.example/v1', quirks: QUIRKS.qwen });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: 'served anyway' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
    expect(createMock).toHaveBeenCalledTimes(2);
    const [first] = createMock.mock.calls[0] as [Record<string, unknown>];
    const [second] = createMock.mock.calls[1] as [Record<string, unknown>];
    expect(first.stream_options).toEqual({ include_usage: true });
    expect('stream_options' in second).toBe(false);
  });

  it('remembers the refusal for the adapter\'s lifetime: the next turn asks for no usage and pays no rejected roundtrip', async () => {
    createMock.mockRejectedValueOnce(Object.assign(new Error('Unrecognized request argument supplied: stream_options'), { status: 400 }));
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://my-gateway.example/v1', quirks: QUIRKS.qwen });
    await collect(adapter.stream(baseRequest(), new AbortController().signal));
    expect(createMock).toHaveBeenCalledTimes(2);

    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: 'ok' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
    expect(createMock).toHaveBeenCalledTimes(3);
    const [third] = createMock.mock.calls[2] as [Record<string, unknown>];
    expect('stream_options' in third).toBe(false);
  });

  it('never eats a real 400: a rejection that names something other than stream_options fails loudly on the first try', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('Invalid value for model: no-such-model'), { status: 400 }));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', quirks: QUIRKS.deepseek });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.t).toBe('error');
    if (event?.t !== 'error') throw new Error('expected an error event');
    expect(event.error.status).toBe(400);
    expect(event.error.detail).toContain('no-such-model');
  });

  it('constructs the client with maxRetries 0, dangerouslyAllowBrowser, and every x-stainless telemetry header nulled', async () => {
    createMock.mockResolvedValue(fakeChunkStream([]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.deepseek.com', quirks: QUIRKS.deepseek });
    await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(ctorMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      baseURL: 'https://api.deepseek.com',
      maxRetries: 0,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'x-stainless-arch': null,
        'x-stainless-lang': null,
        'x-stainless-os': null,
        'x-stainless-package-version': null,
        'x-stainless-retry-count': null,
        'x-stainless-runtime': null,
        'x-stainless-runtime-version': null,
        'x-stainless-timeout': null,
      },
    });
  });

  it('passes no baseURL to the SDK constructor when the caller omits one (the openai provider, whose SDK carries its own default)', async () => {
    createMock.mockResolvedValue(fakeChunkStream([]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', quirks: QUIRKS.openai });
    await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(ctorMock).toHaveBeenCalledWith(expect.objectContaining({ baseURL: undefined }));
  });

  it('nests an image inside its own tool message when the quirks flag says the dialect allows it, appending no follow-up user message', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));

    const quirks: Quirks = { ...QUIRKS.openai, imageInToolResult: true };
    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks });
    const messages: ProviderMessage[] = [
      {
        role: 'tool',
        results: [{ callId: 'call_1', name: 'view_map', content: 'here is the map', isError: false, image: 'data:image/png;base64,QUJD' }],
      },
    ];
    await collect(adapter.stream(baseRequest({ messages }), new AbortController().signal));

    const [params] = createMock.mock.calls[0] as [{ messages: unknown[] }];
    expect(params.messages).toEqual([
      { role: 'system', content: 'You are an agent.' },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: [
          { type: 'text', text: 'here is the map' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      },
    ]);
  });

  it('turns a rejected stream into one error event, never throwing', async () => {
    const err = Object.assign(new Error('rate limited: key sk-proj-abcdefghijklmno1234567890 exceeded'), {
      status: 429,
      headers: { 'retry-after': '3' },
    });
    createMock.mockRejectedValue(err);

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks: QUIRKS.openai });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.t).toBe('error');
    if (event?.t !== 'error') throw new Error('expected an error event');
    expect(event.error.cls).toBe('rate-limit');
    expect(event.error.status).toBe(429);
    expect(event.error.retryAfterMs).toBe(3000);
    expect(event.error.detail).not.toMatch(/sk-proj-/);
    expect(event.error.detail).toContain('<redacted-key>');
  });

  it('ends with a stop:"aborted" done event and never throws, carrying whatever text already streamed', async () => {
    const controller = new AbortController();
    const abortErr = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
    createMock.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ index: 0, delta: { content: 'Partial' }, finish_reason: null }] };
        controller.abort();
        throw abortErr;
      },
    });

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks: QUIRKS.openai });
    const events = await collect(adapter.stream(baseRequest(), controller.signal));

    expect(events).toEqual([
      { t: 'text', delta: 'Partial' },
      { t: 'done', stop: 'aborted' },
    ]);
  });

  /**
   * A GATEWAY THAT CANNOT CARRY A TOOL CALL ON ITS STREAMING PATH.
   *
   * The shapes below are the ones recorded against a live Open WebUI gateway: the same request body
   * answers `finish_reason: "tool_calls"` with a proper `tool_calls` array unstreamed, and streams
   * the identical call as `delta.content` with `finish_reason: "stop"` and no `tool_calls` anywhere.
   * Unnormalized, that turn is an ANSWER whose text is the JSON — a well-formed turn with a call in
   * the wrong channel, which no error shape covers.
   *
   * Every test here uses its OWN base URL: the endpoint memory behind the second fix is module-wide
   * (deliberately, so a per-job adapter does not relearn it), so a shared URL would let one test's
   * lesson decide another test's transport.
   */
  const PROSE_CALL = '{"name": "find_flat_areas", "arguments": {"minWidth": 7, "minHeight": 4, "elevation": 0, "near": {"x": 76, "y": 58}, "limit": 5}}';
  const PROSE_ARGS = { minWidth: 7, minHeight: 4, elevation: 0, near: { x: 76, y: 58 }, limit: 5 };
  const searchRequest = (overrides: Partial<AdapterRequest> = {}) => baseRequest({
    tools: [{ name: 'find_flat_areas', description: 'finds flat ground', parameters: { type: 'object', properties: {} } }],
    ...overrides,
  });

  it('delivers a streamed tool-shaped message body as the tool call it is, marking the turn, and says nothing as text', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: PROSE_CALL.slice(0, 40) }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: PROSE_CALL.slice(40) }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://prose-a.example/v1', quirks: QUIRKS.custom });
    const events = await collect(adapter.stream(searchRequest(), new AbortController().signal));

    expect(events.some((e) => e.t === 'text'), 'the call is never the assistant\'s words').toBe(false);
    expect(events).toEqual([
      { t: 'tool-start', callId: 'call-prose-0', name: 'find_flat_areas' },
      { t: 'tool-args', callId: 'call-prose-0', delta: JSON.stringify(PROSE_ARGS) },
      {
        t: 'done',
        stop: 'tool-calls',
        final: [{ callId: 'call-prose-0', name: 'find_flat_areas', args: PROSE_ARGS, rawArgs: JSON.stringify(PROSE_ARGS) }],
        quirks: ['tool-call-as-prose'],
      },
    ]);
  });

  it('takes `arguments` as a JSON string too, and an absent one as a call with no arguments', async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: '{"name":"find_flat_areas","arguments":"{\\"limit\\":2}"}' }, finish_reason: 'stop' }] },
    ]));
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: '{"name":"find_flat_areas"}' }, finish_reason: 'stop' }] },
    ]));

    // Two endpoints, because the FIRST prose turn takes its own endpoint off the streaming path.
    const withString = await collect(createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://prose-b1.example/v1', quirks: QUIRKS.custom })
      .stream(searchRequest(), new AbortController().signal));
    const withNone = await collect(createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://prose-b2.example/v1', quirks: QUIRKS.custom })
      .stream(searchRequest(), new AbortController().signal));

    expect(withString.find((e) => e.t === 'done')).toMatchObject({
      stop: 'tool-calls',
      final: [{ name: 'find_flat_areas', args: { limit: 2 } }],
    });
    expect(withNone.find((e) => e.t === 'done')).toMatchObject({
      stop: 'tool-calls',
      final: [{ name: 'find_flat_areas', args: {} }],
    });
  });

  it('publishes a brace-opened body that is NOT a requested call as the text it is, delta by delta', async () => {
    createMock.mockResolvedValue(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: '{"name":"rm -rf",' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: '"arguments":{}}' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://prose-c.example/v1', quirks: QUIRKS.custom });
    const events = await collect(adapter.stream(searchRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: '{"name":"rm -rf",' },
      { t: 'text', delta: '"arguments":{}}' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
  });

  it('never promotes a body the provider truncated, nor one from a turn that carried real tool calls', async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: PROSE_CALL }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
    ]));
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: PROSE_CALL }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_r', function: { name: 'find_flat_areas', arguments: '{}' } }] }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]));

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://prose-d.example/v1', quirks: QUIRKS.custom });
    const truncated = await collect(adapter.stream(searchRequest(), new AbortController().signal));
    const withRealCall = await collect(adapter.stream(searchRequest(), new AbortController().signal));

    expect(truncated).toEqual([
      { t: 'text', delta: PROSE_CALL },
      { t: 'done', stop: 'length', final: [] },
    ]);
    expect(withRealCall.filter((e) => e.t === 'text')).toEqual([{ t: 'text', delta: PROSE_CALL }]);
    expect(withRealCall.find((e) => e.t === 'done')).toEqual({
      t: 'done',
      stop: 'tool-calls',
      final: [{ callId: 'call_r', name: 'find_flat_areas', args: {}, rawArgs: '{}' }],
    });
  });

  it('sends the NEXT request to an endpoint that answered in prose unstreamed, where the same gateway returns real tool_calls', async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: PROSE_CALL }, finish_reason: 'stop' }] },
    ]));
    // The unstreamed answer to the same body, as the live probe recorded it.
    createMock.mockResolvedValueOnce({
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          reasoning_content: 'where is the flat ground',
          tool_calls: [{ id: 'call_real', type: 'function', function: { name: 'find_flat_areas', arguments: '{"limit":5}' } }],
        },
      }],
      usage: { prompt_tokens: 900, completion_tokens: 40, total_tokens: 940 },
    });

    const first = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://prose-e.example/v1', quirks: QUIRKS.custom });
    const firstEvents = await collect(first.stream(searchRequest(), new AbortController().signal));
    // A FRESH ADAPTER, because the runner builds one per job: the lesson has to outlive the instance.
    const second = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://prose-e.example/v1', quirks: QUIRKS.custom });
    const secondEvents = await collect(second.stream(searchRequest(), new AbortController().signal));

    expect(firstEvents.find((e) => e.t === 'done')).toMatchObject({ quirks: ['tool-call-as-prose'] });
    expect((createMock.mock.calls[0]?.[0] as { stream?: unknown }).stream).toBe(true);
    expect((createMock.mock.calls[1]?.[0] as { stream?: unknown }).stream).toBeUndefined();
    // Reasoning and usage both reach the loop off the response body, so nothing the panel counts is
    // lost by leaving the streaming path (and `stream_options` has nothing to ask for here).
    expect(secondEvents).toEqual([
      { t: 'reasoning', delta: 'where is the flat ground' },
      { t: 'tool-start', callId: 'call_real', name: 'find_flat_areas' },
      { t: 'tool-args', callId: 'call_real', delta: '{"limit":5}' },
      {
        t: 'done',
        stop: 'tool-calls',
        final: [{ callId: 'call_real', name: 'find_flat_areas', args: { limit: 5 }, rawArgs: '{"limit":5}' }],
        usage: { input: 900, output: 40, cacheRead: undefined },
      },
    ]);
  });

  it('normalizes a prose call on the unstreamed path too, and reports a body with no choice as a provider fault', async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: PROSE_CALL }, finish_reason: 'stop' }] },
    ]));
    createMock.mockResolvedValueOnce({
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: PROSE_CALL } }],
    });
    createMock.mockResolvedValueOnce({ choices: [] });

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://prose-f.example/v1', quirks: QUIRKS.custom });
    await collect(adapter.stream(searchRequest(), new AbortController().signal));
    const unstreamedProse = await collect(adapter.stream(searchRequest(), new AbortController().signal));
    const empty = await collect(adapter.stream(searchRequest(), new AbortController().signal));

    expect(unstreamedProse.some((e) => e.t === 'text')).toBe(false);
    expect(unstreamedProse.find((e) => e.t === 'done')).toMatchObject({
      stop: 'tool-calls',
      quirks: ['tool-call-as-prose'],
      final: [{ name: 'find_flat_areas', args: PROSE_ARGS }],
    });
    expect(empty).toHaveLength(1);
    expect(empty[0]?.t).toBe('error');
  });

  it('lists model ids off client.models.list', async () => {
    listMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { id: 'gpt-4o' };
        yield { id: 'gpt-4o-mini' };
      },
    });

    const adapter = createOpenAIAdapter({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', quirks: QUIRKS.openai });
    const ids = await adapter.listModels(new AbortController().signal);

    expect(ids).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });
});

describe('providers/openai: toOpenAIMessages', () => {
  it('maps system + user/assistant/tool history two-pass: tool results before any follow-up user message, images as a labeled follow-up user message', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', text: 'build a tower' },
      { role: 'assistant', text: '', toolCalls: [{ callId: 'call_1', name: 'view_map', args: {} }] },
      {
        role: 'tool',
        results: [{ callId: 'call_1', name: 'view_map', content: 'here is the map', isError: false, image: 'data:image/png;base64,QUJD' }],
      },
    ];

    expect(toOpenAIMessages('SYSTEM', messages)).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'user', content: 'build a tower' },
      { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'view_map', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'here is the map' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '(tool attachment: view_map)' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      },
    ]);
  });

  it('prefixes an error result\'s content with "Error: "', () => {
    const messages: ProviderMessage[] = [
      { role: 'tool', results: [{ callId: 'call_2', name: 'place_object', content: 'blocked', isError: true }] },
    ];

    expect(toOpenAIMessages('SYSTEM', messages)).toEqual([
      { role: 'system', content: 'SYSTEM' },
      { role: 'tool', tool_call_id: 'call_2', content: 'Error: blocked' },
    ]);
  });

  it('batches every tool result before any image follow-up, in two passes', () => {
    const messages: ProviderMessage[] = [
      {
        role: 'tool',
        results: [
          { callId: 'call_1', name: 'a', content: 'ok', isError: false, image: 'data:image/png;base64,AAA' },
          { callId: 'call_2', name: 'b', content: 'also ok', isError: false },
        ],
      },
    ];

    expect(toOpenAIMessages('SYS', messages)).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      { role: 'tool', tool_call_id: 'call_2', content: 'also ok' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '(tool attachment: a)' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ]);
  });

  it('ignores a history assistant turn\'s raw field even when sameModel would be true (reasoning is never replayed on this dialect)', () => {
    const messages: ProviderMessage[] = [
      { role: 'assistant', text: 'ok', toolCalls: [], raw: [{ type: 'reasoning', text: 'should never appear' }] },
    ];

    expect(toOpenAIMessages('SYS', messages)).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'assistant', content: 'ok' },
    ]);
  });

  it('never emits content: null on a history assistant turn: omitted beside tool_calls, an empty string on a turn with neither', () => {
    const messages: ProviderMessage[] = [
      { role: 'assistant', text: '', toolCalls: [{ callId: 'call_1', name: 'view_map', args: {} }] },
      { role: 'assistant', text: '', toolCalls: [] },
      { role: 'assistant', text: 'said and called', toolCalls: [{ callId: 'call_2', name: 'view_map', args: {} }] },
    ];

    const out = toOpenAIMessages('SYS', messages);
    expect(out[1]).toEqual({ role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'view_map', arguments: '{}' } }] });
    expect(Object.keys(out[1] as object)).not.toContain('content');
    expect(out[2]).toEqual({ role: 'assistant', content: '' });
    expect(out[3]).toEqual({
      role: 'assistant', content: 'said and called',
      tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'view_map', arguments: '{}' } }],
    });
  });

  it('sends a plain user message as a string, or as text+image parts when images are present', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', text: 'build a tower' },
      { role: 'user', text: 'like this', images: ['data:image/png;base64,QUJD'] },
    ];

    expect(toOpenAIMessages('SYS', messages)).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'build a tower' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'like this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      },
    ]);
  });
});

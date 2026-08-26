import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProviderMessage } from '../../../agent/core/project-messages';
import type { StreamEvent } from '../../../agent/core/types';
import type { AdapterRequest } from '../../../agent/providers/types';

const { streamMock, ctorMock, listMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  ctorMock: vi.fn(),
  listMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { stream: streamMock };
    models = { list: listMock };
    constructor(opts: unknown) {
      ctorMock(opts);
    }
  }
  return { default: MockAnthropic };
});

import { createAnthropicAdapter, toAnthropicMessages, withConversationBreakpoint } from '../../../agent/providers/anthropic';

/** A `client.messages.stream(...)` stand-in: async-iterable over scripted raw SDK events, plus
 *  `finalMessage()`. Mirrors the real MessageStream's dual surface (iterate live, await the end). */
function fakeSdkStream(events: unknown[], finalMessage: () => unknown): { [Symbol.asyncIterator]: () => AsyncGenerator<unknown>; finalMessage: () => Promise<unknown> } {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    finalMessage: async () => finalMessage(),
  };
}

function baseRequest(overrides: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    system: 'You are an agent.',
    messages: [],
    tools: [{ name: 'place_object', description: 'Places an object', parameters: { type: 'object', properties: {} } }],
    model: 'claude-x',
    sameModel: true,
    ...overrides,
  };
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('providers/anthropic: streaming', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('streams text deltas live and reconciles tool_use blocks at finalMessage, raw = the full content array', async () => {
    streamMock.mockReturnValue(fakeSdkStream(
      [
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call_1', name: 'place_object', input: {} } },
        { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"x":1}' } },
        { type: 'content_block_stop', index: 1 },
      ],
      () => ({
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', id: 'call_1', name: 'place_object', input: { x: 1 } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: null, cache_creation_input_tokens: null },
      }),
    ));

    const adapter = createAnthropicAdapter({ apiKey: 'sk-ant-test' });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'text', delta: 'Hello' },
      { t: 'tool-start', callId: 'call_1', name: 'place_object' },
      { t: 'tool-args', callId: 'call_1', delta: '{"x":1}' },
      {
        t: 'done',
        stop: 'tool-calls',
        usage: { input: 10, output: 5, cacheRead: undefined, cacheWrite: undefined },
        raw: [
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', id: 'call_1', name: 'place_object', input: { x: 1 } },
        ],
        final: [{ callId: 'call_1', name: 'place_object', args: { x: 1 }, rawArgs: '{"x":1}' }],
      },
    ]);
  });

  it('forwards each input_json_delta chunk of a tool call live, in order, keyed by the callId its content_block_start opened', async () => {
    streamMock.mockReturnValue(fakeSdkStream(
      [
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call_9', name: 'place_object', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"id":"tr' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'ee-1"}' } },
        { type: 'content_block_stop', index: 0 },
      ],
      () => ({
        content: [{ type: 'tool_use', id: 'call_9', name: 'place_object', input: { id: 'tree-1' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: null, cache_creation_input_tokens: null },
      }),
    ));

    const adapter = createAnthropicAdapter({ apiKey: 'sk-ant-test' });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toEqual([
      { t: 'tool-start', callId: 'call_9', name: 'place_object' },
      { t: 'tool-args', callId: 'call_9', delta: '{"id":"tr' },
      { t: 'tool-args', callId: 'call_9', delta: 'ee-1"}' },
      {
        t: 'done',
        stop: 'tool-calls',
        usage: { input: 4, output: 2, cacheRead: undefined, cacheWrite: undefined },
        raw: [{ type: 'tool_use', id: 'call_9', name: 'place_object', input: { id: 'tree-1' } }],
        final: [{ callId: 'call_9', name: 'place_object', args: { id: 'tree-1' }, rawArgs: '{"id":"tree-1"}' }],
      },
    ]);
  });

  it('builds the request with a cache_control system breakpoint, adaptive thinking, and maxRetries 0 on the client', async () => {
    streamMock.mockReturnValue(fakeSdkStream([], () => ({
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    })));

    const adapter = createAnthropicAdapter({ apiKey: 'sk-ant-test' });
    await collect(adapter.stream(baseRequest({ system: 'SYSTEM PROMPT' }), new AbortController().signal));

    expect(ctorMock).toHaveBeenCalledWith({ apiKey: 'sk-ant-test', maxRetries: 0, dangerouslyAllowBrowser: true });

    const [params, streamOpts] = streamMock.mock.calls[0] as [Record<string, unknown>, { signal: AbortSignal }];
    expect(params.system).toEqual([{ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } }]);
    expect(params.thinking).toEqual({ type: 'adaptive' });
    expect(streamOpts.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives thinking and the answer 32000 tokens to share by default, and still honours an explicit budget', async () => {
    const scripted = () => fakeSdkStream([], () => ({
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: null, cache_creation_input_tokens: null },
    }));

    const adapter = createAnthropicAdapter({ apiKey: 'sk-ant-test' });
    streamMock.mockReturnValue(scripted());
    await collect(adapter.stream(baseRequest(), new AbortController().signal));
    streamMock.mockReturnValue(scripted());
    await collect(adapter.stream(baseRequest({ maxOutputTokens: 4096 }), new AbortController().signal));

    const [defaulted] = streamMock.mock.calls[0] as [Record<string, unknown>];
    const [explicit] = streamMock.mock.calls[1] as [Record<string, unknown>];
    expect(defaulted.max_tokens).toBe(32000);
    expect(explicit.max_tokens).toBe(4096);
  });

  it('sends the conversation with a trailing cache breakpoint, so the prefix is cached and only the new tail is fresh', async () => {
    streamMock.mockReturnValue(fakeSdkStream([], () => ({
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 900, cache_creation_input_tokens: 40 },
    })));

    const adapter = createAnthropicAdapter({ apiKey: 'sk-ant-test' });
    const messages: ProviderMessage[] = [
      { role: 'user', text: 'build a tower' },
      { role: 'assistant', text: 'on it', toolCalls: [{ callId: 'call_1', name: 'x', args: {} }] },
      { role: 'tool', results: [{ callId: 'call_1', name: 'x', content: 'done', isError: false }] },
    ];
    const events = await collect(adapter.stream(baseRequest({ messages }), new AbortController().signal));

    const [params] = streamMock.mock.calls[0] as [{ messages: Anthropic.MessageParam[] }];
    expect(params.messages).toEqual([
      { role: 'user', content: 'build a tower' },
      { role: 'assistant', content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', id: 'call_1', name: 'x', input: {} }] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', is_error: false, content: 'done', cache_control: { type: 'ephemeral' } }],
      },
    ]);

    const done = events[events.length - 1];
    if (done?.t !== 'done') throw new Error('expected a done event');
    expect(done.usage).toEqual({ input: 3, output: 1, cacheRead: 900, cacheWrite: 40 });
  });

  it('ends with a stop:"aborted" done event and never throws, carrying whatever text already streamed', async () => {
    const controller = new AbortController();
    const abortErr = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });

    streamMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
        yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Partial' } };
        controller.abort();
        throw abortErr;
      },
      finalMessage: async () => {
        throw abortErr;
      },
    });

    const adapter = createAnthropicAdapter({ apiKey: 'sk-ant-test' });
    const events = await collect(adapter.stream(baseRequest(), controller.signal));

    expect(events).toEqual([
      { t: 'text', delta: 'Partial' },
      { t: 'done', stop: 'aborted' },
    ]);
  });

  it('turns a thrown SDK error with status 429 and a retry-after header into one error event, never throwing', async () => {
    const err = Object.assign(new Error('rate limited: key sk-ant-abcdefghijklmnop1234 over quota'), {
      status: 429,
      headers: { 'retry-after': '7' },
    });
    streamMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        throw err;
      },
      finalMessage: async () => {
        throw err;
      },
    });

    const adapter = createAnthropicAdapter({ apiKey: 'sk-ant-test' });
    const events = await collect(adapter.stream(baseRequest(), new AbortController().signal));

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.t).toBe('error');
    if (event?.t !== 'error') throw new Error('expected an error event');
    expect(event.error.cls).toBe('rate-limit');
    expect(event.error.status).toBe(429);
    expect(event.error.retryAfterMs).toBe(7000);
    expect(event.error.detail).not.toMatch(/sk-ant-/);
    expect(event.error.detail).toContain('<redacted-key>');
  });

  it('lists model ids off client.models.list', async () => {
    listMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield { id: 'claude-opus-4-8' };
        yield { id: 'claude-sonnet-4-8' };
      },
    });

    const adapter = createAnthropicAdapter({ apiKey: 'sk-ant-test' });
    const ids = await adapter.listModels(new AbortController().signal);

    expect(ids).toEqual(['claude-opus-4-8', 'claude-sonnet-4-8']);
  });
});

describe('providers/anthropic: toAnthropicMessages', () => {
  it('echoes a history assistant turn\'s raw content verbatim only when sameModel; otherwise rebuilds text+tool_use from the neutral fields', () => {
    const raw = [
      { type: 'thinking', thinking: 'plan the move', signature: 'sig-abc' },
      { type: 'text', text: 'ok' },
      { type: 'tool_use', id: 'call_2', name: 'x', input: { a: 1 } },
    ];
    const messages: ProviderMessage[] = [
      { role: 'assistant', text: 'ok', toolCalls: [{ callId: 'call_2', name: 'x', args: { a: 1 } }], raw },
    ];

    expect(toAnthropicMessages(messages, true)).toEqual([{ role: 'assistant', content: raw }]);

    expect(toAnthropicMessages(messages, false)).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 'call_2', name: 'x', input: { a: 1 } },
        ],
      },
    ]);
  });

  it('batches tool results into one user message of tool_result blocks, in order, with is_error mapped and images nested inside the block', () => {
    const messages: ProviderMessage[] = [
      {
        role: 'tool',
        results: [
          { callId: 'call_1', name: 'a', content: 'ok', isError: false },
          { callId: 'call_2', name: 'b', content: 'bad', isError: true },
          { callId: 'call_3', name: 'c', content: 'view attached', isError: false, image: 'data:image/png;base64,QUJD' },
        ],
      },
    ];

    expect(toAnthropicMessages(messages, true)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_1', is_error: false, content: 'ok' },
          { type: 'tool_result', tool_use_id: 'call_2', is_error: true, content: 'bad' },
          {
            type: 'tool_result',
            tool_use_id: 'call_3',
            is_error: false,
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
              { type: 'text', text: 'view attached' },
            ],
          },
        ],
      },
    ]);
  });

  it('sends a plain user message as string content, or with images nested alongside the text when present', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', text: 'build a tower' },
      { role: 'user', text: 'like this', images: ['data:image/png;base64,QUJD'] },
    ];

    expect(toAnthropicMessages(messages, true)).toEqual([
      { role: 'user', content: 'build a tower' },
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
          { type: 'text', text: 'like this' },
        ],
      },
    ]);
  });
});

describe('providers/anthropic: withConversationBreakpoint', () => {
  it('marks a trailing string-content user message by promoting it to one cache_control text block, touching nothing else', () => {
    const earlier: Anthropic.MessageParam = { role: 'assistant', content: [{ type: 'text', text: 'ok' }] };
    const messages: Anthropic.MessageParam[] = [earlier, { role: 'user', content: 'and now a bridge' }];

    const marked = withConversationBreakpoint(messages);

    expect(marked).toEqual([
      earlier,
      { role: 'user', content: [{ type: 'text', text: 'and now a bridge', cache_control: { type: 'ephemeral' } }] },
    ]);
    expect(marked[0]).toBe(earlier);
  });

  it('marks the LAST block of a trailing tool_result message, leaving its earlier blocks as the very objects they were', () => {
    const first = { type: 'tool_result' as const, tool_use_id: 'call_1', content: 'ok' };
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'go' },
      { role: 'user', content: [first, { type: 'tool_result', tool_use_id: 'call_2', content: 'also ok' }] },
    ];

    const marked = withConversationBreakpoint(messages);

    expect(marked).toEqual([
      { role: 'user', content: 'go' },
      {
        role: 'user',
        content: [first, { type: 'tool_result', tool_use_id: 'call_2', content: 'also ok', cache_control: { type: 'ephemeral' } }],
      },
    ]);
    const content = marked[1]?.content as Anthropic.ContentBlockParam[];
    expect(content[0]).toBe(first);
  });

  it('skips a trailing message whose last block cannot carry a breakpoint and marks the nearest earlier one, never mutating the input', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'thinking it over' }, { type: 'thinking', thinking: 'plan', signature: 'sig' }] },
    ];
    const before = structuredClone(messages);

    const marked = withConversationBreakpoint(messages);

    expect(marked[0]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok', cache_control: { type: 'ephemeral' } }],
    });
    expect(marked[1]).toBe(messages[1]);
    expect(messages).toEqual(before);
    expect(marked).not.toBe(messages);
  });

  it('returns the history untouched when nothing in it can carry a breakpoint', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'plan', signature: 'sig' }] },
    ];

    expect(withConversationBreakpoint(messages)).toBe(messages);
    expect(withConversationBreakpoint([])).toEqual([]);
  });
});

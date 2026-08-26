// @vitest-environment node
/** The Responses-dialect eval adapter, without a network: the conversation projection into the
 *  Responses item grammar, the tool schemas' flat shape, the SSE and one-body response mappings,
 *  call_id answering, the error/abort endings, and the wire-shim composition staying redacted.
 *  Every wire shape here is lifted from live probes of the agent-proxy's /openai/v1/responses. */
import { describe, expect, it } from 'vitest';
import {
  createResponsesAdapter, toResponsesBody, toResponsesInput,
} from '../../../agent/eval/responses-adapter';
import { parseLiveEnv, redactKey, wireFetch } from '../../../agent/eval/live-bench';
import type { ProviderMessage } from '../../../agent/core/project-messages';
import type { StreamEvent } from '../../../agent/core/types';
import type { AdapterRequest } from '../../../agent/providers/types';

const KEY = 'agp_0123456789abcdef0123';

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function req(over: Partial<AdapterRequest> = {}): AdapterRequest {
  return {
    system: 'Build maps.',
    messages: [{ role: 'user', text: 'Place a house.' }],
    tools: [{
      name: 'get_weather',
      description: 'Get the weather for a city.',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    }],
    model: 'gpt-5.5',
    sameModel: true,
    maxOutputTokens: 500,
    ...over,
  };
}

function sse(frames: Record<string, unknown>[]): Response {
  const body = frames.map((f) => `event: ${String(f.type)}\ndata: ${JSON.stringify(f)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const USAGE = {
  input_tokens: 69, output_tokens: 18, total_tokens: 87,
  input_tokens_details: { cached_tokens: 5, cache_write_tokens: 2 },
  output_tokens_details: { reasoning_tokens: 0 },
};

describe('toResponsesInput', () => {
  it('projects the three roles into the item grammar, answering calls by call_id', () => {
    const messages: ProviderMessage[] = [
      { role: 'user', text: 'Check Paris.', images: ['data:image/png;base64,AAAA'] },
      {
        role: 'assistant',
        text: 'Checking.',
        toolCalls: [{ callId: 'call_abc', name: 'get_weather', args: { city: 'Paris' } }],
        raw: [{ type: 'reasoning', id: 'rs_1' }],
      },
      {
        role: 'tool',
        results: [
          { callId: 'call_abc', name: 'get_weather', content: 'Sunny, 24C', isError: false, image: 'data:image/png;base64,BBBB' },
          { callId: 'call_def', name: 'get_weather', content: 'no such city', isError: true },
        ],
      },
    ];
    expect(toResponsesInput(messages)).toEqual([
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Check Paris.' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAAA' },
        ],
      },
      { role: 'assistant', content: [{ type: 'output_text', text: 'Checking.' }] },
      { type: 'function_call', call_id: 'call_abc', name: 'get_weather', arguments: '{"city":"Paris"}' },
      { type: 'function_call_output', call_id: 'call_abc', output: 'Sunny, 24C' },
      { type: 'function_call_output', call_id: 'call_def', output: 'Error: no such city' },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '(tool attachment: get_weather)' },
          { type: 'input_image', image_url: 'data:image/png;base64,BBBB' },
        ],
      },
    ]);
  });

  it('omits the message item for an assistant turn that only called', () => {
    const items = toResponsesInput([
      { role: 'assistant', text: '', toolCalls: [{ callId: 'c1', name: 'get_weather', args: {} }] },
    ]);
    expect(items).toEqual([{ type: 'function_call', call_id: 'c1', name: 'get_weather', arguments: '{}' }]);
  });
});

describe('toResponsesBody', () => {
  it('carries the system prompt as instructions and the tools flat', () => {
    const body = toResponsesBody(req(), true);
    expect(body.model).toBe('gpt-5.5');
    expect(body.instructions).toBe('Build maps.');
    expect(body.max_output_tokens).toBe(500);
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual([{
      type: 'function',
      name: 'get_weather',
      description: 'Get the weather for a city.',
      parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    }]);
  });

  it('omits tools when none are offered and stream when not asked', () => {
    const body = toResponsesBody(req({ tools: [], maxOutputTokens: undefined }), false);
    expect('tools' in body).toBe(false);
    expect('stream' in body).toBe(false);
    expect('max_output_tokens' in body).toBe(false);
  });
});

describe('streamed turns', () => {
  it('maps a streamed function call: tool-start at the added item, args from the deltas, finals from the snapshot', async () => {
    const fc = {
      type: 'function_call', id: 'item_0', call_id: 'call_vqEIxQ', name: 'get_weather',
      arguments: '{"city":"Paris"}', status: 'completed',
    };
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => sse([
        { type: 'response.created', response: { status: 'in_progress', output: [] } },
        { type: 'response.output_item.added', output_index: 0, item: { ...fc, arguments: '', status: 'in_progress' } },
        { type: 'response.function_call_arguments.delta', item_id: 'item_0', delta: '{"city' },
        { type: 'response.function_call_arguments.delta', item_id: 'item_0', delta: '":"Paris"}' },
        { type: 'response.function_call_arguments.done', item_id: 'item_0', arguments: '{"city":"Paris"}' },
        { type: 'response.output_item.done', output_index: 0, item: fc },
        { type: 'response.completed', response: { status: 'completed', output: [fc], usage: USAGE } },
      ]),
    });
    const events = await collect(adapter.stream(req(), new AbortController().signal));
    expect(events).toEqual([
      { t: 'tool-start', callId: 'call_vqEIxQ', name: 'get_weather' },
      { t: 'tool-args', callId: 'call_vqEIxQ', delta: '{"city' },
      { t: 'tool-args', callId: 'call_vqEIxQ', delta: '":"Paris"}' },
      {
        t: 'done',
        stop: 'tool-calls',
        final: [{ callId: 'call_vqEIxQ', name: 'get_weather', args: { city: 'Paris' }, rawArgs: '{"city":"Paris"}' }],
        usage: { input: 69, output: 18, cacheRead: 5, cacheWrite: 2 },
      },
    ]);
  });

  it('streams text deltas, drops an empty reasoning summary, and ends on the snapshot', async () => {
    const message = {
      type: 'message', id: 'item_1', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: 'Hello there, friend.' }], phase: 'final_answer',
    };
    const reasoning = { type: 'reasoning', id: 'rs_0b6b', summary: [{ type: 'summary_text', text: '' }], encrypted_content: 'agp_reasoning_v1:opaque' };
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => sse([
        { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_0b6b', summary: [], status: 'in_progress' } },
        { type: 'response.reasoning_summary_text.delta', item_id: 'rs_0b6b', delta: '' },
        { type: 'response.output_item.done', output_index: 0, item: reasoning },
        { type: 'response.output_text.delta', item_id: 'item_1', delta: 'Hello there,' },
        { type: 'response.output_text.delta', item_id: 'item_1', delta: ' friend.' },
        { type: 'response.completed', response: { status: 'completed', output: [reasoning, message], usage: USAGE } },
      ]),
    });
    const events = await collect(adapter.stream(req({ tools: [] }), new AbortController().signal));
    expect(events).toEqual([
      { t: 'text', delta: 'Hello there,' },
      { t: 'text', delta: ' friend.' },
      { t: 'done', stop: 'stop', usage: { input: 69, output: 18, cacheRead: 5, cacheWrite: 2 } },
    ]);
  });

  it('narrates a reasoning summary where the gateway sends words', async () => {
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => sse([
        { type: 'response.reasoning_summary_text.delta', item_id: 'rs_1', delta: 'Weighing the layout.' },
        { type: 'response.completed', response: { status: 'completed', output: [], usage: USAGE } },
      ]),
    });
    const events = await collect(adapter.stream(req(), new AbortController().signal));
    expect(events[0]).toEqual({ t: 'reasoning', delta: 'Weighing the layout.' });
  });

  it('reads an incomplete snapshot cut at max_output_tokens as a length stop', async () => {
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => sse([
        { type: 'response.output_text.delta', item_id: 'item_0', delta: 'Rivers flow' },
        {
          type: 'response.incomplete',
          response: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: USAGE },
        },
      ]),
    });
    const events = await collect(adapter.stream(req(), new AbortController().signal));
    expect(events[events.length - 1]).toMatchObject({ t: 'done', stop: 'length' });
  });

  it('reports a stream that ends without a terminal snapshot as provider silence, retryable', async () => {
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => sse([{ type: 'response.created', response: { status: 'in_progress', output: [] } }]),
    });
    const events = await collect(adapter.stream(req(), new AbortController().signal));
    expect(events).toEqual([
      { t: 'error', error: { cls: 'overloaded', detail: 'The provider sent no response body.', retryAfterMs: undefined, status: undefined } },
    ]);
  });
});

describe('one-body answers', () => {
  it('reads a JSON 200 as the completed response, dropping the gemini seat\'s empty message pad', async () => {
    // Verbatim shape of the gemini_3_1_pro probe: function_call plus an empty-text message item,
    // reasoning tokens counted but no reasoning item, input_tokens reported 0.
    const body = {
      id: 'resp_01a03a12', object: 'response', status: 'completed',
      output: [
        { type: 'function_call', id: 'item_0', call_id: 'call_1805622', name: 'get_weather', arguments: '{"city":"Paris"}', status: 'completed' },
        { type: 'message', id: 'item_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '' }] },
      ],
      usage: {
        input_tokens: 0, output_tokens: 125, total_tokens: 125,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 109 },
      },
      model: 'gemini_3_1_pro',
    };
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const events = await collect(adapter.stream(req({ model: 'gemini_3_1_pro' }), new AbortController().signal));
    expect(events).toEqual([
      { t: 'tool-start', callId: 'call_1805622', name: 'get_weather' },
      { t: 'tool-args', callId: 'call_1805622', delta: '{"city":"Paris"}' },
      {
        t: 'done',
        stop: 'tool-calls',
        final: [{ callId: 'call_1805622', name: 'get_weather', args: { city: 'Paris' }, rawArgs: '{"city":"Paris"}' }],
        usage: { input: 0, output: 125, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
  });
});

describe('failures', () => {
  it('classifies the gateway 401 as an auth incident', async () => {
    const adapter = createResponsesAdapter({
      apiKey: 'expired',
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => new Response(
        JSON.stringify({ error: { message: 'invalid or expired session token', type: 'authentication_error', code: null } }),
        { status: 401 },
      ),
    });
    const events = await collect(adapter.stream(req(), new AbortController().signal));
    expect(events).toEqual([
      { t: 'error', error: { cls: 'auth', detail: 'invalid or expired session token', retryAfterMs: undefined, status: 401 } },
    ]);
  });

  it('classifies the unknown-model 400 as a model fault', async () => {
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => new Response(
        JSON.stringify({ error: { message: 'unknown model_id: "no_such_model". Check the model ID matches a configured model', type: 'invalid_request_error' } }),
        { status: 400 },
      ),
    });
    const events = await collect(adapter.stream(req(), new AbortController().signal));
    expect(events[0]).toMatchObject({ t: 'error', error: { cls: 'model', status: 400 } });
  });

  it('ends an aborted turn as done aborted, never a rejection', async () => {
    const controller = new AbortController();
    controller.abort();
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => { throw new DOMException('The operation was aborted.', 'AbortError'); },
    });
    const events = await collect(adapter.stream(req(), controller.signal));
    expect(events).toEqual([{ t: 'done', stop: 'aborted' }]);
  });

  it('throws from listModels naming the status, since the agent-proxy serves no catalog', async () => {
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai',
      fetch: async () => new Response('not found', { status: 404 }),
    });
    await expect(adapter.listModels(new AbortController().signal)).rejects.toThrow(/models list failed \(404\)/);
  });
});

describe('the wire shim composition', () => {
  it('sends Bearer auth to <base>/v1/responses and the wire log keeps no key', async () => {
    const lines: string[] = [];
    let captured: { url: string; init?: RequestInit } | undefined;
    const fake: typeof fetch = async (url, init) => {
      captured = { url: String(url), ...(init !== undefined ? { init } : {}) };
      return sse([{ type: 'response.completed', response: { status: 'completed', output: [], usage: USAGE } }]);
    };
    const adapter = createResponsesAdapter({
      apiKey: KEY,
      baseUrl: 'https://proxy.example/openai/',
      fetch: wireFetch(fake, { redact: (s) => redactKey(s, KEY), sink: (l) => lines.push(l) }),
    });
    await collect(adapter.stream(req(), new AbortController().signal));
    await new Promise((r) => setTimeout(r, 10));

    expect(captured?.url).toBe('https://proxy.example/openai/v1/responses');
    const sent = new Headers(captured?.init?.headers);
    expect(sent.get('Authorization')).toBe(`Bearer ${KEY}`);
    const parsed = JSON.parse(String(captured?.init?.body)) as Record<string, unknown>;
    expect(parsed.instructions).toBe('Build maps.');
    expect(parsed.stream).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(KEY);
  });
});

describe('parseLiveEnv, this dialect', () => {
  it('accepts responses and still refuses an unknown dialect', () => {
    const FULL = { AGENT_LIVE_BASE_URL: 'https://proxy.example/openai', AGENT_LIVE_KEY: 'none', AGENT_LIVE_MODEL: 'gpt-5.5' };
    expect(parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'responses' }).dialect).toBe('responses');
    expect(() => parseLiveEnv({ ...FULL, AGENT_LIVE_DIALECT: 'grpc' })).toThrow(/"openai", "anthropic" or "responses"/);
  });
});

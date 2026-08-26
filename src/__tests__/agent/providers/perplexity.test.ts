/**
 * PERPLEXITY'S ROUTER, through the OpenAI-dialect adapter it is a drop-in for.
 *
 * The Router speaks the OpenAI Chat Completions schema at `https://api.perplexity.ai/router/v1`, so
 * the provider is an entry in the registry rather than an adapter of its own, and this file is what
 * says so: the entry's own facts, the key shape the setup row reads, the catalog that doubles as the
 * allowlist, the usage object's spelling, and what each documented status means to the ladder.
 *
 * Every payload here is copied from the published reference (the chat-completions and models
 * schemas), including the invalid-model message and the usage object's `prompt_tokens_details`.
 */
import { describe, expect, it, vi } from 'vitest';

import { isRetryable } from '../../../agent/core/errors';
import type { StreamEvent } from '../../../agent/core/types';
import { baseUrlFor, PROVIDER_META, PROVIDER_IDS, QUIRKS } from '../../../agent/providers/defaults';
import { AMBIGUOUS_CANDIDATES, detectProviderFromKey } from '../../../agent/providers/detect';
import type { AdapterRequest } from '../../../agent/providers/types';
import { providerDisclosureList } from '../../../legal/providers-list';
import { PROVIDER_ROSTER, readKeyShape } from '../../../ui/agent/setup-parts';

const { createMock, ctorMock, listMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
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

import { createOpenAIAdapter } from '../../../agent/providers/openai';

/** A catalog slug, used wherever the model itself is beside the point. */
const MODEL = 'perplexity/kimi-k3';

function fakeChunkStream(chunks: unknown[]): { [Symbol.asyncIterator]: () => AsyncGenerator<unknown> } {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

function request(): AdapterRequest {
  return {
    system: 'You are an agent.',
    messages: [{ role: 'user', text: 'Explain the CAP theorem in two sentences.' }],
    tools: [{ name: 'place_object', description: 'Places an object', parameters: { type: 'object', properties: {} } }],
    model: MODEL,
    sameModel: true,
  };
}

function perplexityAdapter() {
  return createOpenAIAdapter({
    apiKey: 'pplx-1234567890abcdef',
    baseUrl: baseUrlFor('perplexity', {}),
    quirks: QUIRKS.perplexity,
  });
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** The event a failed turn ends on, as the panel would read it. */
async function failureOf(thrown: unknown) {
  createMock.mockRejectedValueOnce(thrown);
  const events = await collect(perplexityAdapter().stream(request(), new AbortController().signal));
  const last = events[events.length - 1];
  if (last?.t !== 'error') throw new Error(`expected an error event, got ${last?.t}`);
  return last.error;
}

describe('providers/perplexity: the registry entry', () => {
  it('stands in the roster as its own platform', () => {
    expect(PROVIDER_IDS).toContain('perplexity');
    // Both connection screens build their chooser from this list, so the entry is the whole of what
    // makes the platform selectable.
    expect(PROVIDER_ROSTER).toContain('perplexity');
    expect(PROVIDER_META.perplexity.id).toBe('perplexity');
    expect(PROVIDER_META.perplexity.name).toBe('Perplexity');
    expect(PROVIDER_META.perplexity.keyUrl).toBe('https://console.perplexity.ai/project/keys');
    expect(PROVIDER_META.perplexity.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('resolves the Router base URL the OpenAI SDK is configured with', () => {
    // The Anthropic-schema twin of this endpoint lives at `https://api.perplexity.ai/router`
    // (that SDK appends `/v1/messages` itself); the OpenAI SDK appends `/chat/completions`.
    expect(baseUrlFor('perplexity', {})).toBe('https://api.perplexity.ai/router/v1');
    // One host: the Router is not a region-split platform, so region 1 resolves to the same URL.
    expect(baseUrlFor('perplexity', { region: 1 })).toBe('https://api.perplexity.ai/router/v1');
  });

  it('speaks the OpenAI dialect, asks for streamed usage, and reads reasoning where the Router puts it', () => {
    expect(QUIRKS.perplexity.dialect).toBe('openai');
    expect(QUIRKS.perplexity.streamUsage).toBe(true);
    // The Router honours `stream_options.include_usage`, and both assistant messages and streamed
    // deltas can carry `reasoning_content`. It declares no second spelling.
    expect(QUIRKS.perplexity.reasoningFields).toEqual(['reasoning_content']);
    expect(QUIRKS.perplexity.imageInToolResult).toBe(false);
  });

  it('is disclosed by name in the privacy policy', () => {
    expect(providerDisclosureList('en')).toContain('Perplexity');
    expect(providerDisclosureList('zh')).toContain('Perplexity');
  });
});

describe('providers/perplexity: the key shape', () => {
  it('names the provider from the key prefix, with no probe', () => {
    expect(detectProviderFromKey('pplx-1234567890abcdef')).toBe('perplexity');
    expect(readKeyShape('pplx-1234567890abcdef')).toBe('perplexity');
  });

  it('is never a probe candidate: the prefix is distinct', () => {
    expect(AMBIGUOUS_CANDIDATES).not.toContain('perplexity');
  });

  it('leaves a bare sk- key to the probe', () => {
    expect(detectProviderFromKey(`sk-${'a'.repeat(32)}`)).toBeNull();
  });
});

describe('providers/perplexity: the wire', () => {
  it('sends the request to the Router with usage asked for', async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: 'The CAP theorem' }, finish_reason: 'stop' }] },
    ]));

    const events = await collect(perplexityAdapter().stream(request(), new AbortController().signal));

    expect(ctorMock).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://api.perplexity.ai/router/v1' }));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: MODEL, stream: true, stream_options: { include_usage: true } }),
      expect.anything(),
    );
    expect(events).toEqual([
      { t: 'text', delta: 'The CAP theorem' },
      { t: 'done', stop: 'stop', final: [] },
    ]);
  });

  it('maps the usage object, cached input included', async () => {
    createMock.mockResolvedValueOnce(fakeChunkStream([
      { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }] },
      // `include_usage` delivers usage on a trailing chunk whose `choices` array is empty.
      {
        choices: [],
        usage: {
          prompt_tokens: 18,
          completion_tokens: 52,
          total_tokens: 70,
          prompt_tokens_details: { cached_tokens: 12 },
        },
      },
    ]));

    const events = await collect(perplexityAdapter().stream(request(), new AbortController().signal));

    expect(events[events.length - 1]).toEqual({
      t: 'done', stop: 'stop', final: [], usage: { input: 18, output: 52, cacheRead: 12 },
    });
  });

  it('reads the catalog off /models, which is also the allowlist', async () => {
    listMock.mockReturnValueOnce(fakeChunkStream([
      { id: 'perplexity/deepseek-v4-flash-0731', object: 'model', created: 0, owned_by: 'perplexity' },
      { id: 'perplexity/glm-5.2', object: 'model', created: 0, owned_by: 'perplexity' },
      { id: 'perplexity/kimi-k3', object: 'model', created: 0, owned_by: 'perplexity' },
    ]));

    await expect(perplexityAdapter().listModels(new AbortController().signal)).resolves.toEqual([
      'perplexity/deepseek-v4-flash-0731',
      'perplexity/glm-5.2',
      'perplexity/kimi-k3',
    ]);
  });
});

describe('providers/perplexity: what a refusal means', () => {
  it('leaves a model outside the catalog unretried, with the endpoint\'s own sentence', async () => {
    const error = await failureOf({
      status: 400,
      message: "Invalid model 'example/does-not-exist'. Permitted models can be found in the "
        + 'documentation at https://docs.perplexity.ai/docs/getting-started/models.',
    });

    // Nothing about the request would differ on a second attempt, and the message names the model,
    // so the incident notice carries what to change.
    expect(isRetryable(error.cls)).toBe(false);
    expect(error.status).toBe(400);
    expect(error.detail).toContain("Invalid model 'example/does-not-exist'");
  });

  it('waits out a rate limit for as long as the response asked', async () => {
    const error = await failureOf({
      status: 429,
      message: 'Rate limit exceeded.',
      headers: { 'retry-after': '30' },
    });

    expect(error.cls).toBe('rate-limit');
    expect(error.retryAfterMs).toBe(30_000);
    expect(isRetryable(error.cls)).toBe(true);
  });

  it('reads a payment refusal as the wallet class', async () => {
    // The Router's reference documents 400, 429 and 5xx; 402 is the platform-wide payment status,
    // and the wallet banner is the face that offers a change of provider.
    expect((await failureOf({ status: 402, message: 'Payment required.' })).cls).toBe('quota');
  });

  it('retries a routing failure: every deployment being down is not the request\'s fault', async () => {
    const error = await failureOf({ status: 503, message: 'Service unavailable.' });
    expect(error.cls).toBe('overloaded');
    expect(isRetryable(error.cls)).toBe(true);
  });

  it('reads a refused key as a credential fault', async () => {
    expect((await failureOf({ status: 401, message: 'Unauthorized.' })).cls).toBe('auth');
  });
});

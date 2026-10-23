import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEPLOY_TARGETS } from '../../../platform/build/deploy-targets';
import { assistantModels, ensureModelCatalog, modelCapabilities, MODEL_CATALOG_URL, parseModelCatalog, rememberNativeModels, __resetModelCatalog, suggestedModels } from '../../../agent/providers/model-catalog';
import { reasoningBody, thinkingChoices } from '../../../agent/providers/reasoning';
import { PROVIDER_IDS, QUIRKS, type ProviderId } from '../../../agent/providers/defaults';
import { buildAdapter } from '../../../agent/providers/connect';
import type { AdapterRequest, ThinkingChoice } from '../../../agent/core/adapter';
import type { StreamEvent } from '../../../agent/core/types';
import snapshot from '../../../agent/providers/model-catalog.snapshot.json';

/** The request bodies the SDKs were handed, newest last. */
const { sent } = vi.hoisted(() => ({ sent: [] as Record<string, unknown>[] }));

/** Both SDKs, reduced to keeping the body each request carried and answering with a turn that ends at once. */
vi.mock('openai', () => {
  const ended = { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }) };
  const keep = async (body: Record<string, unknown>) => { sent.push(body); return ended; };
  class MockOpenAI {
    chat = { completions: { create: keep } };
    responses = { create: keep };
  }
  return { default: MockOpenAI };
});
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      stream: (body: Record<string, unknown>) => {
        sent.push(body);
        return {
          [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
          finalMessage: async () => ({ content: [], stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }),
        };
      },
    };
  }
  return { default: MockAnthropic };
});

/** The body `id`'s adapter sends for one turn of a reasoning model at `thinking`. */
async function bodySent(id: ProviderId, thinking: ThinkingChoice): Promise<Record<string, unknown>> {
  sent.length = 0;
  const adapter = buildAdapter({ providerId: id, apiKey: 'sk-test', customBaseUrl: 'https://gateway.example/v1' });
  const request: AdapterRequest = {
    system: 'You plan maps.', messages: [], tools: [], model: 'model-x', sameModel: true,
    capabilities: { reasoning: true }, thinking,
  };
  const events: StreamEvent[] = [];
  for await (const event of adapter.stream(request, new AbortController().signal)) events.push(event);
  expect(sent, `${id} sent one request`).toHaveLength(1);
  return sent[0]!;
}

/** Each platform's own request field for a high effort, as its API reference spells it. */
const EFFORT_WIRE: Record<ProviderId, Record<string, unknown>> = {
  claude: { output_config: { effort: 'high' } },
  openai: { reasoning: { effort: 'high' } },
  deepseek: { reasoning_effort: 'high', thinking: { type: 'enabled' } },
  gemini: { reasoning_effort: 'high', extra_body: { google: { thinking_config: { include_thoughts: true } } } },
  openrouter: { reasoning: { effort: 'high' } },
  zhipu: { reasoning_effort: 'high', thinking: { type: 'enabled' } },
  qwen: { enable_thinking: true, reasoning_effort: 'high' },
  moonshot: { reasoning_effort: 'high', thinking: { type: 'enabled' } },
  doubao: { reasoning_effort: 'high', thinking: { type: 'enabled' } },
  perplexity: { reasoning_effort: 'high' },
  custom: { reasoning_effort: 'high' },
};

/** And for a token budget, on the platforms whose API takes one. */
const BUDGET_WIRE: Partial<Record<ProviderId, Record<string, unknown>>> = {
  claude: { thinking: { type: 'enabled', budget_tokens: 4096 } },
  gemini: { extra_body: { google: { thinking_config: { include_thoughts: true, thinking_budget: 4096 } } } },
  openrouter: { reasoning: { max_tokens: 4096 } },
  qwen: { enable_thinking: true, thinking_budget: 4096 },
};

const data = {
  openai: { models: {
    'gpt-6-astra': { reasoning: true, tool_call: true, modalities: { input: ['text', 'image'], output: ['text'] }, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
    'gpt-5-pro': { tool_call: true, modalities: { input: ['text'], output: ['text'] } },
    'gpt-5-codex': { tool_call: true, modalities: { input: ['text'], output: ['text'] } },
    'gpt-image-1': { tool_call: false, modalities: { output: ['image'] } },
  } },
  volcengine: { models: { 'doubao-current': { tool_call: true, modalities: { input: ['text'], output: ['text'] } } } },
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); __resetModelCatalog(); });

async function load(body: unknown = data) {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => body });
  vi.stubGlobal('fetch', fetcher);
  await ensureModelCatalog(true);
  return fetcher;
}

describe('live model discovery', () => {
  it('retains Astra, Pro, coding and newly listed models while removing media and embedding endpoints', async () => {
    await load();
    const ids = ['text-embedding-ada-002', 'whisper-1', 'gpt-image-1', 'gpt-6-astra', 'gpt-5-pro', 'gpt-5-codex', 'gpt-4.1-mini', 'gpt-new', 'tts-1'];
    expect(assistantModels('openai', ids)).toEqual(['gpt-4.1-mini', 'gpt-6-astra', 'gpt-5-pro', 'gpt-5-codex', 'gpt-new']);
    expect(assistantModels('openai', ['gpt-new'])).not.toContain('gpt-6-astra');
  });

  it('uses account metadata over public metadata and isolates custom endpoints', async () => {
    await load();
    rememberNativeModels('openai', [{ id: 'gpt-6-astra', supported_parameters: ['temperature'] }]);
    expect(assistantModels('openai', ['gpt-6-astra'])).toEqual([]);
    rememberNativeModels('custom', [{ id: 'private', supported_parameters: ['tools'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } }], 'https://one.example/v1');
    expect(modelCapabilities('custom', 'private', 'https://one.example/v1')?.tools).toBe(true);
    expect(modelCapabilities('custom', 'private', 'https://two.example/v1')).toBeUndefined();
  });

  it('keys a built-in provider\'s native list on the provider alone, whatever URL a reader passes', () => {
    rememberNativeModels('openai', [{ id: 'my-model', context_length: 999 }], undefined);
    expect(modelCapabilities('openai', 'my-model')?.context).toBe(999);
    expect(modelCapabilities('openai', 'my-model', 'https://my.gateway/v1')?.context).toBe(999);
    expect(modelCapabilities('openai', 'my-model', 'https://api.openai.com/v1')?.context).toBe(999);
  });

  it('fetches without credentials, coalesces refreshes and lets one success serve the whole session', async () => {
    vi.useFakeTimers();
    const fetcher = await load();
    await Promise.all([ensureModelCatalog(), ensureModelCatalog()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(MODEL_CATALOG_URL, expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('headers');
    vi.advanceTimersByTime(60 * 60_000);
    await Promise.all([ensureModelCatalog(), ensureModelCatalog()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await ensureModelCatalog(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good data during a failed or malformed refresh', async () => {
    const fetcher = await load();
    fetcher.mockRejectedValueOnce(new Error('offline'));
    await ensureModelCatalog(true);
    expect(modelCapabilities('openai', 'gpt-6-astra')?.efforts).toEqual(['low', 'high', 'max']);
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'bad' }) });
    await ensureModelCatalog(true);
    expect(suggestedModels('doubao')).toEqual(['doubao-current']);
  });

  it('accepts capability data without adopting remote request bodies or endpoint URLs', () => {
    const parsed = parseModelCatalog({ openai: { api: 'https://wrong.example', models: { latest: { tool_call: true, provider: { body: { store: true } }, reasoning_options: [{ type: 'effort', values: ['high', {}, 'invalid value'] }] } } } });
    expect(parsed.openai?.latest).toEqual({ tools: true, efforts: ['high'] });
  });

  it('uses the Ark catalog for custom Ark URLs but never guesses the source of arbitrary endpoints', async () => {
    await load();
    expect(suggestedModels('custom', 'https://ark.cn-beijing.volces.com/api/v3')).toEqual(['doubao-current']);
    expect(suggestedModels('custom', 'https://unrelated.example')).toEqual([]);
  });

  it('keeps unknown gateway and fine-tuned models without inventing capabilities', () => {
    expect(assistantModels('custom', ['my-model', 'llama-instruct', 'my-model'])).toEqual(['my-model', 'llama-instruct']);
    expect(assistantModels('openai', ['ft:gpt-4.1:org:name'])).toEqual(['ft:gpt-4.1:org:name']);
  });
});

describe('thinking controls', () => {
  it('uses the exact current levels, without inventing medium or maximum support', () => {
    const choices = thinkingChoices({ reasoning: true, efforts: ['high', 'max'] }, 'deepseek');
    expect(choices).toEqual([{ effort: 'high' }, { effort: 'max' }]);
    expect(thinkingChoices(undefined, 'openai')).toEqual([]);
  });
  it('bounds budget controls by the provider limits and keeps them separate from effort', () => {
    const caps = { reasoning: true, budget: { min: 1024, max: 8192 }, maxOutput: 5000 };
    expect(thinkingChoices(caps, 'claude')).toEqual([{ budget: 1024 }, { budget: 4096 }, { budget: 4999 }]);
    expect(reasoningBody(QUIRKS.qwen.thinkingWire, { budget: 4096 })).toEqual({ enable_thinking: true, thinking_budget: 4096 });
    expect(reasoningBody(QUIRKS.claude.thinkingWire, { effort: 'high' })).toEqual({ output_config: { effort: 'high' } });
  });
  it('sends a chosen effort in each platform\'s own request field', async () => {
    for (const id of PROVIDER_IDS) expect(await bodySent(id, { effort: 'high' }), id).toMatchObject(EFFORT_WIRE[id]);
  });
  it('offers a token budget only where the platform takes one, and sends it in that platform\'s field', async () => {
    const caps = { reasoning: true, budget: { min: 1024, max: 8192 } };
    const offering = PROVIDER_IDS.filter((id) => thinkingChoices(caps, id).length > 0);
    expect(new Set(offering)).toEqual(new Set(Object.keys(BUDGET_WIRE)));
    for (const id of offering) {
      expect(thinkingChoices(caps, id), id).toContainEqual({ budget: 4096 });
      expect(await bodySent(id, { budget: 4096 }), id).toMatchObject(BUDGET_WIRE[id]!);
    }
  });
  it('writes native Gemini, OpenRouter and DeepSeek request fields', () => {
    expect(reasoningBody(QUIRKS.gemini.thinkingWire, { effort: 'low' }, { reasoning: true })).toEqual({ reasoning_effort: 'low', extra_body: { google: { thinking_config: { include_thoughts: true } } } });
    expect(reasoningBody(QUIRKS.openrouter.thinkingWire, { effort: 'high' })).toEqual({ reasoning: { effort: 'high' } });
    expect(reasoningBody(QUIRKS.deepseek.thinkingWire, { effort: 'max' })).toEqual({ reasoning_effort: 'max', thinking: { type: 'enabled' } });
    expect(reasoningBody(QUIRKS.doubao.thinkingWire, { effort: 'none' })).toEqual({ thinking: { type: 'disabled' } });
  });
});

describe('bundled capability extract', () => {
  /** A download that only ends when its signal aborts, as a stalled cross-border transfer does. */
  function stalledFetch() {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      signal = init.signal;
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetcher);
    return { fetcher, aborted: () => signal?.aborted ?? false };
  }

  it('answers DeepSeek effort levels before any refresh and again after a reset', () => {
    expect(snapshot.takenAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const model of ['deepseek-flash', 'deepseek-v4-pro']) {
      const levels = thinkingChoices(modelCapabilities('deepseek', model), 'deepseek').map((choice) => choice.effort);
      expect(levels, model).toContain('high');
    }
    __resetModelCatalog();
    expect(thinkingChoices(modelCapabilities('deepseek', 'deepseek-flash'), 'deepseek').length).toBeGreaterThan(0);
  });

  it('keeps the extract for providers a live refresh does not mention', async () => {
    await load();
    expect(modelCapabilities('openai', 'gpt-6-astra')?.efforts).toEqual(['low', 'high', 'max']);
    expect(modelCapabilities('deepseek', 'deepseek-flash')?.reasoning).toBe(true);
  });

  it('retries a failed download after thirty seconds, and gives up for the session after three failures', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    await ensureModelCatalog(true);
    await ensureModelCatalog();
    expect(fetcher).toHaveBeenCalledTimes(1);
    for (const calls of [2, 3, 3, 3]) {
      vi.advanceTimersByTime(30_001);
      await ensureModelCatalog();
      expect(fetcher).toHaveBeenCalledTimes(calls);
    }
    await ensureModelCatalog(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('never downloads the live catalog on a deployment that cannot reach it, where the extract is the source', async () => {
    vi.stubGlobal('__PETIT_TARGET__', DEPLOY_TARGETS.cn.id);
    expect(DEPLOY_TARGETS.cn.liveModelCatalog).toBe(false);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await ensureModelCatalog(true);
    expect(fetcher).not.toHaveBeenCalled();
    expect(modelCapabilities('deepseek', 'deepseek-flash')?.reasoning).toBe(true);
  });

  it('gives the download twenty seconds before abandoning it', async () => {
    vi.useFakeTimers();
    const { aborted } = stalledFetch();
    const refresh = ensureModelCatalog(true);
    vi.advanceTimersByTime(19_000);
    expect(aborted()).toBe(false);
    vi.advanceTimersByTime(1_001);
    expect(aborted()).toBe(true);
    await refresh;
    expect(modelCapabilities('deepseek', 'deepseek-flash')?.reasoning).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { assistantModels, ensureModelCatalog, modelCapabilities, MODEL_CATALOG_URL, parseModelCatalog, rememberNativeModels, resetModelCatalog, suggestedModels } from '../../../agent/providers/model-catalog';
import { reasoningBody, thinkingChoices } from '../../../agent/providers/reasoning';

const data = {
  openai: { models: {
    'gpt-6-astra': { reasoning: true, tool_call: true, modalities: { input: ['text', 'image'], output: ['text'] }, reasoning_options: [{ type: 'effort', values: ['low', 'high', 'max'] }] },
    'gpt-5-pro': { tool_call: true, modalities: { input: ['text'], output: ['text'] } },
    'gpt-5-codex': { tool_call: true, modalities: { input: ['text'], output: ['text'] } },
    'gpt-image-1': { tool_call: false, modalities: { output: ['image'] } },
  } },
  volcengine: { models: { 'doubao-current': { tool_call: true, modalities: { input: ['text'], output: ['text'] } } } },
};
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); resetModelCatalog(); });

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

  it('fetches without credentials, coalesces refreshes and expires after five minutes', async () => {
    vi.useFakeTimers();
    const fetcher = await load();
    await Promise.all([ensureModelCatalog(), ensureModelCatalog()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(MODEL_CATALOG_URL, expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' }));
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('headers');
    vi.advanceTimersByTime(300001);
    await Promise.all([ensureModelCatalog(), ensureModelCatalog()]);
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
    expect(reasoningBody('qwen', { budget: 4096 })).toEqual({ enable_thinking: true, thinking_budget: 4096 });
    expect(reasoningBody('claude', { effort: 'high' })).toEqual({ output_config: { effort: 'high' } });
  });
  it('writes native Gemini, OpenRouter and DeepSeek request fields', () => {
    expect(reasoningBody('gemini', { effort: 'low' }, { reasoning: true })).toEqual({ reasoning_effort: 'low', extra_body: { google: { thinking_config: { include_thoughts: true } } } });
    expect(reasoningBody('openrouter', { effort: 'high' })).toEqual({ reasoning: { effort: 'high' } });
    expect(reasoningBody('deepseek', { effort: 'max' })).toEqual({ reasoning_effort: 'max', thinking: { type: 'enabled' } });
    expect(reasoningBody('doubao', { effort: 'none' })).toEqual({ thinking: { type: 'disabled' } });
  });
});

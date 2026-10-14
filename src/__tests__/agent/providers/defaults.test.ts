import { describe, expect, it } from 'vitest';
import {
  OPENAI_BASE_URL, PROVIDER_IDS, PROVIDER_META, QUIRKS, baseUrlFor, isRegionSplit, providerForEndpoint,
} from '../../../agent/providers/defaults';

describe('providers/defaults', () => {
  it('carries meta and quirks for every declared provider id', () => {
    expect(PROVIDER_IDS.length).toBeGreaterThan(0);
    for (const id of PROVIDER_IDS) {
      const meta = PROVIDER_META[id];
      const quirks = QUIRKS[id];
      expect(meta).toBeDefined();
      expect(quirks).toBeDefined();
      expect(meta.id).toBe(id);
      expect(typeof meta.name).toBe('string');
      expect(meta.name.length).toBeGreaterThan(0);
      expect(typeof meta.keyUrl).toBe('string');
      expect(typeof meta.accent).toBe('string');
      expect(typeof quirks.vision.guess).toBe('function');
    }
  });

  it('resolves deepseek to the legacy single base URL', () => {
    expect(baseUrlFor('deepseek', {})).toBe('https://api.deepseek.com');
  });

  it('leaves custom undefined without a configured endpoint, and echoes one back', () => {
    expect(baseUrlFor('custom', {})).toBeUndefined();
    expect(baseUrlFor('custom', { customBaseUrl: 'https://my-gateway.example/v1' })).toBe(
      'https://my-gateway.example/v1',
    );
  });

  it('picks the cn host for qwen when region 1 is requested', () => {
    expect(baseUrlFor('qwen', { region: 1 })).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
    // region 0 / omitted resolves to the global deployment
    expect(baseUrlFor('qwen', {})).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
    expect(baseUrlFor('qwen', { region: 0 })).toBe('https://dashscope-intl.aliyuncs.com/compatible-mode/v1');
  });

  it('names a host for every built-in provider, so no SDK falls back to a default of its own', () => {
    expect(baseUrlFor('claude', {})).toBe('https://api.anthropic.com');
    expect(baseUrlFor('openai', {})).toBe('https://api.openai.com/v1');
    for (const id of PROVIDER_IDS) if (id !== 'custom') expect(baseUrlFor(id, {}), id).toMatch(/^https:\/\//);
  });

  it('gives claude the anthropic dialect with images allowed inside a tool result', () => {
    expect(QUIRKS.claude.dialect).toBe('anthropic');
    expect(QUIRKS.claude.imageInToolResult).toBe(true);
  });

  it('declares the reasoning field ORDER each provider is worth trying in, and none for the two that never split reasoning out', () => {
    expect(QUIRKS.deepseek.dialect).toBe('openai');
    // A provider id serves arbitrary models, so both spellings are tried; the order is which one
    // that platform's own docs name first.
    for (const id of ['deepseek', 'zhipu', 'qwen', 'moonshot', 'custom'] as const) {
      expect(QUIRKS[id].reasoningFields).toEqual(['reasoning_content', 'reasoning']);
    }
    expect(QUIRKS.openrouter.reasoningFields).toEqual(['reasoning', 'reasoning_content']);
    expect(QUIRKS.gemini.reasoningFields).toEqual(['reasoning_content']);
    expect(QUIRKS.openai.reasoningFields).toBeUndefined();
    expect(QUIRKS.claude.reasoningFields).toBeUndefined();
  });

  it('carries no singular reasoningField any more: the parse tries a LIST', () => {
    for (const id of PROVIDER_IDS) {
      expect('reasoningField' in QUIRKS[id]).toBe(false);
    }
  });

  it('asks for streamed usage on every OpenAI-dialect provider except custom', () => {
    for (const id of PROVIDER_IDS) {
      if (QUIRKS[id].dialect !== 'openai') continue;
      expect(QUIRKS[id].streamUsage).toBe(id !== 'custom' ? true : undefined);
    }
  });

  it('carries no mayOmitToolIds quirk: id synthesis is unconditional, so there is nothing for a per-provider flag to gate', () => {
    for (const id of PROVIDER_IDS) {
      expect('mayOmitToolIds' in QUIRKS[id]).toBe(false);
    }
  });

  it('reaches OpenAI at its own API host', () => {
    expect(QUIRKS.openai.baseUrls).toEqual([OPENAI_BASE_URL]);
  });

  it('never allows an image inside a tool result on any OpenAI-dialect provider', () => {
    for (const id of PROVIDER_IDS) {
      if (QUIRKS[id].dialect === 'openai') {
        expect(QUIRKS[id].imageInToolResult).toBe(false);
      }
    }
  });

  it('gives every provider a working vision heuristic that never throws', () => {
    for (const id of PROVIDER_IDS) {
      expect(() => QUIRKS[id].vision.guess('some-model-1')).not.toThrow();
    }
    expect(QUIRKS.claude.vision.guess('claude-opus-4-8')).toBe(true);
    expect(QUIRKS.gemini.vision.guess('gemini-2.5-pro')).toBe(true);
    expect(QUIRKS.openai.vision.guess('gpt-5.5')).toBe(true);
    expect(QUIRKS.openai.vision.guess('gpt-4o-realtime')).toBe(false);
    expect(QUIRKS.qwen.vision.guess('qwen-vl-max')).toBe(true);
    expect(QUIRKS.qwen.vision.guess('qwen-max')).toBe(false);
    expect(QUIRKS.deepseek.vision.guess('deepseek-v4-pro')).toBe(false);
  });
});

describe('provider facts read from the quirks', () => {
  it('names the region-split platforms by their two hosts', () => {
    expect(PROVIDER_IDS.filter(isRegionSplit)).toEqual(['zhipu', 'qwen', 'moonshot']);
  });

  it('finds the platform a custom endpoint points at by its exact host, slash or not', () => {
    expect(providerForEndpoint('https://ark.cn-beijing.volces.com/api/v3/')).toBe('doubao');
    expect(providerForEndpoint('https://open.bigmodel.cn/api/paas/v4')).toBe('zhipu');
    expect(providerForEndpoint(OPENAI_BASE_URL)).toBe('openai');
    expect(providerForEndpoint('https://gateway.example/v1')).toBeUndefined();
  });

  it('leaves only Ark without a browser-readable model list', () => {
    expect(PROVIDER_IDS.filter((id) => QUIRKS[id].listsModels === false)).toEqual(['doubao']);
  });

  it('probes vision only where the model id is no authority', () => {
    expect(PROVIDER_IDS.filter((id) => QUIRKS[id].vision.probe)).toEqual(['openrouter', 'doubao', 'perplexity', 'custom']);
  });
});

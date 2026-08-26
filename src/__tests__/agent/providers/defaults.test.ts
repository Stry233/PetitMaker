import { describe, expect, it } from 'vitest';
import { OPENAI_DEFAULT_BASE, PROVIDER_IDS, PROVIDER_META, QUIRKS, baseUrlFor } from '../../../agent/providers/defaults';

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
      expect(typeof meta.vision).toBe('function');
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

  it('leaves claude and openai without a base URL: their SDKs carry their own default', () => {
    expect(baseUrlFor('claude', {})).toBeUndefined();
    expect(baseUrlFor('openai', {})).toBeUndefined();
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

  it('exports the OpenAI SDK default base URL as the one shared literal', () => {
    expect(OPENAI_DEFAULT_BASE).toBe('https://api.openai.com/v1');
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
      expect(() => PROVIDER_META[id].vision('some-model-1')).not.toThrow();
    }
    expect(PROVIDER_META.claude.vision('claude-opus-4-8')).toBe(true);
    expect(PROVIDER_META.gemini.vision('gemini-2.5-pro')).toBe(true);
    expect(PROVIDER_META.openai.vision('gpt-5.5')).toBe(true);
    expect(PROVIDER_META.openai.vision('gpt-4o-realtime')).toBe(false);
    expect(PROVIDER_META.qwen.vision('qwen-vl-max')).toBe(true);
    expect(PROVIDER_META.qwen.vision('qwen-max')).toBe(false);
    expect(PROVIDER_META.deepseek.vision('deepseek-v4-pro')).toBe(false);
  });
});

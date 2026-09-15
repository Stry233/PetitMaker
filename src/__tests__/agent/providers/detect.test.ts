import { describe, expect, it } from 'vitest';
import { detectProviderFromKey } from '../../../agent/providers/detect';

describe('providers/detect: detectProviderFromKey', () => {
  it('recognizes OpenRouter keys before the bare sk- prefix would match', () => {
    expect(detectProviderFromKey('sk-or-abc123')).toBe('openrouter');
  });

  it('recognizes Claude keys', () => {
    expect(detectProviderFromKey('sk-ant-abc123')).toBe('claude');
  });

  it('recognizes OpenAI project/service-account/admin keys', () => {
    expect(detectProviderFromKey('sk-proj-abc123')).toBe('openai');
    expect(detectProviderFromKey('sk-svcacct-abc123')).toBe('openai');
    expect(detectProviderFromKey('sk-admin-abc123')).toBe('openai');
  });

  it('recognizes the legacy sk-None- shape as OpenAI too (carried from the legacy regex)', () => {
    expect(detectProviderFromKey('sk-None-abc123')).toBe('openai');
  });

  it('recognizes Google API keys', () => {
    expect(detectProviderFromKey('AIzaSyD-abcdefghijklmnopqrst')).toBe('gemini');
  });

  it('recognizes the Zhipu 32hex.16alnum shape', () => {
    expect(detectProviderFromKey('0123456789abcdef0123456789abcdef.AbCdEfGh12345678')).toBe('zhipu');
  });

  it('returns null for a bare sk-<32hex> key: ambiguous among deepseek/openai/qwen/moonshot/custom', () => {
    expect(detectProviderFromKey('sk-0123456789abcdef0123456789abcdef')).toBeNull();
  });

  it('trims surrounding whitespace before matching', () => {
    expect(detectProviderFromKey('  sk-ant-abc123  ')).toBe('claude');
  });
});

/**
 * Friendly model names over ids from OpenAI, OpenRouter, Perplexity's Router and an ollama gateway:
 * version dots survive, glued versions split (llama3.1), dash versions join (opus-4-8 to 4.8), dates
 * drop in every shape, sizes and quants uppercase, ollama tags fold in (`:latest` drops), vendor
 * prefixes drop, and brands keep their casing.
 */
import { describe, it, expect } from 'vitest';
import { prettyModel, shortModel } from '../../../../ui/agent/connection/pretty-model';

const CASES: [string, string][] = [
  // platform defaults
  ['gpt-5.5', 'GPT 5.5'],
  ['gpt-5.5-pro', 'GPT 5.5 Pro'],
  ['gpt-5.4-mini', 'GPT 5.4 Mini'],
  ['claude-opus-4-8', 'Claude Opus 4.8'],
  ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
  ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
  ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
  ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
  ['glm-4.5-air', 'GLM 4.5 Air'],
  ['qwen-max', 'Qwen Max'],
  ['moonshot-v1-32k', 'Moonshot V1 32K'],
  ['kimi-k2-turbo-preview', 'Kimi K2 Turbo Preview'],
  // vendor-prefixed (openrouter)
  ['openrouter/auto', 'Auto'],
  ['anthropic/claude-opus-4.7-fast', 'Claude Opus 4.7 Fast'],
  ['z-ai/glm-5.1', 'GLM 5.1'],
  ['x-ai/grok-4.5', 'Grok 4.5'],
  ['openai/o3-mini-high', 'o3 Mini High'],
  ['openai/gpt-5-codex', 'GPT 5 Codex'],
  ['qwen/qwen3-vl-8b-instruct', 'Qwen 3 VL 8B Instruct'],
  ['nousresearch/hermes-3-llama-3.1-405b', 'Hermes 3 Llama 3.1 405B'],
  // openai dates in both shapes
  ['gpt-4.1-mini-2025-04-14', 'GPT 4.1 Mini'],
  ['gpt-4o-2024-11-20', 'GPT 4o'],
  ['gpt-3.5-turbo-0125', 'GPT 3.5 Turbo'],
  ['gpt-4o-mini-search-preview', 'GPT 4o Mini Search Preview'],
  ['chatgpt-image-latest', 'ChatGPT Image'],
  ['o4-mini-deep-research', 'o4 Mini Deep Research'],
  // ollama / campus gateway
  ['deepseek-r1:14b', 'DeepSeek R1 14B'],
  ['llama3.1:70b-instruct-q4_K_M', 'Llama 3.1 70B Instruct Q4 K M'],
  ['llama3.3:70b', 'Llama 3.3 70B'],
  ['llama4:latest', 'Llama 4'],
  ['qwen2.5:72b', 'Qwen 2.5 72B'],
  ['qwen3-coder:latest', 'Qwen 3 Coder'],
  ['qwq:32b-fp16', 'QwQ 32B FP16'],
  ['gpt-oss:120b', 'GPT OSS 120B'],
  ['gemma3:27b', 'Gemma 3 27B'],
  ['medgemma:27b', 'MedGemma 27B'],
  ['phi4:latest', 'Phi 4'],
  ['mistral:latest', 'Mistral'],
  ['llava:latest', 'LLaVA'],
  ['codellama:latest', 'CodeLlama'],
  ['devstral-small-2:latest', 'Devstral Small 2'],
  ['recycling-test-bot', 'Recycling Test Bot'],
  // openrouter :free routing tag survives as a suffix word
  ['google/gemma-4-26b-a4b-it:free', 'Gemma 4 26B A4B IT Free'],
  // Perplexity's Router: the prefix names the server, and the MoE active-parameter suffix uppercases.
  ['perplexity/kimi-k3', 'Kimi K3'],
  ['perplexity/glm-5.2', 'GLM 5.2'],
  ['perplexity/deepseek-v4-flash-0731', 'DeepSeek V4 Flash'],
  ['perplexity/nemotron-3.5-lightning-30b-a3b', 'Nemotron 3.5 Lightning 30B A3B'],
  ['perplexity/nemotron-3-ultra-550b-a55b', 'Nemotron 3 Ultra 550B A55B'],
];

describe('prettyModel', () => {
  for (const [id, want] of CASES) {
    it(`${id} -> ${want}`, () => expect(prettyModel(id)).toBe(want));
  }
  it('never returns empty for weird ids', () => {
    for (const id of ['latest', ':', 'x', '2025-04-14', 'a/b/c']) {
      expect(prettyModel(id).length).toBeGreaterThan(0);
    }
  });
});

/** The short form, for a line that pairs the model name with another fact and cannot wrap. */
describe('shortModel', () => {
  const CUT: [string, string][] = [
    ['claude-sonnet-4-5', 'Claude Sonnet'],
    ['claude-opus-4-1', 'Claude Opus'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ['deepseek-chat', 'DeepSeek Chat'],
  ];
  for (const [id, want] of CUT) {
    it(`${id} -> ${want}`, () => expect(shortModel(id)).toBe(want));
  }

  /** A version is noise only where a family name survives without it. */
  it('keeps a version that is carrying the name on its own', () => {
    expect(shortModel('gpt-5.1')).toBe('GPT 5.1');
    expect(shortModel('o3')).toBe('o3');
  });
});

/**
 * Provider METADATA only — no SDK imports. Anything outside the lazy agent
 * chunk (key-storage defaults, the phone-menu busy badge reading the agent
 * store) must import from here, never from providers/index.ts, which pulls in
 * @anthropic-ai/sdk + openai. `label` is the platform's company/brand name (the
 * UI localizes it via the agent2.prov_<id> i18n keys); `defaultModel` seeds the
 * initial selection. The model dropdown is populated ONLY by a live listModels()
 * fetch — there is no placeholder fallback list, so a bad key/config shows none.
 */
import type { ProviderId } from '../types';

export interface ProviderMeta {
  label: string;
  defaultModel: string;
  /** Narrow listModels() output to chat-capable ids. */
  modelFilter(id: string): boolean;
}

/** Drop non-chat entries (embeddings, audio, image, rerank, moderation) that
 *  OpenAI-compatible /models lists mix in — the generic filter for providers
 *  with broad catalogs. */
const isChatModel = (id: string): boolean =>
  !/embed|whisper|tts|audio|image|vision-?only|rerank|moderation|dall|guard/i.test(id);

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  claude: {
    label: 'Anthropic',
    defaultModel: 'claude-opus-4-8',
    modelFilter: (id) => id.startsWith('claude'),
  },
  deepseek: {
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-pro',
    modelFilter: () => true,
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-5.5',
    modelFilter: (id) => /^(gpt-|o\d)/.test(id),
  },
  gemini: {
    label: 'Google',
    defaultModel: 'gemini-2.5-pro',
    modelFilter: (id) => id.includes('gemini') && isChatModel(id),
  },
  openrouter: {
    label: 'OpenRouter',
    defaultModel: 'openrouter/auto',
    modelFilter: isChatModel,
  },
  zhipu: {
    label: 'Zhipu',
    defaultModel: 'glm-4.6',
    modelFilter: (id) => id.startsWith('glm') && isChatModel(id),
  },
  qwen: {
    label: 'Alibaba',
    defaultModel: 'qwen-max',
    modelFilter: (id) => id.startsWith('qwen') && isChatModel(id),
  },
  moonshot: {
    label: 'Moonshot',
    defaultModel: 'moonshot-v1-32k',
    modelFilter: (id) => /^(moonshot|kimi)/.test(id) && isChatModel(id),
  },
  custom: {
    // Any OpenAI-compatible endpoint (Open WebUI, Ollama, LiteLLM, vLLM, a campus
    // gateway…). No default/fallback models — the live /models list is the source
    // of truth; the model row auto-fills from it once the endpoint answers.
    label: 'Custom',
    defaultModel: '',
    modelFilter: isChatModel,
  },
};

export const PROVIDER_IDS: ProviderId[] = [
  'claude', 'openai', 'deepseek', 'gemini', 'openrouter', 'zhipu', 'qwen', 'moonshot', 'custom',
];

/** Accent color per provider for detection badges/dots. */
export const PROVIDER_ACCENT: Record<ProviderId, string> = {
  claude: '#D97757',
  openai: '#10A37F',
  deepseek: '#4D6BFE',
  gemini: '#1A73E8',
  openrouter: '#6566F1',
  zhipu: '#3859FF',
  qwen: '#615CED',
  moonshot: '#16091B',
  custom: '#5F7A8A',
};

/**
 * Provider detection from the API key FORMAT (instant, no network). Distinct
 * prefixes resolve immediately; bare `sk-…` keys (legacy OpenAI, Qwen, Moonshot)
 * are ambiguous and return null — the caller then probes /models (see
 * identifyProviderByProbe in providers/index.ts) and finally asks the user.
 */
export function detectProviderFromKey(key: string): ProviderId | null {
  const k = key.trim();
  if (/^sk-or-/.test(k)) return 'openrouter';           // OpenRouter (check before bare sk-)
  if (/^sk-ant-/.test(k)) return 'claude';
  if (/^sk-(proj|svcacct|admin|None)-/.test(k)) return 'openai';
  if (/^AIza[\w-]{20,}$/.test(k)) return 'gemini';      // Google API key
  if (/^[0-9a-f]{32}\.[A-Za-z0-9]{16}$/.test(k)) return 'zhipu'; // GLM: 32hex.16alnum
  // sk-<32hex> is NOT format-distinct: DeepSeek uses it, but so do Open WebUI /
  // LiteLLM / OneAPI self-hosted gateways ("custom") — resolve by probe instead.
  return null;                                          // ambiguous bare sk- (DeepSeek / OpenAI legacy / Qwen / Moonshot / custom gateways)
}

/** Providers whose keys are bare `sk-…` and can only be told apart by probing
 *  their /models endpoints (or asking). Order = probe priority. A configured
 *  custom endpoint is probed alongside these (see identifyProviderByProbe). */
export const AMBIGUOUS_CANDIDATES: ProviderId[] = ['deepseek', 'openai', 'qwen', 'moonshot'];

/** Whether (provider, model) accepts image content. Conservative: text-only
 *  providers and unknown models return false — view_map then degrades to the
 *  token-grid overview, which always works. */
export function supportsVision(provider: ProviderId, model: string): boolean {
  const m = model.toLowerCase();
  switch (provider) {
    case 'claude': return true;       // all current Claude chat models are multimodal
    case 'gemini': return true;       // all Gemini chat models are multimodal
    case 'openai': return /^(gpt-|o\d)/.test(m) && !/audio|realtime/.test(m);
    case 'qwen': return /vl|omni/.test(m);
    case 'openrouter': return /claude|gemini|gpt-|vision|-vl|omni|pixtral|llava/.test(m);
    // custom gateways host arbitrary models — recognize the common multimodal families
    case 'custom': return /vl|llava|vision|omni|pixtral|gemma3|llama4/.test(m);
    default: return false;            // deepseek, zhipu, moonshot: text-only chat APIs
  }
}

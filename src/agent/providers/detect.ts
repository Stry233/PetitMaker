/** Provider suggestions from key format only; this module performs no network requests. */
import type { ProviderId } from './defaults';

export function detectProviderFromKey(key: string): ProviderId | null {
  const k = key.trim();
  if (/^sk-or-/.test(k)) return 'openrouter';                    // OpenRouter (checked before bare sk-)
  if (/^sk-ant-/.test(k)) return 'claude';
  if (/^sk-(proj|svcacct|admin|None)-/.test(k)) return 'openai'; // "None" is a legacy OpenAI org-less key shape
  if (/^pplx-/.test(k)) return 'perplexity';
  if (/^AIza[\w-]{20,}$/.test(k)) return 'gemini';               // Google API key
  if (/^[0-9a-f]{32}\.[A-Za-z0-9]{16}$/.test(k)) return 'zhipu'; // GLM: 32hex.16alnum
  // sk-<32hex> is not format-distinct: DeepSeek uses it, but so do legacy OpenAI
  // keys, Qwen, Moonshot and self-hosted gateways ("custom") — require an explicit provider choice.
  return null;
}

/** Maximum duration of a model-list request to the selected endpoint. */
export const PROBE_DEADLINE_MS = 8000;

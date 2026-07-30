/**
 * Provider registry: metadata (defaults.ts) + adapter factories + key→provider
 * probing. This module pulls in the LLM SDKs — only the lazy agent chunk
 * (AgentSection and below) may import it; bundle-light consumers use
 * providers/defaults.ts.
 */
import type { ProviderAdapter, ProviderId } from '../types';
import { PROVIDER_META, PROVIDER_IDS, AMBIGUOUS_CANDIDATES, type ProviderMeta } from './defaults';
import { createAnthropicAdapter } from './anthropic';
import { createOpenAIAdapter } from './openai';

export interface ProviderInfo extends ProviderMeta {
  /** `baseUrl` is only read by the 'custom' provider (the user's own
   *  OpenAI-compatible endpoint); all others have fixed endpoints. */
  create(apiKey: string, baseUrl?: string): ProviderAdapter;
}

/** Trim + drop the trailing slash so `<base>/chat/completions` resolves right
 *  whether the user pastes `https://host/api` or `https://host/api/`. */
export function normalizeBaseUrl(url: string | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '');
}

/** OpenAI-compatible base URLs. Chinese providers expose a .cn/global endpoint;
 *  we use the globally-reachable one where there is a choice. */
const BASE_URL: Partial<Record<ProviderId, string>> = {
  deepseek: 'https://api.deepseek.com',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  openrouter: 'https://openrouter.ai/api/v1',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  moonshot: 'https://api.moonshot.cn/v1',
};

const FACTORIES: Record<ProviderId, (apiKey: string, baseUrl?: string) => ProviderAdapter> = {
  claude: (k) => createAnthropicAdapter(k),
  openai: (k) => createOpenAIAdapter(k),
  deepseek: (k) => createOpenAIAdapter(k, BASE_URL.deepseek),
  gemini: (k) => createOpenAIAdapter(k, BASE_URL.gemini),
  openrouter: (k) => createOpenAIAdapter(k, BASE_URL.openrouter),
  zhipu: (k) => createOpenAIAdapter(k, BASE_URL.zhipu),
  qwen: (k) => createOpenAIAdapter(k, BASE_URL.qwen),
  moonshot: (k) => createOpenAIAdapter(k, BASE_URL.moonshot),
  custom: (k, baseUrl) => {
    const url = normalizeBaseUrl(baseUrl);
    if (!url) throw new Error('Custom provider needs an endpoint URL — set it in the agent settings.');
    return createOpenAIAdapter(k, url);
  },
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, { ...PROVIDER_META[id], create: FACTORIES[id] }]),
) as Record<ProviderId, ProviderInfo>;


/**
 * Identify the provider of an ambiguous bare `sk-…` key by probing candidate
 * endpoints' `GET /models` (read-only and free) concurrently — the endpoint
 * that authenticates the key is its provider. When the user has configured a
 * custom endpoint, it joins the probe set (its keys are usually bare `sk-…`
 * too, e.g. Open WebUI / LiteLLM gateways). Returns the first match, or null
 * if none accept it (offline, CORS-blocked, or invalid key → caller asks).
 */
/** Hard probe deadline: some candidate endpoints are unreachable from a given
 *  network and just STALL (the SDKs default to multi-minute timeouts + retries)
 *  — without this the "detecting" spinner never resolves. On the deadline we
 *  resolve null and the manual chooser opens. */
const PROBE_DEADLINE_MS = 8000;

export async function identifyProviderByProbe(
  apiKey: string,
  signal?: AbortSignal,
  customBaseUrl?: string,
): Promise<ProviderId | null> {
  const candidates: ProviderId[] = normalizeBaseUrl(customBaseUrl)
    ? ['custom', ...AMBIGUOUS_CANDIDATES]
    : [...AMBIGUOUS_CANDIDATES];
  const attempts = candidates.map(
    (id) =>
      PROVIDERS[id]
        .create(apiKey, customBaseUrl)
        .listModels()
        .then(() => id), // 200 → this endpoint owns the key
  );
  // resolve to the first candidate that succeeds; ignore rejections
  return new Promise<ProviderId | null>((resolve) => {
    let pending = attempts.length;
    let settled = false;
    const finish = (id: ProviderId | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(id);
    };
    const timer = setTimeout(() => finish(null), PROBE_DEADLINE_MS);
    signal?.addEventListener('abort', () => finish(null), { once: true });
    for (const p of attempts) {
      p.then((id) => finish(id)).catch(() => {
        pending -= 1;
        if (pending === 0) finish(null);
      });
    }
  });
}

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
import { BASE_URLS, providerBaseUrls } from './defaults';

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

export { providerBaseUrls, REGION_SPLIT, baseUrlFor } from './defaults';

const FACTORIES: Record<ProviderId, (apiKey: string, baseUrl?: string) => ProviderAdapter> = {
  claude: (k) => createAnthropicAdapter(k),
  openai: (k) => createOpenAIAdapter(k),
  deepseek: (k, b) => createOpenAIAdapter(k, b ?? BASE_URLS.deepseek![0]),
  gemini: (k, b) => createOpenAIAdapter(k, b ?? BASE_URLS.gemini![0]),
  openrouter: (k, b) => createOpenAIAdapter(k, b ?? BASE_URLS.openrouter![0]),
  zhipu: (k, b) => createOpenAIAdapter(k, b ?? BASE_URLS.zhipu![0]),
  qwen: (k, b) => createOpenAIAdapter(k, b ?? BASE_URLS.qwen![0]),
  moonshot: (k, b) => createOpenAIAdapter(k, b ?? BASE_URLS.moonshot![0]),
  custom: (k, baseUrl) => {
    const url = normalizeBaseUrl(baseUrl);
    if (!url) throw new Error('Custom provider needs an endpoint URL — set it in the agent settings.');
    return createOpenAIAdapter(k, url);
  },
};

export const PROVIDERS: Record<ProviderId, ProviderInfo> = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, { ...PROVIDER_META[id], create: FACTORIES[id] }]),
) as Record<ProviderId, ProviderInfo>;


/** Hard probe deadline: some candidate endpoints are unreachable from a given
 *  network and just STALL (the SDKs default to multi-minute timeouts + retries)
 *  — without this the "detecting" spinner never resolves. On the deadline we
 *  resolve null and the manual chooser opens. */
const PROBE_DEADLINE_MS = 8000;

/** A provider together with the regional host that authenticated the key. */
export interface ProviderMatch { provider: ProviderId; baseUrl?: string }

/** Race attempts; the first to fulfil wins, all rejecting or the deadline gives null. */
function firstToAnswer<T>(attempts: Promise<T>[], signal?: AbortSignal): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let pending = attempts.length;
    let settled = false;
    const finish = (v: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), PROBE_DEADLINE_MS);
    signal?.addEventListener('abort', () => finish(null), { once: true });
    if (pending === 0) finish(null);
    for (const p of attempts) {
      p.then(finish).catch(() => {
        pending -= 1;
        if (pending === 0) finish(null);
      });
    }
  });
}

/** Every (provider, host) pair to try for one candidate provider. */
function endpointsOf(id: ProviderId, customBaseUrl?: string): ProviderMatch[] {
  if (id === 'custom') return [{ provider: 'custom', baseUrl: normalizeBaseUrl(customBaseUrl) }];
  const urls = providerBaseUrls(id);
  return urls.length > 0
    ? urls.map((baseUrl) => ({ provider: id, baseUrl }))
    : [{ provider: id }];
}

/**
 * Identify the provider of an ambiguous bare `sk-…` key by probing candidate endpoints'
 * `GET /models` (read-only and free) concurrently — the endpoint that authenticates the key is
 * its provider. A region-split provider contributes one attempt PER regional host, so the result
 * names the host as well as the platform. When the user has configured a custom endpoint it joins
 * the probe set (its keys are usually bare `sk-…` too, e.g. Open WebUI / LiteLLM gateways).
 * Returns the first match, or null if none accept it (offline, CORS-blocked, or invalid key).
 */
export async function identifyProviderByProbe(
  apiKey: string,
  signal?: AbortSignal,
  customBaseUrl?: string,
): Promise<ProviderMatch | null> {
  const candidates: ProviderId[] = normalizeBaseUrl(customBaseUrl)
    ? ['custom', ...AMBIGUOUS_CANDIDATES]
    : [...AMBIGUOUS_CANDIDATES];
  const attempts = candidates
    .flatMap((id) => endpointsOf(id, customBaseUrl))
    .map((m) => PROVIDERS[m.provider].create(apiKey, m.baseUrl).listModels().then(() => m));
  return firstToAnswer(attempts, signal);
}

/**
 * Which of a region-split provider's hosts issued this key. Called once the platform is known
 * (from the key format, or from the user picking it), since neither says which deployment the
 * key belongs to. Returns undefined for a single-host provider and when no host answers, both of
 * which leave the primary host in place.
 */
export async function resolveBaseUrl(
  id: ProviderId,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const urls = providerBaseUrls(id);
  if (urls.length < 2) return undefined;
  const match = await firstToAnswer(
    urls.map((baseUrl) => PROVIDERS[id].create(apiKey, baseUrl).listModels().then(() => baseUrl)),
    signal,
  );
  return match ?? undefined;
}

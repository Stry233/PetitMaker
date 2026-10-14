/**
 * The one place a provider connection becomes an adapter. The SDK adapters load on first use, so
 * opening the assistant panel downloads neither SDK and a request fetches only the one it needs.
 * The connection is read when `buildAdapter` runs: a settings change after that never reaches an
 * adapter already handed out.
 */
import { classify } from '../core/errors';
import { redactSecrets } from '../../platform/remote/redact';
import { baseUrlFor, QUIRKS, type ProviderId, type ProviderRegion } from './defaults';
import type { Adapter, AdapterRequest } from '../core/adapter';

/** All an adapter is built from. */
export interface AdapterConfig {
  providerId: ProviderId;
  apiKey: string;
  customBaseUrl?: string;
  region?: ProviderRegion;
}

/**
 * A connection that cannot be built (a custom provider with no address, an adapter chunk that failed
 * to download), as an adapter whose turn is one error event. The order is already on the log, so a
 * throw would leave the job with no end; the loop settles this like any endpoint refusal.
 */
export function refusingAdapter(message: string): Adapter {
  const error = classify({ message });
  return {
    async *stream() { yield { t: 'error' as const, error }; },
    listModels() { return Promise.reject(new Error(message)); },
  };
}

const loadAnthropic = () => import('./anthropic');
const loadOpenAI = () => import('./openai');

/** Starts downloading the SDK adapter `id` speaks through, so the first request does not wait for it. */
export function preloadAdapter(id: ProviderId): void {
  void (QUIRKS[id].dialect === 'anthropic' ? loadAnthropic() : loadOpenAI()).catch(() => {
    // A failed download is retried by the request that needs it.
  });
}

/** Exported for the one-shot capability checks (the panel's vision probe): a probe must reach the
 *  endpoint exactly as a job would, or its verdict is about a different connection. */
export function buildAdapter(cfg: AdapterConfig): Adapter {
  const { providerId, apiKey } = cfg;
  const quirks = QUIRKS[providerId];
  const baseUrl = baseUrlFor(providerId, { customBaseUrl: cfg.customBaseUrl, region: cfg.region });
  const construct = async (): Promise<Adapter> => {
    if (quirks.dialect === 'anthropic') return (await loadAnthropic()).createAnthropicAdapter({ apiKey, baseUrl });
    return (await loadOpenAI()).createOpenAIAdapter({ apiKey, providerId, baseUrl, quirks });
  };
  // One inner adapter per built adapter, so its per-instance memory (synthesized call ids, a refused
  // usage parameter) lasts the built adapter's life. A failure is not kept: the next request tries again.
  let inner: Adapter | undefined;
  const resolve = async (): Promise<Adapter> => {
    if (inner) return inner;
    try {
      inner = await construct();
      return inner;
    } catch (err) {
      return refusingAdapter(redactSecrets(err instanceof Error ? err.message : String(err), [apiKey]));
    }
  };
  return {
    async *stream(req: AdapterRequest, signal: AbortSignal) {
      yield* (await resolve()).stream(req, signal);
    },
    async listModels(signal: AbortSignal) {
      return (await resolve()).listModels(signal);
    },
  };
}

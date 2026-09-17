import { PROBE_DEADLINE_MS } from '../../agent/providers/detect';
import { baseUrlFor, QUIRKS, type ProviderId } from '../../agent/providers/defaults';
import { assistantModels, ensureModelCatalog, suggestedModels } from '../../agent/providers/model-catalog';

export const IDLE_MS = 900;
/** Longest a model listing waits for the live capability download; the bundled extract answers past it. */
const CATALOG_WAIT_MS = 2500;
const catalogSoon = (): Promise<void> => Promise.race([ensureModelCatalog(), new Promise<void>((resolve) => setTimeout(resolve, CATALOG_WAIT_MS))]);

/** Bounds model discovery with the provider-probe deadline and aborts a silent endpoint. */
export function withModelsDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>, deadlineMs: number = PROBE_DEADLINE_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`The endpoint answered nothing in ${Math.round(deadlineMs / 1000)}s; the request timed out.`));
    }, deadlineMs);
  });
  // Promise.race attaches handlers to the request, so a late rejection cannot become unhandled.
  return Promise.race([run(controller.signal), deadline]).finally(() => { clearTimeout(timer); });
}

/** Loads the selected provider adapter dynamically and lists models through its native dialect. */
export function defaultListModels(cfg: {
  provider: ProviderId; apiKey: string; customBaseUrl?: string; region?: 0 | 1;
}): Promise<string[]> {
  // Ark supports chat in browsers but has no CORS-enabled model-list endpoint.
  if (cfg.provider === 'doubao' || /^https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3\/?$/.test(cfg.customBaseUrl ?? '')) return catalogSoon().then(() => suggestedModels(cfg.provider, cfg.customBaseUrl));
  return withModelsDeadline(async (signal) => {
    const metadata = catalogSoon();
    if (cfg.provider === 'claude') {
      const { createAnthropicAdapter } = await import('../../agent/providers/anthropic');
      const ids = await createAnthropicAdapter({ apiKey: cfg.apiKey }).listModels(signal);
      await metadata;
      return assistantModels(cfg.provider, ids);
    }
    const { createOpenAIAdapter } = await import('../../agent/providers/openai');
    const baseUrl = baseUrlFor(cfg.provider, { region: cfg.region, ...(cfg.customBaseUrl ? { customBaseUrl: cfg.customBaseUrl } : {}) });
    const ids = await createOpenAIAdapter({
      apiKey: cfg.apiKey, providerId: cfg.provider,
      ...(baseUrl ? { baseUrl } : {}),
      quirks: QUIRKS[cfg.provider],
    }).listModels(signal);
    await metadata;
    return assistantModels(cfg.provider, ids, cfg.customBaseUrl);
  });
}

export type ListModels = (cfg: {
  provider: ProviderId; apiKey: string; customBaseUrl?: string; region?: 0 | 1;
}) => Promise<string[]>;


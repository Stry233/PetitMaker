/** Live capability data supplements the models a connected account can actually use. */
import { endpointKey, MODEL_CATALOG_URL, PROVIDER_IDS, providerForEndpoint, QUIRKS, type ProviderId } from './defaults';
import snapshot from './model-catalog.snapshot.json';
import { createSignal } from '../../core/base/signal';
import { activeTarget } from '../../platform/build/deploy-targets';
import { withDeadline } from '../../platform/async/abort';
import type { ModelCapabilities } from '../core/adapter';

export { MODEL_CATALOG_URL };

/** A failed download is retried after this long, up to the attempt cap; one success serves the session. */
const RETRY_MS = 30_000;
const ATTEMPTS_MAX = 3;
/** The catalog is several megabytes; slow cross-border links need well over the probe deadline to deliver it. */
const CATALOG_DEADLINE_MS = 20_000;

type Catalog = Partial<Record<ProviderId, Record<string, ModelCapabilities>>>;

/** Capability extract bundled with the build, so effort and vision controls do not depend on reaching the live catalog. */
const MODEL_CATALOG_SNAPSHOT = snapshot as unknown as { takenAt: string; providers: Catalog };
/** The page's merged catalog: the bundled snapshot, overlaid by the live download once it lands. */
let catalog: Catalog = { ...MODEL_CATALOG_SNAPSHOT.providers };
/** Native discovery per provider and endpoint (`nativeKey`); it wins over the catalog entry. */
const native = new Map<string, Record<string, ModelCapabilities>>();
/** Download bookkeeping: whether one download succeeded, how many were tried and when the last
 *  began (the retry pacing), and the download in flight that concurrent callers share. */
let loaded = false;
let attempts = 0;
let lastAttempt = 0;
let pending: Promise<void> | undefined;
/** Bumped with every change to `catalog` or `native`, the key `useSyncExternalStore` readers watch. */
let version = 0;
const catalogChanged = createSignal();

export const catalogVersion = (): number => version;
export const subscribeCatalog = (listener: () => void): (() => void) => catalogChanged.subscribe(listener);

function changed(): void {
  version++;
  catalogChanged.emit();
}

const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const strings = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length < 200) : undefined;
const positive = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/** Accepts data fields only; remote URLs, headers and request-body overrides are never used. */
function parseCapabilities(value: unknown): ModelCapabilities {
  const m = record(value);
  const modalities = record(m.modalities ?? m.architecture);
  const limit = record(m.limit);
  const options = Array.isArray(m.reasoning_options) ? m.reasoning_options.map(record) : [];
  const effort = options.find((o) => o.type === 'effort');
  const budget = options.find((o) => o.type === 'budget_tokens');
  const parameters = strings(m.supported_parameters);
  return {
    ...(typeof m.name === 'string' && m.name.length < 200 ? { name: m.name } : {}),
    ...(typeof m.tool_call === 'boolean' ? { tools: m.tool_call } : parameters ? { tools: parameters.includes('tools') } : {}),
    ...(strings(modalities.input ?? modalities.input_modalities) ? { input: strings(modalities.input ?? modalities.input_modalities) } : {}),
    ...(strings(modalities.output ?? modalities.output_modalities) ? { output: strings(modalities.output ?? modalities.output_modalities) } : {}),
    ...(typeof m.reasoning === 'boolean' ? { reasoning: m.reasoning } : {}),
    ...(effort ? { efforts: strings(effort.values)?.filter((v) => /^[a-z]+$/.test(v)) } : {}),
    ...(budget ? { budget: { min: positive(budget.min) ?? 1024, max: positive(budget.max) } } : {}),
    ...(positive(limit.context ?? m.context_length) ? { context: positive(limit.context ?? m.context_length) } : {}),
    ...(positive(limit.output) ? { maxOutput: positive(limit.output) } : {}),
  };
}

export function parseModelCatalog(value: unknown): Catalog {
  const root = record(value);
  const result: Catalog = {};
  for (const id of PROVIDER_IDS) {
    const models: Record<string, ModelCapabilities> = Object.create(null);
    for (const source of [...(QUIRKS[id].catalogSources ?? [])].reverse()) {
      for (const [name, data] of Object.entries(record(record(root[source]).models))) {
        if (name.length < 200) models[name] = parseCapabilities(data);
      }
    }
    if (Object.keys(models).length) result[id] = models;
  }
  return result;
}

/** One bounded, credential-free download per session, retaining live data over the bundled extract. */
export function ensureModelCatalog(force = false): Promise<void> {
  if (pending) return pending;
  if (!activeTarget().liveModelCatalog) return Promise.resolve();
  if (!force && (loaded || attempts >= ATTEMPTS_MAX || Date.now() - lastAttempt < RETRY_MS)) return Promise.resolve();
  const controller = withDeadline(CATALOG_DEADLINE_MS);
  attempts++;
  lastAttempt = Date.now();
  pending = (async () => {
    try {
      const response = await fetch(MODEL_CATALOG_URL, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) return;
      const next = parseModelCatalog(await response.json());
      if (!Object.keys(next).length) return;
      catalog = { ...MODEL_CATALOG_SNAPSHOT.providers, ...next };
      loaded = true;
      changed();
    } catch {
      // Capability discovery must not prevent a connection or generation.
    } finally {
      controller.dispose();
      pending = undefined;
    }
  })();
  return pending;
}

/** The provider whose catalog entries and model rules describe a connection. */
export function catalogProvider(provider: ProviderId, endpoint?: string): ProviderId {
  const key = endpointKey(provider, endpoint);
  return key === undefined ? provider : providerForEndpoint(key) ?? provider;
}

const nativeKey = (provider: ProviderId, endpoint?: string) => `${provider}|${endpointKey(provider, endpoint) ?? ''}`;

/** Native list capabilities take precedence; account availability stays in the returned ID list. */
export function rememberNativeModels(provider: ProviderId, rows: unknown[], endpoint?: string): void {
  const models: Record<string, ModelCapabilities> = Object.create(null);
  for (const row of rows) {
    const m = record(row);
    if (typeof m.id === 'string' && m.id.length < 200) models[m.id] = parseCapabilities(m);
  }
  native.set(nativeKey(provider, endpoint), models);
  changed();
}

/** `endpoint` may be any URL a reader holds; only a custom connection's URL selects a native list. */
export function modelCapabilities(provider: ProviderId, id: string, endpoint?: string): ModelCapabilities | undefined {
  const source = catalog[catalogProvider(provider, endpoint)];
  const base = id.startsWith('ft:') ? id.split(':')[1] ?? id : id.replace(/^models\//, '');
  const remote = source?.[base] ?? source?.[base.replace(/-\d{4}-?\d{2}-?\d{2}$/, '')];
  const direct = native.get(nativeKey(provider, endpoint))?.[id];
  return remote || direct ? { ...remote, ...direct } : undefined;
}

function unrelated(id: string): boolean {
  return /(?:^|[-/])(?:embedding|embeddings|rerank|tts|whisper|dall-e|sora|veo|lyria)(?:[-/]|$)|realtime|transcrib|(?:^|-)audio(?:-|$)|(?:^|-)image(?:-|$)|^gpt-.*-instruct$/.test(id)
    && !/^qwen.*instruct$/.test(id);
}

export function assistantModels(provider: ProviderId, ids: readonly string[], endpoint?: string): string[] {
  const quirks = QUIRKS[catalogProvider(provider, endpoint)];
  const usable = [...new Set(ids)].filter((id) => {
    const c = modelCapabilities(provider, id, endpoint);
    if (c?.tools === false || c?.output && !c.output.includes('text') || c?.input && !c.input.includes('text')) return false;
    if (c?.tools === true && c.output?.includes('text')) return true;
    if (unrelated(id)) return false;
    return quirks.chatModelIds?.test(id) ?? true;
  });
  const preferred = quirks.preferredModels?.find((id) => usable.includes(id));
  return preferred ? [preferred, ...usable.filter((id) => id !== preferred)] : usable;
}

/** Public suggestions do not assert that a key has access to these models. */
export function suggestedModels(provider: ProviderId, endpoint?: string): string[] {
  return assistantModels(provider, Object.keys(catalog[catalogProvider(provider, endpoint)] ?? {}), endpoint);
}

export function __resetModelCatalog(): void {
  catalog = { ...MODEL_CATALOG_SNAPSHOT.providers };
  native.clear();
  loaded = false;
  attempts = 0;
  lastAttempt = 0;
  changed();
}

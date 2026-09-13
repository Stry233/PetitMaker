/** Live capability data supplements the models a connected account can actually use. */
import { baseUrlFor, PROVIDER_IDS, type ProviderId } from './defaults';

export const MODEL_CATALOG_URL = 'https://models.dev/api.json';
const REFRESH_MS = 5 * 60_000;
const SOURCES: Partial<Record<ProviderId, string[]>> = {
  claude: ['anthropic'], openai: ['openai'], deepseek: ['deepseek'], gemini: ['google'],
  openrouter: ['openrouter'], zhipu: ['zai', 'zhipuai'], qwen: ['alibaba', 'alibaba-cn'],
  moonshot: ['moonshotai', 'moonshotai-cn'], doubao: ['volcengine'], perplexity: ['perplexity'],
};
export interface ModelCapabilities {
  name?: string;
  tools?: boolean;
  input?: string[];
  output?: string[];
  reasoning?: boolean;
  efforts?: string[];
  budget?: { min: number; max?: number };
  context?: number;
  maxOutput?: number;
}
type Catalog = Partial<Record<ProviderId, Record<string, ModelCapabilities>>>;
let catalog: Catalog = {};
const native = new Map<string, Record<string, ModelCapabilities>>();
let refreshed = 0;
let pending: Promise<void> | undefined;
let version = 0;
const listeners = new Set<() => void>();
export const catalogVersion = (): number => version;
export const subscribeCatalog = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const changed = () => { version++; for (const listener of listeners) listener(); };
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const strings = (v: unknown): string[] | undefined => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.length < 200) : undefined;
const positive = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;

/** Accepts data fields only; remote URLs, headers and request-body overrides are never used. */
export function parseCapabilities(value: unknown): ModelCapabilities {
  const m = record(value), modalities = record(m.modalities ?? m.architecture), limit = record(m.limit);
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
  const root = record(value), result: Catalog = {};
  for (const id of PROVIDER_IDS) {
    const models: Record<string, ModelCapabilities> = Object.create(null);
    for (const source of [...(SOURCES[id] ?? [])].reverse()) {
      for (const [name, data] of Object.entries(record(record(root[source]).models))) {
        if (name.length < 200) models[name] = parseCapabilities(data);
      }
    }
    if (Object.keys(models).length) result[id] = models;
  }
  return result;
}

/** One bounded, credential-free refresh per freshness window, retaining the last good snapshot. */
export function ensureModelCatalog(force = false): Promise<void> {
  if (pending) return pending;
  if (!force && Date.now() - refreshed < REFRESH_MS) return Promise.resolve();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  pending = (async () => {
    try {
      const response = await fetch(MODEL_CATALOG_URL, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) return;
      const next = parseModelCatalog(await response.json());
      if (!Object.keys(next).length) return;
      catalog = next;
      changed();
    } catch { /* Capability discovery must not prevent a connection or generation. */ }
    finally { clearTimeout(timer); refreshed = Date.now(); pending = undefined; }
  })();
  return pending;
}

export function catalogProvider(provider: ProviderId, endpoint?: string): ProviderId {
  if (provider !== 'custom' || !endpoint) return provider;
  const url = endpoint.replace(/\/$/, '');
  return PROVIDER_IDS.find((id) => id !== 'custom' && [0, 1].some((region) =>
    (baseUrlFor(id, { region: region as 0 | 1 }) ?? (id === 'openai' ? 'https://api.openai.com/v1' : '')).replace(/\/$/, '') === url)) ?? provider;
}
const nativeKey = (provider: ProviderId, endpoint?: string) => `${provider}|${endpoint ?? ''}`;

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
  const usable = [...new Set(ids)].filter((id) => {
    const c = modelCapabilities(provider, id, endpoint);
    if (c?.tools === false || c?.output && !c.output.includes('text') || c?.input && !c.input.includes('text')) return false;
    if (c?.tools === true && c.output?.includes('text')) return true;
    if (unrelated(id)) return false;
    return catalogProvider(provider, endpoint) !== 'openai' || /^(?:ft:)?(?:gpt-|o[1-9])/.test(id);
  });
  const preferred = catalogProvider(provider, endpoint) === 'openai'
    ? ['gpt-4.1-mini', 'gpt-4o-mini'].find((id) => usable.includes(id)) : undefined;
  return preferred ? [preferred, ...usable.filter((id) => id !== preferred)] : usable;
}

/** Public suggestions do not assert that a key has access to these models. */
export function suggestedModels(provider: ProviderId, endpoint?: string): string[] {
  return assistantModels(provider, Object.keys(catalog[catalogProvider(provider, endpoint)] ?? {}), endpoint);
}

export function resetModelCatalog(): void {
  catalog = {}; native.clear(); refreshed = 0; changed();
}

/**
 * Provider metadata and the dialect quirks table, as pure data. SDK-free and
 * import-free by design: everything an adapter or the settings UI needs to know
 * about a provider BEFORE any network call or SDK construction lives here, so
 * neither the lazy agent chunk nor a test needs to pull in @anthropic-ai/sdk or
 * openai to read a name, an accent color or a base URL. Facts (names, base
 * URLs, accents, vision heuristics) are carried verbatim from the retired harness's metadata
 * table this supersedes; `keyUrl` comes from `ui/agent/SetupScreen.tsx`, which held it instead.
 * Two deliberate deviations
 * from the legacy tables: the zhipu and moonshot host orders are normalized to
 * `[global, cn]` (the legacy table listed them inconsistently), and
 * `mayOmitToolIds` was dropped from the quirks table entirely (see below).
 */

export type ProviderId =
  | 'claude'
  | 'openai'
  | 'deepseek'
  | 'gemini'
  | 'openrouter'
  | 'zhipu'
  | 'qwen'
  | 'moonshot'
  | 'perplexity'
  | 'custom';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'claude', 'openai', 'deepseek', 'gemini', 'openrouter', 'zhipu', 'qwen', 'moonshot', 'perplexity',
  'custom',
];

export interface ProviderMeta {
  id: ProviderId;
  /** The platform's company/brand name, as shown in the roster and detection badges. */
  name: string;
  /** Where to get a key for this platform. Empty for `custom`: it has no signup
   *  page of its own, the user already holds a key for whatever endpoint they run. */
  keyUrl: string;
  /** Accent color for detection badges/dots. */
  accent: string;
  /** Whether (this provider, model) accepts image content. Conservative: an
   *  unrecognized model returns false, so a caller degrades to text gracefully. */
  vision: (model: string) => boolean;
}

/** Vision heuristics below match on the lowercased model id. */
const lower = (model: string): string => model.toLowerCase();

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: 'claude',
    name: 'Anthropic',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    accent: '#D97757',
    vision: () => true, // every current Claude chat model is multimodal
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    accent: '#10A37F',
    vision: (model) => /^(gpt-|o\d)/.test(lower(model)) && !/audio|realtime/.test(lower(model)),
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    accent: '#4D6BFE',
    vision: () => false, // text-only chat API
  },
  gemini: {
    id: 'gemini',
    name: 'Google',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    accent: '#1A73E8',
    vision: () => true, // every Gemini chat model is multimodal
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    accent: '#6566F1',
    vision: (model) => /claude|gemini|gpt-|vision|-vl|omni|pixtral|llava/.test(lower(model)),
  },
  zhipu: {
    id: 'zhipu',
    name: 'Zhipu',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    accent: '#3859FF',
    vision: () => false, // text-only chat API
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba',
    keyUrl: 'https://bailian.console.aliyun.com/',
    accent: '#615CED',
    vision: (model) => /vl|omni/.test(lower(model)),
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    accent: '#16091B',
    vision: () => false, // text-only chat API
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    keyUrl: 'https://console.perplexity.ai/project/keys',
    accent: '#20808D',
    vision: () => false, // the Router's catalog is open-weight text models
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    // Any OpenAI-compatible endpoint (Open WebUI, Ollama, LiteLLM, vLLM, a campus
    // gateway…) — there is no signup page, the user already holds a key.
    keyUrl: '',
    accent: '#5F7A8A',
    // Self-hosted gateways host arbitrary models — recognize the common multimodal families.
    vision: (model) => /vl|llava|vision|omni|pixtral|gemma3|llama4/.test(lower(model)),
  },
};

/** Accent color per provider, flattened out of `PROVIDER_META` for a caller that wants just the
 *  color table (detection badges/dots) without the rest of a provider's metadata. */
export const PROVIDER_ACCENT: Record<ProviderId, string> = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, PROVIDER_META[id].accent]),
) as Record<ProviderId, string>;

export interface Quirks {
  /** Which SDK dialect serves this provider. */
  dialect: 'anthropic' | 'openai';
  /** OpenAI-dialect base URL(s), primary/global first; regional split carried as
   *  [global, cn] where a platform runs a separate CN deployment a key is issued
   *  against (Moonshot, Qwen, Zhipu: a key issued on one host is rejected by the
   *  other, so which one a key belongs to has to be settled by asking). Absent
   *  for `claude`/`openai`, whose SDKs carry their own default endpoint, and for
   *  `custom`, where the user supplies the URL. */
  baseUrls?: string[];
  /** Wire fields reasoning may arrive in, tried in order per delta. A LIST because one provider id
   *  serves many models (OpenRouter routes to everything, `custom` is whatever the user runs) and a
   *  self-hosted gateway picks its own name. Parse decision ONLY: the panel keys its reasoning UI on
   *  observation (a delta arrived), never on this flag. */
  reasoningFields?: readonly ('reasoning_content' | 'reasoning')[];
  /** Whether to ask for `stream_options: { include_usage: true }`. Off for `custom`: an arbitrary
   *  gateway may reject the parameter, and losing usage is cheaper than losing the stream. */
  streamUsage?: boolean;
  /**
   * Whether an adapter for this provider REQUIRES an explicit base URL to be built at all.
   *
   * True for `custom` alone, and the asymmetry is the point: the `openai` SDK reads an absent
   * `baseURL` as "my own default host", which is right for the `openai` provider and wrong for a
   * private gateway — the key was issued by whatever runs at the user's address, and the fallback
   * is another company's API. Declared here rather than tested per call site so the floor is one
   * fact both the adapter and the settings surfaces read.
   */
  needsBaseUrl?: boolean;
  /** Whether images may ride inside a tool result message. Anthropic's dialect
   *  allows an image block inside a tool_result; the OpenAI dialect's API
   *  rejects images inside a tool message, so an adapter must append a separate
   *  user message carrying the image instead. */
  imageInToolResult: boolean;
}

// There is no `mayOmitToolIds` quirk: a missing tool-call id is synthesized unconditionally by
// every OpenAI-dialect adapter, since synthesizing one for a platform that always sends ids is a
// no-op and a per-provider flag would only be read to decide whether to do nothing.

export const QUIRKS: Record<ProviderId, Quirks> = {
  claude: {
    dialect: 'anthropic',
    imageInToolResult: true,
  },
  openai: {
    dialect: 'openai',
    // The o-series keeps its reasoning server-side and sends no field for it.
    imageInToolResult: false,
    streamUsage: true,
  },
  deepseek: {
    dialect: 'openai',
    baseUrls: ['https://api.deepseek.com'],
    reasoningFields: ['reasoning_content', 'reasoning'],
    imageInToolResult: false,
    streamUsage: true,
  },
  gemini: {
    dialect: 'openai',
    baseUrls: ['https://generativelanguage.googleapis.com/v1beta/openai/'],
    reasoningFields: ['reasoning_content'],
    imageInToolResult: false,
    streamUsage: true,
  },
  openrouter: {
    dialect: 'openai',
    baseUrls: ['https://openrouter.ai/api/v1'],
    // OpenRouter normalizes every routed model's thinking onto `reasoning`, but passes a
    // backend's own `reasoning_content` through on some routes.
    reasoningFields: ['reasoning', 'reasoning_content'],
    imageInToolResult: false,
    streamUsage: true,
  },
  zhipu: {
    dialect: 'openai',
    baseUrls: ['https://api.z.ai/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4'],
    reasoningFields: ['reasoning_content', 'reasoning'],
    imageInToolResult: false,
    streamUsage: true,
  },
  qwen: {
    dialect: 'openai',
    baseUrls: [
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ],
    reasoningFields: ['reasoning_content', 'reasoning'],
    imageInToolResult: false,
    streamUsage: true,
  },
  moonshot: {
    dialect: 'openai',
    baseUrls: ['https://api.moonshot.ai/v1', 'https://api.moonshot.cn/v1'],
    reasoningFields: ['reasoning_content', 'reasoning'],
    imageInToolResult: false,
    streamUsage: true,
  },
  perplexity: {
    dialect: 'openai',
    // Perplexity's Router, which serves the same catalog under three schemas. The Anthropic-schema
    // endpoint is `https://api.perplexity.ai/router` (that SDK appends `/v1/messages` itself).
    baseUrls: ['https://api.perplexity.ai/router/v1'],
    // The Router carries a routed model's thinking on `reasoning_content` and declares no second
    // spelling for it.
    reasoningFields: ['reasoning_content'],
    imageInToolResult: false,
    streamUsage: true,
  },
  custom: {
    dialect: 'openai',
    reasoningFields: ['reasoning_content', 'reasoning'],
    imageInToolResult: false,
    needsBaseUrl: true,
  },
};

// OpenAI carries no `QUIRKS.baseUrls` (its SDK holds its own default endpoint) — this constant
// serves two callers: `detect.ts`'s ambiguous-key probe, which still needs an explicit URL to
// fetch, and this comment, documenting what the SDK defaults `createOpenAIAdapter` to when its
// `baseUrl` option is omitted.
export const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';

/**
 * The endpoint to call for a provider: `custom` echoes whatever the user
 * configured (undefined if nothing yet); a region-split platform picks
 * `baseUrls[region]` (0 = global/default); anything else falls back to its
 * single base URL, or undefined where the SDK carries its own default.
 */
export function baseUrlFor(id: ProviderId, opts: { customBaseUrl?: string; region?: 0 | 1 }): string | undefined {
  if (id === 'custom') return opts.customBaseUrl;
  const urls = QUIRKS[id].baseUrls;
  if (!urls) return undefined;
  return urls[opts.region ?? 0] ?? urls[0];
}

/** Every host a provider answers on, primary first. Empty for `custom` (the user supplies the
 *  URL) and for a provider whose SDK carries its own default endpoint. For a caller that wants
 *  the full declared list rather than `baseUrlFor`'s single resolved host (an allowlist check
 *  against a stored regional endpoint, a CSP-origin drift test). */
export function providerBaseUrls(id: ProviderId): readonly string[] {
  return QUIRKS[id].baseUrls ?? [];
}

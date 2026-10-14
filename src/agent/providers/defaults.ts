/** SDK-independent provider metadata and wire-format quirks. Regional URLs are ordered global, then China. */
import type { I18nKey } from '../../i18n/keys';

export const PROVIDER_IDS = [
  'claude', 'openai', 'deepseek', 'gemini', 'openrouter', 'zhipu', 'qwen', 'moonshot', 'doubao', 'perplexity',
  'custom',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** OpenAI's own API host, where its reasoning models are served over the Responses protocol. */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** The public model capability catalog (Models.dev); fetched without credentials. */
export const MODEL_CATALOG_URL = 'https://models.dev/api.json';

export interface ProviderMeta {
  id: ProviderId;
  /** Canonical English name; reader-facing names use i18n. */
  name: string;
  /** Key-management page; empty for a custom endpoint. Where the provider runs separate mainland
   *  China and international consoles, this is the mainland one. */
  keyUrl: string;
  /** The international console's key page, for a provider whose `keyUrl` is the mainland one. */
  keyUrlIntl?: string;
  /** Detection-badge accent. */
  accent: string;
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: 'claude',
    name: 'Anthropic',
    keyUrl: 'https://platform.claude.com/settings/keys',
    accent: '#D97757',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/settings/organization/api-keys',
    accent: '#10A37F',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    accent: '#4D6BFE',
  },
  gemini: {
    id: 'gemini',
    name: 'Google',
    keyUrl: 'https://aistudio.google.com/apikey',
    accent: '#1A73E8',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    accent: '#6566F1',
  },
  zhipu: {
    id: 'zhipu',
    name: 'Zhipu',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    keyUrlIntl: 'https://z.ai/manage-apikey/apikey-list',
    accent: '#3859FF',
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba',
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
    keyUrlIntl: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key',
    accent: '#615CED',
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    keyUrl: 'https://platform.kimi.com/console/api-keys',
    keyUrlIntl: 'https://platform.kimi.ai/console/api-keys',
    accent: '#16091B',
  },
  doubao: {
    id: 'doubao',
    name: 'Doubao',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
    accent: '#4D6BFE',
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    keyUrl: 'https://console.perplexity.ai/project/keys',
    accent: '#20808D',
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    keyUrl: '',
    accent: '#5F7A8A',
  },
};

/** How a request asks for thinking: Anthropic's `thinking`/`output_config`, OpenRouter's normalized
 *  `reasoning`, Gemini's `extra_body.google`, Qwen's `enable_thinking`, a `thinking` on/off toggle
 *  beside `reasoning_effort`, or `reasoning_effort` alone. */
export type ThinkingWire = 'anthropic' | 'openrouter' | 'gemini' | 'qwen' | 'toggle' | 'effort';

export interface Quirks {
  /** Which SDK dialect serves this provider. */
  dialect: 'anthropic' | 'openai';
  thinkingWire: ThinkingWire;
  /** Whether the request can carry a thinking token budget, offered where the model publishes one. */
  thinkingBudgets?: true;
  /** Models.dev provider keys whose entries describe this provider's models, earlier keys winning. */
  catalogSources?: readonly string[];
  /** Whether a model reads images: a conservative model-id `guess`, and `probe` where the id is no
   *  authority, so a session probe confirms a positive guess. */
  vision: { guess: (model: string) => boolean; probe?: true };
  /** False where the platform has no model list a browser can read; the catalog suggests instead. */
  listsModels?: false;
  /** Account models outside this pattern are not offered to the assistant. */
  chatModelIds?: RegExp;
  /** Account models offered first, in order of preference, when the account has them. */
  preferredModels?: readonly string[];
  /** The hosts this provider is reached at, ordered global then China; every request names one, so
   *  no SDK falls back to a host of its own. Absent only for the custom provider, whose host is the
   *  user's. */
  baseUrls?: string[];
  /** Reasoning fields checked in wire-order; the UI depends on observed deltas. */
  reasoningFields?: readonly ('reasoning_content' | 'reasoning')[];
  /** Whether the provider accepts streamed usage metadata. */
  streamUsage?: boolean;
  /** Whether adapter construction requires an explicit URL. Prevents custom keys falling through to the SDK default. */
  needsBaseUrl?: boolean;
  /** Whether the dialect permits image blocks inside tool results. */
  imageInToolResult: boolean;
  /** The i18n key of the hint beside the model field, where the platform's model ids need one. */
  modelHintKey?: I18nKey;
}

// OpenAI-dialect adapters synthesize a missing tool-call id for every provider.

const lower = (model: string): string => model.toLowerCase();

/** What every hosted OpenAI-dialect platform shares: no images in tool results, streamed usage. */
const HOSTED_OPENAI = { dialect: 'openai', imageInToolResult: false, streamUsage: true } as const;

export const QUIRKS: Record<ProviderId, Quirks> = {
  claude: {
    dialect: 'anthropic',
    thinkingWire: 'anthropic',
    thinkingBudgets: true,
    catalogSources: ['anthropic'],
    baseUrls: ['https://api.anthropic.com'],
    imageInToolResult: true,
    vision: { guess: () => true },
  },
  openai: {
    ...HOSTED_OPENAI,
    thinkingWire: 'effort',
    catalogSources: ['openai'],
    chatModelIds: /^(?:ft:)?(?:gpt-|o[1-9])/,
    preferredModels: ['gpt-4.1-mini', 'gpt-4o-mini'],
    baseUrls: [OPENAI_BASE_URL],
    vision: { guess: (model) => /^(gpt-|o\d)/.test(lower(model)) && !/audio|realtime/.test(lower(model)) },
  },
  deepseek: {
    ...HOSTED_OPENAI,
    thinkingWire: 'toggle',
    catalogSources: ['deepseek'],
    baseUrls: ['https://api.deepseek.com'],
    reasoningFields: ['reasoning_content', 'reasoning'],
    vision: { guess: () => false },
  },
  gemini: {
    ...HOSTED_OPENAI,
    thinkingWire: 'gemini',
    thinkingBudgets: true,
    catalogSources: ['google'],
    baseUrls: ['https://generativelanguage.googleapis.com/v1beta/openai/'],
    reasoningFields: ['reasoning_content'],
    vision: { guess: () => true },
  },
  openrouter: {
    ...HOSTED_OPENAI,
    thinkingWire: 'openrouter',
    thinkingBudgets: true,
    catalogSources: ['openrouter'],
    baseUrls: ['https://openrouter.ai/api/v1'],
    // Routed models may use either normalized or backend-native reasoning fields.
    reasoningFields: ['reasoning', 'reasoning_content'],
    vision: { guess: (model) => /claude|gemini|gpt-|vision|-vl|omni|pixtral|llava/.test(lower(model)), probe: true },
  },
  zhipu: {
    ...HOSTED_OPENAI,
    thinkingWire: 'toggle',
    catalogSources: ['zai', 'zhipuai'],
    baseUrls: ['https://api.z.ai/api/paas/v4', 'https://open.bigmodel.cn/api/paas/v4'],
    reasoningFields: ['reasoning_content', 'reasoning'],
    vision: { guess: () => false },
  },
  qwen: {
    ...HOSTED_OPENAI,
    thinkingWire: 'qwen',
    thinkingBudgets: true,
    catalogSources: ['alibaba', 'alibaba-cn'],
    baseUrls: [
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ],
    reasoningFields: ['reasoning_content', 'reasoning'],
    vision: { guess: (model) => /vl|omni/.test(lower(model)) },
  },
  moonshot: {
    ...HOSTED_OPENAI,
    thinkingWire: 'toggle',
    catalogSources: ['moonshotai', 'moonshotai-cn'],
    baseUrls: ['https://api.moonshot.ai/v1', 'https://api.moonshot.cn/v1'],
    reasoningFields: ['reasoning_content', 'reasoning'],
    vision: { guess: () => false },
  },
  doubao: {
    ...HOSTED_OPENAI,
    thinkingWire: 'toggle',
    catalogSources: ['volcengine'],
    // Ark serves chat to browsers, but its model list answers without CORS headers.
    listsModels: false,
    baseUrls: ['https://ark.cn-beijing.volces.com/api/v3'],
    reasoningFields: ['reasoning_content'],
    modelHintKey: 'agent.setup_doubao_model',
    vision: { guess: (model) => /vision|doubao-seed-(?:1[.-][68]|2[.-]0)/.test(lower(model)), probe: true },
  },
  perplexity: {
    ...HOSTED_OPENAI,
    thinkingWire: 'effort',
    catalogSources: ['perplexity'],
    // The Router's OpenAI-compatible endpoint includes `/v1`.
    baseUrls: ['https://api.perplexity.ai/router/v1'],
    reasoningFields: ['reasoning_content'],
    vision: { guess: (model) => /claude|gemini|gpt-|grok/.test(lower(model)), probe: true },
  },
  custom: {
    dialect: 'openai',
    thinkingWire: 'effort',
    reasoningFields: ['reasoning_content', 'reasoning'],
    imageInToolResult: false,
    needsBaseUrl: true,
    vision: { guess: (model) => /vl|llava|vision|omni|pixtral|gemma3|llama4|claude|gemini|gpt-|grok/.test(lower(model)), probe: true },
  },
};

/** Which of a region-split platform's hosts a key was issued against: an index into `Quirks.baseUrls`,
 *  0 the global host (the default) and 1 the China host. */
export type ProviderRegion = 0 | 1;

/** The endpoint a connection's capability and vision caches key on: the custom URL, and nothing for a
 *  built-in platform, whose own host and any saved custom URL say nothing about its models. */
export function endpointKey(id: ProviderId, customBaseUrl: string | undefined): string | undefined {
  return id === 'custom' && customBaseUrl ? customBaseUrl : undefined;
}

/** Resolve a custom, regional, or single provider URL; undefined only for a custom provider with no
 *  address filed, which the OpenAI adapter refuses. */
export function baseUrlFor(id: ProviderId, opts: { customBaseUrl?: string; region?: ProviderRegion }): string | undefined {
  if (id === 'custom') return opts.customBaseUrl;
  const urls = QUIRKS[id].baseUrls;
  if (!urls) return undefined;
  return urls[opts.region ?? 0] ?? urls[0];
}

/** Whether the platform issues keys against separate global and China hosts. */
export function isRegionSplit(id: ProviderId): boolean {
  return (QUIRKS[id].baseUrls?.length ?? 0) > 1;
}

/** Every built-in host a provider adapter may call. Custom endpoints are supplied by the user and
 *  therefore cannot be enumerated here. */
export function providerBaseUrls(id: ProviderId): readonly string[] {
  return QUIRKS[id].baseUrls ?? [];
}

/** The built-in provider whose own host `url` is, ignoring a trailing slash; a custom endpoint
 *  pointed at a known platform reads that platform's facts. */
export function providerForEndpoint(url: string): ProviderId | undefined {
  const at = url.replace(/\/$/, '');
  return PROVIDER_IDS.find((id) => id !== 'custom' && providerBaseUrls(id).some((u) => u.replace(/\/$/, '') === at));
}

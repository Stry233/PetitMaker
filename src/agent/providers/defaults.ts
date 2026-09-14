/** SDK-independent provider metadata and wire-format quirks. Regional URLs are ordered global, then China. */

export type ProviderId =
  | 'claude'
  | 'openai'
  | 'deepseek'
  | 'gemini'
  | 'openrouter'
  | 'zhipu'
  | 'qwen'
  | 'moonshot'
  | 'doubao'
  | 'perplexity'
  | 'custom';

export const PROVIDER_IDS: readonly ProviderId[] = [
  'claude', 'openai', 'deepseek', 'gemini', 'openrouter', 'zhipu', 'qwen', 'moonshot', 'doubao', 'perplexity',
  'custom',
];

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
  /** Conservative model-id test for image input support. */
  vision: (model: string) => boolean;
}

const lower = (model: string): string => model.toLowerCase();

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  claude: {
    id: 'claude',
    name: 'Anthropic',
    keyUrl: 'https://platform.claude.com/settings/keys',
    accent: '#D97757',
    vision: () => true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    keyUrl: 'https://platform.openai.com/settings/organization/api-keys',
    accent: '#10A37F',
    vision: (model) => /^(gpt-|o\d)/.test(lower(model)) && !/audio|realtime/.test(lower(model)),
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    accent: '#4D6BFE',
    vision: () => false,
  },
  gemini: {
    id: 'gemini',
    name: 'Google',
    keyUrl: 'https://aistudio.google.com/apikey',
    accent: '#1A73E8',
    vision: () => true,
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
    keyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
    keyUrlIntl: 'https://z.ai/manage-apikey/apikey-list',
    accent: '#3859FF',
    vision: () => false,
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba',
    keyUrl: 'https://bailian.console.aliyun.com/cn-beijing/model/settings/api-key',
    keyUrlIntl: 'https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key',
    accent: '#615CED',
    vision: (model) => /vl|omni/.test(lower(model)),
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    keyUrl: 'https://platform.kimi.com/console/api-keys',
    keyUrlIntl: 'https://platform.kimi.ai/console/api-keys',
    accent: '#16091B',
    vision: () => false,
  },
  doubao: {
    id: 'doubao',
    name: 'Doubao',
    keyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apikey',
    accent: '#4D6BFE',
    vision: (model) => /vision|doubao-seed-(?:1[.-][68]|2[.-]0)/.test(lower(model)),
  },
  perplexity: {
    id: 'perplexity',
    name: 'Perplexity',
    keyUrl: 'https://console.perplexity.ai/project/keys',
    accent: '#20808D',
    // The session vision probe confirms this model-id heuristic.
    vision: (model) => /claude|gemini|gpt-|grok/.test(lower(model)),
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    keyUrl: '',
    accent: '#5F7A8A',
    // The session vision probe confirms this model-id heuristic for arbitrary gateways.
    vision: (model) => /vl|llava|vision|omni|pixtral|gemma3|llama4|claude|gemini|gpt-|grok/.test(lower(model)),
  },
};

/** Accent color by provider. */
export const PROVIDER_ACCENT: Record<ProviderId, string> = Object.fromEntries(
  PROVIDER_IDS.map((id) => [id, PROVIDER_META[id].accent]),
) as Record<ProviderId, string>;

export interface Quirks {
  /** Which SDK dialect serves this provider. */
  dialect: 'anthropic' | 'openai';
  /** OpenAI-dialect base URLs, ordered global then China. SDK defaults and custom URLs are omitted. */
  baseUrls?: string[];
  /** Reasoning fields checked in wire-order; the UI depends on observed deltas. */
  reasoningFields?: readonly ('reasoning_content' | 'reasoning')[];
  /** Whether the provider accepts streamed usage metadata. */
  streamUsage?: boolean;
  /** Whether adapter construction requires an explicit URL. Prevents custom keys falling through to the SDK default. */
  needsBaseUrl?: boolean;
  /** Whether the dialect permits image blocks inside tool results. */
  imageInToolResult: boolean;
}

// OpenAI-dialect adapters synthesize a missing tool-call id for every provider.

export const QUIRKS: Record<ProviderId, Quirks> = {
  claude: {
    dialect: 'anthropic',
    imageInToolResult: true,
  },
  openai: {
    dialect: 'openai',
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
    // Routed models may use either normalized or backend-native reasoning fields.
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
  doubao: {
    dialect: 'openai',
    baseUrls: ['https://ark.cn-beijing.volces.com/api/v3'],
    reasoningFields: ['reasoning_content'],
    imageInToolResult: false,
    streamUsage: true,
  },
  perplexity: {
    dialect: 'openai',
    // The Router's OpenAI-compatible endpoint includes `/v1`.
    baseUrls: ['https://api.perplexity.ai/router/v1'],
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

/** Default SDK endpoints that are absent from `QUIRKS.baseUrls`. */
export const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com';
export const OPENAI_DEFAULT_BASE = 'https://api.openai.com/v1';

/** Resolve a custom, regional, or single provider URL; undefined uses the SDK default. */
export function baseUrlFor(id: ProviderId, opts: { customBaseUrl?: string; region?: 0 | 1 }): string | undefined {
  if (id === 'custom') return opts.customBaseUrl;
  const urls = QUIRKS[id].baseUrls;
  if (!urls) return undefined;
  return urls[opts.region ?? 0] ?? urls[0];
}

/** Declared provider URLs, excluding SDK defaults and user-supplied custom endpoints. */
export function providerBaseUrls(id: ProviderId): readonly string[] {
  return QUIRKS[id].baseUrls ?? [];
}

/** Every built-in network endpoint a provider adapter may call. Custom endpoints are supplied by
 *  the user and therefore cannot be enumerated here. */
export function providerNetworkUrls(id: ProviderId): readonly string[] {
  if (id === 'claude') return [ANTHROPIC_DEFAULT_BASE];
  if (id === 'openai') return [OPENAI_DEFAULT_BASE];
  return providerBaseUrls(id);
}

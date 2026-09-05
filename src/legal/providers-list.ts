import { PROVIDER_IDS, PROVIDER_META } from '../agent/providers/defaults';
import { en } from '../i18n/locales/en';
import { zh } from '../i18n/locales/zh';
import { STYLIZE_PROVIDERS } from '../io/stylize/providers';

const AGENT_CUSTOM_ENDPOINT: Record<'en' | 'zh', string> = {
  en: 'User-configured custom endpoints (any OpenAI-compatible service you point the app at)',
  zh: '你自行配置的自定义端点（任何你让本应用连接的、兼容 OpenAI 接口的服务）',
};

const ILLUSTRATION_CUSTOM_ENDPOINT: Record<'en' | 'zh', string> = {
  en: 'Custom endpoint (a compatible image service you configure)',
  zh: '自定义端点（你自行配置的兼容图像服务）',
};

/** One disclosure entry per connection choice in the AI Agent. */
export function agentProviderDisclosureList(lang: 'en' | 'zh' = 'en'): string[] {
  const named = PROVIDER_IDS.filter((id) => id !== 'custom').map((id) => PROVIDER_META[id].name);
  return [...named, AGENT_CUSTOM_ENDPOINT[lang]];
}

/** One localized disclosure entry per connection choice in the illustration studio. */
export function illustrationProviderDisclosureList(lang: 'en' | 'zh' = 'en'): string[] {
  const strings = lang === 'zh' ? zh : en;
  return STYLIZE_PROVIDERS.map((provider) => {
    if (provider.id === 'custom') return ILLUSTRATION_CUSTOM_ENDPOINT[lang];
    return strings[`stylize.provider_${provider.id}`] ?? provider.id;
  });
}

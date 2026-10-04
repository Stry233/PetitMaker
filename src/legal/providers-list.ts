import { providerName } from '../i18n/providers';
import { PROVIDER_IDS } from '../agent/providers/defaults';
import { en } from '../i18n/locales/en';
import { zh } from '../i18n/locales/zh';
import { STYLIZE_PROVIDERS } from '../io/stylize/providers';

/** One disclosure entry per connection choice in the AI Agent. */
export function agentProviderDisclosureList(lang: 'en' | 'zh' = 'en'): string[] {
  const strings = lang === 'zh' ? zh : en;
  const named = PROVIDER_IDS.filter((id) => id !== 'custom').map((id) => providerName(id, key => strings[key] ?? key));
  return [...named, strings['legal.agent_custom_endpoint']!];
}

/** One localized disclosure entry per connection choice in the illustration studio. */
export function illustrationProviderDisclosureList(lang: 'en' | 'zh' = 'en'): string[] {
  const strings = lang === 'zh' ? zh : en;
  return STYLIZE_PROVIDERS.map((provider) => {
    if (provider.id === 'custom') return strings['legal.illustration_custom_endpoint']!;
    return strings[`stylize.provider_${provider.id}`] ?? provider.id;
  });
}

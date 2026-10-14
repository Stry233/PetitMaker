import { illustrationProviderName, providerName } from '../i18n/providers';
import { PROVIDER_IDS } from '../agent/providers/defaults';
import { loadedTable } from '../i18n/translations';
import { STYLIZE_PROVIDERS } from '../pipelines/stylize/facts';

/** One disclosure entry per connection choice in the AI Agent, in a loaded document language. */
export function agentProviderDisclosureList(lang: 'en' | 'zh' = 'en'): string[] {
  const strings = loadedTable(lang);
  const named = PROVIDER_IDS.filter((id) => id !== 'custom').map((id) => providerName(id, key => strings[key] ?? key));
  return [...named, strings['legal.agent_custom_endpoint']!];
}

/** One localized disclosure entry per connection choice in the illustration studio, in a loaded
 *  document language. */
export function illustrationProviderDisclosureList(lang: 'en' | 'zh' = 'en'): string[] {
  const strings = loadedTable(lang);
  return STYLIZE_PROVIDERS.map((provider) => {
    if (provider.id === 'custom') return strings['legal.illustration_custom_endpoint']!;
    return illustrationProviderName(provider.id, (key) => strings[key] ?? key);
  });
}

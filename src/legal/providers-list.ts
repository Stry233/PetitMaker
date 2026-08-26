/**
 * The AI-provider disclosure list rendered into the privacy policy's
 * `{providers}` token — DERIVED from the app's own provider registry
 * (`src/agent/providers/defaults.ts`) so the published list can never drift
 * from what the app can actually reach (pinned by the provider-drift test).
 *
 * The named entries are the registry's display names; the `custom` provider is
 * an arbitrary user-configured OpenAI-compatible endpoint, so it is disclosed
 * as a described category rather than a brand name.
 */
import { PROVIDER_IDS, PROVIDER_META } from '../agent/providers/defaults';

/** The custom-endpoint disclosure line, per document language. */
const CUSTOM_ENDPOINT_LINE: Record<'en' | 'zh', string> = {
  en: 'User-configured custom endpoints (any OpenAI-compatible service you point the app at)',
  zh: '你自行配置的自定义端点（任何你让本应用连接的、兼容 OpenAI 接口的服务）',
};

/**
 * The provider disclosure list, one entry per selectable provider: every named
 * provider's display label in registry order, then the custom-endpoint line.
 * `lang` localizes only the custom-endpoint line — brand names are identical
 * across languages.
 */
export function providerDisclosureList(lang: 'en' | 'zh' = 'en'): string[] {
  const named = PROVIDER_IDS.filter((id) => id !== 'custom').map((id) => PROVIDER_META[id].name);
  return [...named, CUSTOM_ENDPOINT_LINE[lang]];
}

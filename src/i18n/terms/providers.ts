/**
 * The one family of provider names, for the assistant's connections and the illustration studio's.
 * A platform both offer has one key, so its name reads the same on every surface. UI and document names follow the
 * reader's language; provider ids remain unchanged. Callers pass the rosters' own id types, so a
 * provider missing here fails the type check where its name is shown.
 */
import type { I18nKey, Translate } from '../keys';

const PROVIDER_NAME_KEYS = {
  claude: 'provider.name_claude',
  openai: 'provider.name_openai',
  deepseek: 'provider.name_deepseek',
  gemini: 'provider.name_gemini',
  openrouter: 'provider.name_openrouter',
  zhipu: 'provider.name_zhipu',
  qwen: 'provider.name_qwen',
  moonshot: 'provider.name_moonshot',
  doubao: 'provider.name_doubao',
  perplexity: 'provider.name_perplexity',
  custom: 'provider.name_custom',
} as const satisfies Record<string, I18nKey>;

/** The studio names Google's image model by product and the custom choice by what it asks for. */
const ILLUSTRATION_NAME_KEYS = {
  gemini: 'stylize.provider_gemini',
  openai: PROVIDER_NAME_KEYS.openai,
  siliconflow: 'stylize.provider_siliconflow',
  stepfun: 'stylize.provider_stepfun',
  modelscope: 'stylize.provider_modelscope',
  doubao: PROVIDER_NAME_KEYS.doubao,
  custom: 'stylize.provider_custom',
} as const satisfies Record<string, I18nKey>;

/** An assistant provider's name. */
export function providerName(id: keyof typeof PROVIDER_NAME_KEYS, t: Translate): string {
  return t(PROVIDER_NAME_KEYS[id]);
}

/** An illustration provider's name. */
export function illustrationProviderName(id: keyof typeof ILLUSTRATION_NAME_KEYS, t: Translate): string {
  return t(ILLUSTRATION_NAME_KEYS[id]);
}

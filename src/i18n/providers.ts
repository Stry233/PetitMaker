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
} as const;

/** UI and document names follow the reader's language; provider IDs remain unchanged. */
export function providerName(id: keyof typeof PROVIDER_NAME_KEYS, t: (key: string) => string): string {
  return t(PROVIDER_NAME_KEYS[id]);
}

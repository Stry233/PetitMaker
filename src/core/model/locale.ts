/** The UI locales, in the order the language picker lists them. */
export const LOCALES = ['zh', 'en', 'ja', 'ru', 'th', 'id', 'fr'] as const;
export type Locale = typeof LOCALES[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * A display name localized into one or more locales. `en` is required as the
 * universal fallback; every other locale is optional, so content data (catalog,
 * map templates) may ship only the locales it has translations for and the rest
 * gracefully fall back to English via `localizedName()`.
 */
export type LocalizedName = { en: string } & Partial<Record<Locale, string>>;

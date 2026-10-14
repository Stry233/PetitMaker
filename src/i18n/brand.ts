/**
 * The product's names: the app (`{app}`, also the `app.name` key) and its image map code (`{glyph}`).
 * translateFor fills both tokens in every string, and the agent system prompt reads the app name, so
 * copy never writes either name out.
 *
 * Outside the locale tables the deployment titles in platform/build/deploy-targets.ts, the index.html fallback
 * title and package.json also carry the app name and need review when it changes.
 */
import { IS_LITE } from '../platform/build/edition.ts';
import type { Locale } from '../core/model/locale.ts';

export const BASE_APP_NAME = 'PetitMaker';

/** Per-locale names without the edition badge; locales absent here use BASE_APP_NAME. */
const LOCALE_BASE_NAMES: Partial<Record<Locale, string>> = {
  zh: '谷地工坊',
};

/** The wordmark's name; edition badges are rendered separately. */
export function baseBrandName(locale: Locale): string {
  return LOCALE_BASE_NAMES[locale] ?? BASE_APP_NAME;
}

/** The brand name to display for a locale, edition included: the single resolver behind `{app}`. */
export function brandName(locale: Locale): string {
  const base = baseBrandName(locale);
  return IS_LITE ? `${base} (Lite)` : base;
}

export const APP_NAME = brandName('en');

/** The name of the map code an exported image carries, the `{glyph}` token; the same in every locale. */
export const GLYPH_NAME = 'PetitGlyph';

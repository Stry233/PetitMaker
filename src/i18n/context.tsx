import { createContext, useContext, useCallback, useEffect, type ReactNode } from 'react';
import { localeTag, translations } from './translations';
import { useEditorStore } from '../state/store';
import { landmarkItem } from '../state/catalog';
import { brandName } from '../version';
import type { Locale, LocalizedName, Translate } from '../core/model/types';

/** Resolve a content name for the active locale, falling back to English. */
export function localizedName(name: LocalizedName, locale: Locale): string {
  return name[locale] ?? name.en;
}

const I18nContext = createContext<Translate>((key) => key);

/**
 * Late-arriving string tables, registered by a lazy chunk for its own keys (the Help Center's
 * tables are megabytes of prose nobody pays for until the window opens). An overlay only ever ADDS
 * keys: the main tables always win, so a chunk cannot re-word the interface.
 */
let extraTables: Partial<Record<Locale, Record<string, string>>> = {};

/** Merge a per-locale table set into the overlay. Idempotent per call site by construction: the
 *  caller registers a module-level constant, and re-merging the same table changes nothing. */
export function registerExtraStrings(tables: Partial<Record<Locale, Record<string, string>>>): void {
  const next: typeof extraTables = { ...extraTables };
  for (const [locale, table] of Object.entries(tables) as [Locale, Record<string, string>][]) {
    next[locale] = { ...next[locale], ...table };
  }
  extraTables = next;
}

/** Tokens every string may use without a caller passing them, each read from its one source: `{app}`
 *  from the brand name (see version.ts), `{landmark}` from the template landmark's catalog name. A
 *  locale may leave one out, since no caller supplies it. */
export const RESOLVED_TOKENS: Readonly<Record<string, (locale: Locale) => string>> = {
  app: brandName,
  landmark: (locale) => localizedName(landmarkItem().name, locale),
};


/** A number as copy reads it: integers of five digits or more take the locale's digit grouping
 *  (10,000, 10 000, 10.000); shorter numbers, years among them, stay ungrouped in every locale. */
export function formatNumber(locale: Locale, n: number): string {
  return Number.isInteger(n) && Math.abs(n) >= 10000 ? new Intl.NumberFormat(localeTag(locale)).format(n) : String(n);
}

/** `params` with every number formatted by `formatNumber`, for params that are all quantities
 *  (limits and counts in rule messages). Identifiers such as seeds must not pass through it. */
export function quantityParams(locale: Locale, params?: Record<string, string | number>): Record<string, string> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'number' ? formatNumber(locale, v) : v]));
}

/** Resolve a key for a specific locale (falling back to English) + interpolate `{name}` params
 *  after the `RESOLVED_TOKENS`, so no translation string hardcodes a brand or catalog name.
 *  Params are inserted as written; quantities go through `quantityParams` first. */
export function translateFor(locale: Locale, key: string, params?: Record<string, string | number>): string {
  if (key === 'app.name') return brandName(locale);
  let text = translations[locale]?.[key] ?? extraTables[locale]?.[key]
    ?? translations['en'][key] ?? extraTables['en']?.[key] ?? key;
  for (const [token, resolve] of Object.entries(RESOLVED_TOKENS)) {
    if (text.includes(`{${token}}`)) text = text.split(`{${token}}`).join(resolve(locale));
  }
  if (params) {
    // split/join, not replace: a param value is literal text, never a replacement pattern.
    for (const [k, v] of Object.entries(params)) text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}

/** Hook-free translate for imperative code outside the provider (e.g. toasts in event
 *  handlers). Reads the active locale from the store, like other imperative store access. */
export function translate(key: string, params?: Record<string, string | number>): string {
  return translateFor(useEditorStore.getState().locale, key, params);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useEditorStore((s) => s.locale);
  const t: Translate = useCallback((key, params) => translateFor(locale, key, params), [locale]);
  // The deployment owns the document head; a saved editor locale applies only to the app subtree.
  useEffect(() => {
    document.getElementById('root')?.setAttribute('lang', localeTag(locale));
  }, [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): Translate {
  return useContext(I18nContext);
}

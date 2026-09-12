import { createContext, useContext, useCallback, useEffect, type ReactNode } from 'react';
import { translations } from './translations';
import { useEditorStore } from '../state/store';
import { brandName } from '../version';
import type { Locale, LocalizedName } from '../core/model/types';

type TFunction = (key: string, params?: Record<string, string | number>) => string;

/** Resolve a content name for the active locale, falling back to English. */
export function localizedName(name: LocalizedName, locale: Locale): string {
  return name[locale] ?? name.en;
}

const I18nContext = createContext<TFunction>((key) => key);

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

/** Resolve a key for a specific locale (falling back to English) + interpolate `{name}` params.
 *  The `{app}` token is always resolved from the central brand name (see version.ts), so no
 *  translation string ever hardcodes the project name. */
export function translateFor(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let text = translations[locale]?.[key] ?? extraTables[locale]?.[key]
    ?? translations['en'][key] ?? extraTables['en']?.[key] ?? key;
  text = text.split('{app}').join(brandName(locale));
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
  const t: TFunction = useCallback((key, params) => translateFor(locale, key, params), [locale]);
  // The deployment owns the document head; a saved editor locale applies only to the app subtree.
  useEffect(() => {
    document.getElementById('root')?.setAttribute('lang', locale === 'zh' ? 'zh-CN' : locale);
  }, [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): TFunction {
  return useContext(I18nContext);
}

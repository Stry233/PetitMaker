import { createContext, useContext, useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { en } from './locales/en';
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
 * Late-arriving string tables, in two layers that are managed separately:
 *
 * - `baseTables` — a locale's INTERFACE table, one per locale, arriving with the language that reads
 *   it (`locales/index.ts`).
 * - `extraTables` — prose a window registers for its own keys: the Help Center's tables are megabytes
 *   nobody pays for until the window opens.
 *
 * Base outranks extra, so a help string that happens to use an interface key cannot re-word the
 * interface it is displayed in. Both only ADD keys: the eager table (English) wins over either.
 */
let baseTables: Partial<Record<Locale, Record<string, string>>> = {};
let extraTables: Partial<Record<Locale, Record<string, string>>> = {};

let version = 0;
const stringsListeners = new Set<() => void>();

/** Re-render when a table lands: the interface is painted before its locale's table has to be in
 *  hand, so an arrival has to reach the components that already rendered in the fallback. */
export function subscribeStrings(listener: () => void): () => void {
  stringsListeners.add(listener);
  return () => { stringsListeners.delete(listener); };
}

export function stringsVersion(): number {
  return version;
}

function merge(store: Partial<Record<Locale, Record<string, string>>>, tables: Partial<Record<Locale, Record<string, string>>>): typeof store {
  const next = { ...store };
  for (const [locale, table] of Object.entries(tables) as [Locale, Record<string, string>][]) {
    next[locale] = { ...next[locale], ...table };
  }
  version += 1;
  for (const listener of stringsListeners) listener();
  return next;
}

/** Merge a locale's interface table. Idempotent per call site: the caller registers a module-level
 *  constant, and re-merging the same table changes nothing. */
export function registerBaseStrings(tables: Partial<Record<Locale, Record<string, string>>>): void {
  baseTables = merge(baseTables, tables);
}

/** Merge a window's own tables into the prose overlay. */
export function registerExtraStrings(tables: Partial<Record<Locale, Record<string, string>>>): void {
  extraTables = merge(extraTables, tables);
}

/**
 * The table that ships on the eager bundle. English alone: it is the fallback every other locale
 * leans on, so it has to be readable before the first render. The other six arrive through
 * `ensureLocaleStrings` (`locales/index.ts`), which keeps six tables of interface strings off the
 * start-up payload.
 */
const eagerTables: Partial<Record<Locale, Record<string, string>>> = { en };

/** Resolve a key for a specific locale (falling back to English) + interpolate `{name}` params.
 *  The `{app}` token is always resolved from the central brand name (see version.ts), so no
 *  translation string ever hardcodes the project name. */
export function translateFor(locale: Locale, key: string, params?: Record<string, string | number>): string {
  let text = eagerTables[locale]?.[key] ?? baseTables[locale]?.[key] ?? extraTables[locale]?.[key]
    ?? en[key] ?? extraTables['en']?.[key] ?? key;
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
  // A table that lands after the first frame has to reach the components already rendered with the
  // fallback, so the provider reads the arrival counter and the translate function is keyed on it.
  const revision = useSyncExternalStore(subscribeStrings, stringsVersion, stringsVersion);
  const t: TFunction = useCallback((key, params) => translateFor(locale, key, params), [locale, revision]);
  // The deployment owns the document head; a saved editor locale applies only to the app subtree.
  useEffect(() => {
    document.getElementById('root')?.setAttribute('lang', locale === 'zh' ? 'zh-CN' : locale);
  }, [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): TFunction {
  return useContext(I18nContext);
}

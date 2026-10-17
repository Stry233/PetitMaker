import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { helpTranslations, loadHelpTables, loadLocale, localeTablesVersion, onLocaleTables, translations } from './translations';
import { useEditorStore } from '../state/store';
import { landmarkItem } from '../state/catalog';
import { ANCHOR_LANDMARK } from '../core/game/profile';
import { brandName, GLYPH_NAME } from './terms/brand';
import type { Locale, LocalizedName } from '../core/model/locale';
import type { ParamsFor, TextKey, Translate } from './keys';
import { localeTag } from './locale-info';

/** Resolve a content name for the active locale, falling back to English. */
export function localizedName(name: LocalizedName, locale: Locale): string {
  return name[locale] ?? name.en;
}

const I18nContext = createContext<Translate>((key) => key);

/** A translator answering in `locale`, carrying it for the quantity formatting `terms/rule-copy.ts` does. */
export function translatorFor(locale: Locale): Translate {
  return Object.assign(<K extends TextKey>(key: K, params?: ParamsFor<K>) => translateFor(locale, key, params), { locale });
}

/** Tokens every string may use without a caller passing them, each read from its one source: `{app}`
 *  and `{glyph}` from terms/brand.ts, `{landmark}` from the anchor landmark's catalog name, empty for a game
 *  without one. A locale may leave one out, since no caller supplies it. */
export const RESOLVED_TOKENS: Readonly<Record<string, (locale: Locale) => string>> = {
  app: brandName,
  glyph: () => GLYPH_NAME,
  landmark: (locale) => (ANCHOR_LANDMARK ? localizedName(landmarkItem().name, locale) : ''),
};


/** A number as copy reads it: integers of five digits or more take the locale's digit grouping
 *  (10,000, 10 000, 10.000); shorter integers, years among them, stay ungrouped in every locale; a
 *  fraction takes the locale's decimal mark (2.6, 2,6). */
export function formatNumber(locale: Locale, n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 10000) return String(n);
  return new Intl.NumberFormat(localeTag(locale), { useGrouping: Math.abs(n) >= 10000, maximumFractionDigits: 3 }).format(n);
}

/** `params` with every number formatted by `formatNumber`, for params that are all quantities
 *  (limits and counts in rule messages). Identifiers such as seeds must not pass through it. A number
 *  the formatting leaves unchanged stays a number, so `{n}` still selects its plural form. */
export function quantityParams(locale: Locale, params?: Record<string, string | number>): Record<string, string | number> | undefined {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).map(([k, v]) => {
    if (typeof v !== 'number') return [k, v];
    const text = formatNumber(locale, v);
    return [k, text === String(v) ? v : text];
  }));
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** The CLDR plural category of `count` in `locale` (`one`, `few`, `many`, `other` and so on). */
function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) pluralRules.set(locale, (rules = new Intl.PluralRules(localeTag(locale))));
  return rules.select(count);
}

/** The count a `{n}` param carries: a number, or a grouped integer `quantityParams` wrote out. */
function countOf(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d{1,3}(?:[\s.,\u00a0\u202f]\d{3})+$/.test(value)) return Number(value.replace(/\D/g, ''));
  return undefined;
}

/** A key's text in one locale's tables. A counted key (`params.n`) reads `key_single` for a count of
 *  exactly 1 when declared (wording that drops the number), else the plural variant
 *  `key_<category>` when that locale declares one; the bare key is the `other` form. */
function lookup(locale: Locale, key: string, count: number | undefined): string | undefined {
  const table = (k: string) => translations[locale]?.[k] ?? helpTranslations[locale]?.[k];
  if (count !== undefined) {
    const single = count === 1 ? table(`${key}_single`) : undefined;
    if (single !== undefined) return single;
    const variant = table(`${key}_${pluralCategory(locale, count)}`);
    if (variant !== undefined) return variant;
  }
  return table(key);
}

/** A placeholder: `{ui:key}` names an interface control by its key, so copy that mentions a control
 *  (Help above all) shows its current label in the same locale; any other `{name}` is a
 *  `RESOLVED_TOKENS` entry or a caller param. */
const PLACEHOLDER = /\{(ui:[a-z0-9_.]+|[A-Za-z0-9_]+)\}/g;

const hasOwn = (record: object, name: string): boolean => Object.prototype.hasOwnProperty.call(record, name);

/** A label as copy names it: without the closing ellipsis a control wears when it opens a further step. */
const withoutEllipsis = (label: string): string => label.replace(/(…|\.\.\.)$/, '');

/** Resolve a key for a specific locale (falling back to English) and fill its placeholders in one
 *  pass over the template: a `{ui:key}` label (its closing ellipsis left out), else a `RESOLVED_TOKENS` entry, else a param, so no
 *  translation string hardcodes a control label, brand or catalog name. Inserted text is never
 *  scanned again, so a param carrying typed text such as `{n}` stays literal. Params are inserted as
 *  written; quantities go through `quantityParams` first. A numeric `{n}` picks the plural form, so
 *  callers pass the base key whatever the count. */
export function translateFor<K extends TextKey>(locale: Locale, key: K, params?: ParamsFor<K>): string {
  const count = countOf(params?.n);
  const text = lookup(locale, key, count) ?? lookup('en', key, count) ?? key;
  if (!text.includes('{')) return text;
  return text.replace(PLACEHOLDER, (match, name: string) => {
    // A `{ui:key}` token names an interface key; `ui-names.test.ts` holds every one to the tables.
    if (name.startsWith('ui:')) return withoutEllipsis(translateFor(locale, name.slice(3) as TextKey));
    if (hasOwn(RESOLVED_TOKENS, name)) return RESOLVED_TOKENS[name]!(locale);
    if (params && hasOwn(params, name)) return String(params[name]);
    return match;
  });
}

/** Hook-free translate for imperative code outside the provider (e.g. toasts in event
 *  handlers). Reads the active locale from the store, like other imperative store access. */
export function translate<K extends TextKey>(key: K, params?: ParamsFor<K>): string {
  return translateFor(useEditorStore.getState().locale, key, params);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const locale = useEditorStore((s) => s.locale);
  const tables = useSyncExternalStore(onLocaleTables, localeTablesVersion, localeTablesVersion);
  useEffect(() => { loadLocale(locale).catch(() => {}); }, [locale]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a table that arrives after the locale was chosen must give every reader a new translator
  const t: Translate = useMemo(() => translatorFor(locale), [locale, tables]);
  // The deployment owns the document head; a saved editor locale applies only to the app subtree.
  useEffect(() => {
    document.getElementById('root')?.setAttribute('lang', localeTag(locale));
  }, [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

/** Asks for the Help table of the editor's locale, with English; the translator re-renders when it
 *  arrives, and until then Help reads in English. */
export function useHelpTables(): void {
  const locale = useEditorStore((s) => s.locale);
  useEffect(() => { loadHelpTables(locale).catch(() => {}); }, [locale]);
}

/** The editor's display language. */
export function useLocale(): Locale {
  return useEditorStore((s) => s.locale);
}

export function useT(): Translate {
  return useContext(I18nContext);
}

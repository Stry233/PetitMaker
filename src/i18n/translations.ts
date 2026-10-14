import type { Locale } from '../core/model/locale';
import { createSignal } from '../core/base/signal';
import { en } from './locales/en';

type Table = Readonly<Record<string, string>>;

/** The interface tables loaded so far: English, the reference every lookup falls back to, always;
 *  every other locale once `loadLocale` brought its chunk. One page-wide registry. */
export const translations: { en: Table } & Partial<Record<Locale, Table>> = { en };

/** The Help Center's tables, the registry's second part: an order of magnitude longer than the
 *  interface's strings, so each locale's, English included, is its own chunk that Help asks for when
 *  it first shows that locale (`loadHelpTables`). A lookup reads the interface table first. */
export const helpTranslations: Partial<Record<Locale, Table>> = {};

/** Each other locale's table as its own chunk, fetched when the editor first shows that locale. */
const LOADERS: Readonly<Record<Exclude<Locale, 'en'>, () => Promise<Table>>> = {
  zh: () => import('./locales/zh').then((m) => m.zh),
  ja: () => import('./locales/ja').then((m) => m.ja),
  ru: () => import('./locales/ru').then((m) => m.ru),
  th: () => import('./locales/th').then((m) => m.th),
  id: () => import('./locales/id').then((m) => m.id),
  fr: () => import('./locales/fr').then((m) => m.fr),
};

const HELP_LOADERS: Readonly<Record<Locale, () => Promise<Table>>> = {
  en: () => import('./locales/help/en').then((m) => m.helpEn),
  zh: () => import('./locales/help/zh').then((m) => m.helpZh),
  ja: () => import('./locales/help/ja').then((m) => m.helpJa),
  ru: () => import('./locales/help/ru').then((m) => m.helpRu),
  th: () => import('./locales/help/th').then((m) => m.helpTh),
  id: () => import('./locales/help/id').then((m) => m.helpId),
  fr: () => import('./locales/help/fr').then((m) => m.helpFr),
};

/** Counts the tables that arrived, so a reader of the registry can re-read when one does. */
const arrivals = createSignal<number>(0);
export const onLocaleTables = (listener: () => void): (() => void) => arrivals.subscribe(listener);
export const localeTablesVersion = (): number => arrivals.get();

/** Puts `table` in the registry as `locale`'s interface table, or its Help table. */
export function registerLocaleTable(locale: Locale, table: Table, part: 'ui' | 'help' = 'ui'): void {
  const tables = part === 'ui' ? translations : helpTranslations;
  if (tables[locale] === table) return;
  tables[locale] = table;
  arrivals.emit(arrivals.get() + 1);
}

/** The loads in flight, by part and locale. */
const pending = new Map<string, Promise<void>>();

/** Runs `load` once per `id` until it succeeds; a failed load is forgotten, so the next call retries. */
function loadOnce(id: string, load: () => Promise<void>): Promise<void> {
  let loading = pending.get(id);
  if (!loading) {
    loading = load().catch((error: unknown) => { pending.delete(id); throw error; });
    pending.set(id, loading);
  }
  return loading;
}

/** Whether `locale`'s table is in the registry. */
export function localeLoaded(locale: Locale): boolean {
  return translations[locale] !== undefined;
}

/** `locale`'s table for code that writes in a language other than the interface's (legal
 *  documents); the caller loads it first, so a missing table is an ordering fault and throws. */
export function loadedTable(locale: Locale): Table {
  const table = translations[locale];
  if (!table) throw new Error(`The ${locale} interface table is not loaded.`);
  return table;
}

/** Brings `locale`'s table into the registry; resolves at once for a loaded one. A failed load is
 *  forgotten, so the next call retries. */
export function loadLocale(locale: Locale): Promise<void> {
  if (localeLoaded(locale) || locale === 'en') return Promise.resolve();
  return loadOnce(locale, () => LOADERS[locale]().then((table) => { registerLocaleTable(locale, table); }));
}

/** Brings `locale`'s Help table into the registry, with English, the table every lookup falls back
 *  to; resolves at once when both are there. */
export function loadHelpTables(locale: Locale): Promise<void> {
  const one = (id: Locale): Promise<void> => (helpTranslations[id] ? Promise.resolve()
    : loadOnce(`help:${id}`, () => HELP_LOADERS[id]().then((table) => { registerLocaleTable(id, table, 'help'); })));
  return Promise.all([one('en'), one(locale)]).then(() => undefined);
}

/** Brings every locale's table into the registry, for a reader that offers all of them. */
export function loadAllLocales(): Promise<void> {
  return Promise.all((Object.keys(LOADERS) as Locale[]).map(loadLocale)).then(() => undefined);
}

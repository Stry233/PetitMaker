/*
 * The interface tables, one chunk per locale, registered when they arrive. English stays on the
 * eager bundle: `translateFor` falls back to it for every key a locale is missing, so it has to be
 * readable before the first render. The other six are read only by someone reading that language,
 * and merged into a single chunk they were the largest item on the start-up payload — 535 KB raw /
 * 155 KB gzip, all of it modulepreloaded. `i18n/translations.ts` keeps the merged record for tests,
 * scripts and the legal-page generator; nothing on the runtime path imports it.
 */
import type { Locale } from '../../core/model/types';
import { registerBaseStrings } from '../context';

/** Every locale a saved preference may name, in the order the settings list them. */
export const LOCALES: readonly Locale[] = ['en', 'zh', 'ja', 'ru', 'th', 'id', 'fr'];

/** True for a string that names a locale we ship tables for (a stored preference, an agent's
 *  reported UI language, a URL parameter). */
export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** Static specifiers, so the bundler gives each table its own chunk and fetches exactly one. */
const LOADERS: Record<Exclude<Locale, 'en'>, () => Promise<Record<string, Record<string, string>>>> = {
  zh: () => import('./zh').then((m) => ({ zh: m.zh })),
  ja: () => import('./ja').then((m) => ({ ja: m.ja })),
  ru: () => import('./ru').then((m) => ({ ru: m.ru })),
  th: () => import('./th').then((m) => ({ th: m.th })),
  id: () => import('./id').then((m) => ({ id: m.id })),
  fr: () => import('./fr').then((m) => ({ fr: m.fr })),
};

/** In-flight or finished loads, so concurrent callers (boot, and a switch before it lands) share one
 *  import instead of racing two. */
const pending = new Map<Locale, Promise<void>>();

/**
 * Register `locale`'s interface table.
 *
 * Resolves without a request for English. Safe to call repeatedly: the second call returns the same
 * promise. A failed fetch is dropped from the memo rather than remembered, so a later attempt
 * retries — the caller still sees the rejection, because a language that did not arrive is a fact
 * the caller decides on (boot renders anyway; the switcher keeps the old language and offers a retry).
 */
export function ensureLocaleStrings(locale: Locale): Promise<void> {
  if (locale === 'en') return Promise.resolve();
  const running = pending.get(locale);
  if (running) return running;
  const load = LOADERS[locale]().then(registerBaseStrings, (err: unknown) => {
    pending.delete(locale);
    throw err;
  });
  pending.set(locale, load);
  return load;
}

/*
 * The interface tables, one chunk per locale, registered as an i18n OVERLAY when they arrive — the
 * same mechanism the Help Center uses for its prose (`locales/help/index.ts`).
 *
 * English stays on the eager bundle: `translateFor` falls back to it for every key a locale is
 * missing, so it has to be readable before the first render. The other six are only ever read by
 * someone reading that language, and merged into one chunk they were the single largest item on the
 * start-up payload (535 KB raw / 155 KB gzip, seven tables, all of it modulepreloaded), so each now
 * arrives with the language that needs it. `i18n/translations.ts` still holds the merged record for
 * tests, scripts and the legal-page generator; nothing on the runtime path imports it.
 */
import type { Locale } from '../../core/model/types';
import { registerExtraStrings } from '../context';

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

/** In-flight or finished loads, so concurrent callers (boot, and a switch before it lands) share
 *  one import instead of racing two. */
const pending = new Map<Locale, Promise<void>>();

/**
 * Put `locale`'s table where `translateFor` can see it.
 *
 * Resolves without a request for English, which is already on the bundle. Safe to call repeatedly:
 * the second call returns the same promise. A failed fetch is dropped from the memo rather than
 * remembered, so a later attempt retries — but the caller still sees the rejection, because a
 * locale that did not arrive is a fact the caller may need (boot renders anyway; the switcher
 * decides whether to keep the old language).
 */
export function ensureLocaleStrings(locale: Locale): Promise<void> {
  if (locale === 'en') return Promise.resolve();
  const running = pending.get(locale);
  if (running) return running;
  const load = LOADERS[locale]().then(registerExtraStrings, (err: unknown) => {
    pending.delete(locale);
    throw err;
  });
  pending.set(locale, load);
  return load;
}

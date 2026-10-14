import type { Locale } from '../core/model/locale.ts';
import type { en } from './locales/en.ts';
import type { helpEn } from './locales/help/en.ts';

/** The suffixes of the plural variants `translateFor` selects through a numeric `{n}`. */
type PluralSuffix = '_zero' | '_one' | '_two' | '_few' | '_many';

/** `K` unless it is a plural variant of another key in `Keys`. */
type BaseOf<K extends string, Keys extends string> = K extends `${infer B}${PluralSuffix}` ? (B extends Keys ? never : K) : K;

/** The table every locale shares: each base key of the reference table, plus the plural variants the
 *  locale's own rules select. */
type TableOf<Keys extends string> = Record<BaseOf<Keys, Keys>, string> & Partial<Record<`${BaseOf<Keys, Keys>}${PluralSuffix}`, string>>;

/** A key of the interface tables. */
export type I18nKey = BaseOf<keyof typeof en & string, keyof typeof en & string>;
export type LocaleTable = TableOf<keyof typeof en & string>;

/** A key of the Help tables. */
export type HelpKey = keyof typeof helpEn & string;
export type HelpTable = TableOf<HelpKey>;

/** Any key the translation lookup resolves: an interface key or a Help key. */
export type TextKey = I18nKey | HelpKey;

/** A UI string lookup: a locale key and its `{param}` substitutions, answered in the active language.
 *  The app's translators carry that `locale`, which `rule-copy.ts` formats a refusal's quantities in;
 *  a bare stub (a test's) leaves them as written. */
export interface Translate {
  (key: TextKey, params?: Record<string, string | number>): string;
  readonly locale?: Locale;
}

import type { Locale } from '../core/model/locale.ts';
import type { LayerNumber } from '../core/game/profile.ts';
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

/** A string's `{param}` substitutions. */
export type TextParams = Record<string, string | number>;

/** The interface strings that name a layer, by the param carrying its number. That param takes a
 *  `LayerNumber` alone, so a raw elevation never reaches the copy; `terms/layer-name.ts` words a layer
 *  through `layer.name` and `layer.tile`, and `__tests__/i18n/layer-name.test.ts` holds every string naming a layer to this list. */
export const LAYER_PARAMS = {
  'layer.name': 'n',
  'layer.tile': 'n',
  'error.elevation_limit': 'max',
  'error.water_only_layer': 'layer',
  'agent.dc_paint': 'elev',
  'agent.dc_paint_smooth': 'elev',
  'agent.dc_wall': 'crest',
} as const satisfies { readonly [K in I18nKey]?: string };

/** The params key `K` takes: a layer string's layer param is a `LayerNumber`. A key not known
 *  until run time takes plain params. */
export type ParamsFor<K extends TextKey> = [K] extends [keyof typeof LAYER_PARAMS]
  ? TextParams & { readonly [P in (typeof LAYER_PARAMS)[K]]: LayerNumber }
  : TextParams;

/** A UI string lookup: a locale key and its `{param}` substitutions, answered in the active language.
 *  The app's translators carry that `locale`, which `terms/rule-copy.ts` formats a refusal's quantities in;
 *  a bare stub (a test's) leaves them as written. */
export interface Translate {
  <K extends TextKey>(key: K, params?: ParamsFor<K>): string;
  readonly locale?: Locale;
}

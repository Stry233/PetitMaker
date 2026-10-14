/** Each UI locale's tag, names and list style. */
import type { Locale } from '../core/model/locale';

/** How a locale joins a run of names: `sep` between the leading items, `and` before the last. */
interface ListStyle {
  readonly sep: string;
  readonly and: string;
}

interface LocaleInfo {
  /** BCP 47 tag, for `lang` attributes and `Intl` formatters. */
  readonly tag: string;
  /** The language's name in its own script, as the language picker shows it. */
  readonly label: string;
  /** The language's English name, as model-facing prompts name it. */
  readonly englishName: string;
  readonly list: ListStyle;
}

export const LOCALE_INFO: Readonly<Record<Locale, LocaleInfo>> = {
  zh: { tag: 'zh-CN', label: '中文', englishName: 'Simplified Chinese', list: { sep: '、', and: '、' } },
  en: { tag: 'en', label: 'English', englishName: 'English', list: { sep: ', ', and: ' and ' } },
  ja: { tag: 'ja', label: '日本語', englishName: 'Japanese', list: { sep: '、', and: '、' } },
  ru: { tag: 'ru', label: 'Русский', englishName: 'Russian', list: { sep: ', ', and: ' и ' } },
  th: { tag: 'th', label: 'ไทย', englishName: 'Thai', list: { sep: ', ', and: ' และ ' } },
  id: { tag: 'id', label: 'Indonesia', englishName: 'Indonesian', list: { sep: ', ', and: ' dan ' } },
  fr: { tag: 'fr', label: 'Français', englishName: 'French', list: { sep: ', ', and: ' et ' } },
};

/** The BCP 47 tag for a UI locale. */
export const localeTag = (locale: Locale): string => LOCALE_INFO[locale].tag;

/** `values` joined as the locale writes a list of names: "a, b and c" in English, ideographic commas throughout in Chinese and Japanese.
 *  `conjunction: false` writes a run of facts that is not an enumeration ("a, b, c") with the same separator. */
export function joinList(locale: Locale, values: readonly string[], { conjunction = true }: { conjunction?: boolean } = {}): string {
  if (values.length < 2) return values[0] ?? '';
  const { sep, and } = LOCALE_INFO[locale].list;
  return `${values.slice(0, -1).join(sep)}${conjunction ? and : sep}${values[values.length - 1]}`;
}

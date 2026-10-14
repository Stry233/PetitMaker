import { translations } from '../../i18n/translations';

/** The base of a plural variant `base_<category>` whose base the en table declares, else null. A
 *  variant is read through its base key's `{n}`, so key-set checks treat it as part of the base. */
export function pluralBase(key: string): string | null {
  const m = /^(.*)_(zero|one|two|few|many)$/.exec(key);
  return m && m[1]! in translations.en ? m[1]! : null;
}

/** The base a counted variant is read through: a plural variant, or the exact-one `base_single`
 *  that `translateFor` reads for a count of 1; else null. */
export function countedBase(key: string): string | null {
  const m = /^(.*)_single$/.exec(key);
  return pluralBase(key) ?? (m && m[1]! in translations.en ? m[1]! : null);
}

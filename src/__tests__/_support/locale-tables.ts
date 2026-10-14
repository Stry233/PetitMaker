import type { Locale } from '../../core/model/locale';
import { registerLocaleTable } from '../../i18n/translations';
import { en } from '../../i18n/locales/en';
import { zh } from '../../i18n/locales/zh';
import { ja } from '../../i18n/locales/ja';
import { ru } from '../../i18n/locales/ru';
import { th } from '../../i18n/locales/th';
import { id } from '../../i18n/locales/id';
import { fr } from '../../i18n/locales/fr';
import { helpEn } from '../../i18n/locales/help/en';
import { helpZh } from '../../i18n/locales/help/zh';
import { helpJa } from '../../i18n/locales/help/ja';
import { helpRu } from '../../i18n/locales/help/ru';
import { helpTh } from '../../i18n/locales/help/th';
import { helpId } from '../../i18n/locales/help/id';
import { helpFr } from '../../i18n/locales/help/fr';

/** Every locale's interface table, for tests that read the tables themselves; the setup file
 *  registers them all, so `translateFor` speaks every locale in tests. */
export const translations: Readonly<Record<Locale, Readonly<Record<string, string>>>> = { en, zh, ja, ru, th, id, fr };

/** Every locale's Help table at once, for the checks that compare them; the app loads one locale's
 *  table at a time through `i18n/translations.ts:loadHelpTables`. */
export const HELP_TABLES: Record<Locale, Record<string, string>> = {
  en: helpEn, zh: helpZh, ja: helpJa, ru: helpRu, th: helpTh, id: helpId, fr: helpFr,
};

/** Registers every locale's Help table, as Help's window does for the locale it shows. */
export function installHelpTables(): void {
  for (const [locale, table] of Object.entries(HELP_TABLES) as [Locale, Readonly<Record<string, string>>][]) {
    registerLocaleTable(locale, table, 'help');
  }
}

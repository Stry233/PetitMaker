/*
 * Every interface table merged into one record — FOR TESTS AND SCRIPTS ONLY.
 *
 * The runtime does not import this, and must not: pulling it in puts all seven tables back on the
 * eager bundle, which is the 155 KB gzip the start-up payload just shed. The app reads English
 * eagerly (`i18n/context.tsx`) and every other locale through `locales/index.ts:ensureLocaleStrings`,
 * which registers the table as an i18n overlay when its chunk arrives.
 * `__tests__/i18n/eager-tables.test.ts` fails if this module reappears on the runtime graph.
 */
import type { Locale } from '../core/model/types';
import { en } from './locales/en';
import { zh } from './locales/zh';
import { ja } from './locales/ja';
import { ru } from './locales/ru';
import { th } from './locales/th';
import { id } from './locales/id';
import { fr } from './locales/fr';

// The Help Center's tables are deliberately NOT merged here either: they are an order of magnitude
// longer than any other surface's strings, so they live in the help chunk and arrive through
// `context.tsx:registerExtraStrings` when that chunk loads (`locales/help/index.ts`).
export const translations: Record<Locale, Record<string, string>> = { en, zh, ja, ru, th, id, fr };

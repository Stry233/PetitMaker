import type { Locale } from '../core/model/types';
import { en } from './locales/en';
import { zh } from './locales/zh';
import { ja } from './locales/ja';
import { ru } from './locales/ru';
import { th } from './locales/th';
import { id } from './locales/id';
import { fr } from './locales/fr';

// The Help Center's tables are deliberately NOT merged here: they are an order of magnitude
// longer than any other surface's strings, so they live in the help chunk and arrive through
// `context.tsx:registerExtraStrings` when that chunk loads (`locales/help/index.ts`).
export const translations: Record<Locale, Record<string, string>> = { en, zh, ja, ru, th, id, fr };

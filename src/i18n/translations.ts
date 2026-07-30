import type { Locale } from '../core/model/types';
import { en } from './locales/en';
import { zh } from './locales/zh';
import { ja } from './locales/ja';
import { ru } from './locales/ru';
import { th } from './locales/th';
import { id } from './locales/id';
import { fr } from './locales/fr';

export const translations: Record<Locale, Record<string, string>> = { en, zh, ja, ru, th, id, fr };

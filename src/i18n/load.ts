import type { Locale } from '../core/model/types';
import { roundLoad } from '../core/model/load';
import { localeTag } from './translations';
import { translateFor } from './context';

export function formatLoad(locale: Locale, value: number, unknown = false): string {
  const number = new Intl.NumberFormat(localeTag(locale)).format(roundLoad(value));
  return unknown
    ? translateFor(locale, value === 0 ? 'load.unknown' : 'load.partial', { value: number })
    : number;
}

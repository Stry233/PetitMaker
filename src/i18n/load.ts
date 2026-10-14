import type { Locale } from '../core/model/locale';
import { roundLoad } from '../core/model/load';
import { formatNumber, translateFor } from './context';

export function formatLoad(locale: Locale, value: number, unknown = false): string {
  const number = formatNumber(locale, roundLoad(value));
  return unknown
    ? translateFor(locale, value === 0 ? 'load.unknown' : 'load.partial', { value: number })
    : number;
}

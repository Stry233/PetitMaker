/** Chinese and Japanese copy around numbers and the reader: one register and one spacing rule each. */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../platform/build/build-info', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platform/build/build-info')>();
  return { ...actual, IS_DEV_BUILD: true };
});
import { HELP_TABLES, translations } from '../_support/locale-tables';
import { helpFacts } from '../../ui/help/facts';

const CJK = '[\\u3040-\\u30ff\\u3400-\\u9fff]';
const facts = helpFacts('en');
const NUMBERS = [
  'n', 'm', 'max', 'min', 'w', 'h', 'total', 'count', 'seconds', 'layer', 'elev', 'crest', 'reach', 'window',
  ...Object.keys(facts).filter((key) => typeof facts[key] === 'number'),
];
const number = `\\{(?:${NUMBERS.join('|')})\\}`;

function lines(locale: 'zh' | 'ja'): [string, string][] {
  return [...Object.entries(translations[locale]), ...Object.entries(HELP_TABLES[locale])];
}

describe('CJK copy', () => {
  it('addresses the Chinese reader with the informal pronoun', () => {
    expect(lines('zh').filter(([, v]) => v.includes('您')).map(([k]) => k)).toEqual([]);
  });

  it('spaces a Chinese number placeholder from Han text', () => {
    const tight = new RegExp(`${CJK}${number}|${number}${CJK}`);
    expect(lines('zh').filter(([, v]) => tight.test(v)).map(([k]) => k)).toEqual([]);
  });

  it('writes a Japanese number placeholder tight against its text', () => {
    const spaced = new RegExp(`${CJK} ${number}|${number} ${CJK}`);
    expect(lines('ja').filter(([, v]) => spaced.test(v)).map(([k]) => k)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { joinList } from '../../i18n/locale-info';

describe('joinList', () => {
  it('joins names with the locale\'s separator and conjunction', () => {
    expect(joinList('en', ['a', 'b', 'c'])).toBe('a, b and c');
    expect(joinList('zh', ['甲', '乙', '丙'])).toBe('甲、乙、丙');
  });

  it('writes a run of facts with the separator alone', () => {
    expect(joinList('en', ['Version 1', 'Build 2', 'abc'], { conjunction: false })).toBe('Version 1, Build 2, abc');
    expect(joinList('ru', ['a', 'b'], { conjunction: false })).toBe('a, b');
    expect(joinList('en', ['a'], { conjunction: false })).toBe('a');
  });
});

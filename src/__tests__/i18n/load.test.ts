/** A load reading follows the app's one number rule: integers under five digits stay ungrouped. */
import { describe, expect, it } from 'vitest';
import { formatLoad } from '../../i18n/load';
import { formatNumber } from '../../i18n/context';

describe('formatLoad', () => {
  it('writes a reading as formatNumber does, in every grouping band', () => {
    expect(formatLoad('en', 1234)).toBe('1234');
    expect(formatLoad('en', 12345)).toBe(formatNumber('en', 12345));
    expect(formatLoad('fr', 12345)).toBe(formatNumber('fr', 12345));
  });

  it('keeps the partial reading around the formatted number', () => {
    expect(formatLoad('en', 1234, true)).toBe('1234 + ?');
    expect(formatLoad('en', 0, true)).toBe('?');
  });
});

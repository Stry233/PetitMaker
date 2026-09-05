import { describe, expect, it } from 'vitest';
import { brandInfo, EXPORT_SITE_MARK } from '../../../ui/chrome/modals/export/brand';
import { LEGAL } from '../../../legal/config';

describe('the maker\'s band words', () => {
  it('names the site and points the QR at it when the site mark is on', () => {
    const b = brandInfo('en', { importable: true }, null, true);
    expect(b.url).toBe(LEGAL.canonicalOrigin);
    expect(b.label).toBe(LEGAL.canonicalOrigin.replace(/^https?:\/\//, ''));
    expect(b.powerText.toLowerCase()).toContain('import');
  });

  it('names no site when the mark is off, and never invites an import to nowhere', () => {
    const b = brandInfo('en', { importable: true }, null, false);
    expect(b.url).toBe('');
    expect(b.label).toBe('');
    expect(b.powerText.toLowerCase()).not.toContain('import');
  });

  it('defaults to the deploy-time choice', () => {
    expect(brandInfo('en', { importable: false }, null).url)
      .toBe(EXPORT_SITE_MARK ? LEGAL.canonicalOrigin : '');
  });
});

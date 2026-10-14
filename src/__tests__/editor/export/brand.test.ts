import { afterEach, describe, expect, it, vi } from 'vitest';
import { brandInfo } from '../../../editor/export/brand';
import { LEGAL } from '../../../legal/config';

const SITE = LEGAL.canonicalOrigin;

describe('the maker\'s band words', () => {
  it('names the site and points the QR at it when the site mark is on', () => {
    const b = brandInfo('en', { preset: 'share' }, null, SITE, true);
    expect(b.url).toBe(SITE);
    expect(b.label).toBe(SITE.replace(/^https?:\/\//, ''));
    expect(b.powerText.toLowerCase()).toContain('import');
  });

  it('names no site when the mark is off, and never invites an import to nowhere', () => {
    const b = brandInfo('en', { preset: 'share' }, null, SITE, false);
    expect(b.url).toBe('');
    expect(b.label).toBe('');
    expect(b.powerText.toLowerCase()).not.toContain('import');
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('defaults to the deploy-time choice: off where the build sets none, as here', () => {
    expect(brandInfo('en', { preset: 'plain' }, null, SITE).url).toBe('');
  });

  it('defaults to the deploy-time choice: on where the build turns the mark on', async () => {
    vi.stubGlobal('__PETIT_EXPORT_SITE_MARK__', true);
    vi.resetModules();
    const marked = await import('../../../editor/export/brand');
    expect(marked.brandInfo('en', { preset: 'plain' }, null, SITE).url).toBe(SITE);
  });
});

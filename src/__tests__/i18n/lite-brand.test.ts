import { describe, expect, it, vi } from 'vitest';
// The build defines the edition flag; unset under test, so it is set before the edition module loads.
vi.hoisted(() => { (globalThis as { __PETIT_LITE__?: boolean }).__PETIT_LITE__ = true; });
import { APP_NAME, baseBrandName, brandName } from '../../i18n/brand';

describe('Lite brand identity', () => {
  it('uses a parenthesized edition in plain text and a bare wordmark for headings', () => {
    expect(APP_NAME).toBe('PetitMaker (Lite)');
    expect(brandName('en')).toBe('PetitMaker (Lite)');
    expect(brandName('zh')).toBe('谷地工坊 (Lite)');
    expect(baseBrandName('en')).toBe('PetitMaker');
    expect(baseBrandName('zh')).toBe('谷地工坊');
  });
});

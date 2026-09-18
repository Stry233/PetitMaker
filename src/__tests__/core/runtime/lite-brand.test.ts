import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../core/runtime/edition', () => ({ IS_LITE: true }));
import { APP_NAME, APP_VERSION, IS_DEV_BUILD, baseBrandName, brandName } from '../../../version';

describe('Lite brand identity', () => {
  it('uses a parenthesized edition in plain text and a bare wordmark for headings', () => {
    expect(APP_NAME).toBe('PetitMaker (Lite)');
    expect(brandName('en')).toBe('PetitMaker (Lite)');
    expect(brandName('zh')).toBe('谷地工坊 (Lite)');
    expect(baseBrandName('en')).toBe('PetitMaker');
    expect(baseBrandName('zh')).toBe('谷地工坊');
  });
  it('adds the edition suffix while retaining development-build detection', () => {
    expect(APP_VERSION).toMatch(/-lite(?:-dev)?$/);
    expect(IS_DEV_BUILD).toBe(APP_VERSION.endsWith('-dev'));
  });
});

import { describe, expect, it, vi } from 'vitest';
// The build defines the edition flag; unset under test, so it is set before the edition module loads.
vi.hoisted(() => { (globalThis as { __PETIT_LITE__?: boolean }).__PETIT_LITE__ = true; });
import { APP_VERSION, IS_DEV_BUILD } from '../../../platform/build/build-info';

describe('Lite build identity', () => {
  it('adds the edition suffix while retaining development-build detection', () => {
    expect(APP_VERSION).toMatch(/-lite(?:-dev)?$/);
    expect(IS_DEV_BUILD).toBe(APP_VERSION.endsWith('-dev'));
  });
});

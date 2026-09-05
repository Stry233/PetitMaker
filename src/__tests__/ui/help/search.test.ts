/*
 * The help search as a reader uses it: the active locale and English both match, a heading match
 * carries its anchor, and a nonsense query answers with nothing rather than everything.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetHelpSearch, searchHelp } from '../../../ui/chrome/modals/help/search';
import { ensureHelpStrings } from '../../../i18n/locales/help';

ensureHelpStrings();

beforeEach(() => __resetHelpSearch());

describe('searchHelp', () => {
  it('finds a page by its zh title', () => {
    const hits = searchHelp('zh', '视角');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.page).toBe('camera');
  });

  it('finds the same page from English words while the locale is zh', () => {
    const hits = searchHelp('zh', 'camera');
    expect(hits.some((h) => h.page === 'camera')).toBe(true);
  });

  it('carries the matching section anchor when a heading matched', () => {
    const hits = searchHelp('zh', '键盘控制');
    const hit = hits.find((h) => h.page === 'camera');
    expect(hit?.anchor).toBe('camera-keys');
  });

  it('answers nonsense with silence', () => {
    expect(searchHelp('zh', 'zzqqxxyy')).toEqual([]);
  });
});

/**
 * The documents the offline edition carries: the licences About opens there, with their words. The others
 * stay out of its bundle, so a Lite package carries no word of them, the web pages' platform links included.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOC_IDS } from '../../legal/site-paths';

/** The registry and About's rows as the build for `lite` evaluates them. */
async function liteEdition(lite = true) {
  vi.resetModules();
  vi.stubGlobal('__PETIT_LITE__', lite);
  const { DOCS, docBody } = await import('../../legal/registry');
  const { LEGAL } = await import('../../legal/config');
  const { opensDoc } = await import('../../ui/chrome/modals/about/AboutView');
  return { DOCS, body: (id: (typeof DOC_IDS)[number], lang?: 'en' | 'zh') => (lang ? docBody(id, lang, LEGAL) : docBody(id, 'en', LEGAL) + docBody(id, 'zh', LEGAL)), opensDoc };
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

describe('[UI-25] the documents of the offline edition', () => {
  it('carries the words of the licences it opens and of no other document', async () => {
    const lite = await liteEdition();
    expect(DOC_IDS.filter(lite.opensDoc)).toEqual(['license', 'third-party', 'asset-licenses']);
    for (const id of DOC_IDS) expect(lite.body(id) !== '', id).toBe(lite.opensDoc(id));
  });

  it('words the team avatars as each edition may: the web edition names Bilibili, the offline one names no platform', async () => {
    const lite = await liteEdition();
    expect(lite.body('asset-licenses', 'en')).toContain('The members\' social media profile pictures, displayed on the About screen.');
    expect(lite.body('asset-licenses', 'zh')).toContain('「关于」页面展示的成员的社交媒体头像。');
    const web = await liteEdition(false);
    expect(web.body('asset-licenses', 'en')).toContain('Bilibili profile images displayed on the About screen.');
    expect(web.body('asset-licenses', 'zh')).toContain('「关于」页面展示的哔哩哔哩头像。');
    for (const edition of [lite, web]) {
      const body = edition.body('asset-licenses');
      expect(body).not.toContain('<!--');
      expect(body.includes('Bilibili') || body.includes('哔哩哔哩')).toBe(edition === web);
    }
  });
});

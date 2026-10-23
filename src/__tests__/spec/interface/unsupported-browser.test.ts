/** The page a browser that cannot run the editor gets: the served `index.html` and its classic
 *  `public/boot-guard.js`, run in a window that has no module support. */
import { describe, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { spec } from '../../_support/spec';
import { LOCALES } from '../../../core/model/locale';
import { translateFor } from '../../../i18n/context';
import { baseBrandName } from '../../../i18n/terms/brand';
import { DEPLOY_TARGETS } from '../../../platform/build/deploy-targets';

const INDEX_HTML = readFileSync('index.html', 'utf8');
const GUARD = readFileSync('public/boot-guard.js', 'utf8');

/** The served page in a browser of `language` that runs no module scripts. */
function oldBrowser(language: string): Document {
  const dom = new JSDOM(INDEX_HTML, { runScripts: 'dangerously', url: 'https://petitmaker.cc/' });
  const win = dom.window;
  delete (win.HTMLScriptElement.prototype as { noModule?: boolean }).noModule;
  win.CSS = { supports: () => true } as unknown as typeof CSS;
  Object.defineProperty(win.navigator, 'language', { configurable: true, value: language });
  win.eval(GUARD);
  return win.document;
}

describe('a browser that cannot run the editor', () => {
  spec('UI-23', 'gets a notice in the visitor\'s language naming what it needs, with download links, instead of a blank page', () => {
    const { chrome, firefox } = DEPLOY_TARGETS.global.browserDownloads;
    for (const locale of LOCALES) {
      const notice = oldBrowser(`${locale}-XX`).getElementById('petit-boot-guard');
      expect(notice, locale).not.toBeNull();
      expect(notice!.getAttribute('lang'), locale).toBe(locale);
      expect(notice!.textContent, locale).toContain(baseBrandName(locale));
      const links = [...notice!.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
      expect(links, locale).toEqual([
        [translateFor(locale, 'browser.get_chrome'), chrome],
        [translateFor(locale, 'browser.get_firefox'), firefox],
      ]);
    }
  });
});

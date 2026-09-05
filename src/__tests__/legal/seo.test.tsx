import { describe, it, expect, vi } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { render } from '@testing-library/react';
import { DEPLOY_TARGETS } from '../../legal/deploy-targets';
import { transformHomepage } from '../../../scripts/site-html.mts';
import { I18nProvider } from '../../i18n/context';
import { readPref, writePref } from '../../core/runtime/prefs';

const input = readFileSync('index.html', 'utf8');
const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

describe('homepage search metadata', () => {
  for (const target of Object.values(DEPLOY_TARGETS)) {
    it(`${target.id} has consistent metadata without changing the loading UI`, () => {
      const html = transformHomepage(input, target, '/');
      const doc = parse(html);
      expect(doc.title).toBe(target.title);
      expect(doc.documentElement.lang).toBe(target.htmlLang);
      expect(doc.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(target.description);
      expect(doc.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
      expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        target.canonicalOrigin + '/',
      );
      const original = parse(input);
      original.querySelector('#petit-boot img')!.setAttribute('src', '/' + target.bootBanner);
      expect(doc.body.innerHTML).toBe(original.body.innerHTML);
      const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]')!.textContent!);
      expect(data).toEqual({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        url: target.canonicalOrigin + '/',
        name: target.id === 'cn' ? '谷地工坊' : 'PetitMaker',
        alternateName:
          target.id === 'cn' ? ['PetitMaker'] : ['Petit Maker', 'PetitMaker Map Editor', 'petitmaker.cc'],
      });
      for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
        expect(doc.querySelector(selector)?.getAttribute('content')).toBe(
          target.canonicalOrigin + '/logo-256.png',
        );
      }
      for (const attribute of ['name', 'property']) {
        const keys = [...doc.querySelectorAll(`meta[${attribute}]`)].map((m) => m.getAttribute(attribute));
        expect(new Set(keys).size).toBe(keys.length);
      }
      expect(doc.querySelector('meta[name="keywords"]')).toBeNull();
      expect(doc.querySelector('meta[name="robots"]')).toBeNull();
    });
  }

  it('declares reciprocal homepage alternates and keeps previews out of search', () => {
    const alternates = (target: typeof DEPLOY_TARGETS.global) =>
      [...parse(transformHomepage(input, target, '/')).querySelectorAll('link[rel="alternate"]')].map((a) => [
        a.getAttribute('hreflang'),
        a.getAttribute('href'),
      ]);
    expect(alternates(DEPLOY_TARGETS.global)).toEqual(alternates(DEPLOY_TARGETS.cn));
    expect(alternates(DEPLOY_TARGETS.global)).toEqual([
      ['en', 'https://petitmaker.cc/'],
      ['zh-CN', 'https://petitmaker.com.cn/'],
      ['x-default', 'https://petitmaker.cc/'],
    ]);
    const preview = parse(transformHomepage(input, DEPLOY_TARGETS.global, '/Apollonius/'));
    expect(preview.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, nofollow');
    expect(preview.querySelector('link[rel="canonical"]')).toBeNull();
    expect(preview.body.innerHTML).toBe(parse(input).body.innerHTML);
  });

  it('localization preserves the deployment title and honors a saved editor language', () => {
    const previousTitle = document.title;
    const previousLang = document.documentElement.lang;
    const previousLocale = readPref('locale');
    const browserLanguage = vi.spyOn(navigator, 'language', 'get').mockReturnValue('ja-JP');
    try {
      localStorage.removeItem('petit-planet-locale');
      document.documentElement.lang = 'zh-CN';
      expect(readPref('locale')).toBe('ja');
      document.documentElement.lang = 'en';
      expect(readPref('locale')).toBe('ja');
      writePref('locale', 'fr');
      expect(readPref('locale')).toBe('fr');
      document.title = DEPLOY_TARGETS.cn.title;
      const view = render(
        <I18nProvider>
          <span>Editor</span>
        </I18nProvider>,
      );
      expect(document.title).toBe(DEPLOY_TARGETS.cn.title);
      view.unmount();
    } finally {
      document.title = previousTitle;
      document.documentElement.lang = previousLang;
      writePref('locale', previousLocale);
      browserLanguage.mockRestore();
    }
  });
});

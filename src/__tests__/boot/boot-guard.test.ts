/**
 * `public/boot-guard.js` is the only message a visitor gets when the module bundle cannot run, so
 * it is exercised as a file: parsed into a jsdom window built from the real `index.html`, with the
 * two capability readings jsdom does not implement supplied per scenario.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
// @ts-ignore - jsdom is untyped here (no @types/jsdom)
import { JSDOM } from 'jsdom';
import { DEPLOY_TARGETS } from '../../legal/deploy-targets';

const GUARD_SOURCE = readFileSync('public/boot-guard.js', 'utf8');
const INDEX_HTML = readFileSync('index.html', 'utf8');

const GUARD_ID = 'petit-boot-guard';
const CONTINUE_ID = 'petit-boot-continue';
const BOOT_ID = 'petit-boot';

interface Env {
  /** `<html lang>` of the served page. */
  lang?: string;
  navLang?: string;
  modules?: boolean;
  zoom?: boolean;
  /** The guard sits in the head, so a real run can begin before the body is parsed. */
  parsed?: boolean;
}

/** The served page, with the two capability readings jsdom does not implement supplied. */
function served(env: Env = {}): any {
  const html = INDEX_HTML.replace(/<html lang="[^"]*"/, `<html lang="${env.lang ?? 'en'}"`);
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://petitmaker.cc/' });
  const win = dom.window;
  if (env.modules === false) {
    delete win.HTMLScriptElement.prototype.noModule;
  } else {
    Object.defineProperty(win.HTMLScriptElement.prototype, 'noModule', { configurable: true, value: false });
  }
  win.CSS = { supports: (prop: string) => !(prop === 'zoom' && env.zoom === false) };
  Object.defineProperty(win.navigator, 'language', { configurable: true, value: env.navLang ?? 'en-US' });
  return dom;
}

function page(env: Env = {}): any {
  const dom = served(env);
  dom.window.eval(GUARD_SOURCE);
  return dom;
}

const guard = (dom: any): any => dom.window.document.getElementById(GUARD_ID);
const boot = (dom: any): any => dom.window.document.getElementById(BOOT_ID);
const links = (dom: any): string[] =>
  [...guard(dom).querySelectorAll('a')].map((a: any) => a.getAttribute('href'));

it('reports a dynamic entry failure only while the app is still booting', () => {
  const failed = page();
  failed.window.dispatchEvent(new failed.window.Event('petit:boot-failed'));
  expect(guard(failed)).not.toBeNull();
  failed.window.close();
  const mounted = page();
  mountApp(mounted);
  mounted.window.dispatchEvent(new mounted.window.Event('petit:boot-failed'));
  expect(guard(mounted)).toBeNull();
  mounted.window.close();
});

/** React's first render replaces everything inside `#root`, boot markup included. */
function mountApp(dom: any): void {
  dom.window.document.getElementById('root').innerHTML = '<div id="app"></div>';
}

function failEntryParse(dom: any): void {
  const win = dom.window;
  win.dispatchEvent(new win.ErrorEvent('error', { error: new win.SyntaxError('unexpected token') }));
}

function failEntryLoad(dom: any): void {
  const win = dom.window;
  const entry = win.document.querySelector('script[type="module"]');
  entry.dispatchEvent(new win.Event('error'));
}

describe('index.html boot references', () => {
  it('runs the classic guard ahead of the module entry and states the requirement without scripts', () => {
    expect(INDEX_HTML).toContain('<script src="/boot-guard.js"></script>');
    expect(INDEX_HTML.indexOf('boot-guard.js')).toBeLessThan(INDEX_HTML.indexOf('type="module"'));
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(INDEX_HTML);
    expect(noscript).not.toBeNull();
    expect(INDEX_HTML.indexOf('<noscript>')).toBeGreaterThan(INDEX_HTML.indexOf(`id="${BOOT_ID}"`));
    expect(noscript![1]).toContain('JavaScript');
    expect(noscript![1]).toContain('谷地工坊');
  });
});

describe('boot guard', () => {
  it('says nothing while a healthy boot proceeds', () => {
    const dom = page();
    expect(guard(dom)).toBeNull();
    expect(boot(dom)!.querySelector('img')).not.toBeNull();
  });

  it('says nothing about an error raised after the app has mounted', () => {
    const dom = page();
    mountApp(dom);
    failEntryParse(dom);
    expect(guard(dom)).toBeNull();
  });

  it('reports an entry module the browser cannot parse, in the page language', () => {
    const dom = page({ lang: 'zh-CN' });
    failEntryParse(dom);
    expect(guard(dom)!.textContent).toContain('浏览器版本过旧');
    expect(links(dom)).toEqual([DEPLOY_TARGETS.cn.browserDownloads.chrome, DEPLOY_TARGETS.cn.browserDownloads.firefox]);
    expect(boot(dom)!.querySelector('img')).toBeNull();
  });

  it('reports an entry module that never loads', () => {
    const dom = page();
    failEntryLoad(dom);
    expect(guard(dom)!.textContent).toContain('Your browser is out of date');
    expect(links(dom)).toEqual([
      DEPLOY_TARGETS.global.browserDownloads.chrome,
      DEPLOY_TARGETS.global.browserDownloads.firefox,
    ]);
  });

  it('reports a browser without module support before anything is fetched', () => {
    const dom = page({ modules: false });
    expect(guard(dom)!.textContent).toContain('Your browser is out of date');
    expect(dom.window.document.getElementById(CONTINUE_ID)).toBeNull();
  });

  it('offers to continue when only CSS zoom is missing, and steps aside when asked', () => {
    const dom = page({ zoom: false });
    const message = guard(dom)!;
    expect(message.textContent).toContain('Your browser is out of date');
    // The interface is unscaled rather than absent, so the loading screen stays under the notice.
    expect(boot(dom)!.querySelector('img')).not.toBeNull();
    dom.window.document.getElementById(CONTINUE_ID)!.click();
    expect(guard(dom)).toBeNull();
  });

  it('falls back to the browser language when the page names none of the seven', () => {
    const dom = page({ lang: '', navLang: 'ru-RU', zoom: false });
    expect(guard(dom)!.textContent).toContain('Ваш браузер устарел');
  });

  it('lets the browser language speak on a page whose language is the default English', () => {
    const dom = page({ lang: 'en', navLang: 'ja-JP', zoom: false });
    expect(guard(dom)!.getAttribute('lang')).toBe('ja');
  });

  it('keeps the page language ahead of the browser language', () => {
    const dom = page({ lang: 'zh-CN', navLang: 'fr-FR', zoom: false });
    expect(guard(dom)!.textContent).toContain('浏览器版本过旧');
  });

  it('waits for the page it writes into when it runs ahead of the body', () => {
    const dom = served({ modules: false });
    const win = dom.window;
    const body = win.document.body;
    body.remove();
    win.eval(GUARD_SOURCE);
    expect(guard(dom)).toBeNull();
    win.document.documentElement.appendChild(body);
    win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
    expect(guard(dom)!.textContent).toContain('Your browser is out of date');
  });

  it('withdraws the offer to continue when the app then fails to start', () => {
    const dom = page({ zoom: false });
    expect(dom.window.document.getElementById(CONTINUE_ID)).not.toBeNull();
    failEntryParse(dom);
    expect(dom.window.document.getElementById(CONTINUE_ID)).toBeNull();
    expect(boot(dom)!.querySelector('img')).toBeNull();
  });
});

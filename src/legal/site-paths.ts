import { DEPLOY_TARGETS, targetOfOrigin } from './deploy-targets';

/** Static documents share these slugs with the edge router. */
export const DOC_SLUGS = {
  privacy: 'privacy',
  terms: 'terms',
  license: 'license',
  'third-party': 'third-party-notices',
  'asset-licenses': 'asset-licenses',
  about: 'about',
  security: 'security',
  contact: 'contact',
  changelog: 'changelog',
} as const;

export const INDEXABLE_SLUGS: readonly string[] = ['about', 'contact', 'changelog'];
const EN_ONLY: readonly string[] = [DOC_SLUGS.license, DOC_SLUGS['third-party']];

/** A document's path on the deployment serving `origin`, slashed where that deployment slashes. */
export function pagePath(slug: string, lang: 'en' | 'zh', origin: string): string {
  return `${lang === 'zh' ? '/zh' : ''}/${slug}${targetOfOrigin(origin).trailingSlash ? '/' : ''}`;
}

/** Only real HTML pages have extension and slash aliases; asset and unknown paths stay intact. */
export function canonicalPagePath(path: string, origin: string): string | null {
  if (path === '/' || path === '/index.html' || path === '/index') return '/';
  const plain = path
    .replace(/\/index\.html$/, '')
    .replace(/\.html$/, '')
    .replace(/\/$/, '');
  const match = /^\/(zh\/)?([^/]+)$/.exec(plain);
  if (!match) return null;
  const lang = match[1] ? 'zh' : 'en';
  const slug = match[2]!;
  if (!(Object.values(DOC_SLUGS) as readonly string[]).includes(slug)) return null;
  if (lang === 'zh' && EN_ONLY.includes(slug)) return null;
  return pagePath(slug, lang, origin);
}

/** Only the deployment's primary-language product pages participate in search. */
export function isIndexablePage(slug: string, lang: 'en' | 'zh', origin: string): boolean {
  return INDEXABLE_SLUGS.includes(slug) && lang === targetOfOrigin(origin).lang;
}

export function translatedPageUrls(slug: string): { en: string; zh: string } {
  const en = DEPLOY_TARGETS.global.canonicalOrigin;
  const zh = DEPLOY_TARGETS.cn.canonicalOrigin;
  return { en: en + pagePath(slug, 'en', en), zh: zh + pagePath(slug, 'zh', zh) };
}

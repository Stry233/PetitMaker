import { DEPLOY_TARGETS, type DeployTarget } from '../src/platform/build/deploy-targets.ts';
import { baseBrandName, brandName } from '../src/i18n/terms/brand.ts';
import { en } from '../src/i18n/locales/en.ts';
import { zh } from '../src/i18n/locales/zh.ts';
import { PLATE } from '../src/assets/brand-palette.ts';
import { escapeHtml } from '../src/legal/markdown-html.ts';

/** A deployment's search description and link-preview text, in its primary language. */
export function targetDescription(target: DeployTarget): string {
  return (target.lang === 'zh' ? zh : en)['site.description'].split('{app}').join(baseBrandName(target.lang));
}

export function alternateLinks(urls: { en: string; zh: string }): string {
  return [
    `<link rel="alternate" hreflang="en" href="${escapeHtml(urls.en)}" />`,
    `<link rel="alternate" hreflang="zh-CN" href="${escapeHtml(urls.zh)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(urls.en)}" />`,
  ].join('\n');
}

export function socialTags(title: string, description: string, url: string, lang: 'en' | 'zh'): string {
  const image = `${new URL(url).origin}/logo-256.png`;
  const brand = brandName(lang);
  const pairs = {
    'og:type': 'website',
    'og:url': url,
    'og:site_name': brand,
    'og:title': title,
    'og:description': description,
    'og:image': image,
    'og:image:width': '256',
    'og:image:height': '256',
    'og:image:type': 'image/png',
    'og:image:alt': brand,
    'og:locale': lang === 'zh' ? 'zh_CN' : 'en_US',
    'twitter:card': 'summary',
    'twitter:title': title,
    'twitter:description': description,
    'twitter:image': image,
    'twitter:image:alt': brand,
  };
  return Object.entries(pairs)
    .map(
      ([key, value]) =>
        `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escapeHtml(value)}" />`,
    )
    .join('\n');
}

export function websiteData(target: DeployTarget) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: `${target.canonicalOrigin}/`,
    name: brandName(target.lang),
    alternateName: [...target.alternateNames],
  };
}

/** The installable app's manifest for one deployment; relative URLs keep it valid under a path prefix. */
export function webManifest(target: DeployTarget): string {
  return `${JSON.stringify({
    name: brandName(target.lang),
    short_name: brandName(target.lang),
    description: targetDescription(target),
    lang: target.htmlLang,
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'landscape',
    background_color: PLATE,
    theme_color: PLATE,
    icons: [
      { src: 'logo-256.png', sizes: '256x256', type: 'image/png' },
      { src: 'apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  }, null, 2)}\n`;
}

export function transformHomepage(html: string, target: DeployTarget, basePath: string): string {
  const data = JSON.stringify(websiteData(target)).replace(/</g, '\\u003c');
  const description = targetDescription(target);
  const tags =
    basePath === '/'
      ? [
          ...target.verificationMetas.map(
            (m) => `<meta name="${escapeHtml(m.name)}" content="${escapeHtml(m.content)}" />`,
          ),
          `<meta name="description" content="${escapeHtml(description)}" />`,
          `<link rel="canonical" href="${target.canonicalOrigin}/" />`,
          alternateLinks({
            en: `${DEPLOY_TARGETS.global.canonicalOrigin}/`,
            zh: `${DEPLOY_TARGETS.cn.canonicalOrigin}/`,
          }),
          socialTags(target.title, description, `${target.canonicalOrigin}/`, target.lang),
          `<script type="application/ld+json">${data}</script>`,
        ]
      : ['<meta name="robots" content="noindex, nofollow" />'];
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${target.htmlLang}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(target.title)}</title>`)
    .replace('src="/banner.svg"', `src="/${target.bootBanner}"`)
    .replace('</head>', `${tags.join('\n')}\n</head>`);
}

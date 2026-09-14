import { DEPLOY_TARGETS, type DeployTarget } from '../src/legal/deploy-targets.ts';
import { brandName } from '../src/version.ts';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    name: brandName(target.id === 'cn' ? 'zh' : 'en'),
    alternateName:
      target.id === 'cn' ? ['PetitMaker'] : ['Petit Maker', 'PetitMaker Map Editor', 'petitmaker.cc'],
  };
}

export function transformHomepage(html: string, target: DeployTarget, basePath: string): string {
  const lang = target.id === 'cn' ? 'zh' : 'en';
  const data = JSON.stringify(websiteData(target)).replace(/</g, '\\u003c');
  const tags =
    basePath === '/'
      ? [
          ...target.verificationMetas.map(
            (m) => `<meta name="${escapeHtml(m.name)}" content="${escapeHtml(m.content)}" />`,
          ),
          `<meta name="description" content="${escapeHtml(target.description)}" />`,
          `<link rel="canonical" href="${target.canonicalOrigin}/" />`,
          alternateLinks({
            en: `${DEPLOY_TARGETS.global.canonicalOrigin}/`,
            zh: `${DEPLOY_TARGETS.cn.canonicalOrigin}/`,
          }),
          socialTags(target.title, target.description, `${target.canonicalOrigin}/`, lang),
          `<script type="application/ld+json">${data}</script>`,
        ]
      : ['<meta name="robots" content="noindex, nofollow" />'];
  return html
    .replace(/<html lang="[^"]*"/, `<html lang="${target.htmlLang}"`)
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(target.title)}</title>`)
    .replace('src="/banner.svg"', `src="/${target.bootBanner}"`)
    .replace('</head>', `${tags.join('\n')}\n</head>`);
}

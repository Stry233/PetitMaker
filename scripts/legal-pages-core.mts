/**
 * Pure rendering core for zero-JavaScript legal pages and their sitemap, robots, security, and license artifacts.
 * Only `writeAll` writes to the filesystem; imports and render helpers have no side effects.
 */

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DOCS, docNodes, type DocId } from '../src/legal/registry';
import type { LegalConfig } from '../src/legal/config';
import { validateLegalConfig } from '../src/legal/validate-config';
import { escapeHtml, renderHtml } from '../src/legal/markdown-html';
import { inlineText, type MdNode } from '../src/legal/markdown';
import { alternateLinks, socialTags } from './site-html.mts';
import { DOC_IDS, canonicalPagePath, isIndexablePage, pagePath, translatedPageUrls } from '../src/legal/site-paths';
import { DEPLOY_TARGETS } from '../src/platform/build/deploy-targets';
import { en } from '../src/i18n/locales/en';
import { zh } from '../src/i18n/locales/zh';
import { localeTag } from '../src/i18n/locale-info';
import { registerLocaleTable } from '../src/i18n/translations';
import { brandName } from '../src/i18n/terms/brand';
import { toDocumentCspMeta } from '../security/headers-policy';
import { BROWN_TEXT, FRAME_INK, PLATE, SURFACE_SECONDARY, TEXT_PRIMARY, rgbaOf } from '../src/assets/brand-palette';

export type Lang = 'en' | 'zh';

export function resolveMode(env: Record<string, string | undefined>): 'release' | 'dev' {
  return env.PETIT_RELEASE === '1' ? 'release' : 'dev';
}

/** The locale tables the About window reads, for the static pages. */
const PAGE_COPY: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { en, zh };
/** A document's title in a page language. */
const docTitle = (id: DocId, lang: Lang): string => PAGE_COPY[lang][DOCS[id].titleKey]!;

/** The affiliation disclaimer every static page footer repeats, worded as the About window words it. */
const disclaimer = (lang: Lang): string => PAGE_COPY[lang]['about.disclaimer']!.split('{app}').join(brandName(lang));

/** First paragraph as plain text, capped at `maxLen` characters for the meta description. */
export function metaDescription(nodes: MdNode[], maxLen = 155): string {
  const p = nodes.find((n): n is Extract<MdNode, { t: 'p' }> => n.t === 'p');
  const raw = (p ? inlineText(p.children) : '').trim();
  if (raw.length <= maxLen) return raw;
  return raw.slice(0, maxLen - 1).trimEnd() + '…';
}

const STYLE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: ${PLATE};
  color: ${TEXT_PRIMARY};
  /* system CJK stack — no webfont download on policy pages */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans", sans-serif;
  line-height: 1.7;
}
.wrap { max-width: 720px; margin: 0 auto; padding: 24px 20px 48px; }
header.top {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding-bottom: 16px; margin-bottom: 24px;
  border-bottom: 1px solid ${rgbaOf(FRAME_INK, 0.12)};
}
header.top a.back { color: ${FRAME_INK}; font-weight: 800; text-decoration: none; }
header.top a.back:hover { text-decoration: underline; }
.langswitch { font-size: 13px; font-weight: 700; white-space: nowrap; }
.langswitch a { color: ${FRAME_INK}; text-decoration: none; }
.langswitch a:hover { text-decoration: underline; }
.langswitch strong { color: ${BROWN_TEXT}; }
h1 { font-size: 28px; font-weight: 900; color: ${FRAME_INK}; margin: 0 0 8px; }
h2 { font-size: 20px; font-weight: 800; color: ${TEXT_PRIMARY}; margin: 32px 0 12px; }
h3 { font-size: 16px; font-weight: 700; color: ${TEXT_PRIMARY}; margin: 24px 0 8px; }
h4 { font-size: 14px; font-weight: 700; color: ${TEXT_PRIMARY}; margin: 20px 0 8px; }
p { margin: 0 0 16px; }
a { color: ${FRAME_INK}; }
ul, ol { padding-left: 24px; margin: 0 0 16px; }
li { margin-bottom: 6px; }
blockquote {
  margin: 0 0 16px; padding: 8px 16px;
  border-left: 3px solid rgba(67,65,62,0.12); color: ${BROWN_TEXT};
}
hr { border: none; border-top: 1px solid rgba(67,65,62,0.12); margin: 32px 0; }
code { background: ${SURFACE_SECONDARY}; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; }
.tbl { overflow-x: auto; margin: 0 0 16px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 8px 12px; border: 1px solid rgba(67,65,62,0.12); }
th { background: ${SURFACE_SECONDARY}; font-weight: 700; }
p.updated { font-size: 13px; font-weight: 700; color: ${BROWN_TEXT}; margin: 0 0 24px; }
footer.legal {
  margin-top: 48px; padding-top: 20px;
  border-top: 1px solid rgba(67,65,62,0.12);
  font-size: 12px; color: ${BROWN_TEXT};
}
footer.legal nav { margin-bottom: 12px; line-height: 2; }
footer.legal nav a { color: ${BROWN_TEXT}; text-decoration: none; margin: 0 10px; }
footer.legal nav a:hover { text-decoration: underline; }
footer.legal p { margin: 0 0 6px; }
@media (max-width: 480px) {
  .wrap { padding: 16px 14px 32px; }
  h1 { font-size: 22px; }
}
`.trim();

function footerNavHtml(effLang: Lang, cfg: LegalConfig): string {
  const items = DOC_IDS.map((id) => {
    const meta = DOCS[id];
    const linkLang: Lang = effLang === 'zh' && meta.source.zh !== null ? 'zh' : 'en';
    const path = pagePath(meta.slug, linkLang, cfg.canonicalOrigin);
    return `<a href="${escapeHtml(path)}">${escapeHtml(docTitle(id, linkLang))}</a>`;
  });
  return items.join('');
}

function filingRowsHtml(cfg: LegalConfig): string {
  const hasIcp = !!(cfg.icpNumber && cfg.icpUrl);
  const hasPsb = !!(cfg.psbNumber && cfg.psbUrl);
  if (!hasIcp && !hasPsb) return '';
  const parts: string[] = [];
  // Spacing matches the in-app filing bar without introducing a text separator.
  const gap = hasIcp && hasPsb ? ' style="margin-right:12px"' : '';
  if (hasIcp) parts.push(`<a href="${escapeHtml(cfg.icpUrl!)}"${gap}>${escapeHtml(cfg.icpNumber!)}</a>`);
  if (hasPsb) parts.push(`<a href="${escapeHtml(cfg.psbUrl!)}">${escapeHtml(cfg.psbNumber!)}</a>`);
  return `<p class="filing">${parts.join('')}</p>\n`;
}

function updatedLineHtml(id: DocId, lang: Lang, cfg: LegalConfig): string {
  const meta = DOCS[id];
  if (!meta.dated) return '';
  const date = (cfg.effectiveDates as Record<string, string>)[id] ?? '';
  const version = (cfg.policyVersions as Record<string, string>)[id] ?? '';
  const text = lang === 'zh' ? `生效日期 ${date}，版本 ${version}` : `Effective ${date}, version ${version}`;
  return `<p class="updated">${escapeHtml(text)}</p>\n`;
}

/** Deterministic zero-JavaScript HTML document for one document and language. */
export function pageHtml(id: DocId, lang: Lang, cfg: LegalConfig): string {
  const meta = DOCS[id];
  const hasZh = meta.source.zh !== null;
  // English-only sources ignore a Chinese request on every render surface.
  const effLang: Lang = hasZh ? lang : 'en';

  const title = docTitle(id, effLang);
  // The registry reads a document language's words from the loaded tables; the app loads zh lazily.
  registerLocaleTable('zh', zh);
  const nodes = docNodes(id, effLang, cfg, title);
  // `docNodes` supplies a synthetic h1 when needed, so one node means the body is empty.
  if (nodes.length <= 1) {
    throw new Error(`legal-pages: "${id}"/"${effLang}" resolved to an empty document body`);
  }
  const [h1Node, ...restNodes] = nodes;
  const h1Html = renderHtml([h1Node!]);
  const bodyHtml = renderHtml(restNodes).replace(/href="(\/[^"#?]*)([?#][^"]*)?"/g, (_all, path: string, suffix = '') =>
    `href="${canonicalPagePath(path, cfg.canonicalOrigin) ?? path}${suffix}"`);
  const brand = brandName(effLang);
  const description = id === 'changelog' ? (effLang === 'zh' ? zh : en)['site.changelog_description']!.split('{app}').join(brand) : metaDescription(nodes);

  const enPath = pagePath(meta.slug, 'en', cfg.canonicalOrigin);
  const zhPath = hasZh ? pagePath(meta.slug, 'zh', cfg.canonicalOrigin) : null;
  const selfPath = effLang === 'zh' ? zhPath! : enPath;
  const canonical = `${cfg.canonicalOrigin}${selfPath}`;
  const indexable = isIndexablePage(meta.slug, effLang, cfg.canonicalOrigin);
  const counterparts = translatedPageUrls(meta.slug);
  const alternates = indexable && hasZh ? alternateLinks(counterparts) : '';
  const enLink = indexable ? counterparts.en : enPath;
  const zhLink = indexable ? counterparts.zh : zhPath;
  const langSwitcher = hasZh
    ? effLang === 'en'
      ? `<strong>EN</strong> | <a href="${escapeHtml(zhLink!)}" hreflang="zh-CN" lang="zh-CN">中文</a>`
      : `<a href="${escapeHtml(enLink)}" hreflang="en" lang="en">EN</a> | <strong>中文</strong>`
    : '<strong>EN</strong>';

  return `<!doctype html>
<html lang="${localeTag(effLang)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${toDocumentCspMeta()}" />
<title>${escapeHtml(title)} | ${escapeHtml(brand)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="canonical" href="${escapeHtml(canonical)}" />
${indexable ? '' : '<meta name="robots" content="noindex, follow" />'}
${alternates}
${socialTags(`${title} | ${brand}`, description, canonical, effLang)}
<style>
${STYLE_CSS}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
<a class="back" href="/">← ${escapeHtml(brand)}</a>
<div class="langswitch">${langSwitcher}</div>
</header>
<main>
${h1Html}
${updatedLineHtml(id, effLang, cfg)}${bodyHtml}
</main>
<footer class="legal">
<nav>${footerNavHtml(effLang, cfg)}</nav>
<p>${escapeHtml(disclaimer(effLang))}</p>
${filingRowsHtml(cfg)}<p>© ${escapeHtml(`${cfg.operatorName.en} / ${cfg.operatorName.zh}`)}</p>
</footer>
</div>
</body>
</html>
`;
}

export interface PlannedPage {
  id: DocId;
  lang: Lang;
  slug: string;
  path: string; // e.g. '/privacy' or '/zh/privacy'
}

/** Page list shared by `writeAll` and the sitemap. */
export function pagePlan(cfg?: Pick<LegalConfig, 'canonicalOrigin'>): PlannedPage[] {
  const origin = cfg?.canonicalOrigin ?? DEPLOY_TARGETS.global.canonicalOrigin;
  const pages: PlannedPage[] = [];
  for (const id of DOC_IDS) {
    const meta = DOCS[id];
    pages.push({ id, lang: 'en', slug: meta.slug, path: pagePath(meta.slug, 'en', origin) });
    if (meta.source.zh !== null) {
      pages.push({ id, lang: 'zh', slug: meta.slug, path: pagePath(meta.slug, 'zh', origin) });
    }
  }
  return pages;
}

/** Only canonical, indexable pages are listed; hreflang is maintained in HTML alone. */
export function sitemapXml(cfg: LegalConfig): string {
  const paths = ['/', ...pagePlan(cfg).filter((p) => isIndexablePage(p.slug, p.lang, cfg.canonicalOrigin)).map((p) => p.path)];
  const urls = paths.map((path) => `  <url><loc>${escapeHtml(cfg.canonicalOrigin + path)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

function robotsTxt(cfg: LegalConfig): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${cfg.canonicalOrigin}/sitemap.xml\n`;
}

/** `/.well-known/security.txt`; `expires` is injected (build date + 1 year, ISO) so the output is deterministic/testable. */
export function securityTxt(cfg: LegalConfig, expires: string): string {
  return (
    `Contact: mailto:${cfg.securityContactEmail}\n` +
    `Expires: ${expires}\n` +
    `Canonical: ${cfg.canonicalOrigin}/.well-known/security.txt\n` +
    `Policy: ${cfg.canonicalOrigin}${pagePath('security', 'en', cfg.canonicalOrigin)}\n` +
    `Preferred-Languages: en, zh-CN\n`
  );
}

/** Build date + 1 year, UTC, ISO-8601 — the security.txt `Expires` field. */
export function computeExpires(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString();
}

const UNRESOLVED_TOKEN_RE = /\{[a-zA-Z-]+\}/g;

// A surviving authored token always indicates an unresolved substitution.
function assertNoUnresolvedTokens(html: string, context: string): void {
  const matches = html.match(UNRESOLVED_TOKEN_RE) ?? [];
  if (matches.length > 0) {
    throw new Error(`legal-pages: ${context} left unresolved token(s): ${[...new Set(matches)].join(', ')}`);
  }
}

function writeTextFile(distDir: string, relPath: string, contents: string): void {
  const full = join(distDir, ...relPath.split('/').filter(Boolean));
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

/**
 * Writes all static legal artifacts to `distDir`.
 * Release mode rejects configuration problems; unresolved content tokens always fail; injected `now` makes security.txt deterministic.
 */
export function writeAll(distDir: string, cfg: LegalConfig, mode: 'release' | 'dev', now: Date = new Date()): void {
  const problems = validateLegalConfig(cfg);
  if (problems.length > 0) {
    if (mode === 'release') {
      throw new Error(`legal-pages: config invalid for release:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    }
    console.warn('[legal-pages] LEGAL config has unresolved problems (dev/warn mode):');
    for (const p of problems) console.warn(`  - ${p}`);
  }

  for (const page of pagePlan(cfg)) {
    const html = pageHtml(page.id, page.lang, cfg);
    assertNoUnresolvedTokens(html, `${page.id}/${page.lang}`);
    writeTextFile(distDir, `${page.path.replace(/\/$/, '')}/index.html`, html);
  }

  const sitemap = sitemapXml(cfg);
  assertNoUnresolvedTokens(sitemap, 'sitemap.xml');
  writeTextFile(distDir, '/sitemap.xml', sitemap);

  writeTextFile(distDir, '/robots.txt', robotsTxt(cfg));

  const security = securityTxt(cfg, computeExpires(now));
  assertNoUnresolvedTokens(security, 'security.txt');
  writeTextFile(distDir, '/.well-known/security.txt', security);

  const licensesSrc = join(process.cwd(), 'licenses');
  const licensesDest = join(distDir, 'licenses');
  if (existsSync(licensesSrc)) {
    mkdirSync(licensesDest, { recursive: true });
    cpSync(licensesSrc, licensesDest, { recursive: true });
  } else {
    console.warn(`[legal-pages] licenses/ not found at ${licensesSrc} — run "npm run legal:licenses" first.`);
  }
}

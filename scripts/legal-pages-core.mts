// Pure(ish) core of the static legal-page generator (Task 17): renders every
// registry doc (src/legal/registry.ts) through the shared markdown emitter
// (src/legal/markdown-html.ts) into a full zero-JS HTML document, plus the
// sitemap/robots/security.txt/license-tree copy that make the site crawlable.
// See docs/internal/superpowers/specs/2026-07-14-legal-docs-design.md §14/§15.
//
// Split from scripts/build-legal-pages.mts (the CLI entry) for EXACTLY the
// reason scripts/license-audit-core.mts is split from scripts/license-audit.mts
// (see that file's doc comment): a `main-module` guard
// (`import.meta.url === file://${process.argv[1]}`) does NOT work under
// `vite-node` — it invokes the target script without rewriting
// `process.argv[1]` to the script's own path, so the guard never matches. This
// file therefore has NO CLI logic and NO top-level side effects at import time
// — every export is a function that only touches the filesystem when CALLED
// (writeAll), never on import — so src/__tests__/legal/build-pages.test.ts can
// import it directly with zero risk of accidentally running the real build
// against the real (still-draft) LEGAL config.

// @ts-ignore - node:fs is untyped here (no @types/node)
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join } from 'node:path';

import { DOCS, docNodes, type DocId } from '../src/legal/registry';
import type { LegalConfig } from '../src/legal/config';
import { validateLegalConfig } from '../src/legal/validate-config';
import { renderHtml } from '../src/legal/markdown-html';
import { inlineText, type MdNode } from '../src/legal/markdown';
import { brandName } from '../src/version';

// Minimal ambient shape for the pieces of `process` this module uses — matches
// this repo's existing convention (see src/__tests__/agent/bench.live.test.ts)
// of a local declaration instead of an @types/node dependency.
declare const process: { cwd(): string };

export type Lang = 'en' | 'zh';

/**
 * Pure helper to resolve the build mode from the environment.
 * Returns 'release' if PETIT_RELEASE env var is '1', otherwise 'dev'.
 * Exported for testability.
 */
export function resolveMode(env: Record<string, string | undefined>): 'release' | 'dev' {
  return env.PETIT_RELEASE === '1' ? 'release' : 'dev';
}

// Stable, spec-§6 authored order — every doc-listing surface (footer nav,
// sitemap, writeAll) iterates this instead of `Object.keys(DOCS)` so the order
// is an explicit, documented contract rather than an incidental object-literal
// detail.
export const ALL_DOC_IDS: DocId[] = [
  'privacy',
  'terms',
  'license',
  'third-party',
  'asset-licenses',
  'about',
  'security',
  'contact',
  'changelog',
];

// Plain-language page titles, EN/ZH literal (static pages render no i18n).
// Deliberately duplicated from src/i18n/locales/{en,zh}.ts's `legal.doc_*` keys rather than
// importing the i18n system into a Node/vite-node script; the drift risk is
// small (nine short labels) and importing the full i18n module graph into a
// build script would be a much larger footgun than a documented duplication.
const DOC_TITLES: Record<DocId, { en: string; zh: string }> = {
  privacy: { en: 'Privacy Policy', zh: '隐私政策' },
  terms: { en: 'Terms of Use', zh: '使用条款' },
  license: { en: 'License', zh: '许可协议' },
  'third-party': { en: 'Third-party Notices', zh: '第三方声明' },
  'asset-licenses': { en: 'Asset Licenses', zh: '素材许可' },
  about: { en: 'About', zh: '关于' },
  security: { en: 'Security', zh: '安全性' },
  contact: { en: 'Contact', zh: '联系我们' },
  changelog: { en: 'Changelog', zh: '更新日志' },
};

// Static-page-only literal disclaimer (the React About view has its own copy
// authored in src/legal/content/about.*.md; this is the FOOTER strip repeated on
// every static page, same substance, short form).
const DISCLAIMER: Record<Lang, string> = {
  en: 'This is an unofficial, non-commercial fan project. It is not affiliated with, endorsed by, or sponsored by miHoYo / HoYoverse (COGNOSPHERE PTE. LTD.).',
  zh: '本项目为非官方、非商业性质的同人项目，与米哈游及其海外品牌 HoYoverse（COGNOSPHERE PTE. LTD.）无任何关联，未获得其认可或赞助。',
};

// One escaper for text content AND attribute values, mirroring
// src/legal/markdown-html.ts's `esc()` (that file's escaper is not exported —
// deliberately kept as the single security-reviewed path for MARKDOWN-sourced
// content; this is the equivalent for the page-SHELL strings this script
// builds itself, e.g. titles/nav labels/disclaimers/config values).
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The `<meta name="description">` source: the first paragraph block's plain
 * text (formatting stripped), truncated to at most 155 characters — exported
 * so it can be unit-tested directly against a hand-built node tree (real doc
 * content rarely carries the punctuation/CJK-length edge cases worth pinning).
 * Truncation happens on the RAW text (a single trailing '…' keeps the total
 * at-or-under the cap); escaping for the HTML attribute happens at the call
 * site, same as every other page-shell string.
 */
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
  background: #FFFBE1; /* src/ui/styles.ts colors.panelCream */
  color: #4A3B32; /* src/ui/styles.ts colors.textPrimary */
  /* system CJK stack — no webfont download on policy pages (spec §14) */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans", sans-serif;
  line-height: 1.7;
}
.wrap { max-width: 720px; margin: 0 auto; padding: 24px 20px 48px; }
header.top {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding-bottom: 16px; margin-bottom: 24px;
  border-bottom: 1px solid rgba(67,65,62,0.12); /* colors.inkBorder */
}
header.top a.back { color: #43413F; font-weight: 800; text-decoration: none; } /* colors.frameDark */
header.top a.back:hover { text-decoration: underline; }
.langswitch { font-size: 13px; font-weight: 700; white-space: nowrap; }
.langswitch a { color: #43413F; text-decoration: none; }
.langswitch a:hover { text-decoration: underline; }
.langswitch strong { color: #826042; } /* colors.brownText */
h1 { font-size: 28px; font-weight: 900; color: #43413F; margin: 0 0 8px; }
h2 { font-size: 20px; font-weight: 800; color: #4A3B32; margin: 32px 0 12px; }
h3 { font-size: 16px; font-weight: 700; color: #4A3B32; margin: 24px 0 8px; }
h4 { font-size: 14px; font-weight: 700; color: #4A3B32; margin: 20px 0 8px; }
p { margin: 0 0 16px; }
a { color: #43413F; }
ul, ol { padding-left: 24px; margin: 0 0 16px; }
li { margin-bottom: 6px; }
blockquote {
  margin: 0 0 16px; padding: 8px 16px;
  border-left: 3px solid rgba(67,65,62,0.12); color: #826042;
}
hr { border: none; border-top: 1px solid rgba(67,65,62,0.12); margin: 32px 0; }
code { background: #F3EEE8; padding: 2px 5px; border-radius: 4px; font-size: 0.9em; } /* colors.surfaceSecondary */
.tbl { overflow-x: auto; margin: 0 0 16px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; padding: 8px 12px; border: 1px solid rgba(67,65,62,0.12); }
th { background: #F3EEE8; font-weight: 700; }
p.updated { font-size: 13px; font-weight: 700; color: #826042; margin: 0 0 24px; }
footer.legal {
  margin-top: 48px; padding-top: 20px;
  border-top: 1px solid rgba(67,65,62,0.12);
  font-size: 12px; color: #826042;
}
footer.legal nav { margin-bottom: 12px; line-height: 2; }
footer.legal nav a { color: #826042; text-decoration: none; }
footer.legal nav a:hover { text-decoration: underline; }
footer.legal p { margin: 0 0 6px; }
@media (max-width: 480px) {
  .wrap { padding: 16px 14px 32px; }
  h1 { font-size: 22px; }
}
`.trim();

function footerNavHtml(effLang: Lang): string {
  const items = ALL_DOC_IDS.map((id) => {
    const meta = DOCS[id];
    const linkLang: Lang = effLang === 'zh' && meta.source.zh !== null ? 'zh' : 'en';
    const path = linkLang === 'zh' ? `/zh/${meta.slug}` : `/${meta.slug}`;
    return `<a href="${esc(path)}">${esc(DOC_TITLES[id][linkLang])}</a>`;
  });
  return items.join(' · ');
}

function filingRowsHtml(cfg: LegalConfig): string {
  const hasIcp = !!(cfg.icpNumber && cfg.icpUrl);
  const hasPsb = !!(cfg.psbNumber && cfg.psbUrl);
  if (!hasIcp && !hasPsb) return '';
  const parts: string[] = [];
  if (hasIcp) parts.push(`<a href="${esc(cfg.icpUrl!)}">${esc(cfg.icpNumber!)}</a>`);
  if (hasPsb) parts.push(`<a href="${esc(cfg.psbUrl!)}">${esc(cfg.psbNumber!)}</a>`);
  return `<p class="filing">${parts.join(' · ')}</p>\n`;
}

function updatedLineHtml(id: DocId, lang: Lang, cfg: LegalConfig): string {
  const meta = DOCS[id];
  if (!meta.schema.requiresEffectiveDate) return '';
  const date = (cfg.effectiveDates as Record<string, string>)[id] ?? '';
  const version = (cfg.policyVersions as Record<string, string>)[id] ?? '';
  const text = lang === 'zh' ? `生效日期 ${date} · ${version}` : `Effective ${date} · ${version}`;
  return `<p class="updated">${esc(text)}</p>\n`;
}

/**
 * Full zero-JS HTML document for one doc/language. Pure function of
 * (id, lang, cfg) — no Date.now()/env reads — so it is byte-deterministic,
 * which is what lets `writeAll` scan its OWN output for unresolved `{...}`
 * tokens before ever touching disk.
 */
export function pageHtml(id: DocId, lang: Lang, cfg: LegalConfig): string {
  const meta = DOCS[id];
  const hasZh = meta.source.zh !== null;
  // An en-only doc always renders English content, regardless of what `lang`
  // was requested with — mirrors LegalDocView.tsx's `effLang` fallback so the
  // static page and the in-app reader never disagree about which language a
  // given doc/lang pair actually renders.
  const effLang: Lang = hasZh ? lang : 'en';

  const title = DOC_TITLES[id][effLang];
  const nodes = docNodes(id, effLang, cfg, title);
  // docNodes() guarantees a leading synthetic h1 when the source has none
  // (LICENSE) — nodes.length <= 1 means the resolved body carries nothing but
  // that heading, i.e. an EMPTY document body. Always a build error (never
  // just a release-mode warning): a doc that resolves to nothing is a content
  // bug regardless of who's about to deploy it.
  if (nodes.length <= 1) {
    throw new Error(`legal-pages: "${id}"/"${effLang}" resolved to an empty document body`);
  }
  const [h1Node, ...restNodes] = nodes;
  const h1Html = renderHtml([h1Node!]);
  const bodyHtml = renderHtml(restNodes);
  const description = metaDescription(nodes);
  const brand = brandName(effLang);

  const enPath = `/${meta.slug}`;
  const zhPath = hasZh ? `/zh/${meta.slug}` : null;
  const selfPath = effLang === 'zh' ? zhPath! : enPath;
  const canonical = `${cfg.canonicalOrigin}${selfPath}`;

  const alternates: string[] = [
    `<link rel="alternate" hreflang="en" href="${esc(cfg.canonicalOrigin + enPath)}" />`,
  ];
  if (zhPath) {
    alternates.push(`<link rel="alternate" hreflang="zh" href="${esc(cfg.canonicalOrigin + zhPath)}" />`);
  }
  // x-default always resolves to the English page — the design's documented
  // default when a user's locale doesn't otherwise match (spec §14/§15).
  alternates.push(`<link rel="alternate" hreflang="x-default" href="${esc(cfg.canonicalOrigin + enPath)}" />`);

  // EN | 中文 switcher. Design judgment (documented per the brief): an en-only
  // doc has no zh counterpart to switch TO, so its switcher collapses to a
  // plain "EN" label rather than a dead/misleading "中文" link — it is NOT
  // rendered as a link to the English page with a note, since that reads as
  // an actual language choice where none exists.
  const langSwitcher = hasZh
    ? effLang === 'en'
      ? `<strong>EN</strong> | <a href="${esc(zhPath!)}">中文</a>`
      : `<a href="${esc(enPath)}">EN</a> | <strong>中文</strong>`
    : `<strong>EN</strong>`;

  return `<!doctype html>
<html lang="${effLang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} | ${esc(brand)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
<link rel="canonical" href="${esc(canonical)}" />
${alternates.join('\n')}
<style>
${STYLE_CSS}
</style>
</head>
<body>
<div class="wrap">
<header class="top">
<a class="back" href="/">← ${esc(brand)}</a>
<div class="langswitch">${langSwitcher}</div>
</header>
<main>
${h1Html}
${updatedLineHtml(id, effLang, cfg)}${bodyHtml}
</main>
<footer class="legal">
<nav>${footerNavHtml(effLang)}</nav>
<p>${esc(DISCLAIMER[effLang])}</p>
${filingRowsHtml(cfg)}<p>© ${esc(cfg.operatorDisplayName)}</p>
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

/**
 * The single source of truth for "which pages exist" — sitemapXml and
 * writeAll both derive their page list from this so they can never drift
 * from each other (or from the registry's own zh-presence flags).
 */
export function pagePlan(): PlannedPage[] {
  const pages: PlannedPage[] = [];
  for (const id of ALL_DOC_IDS) {
    const meta = DOCS[id];
    pages.push({ id, lang: 'en', slug: meta.slug, path: `/${meta.slug}` });
    if (meta.source.zh !== null) {
      pages.push({ id, lang: 'zh', slug: meta.slug, path: `/zh/${meta.slug}` });
    }
  }
  return pages;
}

/** `sitemap.xml` listing every emitted page with its hreflang alternates. */
export function sitemapXml(cfg: LegalConfig): string {
  const plan = pagePlan();
  const urls = plan.map((page) => {
    const meta = DOCS[page.id];
    const enHref = `${cfg.canonicalOrigin}/${meta.slug}`;
    const zhHref = meta.source.zh !== null ? `${cfg.canonicalOrigin}/zh/${meta.slug}` : null;
    const loc = `${cfg.canonicalOrigin}${page.path}`;
    const alt: string[] = [`    <xhtml:link rel="alternate" hreflang="en" href="${esc(enHref)}"/>`];
    if (zhHref) alt.push(`    <xhtml:link rel="alternate" hreflang="zh" href="${esc(zhHref)}"/>`);
    alt.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(enHref)}"/>`);
    return `  <url>\n    <loc>${esc(loc)}</loc>\n${alt.join('\n')}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

function robotsTxt(cfg: LegalConfig): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${cfg.canonicalOrigin}/sitemap.xml\n`;
}

/** `/.well-known/security.txt` (spec §13); `expires` is injected (build date + 1 year, ISO) so the output is deterministic/testable. */
export function securityTxt(cfg: LegalConfig, expires: string): string {
  return (
    `Contact: mailto:${cfg.securityContactEmail}\n` +
    `Expires: ${expires}\n` +
    `Canonical: ${cfg.canonicalOrigin}/.well-known/security.txt\n` +
    `Policy: ${cfg.canonicalOrigin}/security\n` +
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

// Every authored token is resolvable (round 3 retired the last deferral,
// `{deployment-facts}`), so ANY surviving `{...}` is a bug in BOTH modes — a
// content author left a token the registry does not substitute. Always a build
// error, never a mode-gated warning.
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
 * Renders + writes every static legal page, sitemap.xml, robots.txt,
 * /.well-known/security.txt, and copies licenses/ through, into
 * `distDir`. `mode` mirrors `validateLegalConfig`'s: 'release' throws on any
 * config problem, 'dev' only warns. An unresolved `{...}` token is ALWAYS a bug
 * and always throws regardless of mode (see `assertNoUnresolvedTokens`) — there
 * are no deferred tokens anymore. `now` is injected (defaults to the real clock)
 * so the security.txt `Expires` stamp is deterministic under test.
 */
export function writeAll(distDir: string, cfg: LegalConfig, mode: 'release' | 'dev', now: Date = new Date()): void {
  const problems = validateLegalConfig(cfg, mode);
  if (problems.length > 0) {
    if (mode === 'release') {
      throw new Error(`legal-pages: config invalid for release:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    }
    console.warn('[legal-pages] LEGAL config has unresolved problems (dev/warn mode):');
    for (const p of problems) console.warn(`  - ${p}`);
  }

  for (const id of ALL_DOC_IDS) {
    const meta = DOCS[id];
    if (meta.source.en.trim().length === 0) {
      throw new Error(`legal-pages: missing en doc source for "${id}"`);
    }

    const enHtml = pageHtml(id, 'en', cfg);
    assertNoUnresolvedTokens(enHtml, `${id}/en`);
    writeTextFile(distDir, `/${meta.slug}/index.html`, enHtml);

    if (meta.source.zh !== null) {
      const zhHtml = pageHtml(id, 'zh', cfg);
      assertNoUnresolvedTokens(zhHtml, `${id}/zh`);
      writeTextFile(distDir, `/zh/${meta.slug}/index.html`, zhHtml);
    }
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

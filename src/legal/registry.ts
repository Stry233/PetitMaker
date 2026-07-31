/**
 * The doc registry: every legal/policy document the app renders, keyed by a
 * stable `DocId`, with its raw markdown source(s) (`?raw` imports) and a
 * per-document schema. Three render surfaces (static pages, the in-app doc
 * view, GitHub root files) all read `DOCS`/`docBody` so there is exactly one
 * place that maps an id to its source.
 *
 * WHERE A DOC'S BODY LIVES is one of three cases, declared per entry as
 * `sourceKind` so it is never left to be inferred from an import path (and
 * enforced by `doc-sources.test.ts`, which checks the declared path's bytes ARE
 * the imported bytes and that the path matches the kind):
 *
 *   - `authored` — written for this app, under `src/legal/content/*.md`, using
 *     the token/schema contract below. Same prompts-as-build-input pattern as
 *     `src/agent/prompts/*.md`.
 *   - `canonical-root` — the body is a repo file that exists for its OWN sake and
 *     cannot move: `LICENSE` is byte-exact upstream text (GitHub reads it at the
 *     root for license detection), `SECURITY.md` is where GitHub looks for a
 *     vulnerability policy, and `ASSET_LICENSES`/`CHANGELOG` are public docs the
 *     READMEs link; all three carry a `*.zh-CN.md` mirror. The app renders THAT
 *     file, so the GitHub view, the static page, and the in-app view cannot
 *     disagree.
 *   - `generated` — produced by a script; never hand-edited.
 *
 * See `src/legal/content/README.md` for the same map from the content side.
 */

import type { LegalConfig } from './config';
import { brandName } from '../version';
import { parseLegalMarkdown, type Inline, type MdNode } from './markdown';
import { providerDisclosureList } from './providers-list';

// canonical-root + generated sources: the file at this path IS the document,
// with no `src/legal/content/` counterpart (see the header note).
import LICENSE_SRC from '../../LICENSE?raw';
import THIRD_PARTY_SRC from '../../docs/THIRD_PARTY_NOTICES.md?raw';
import ASSET_LICENSES_EN_SRC from '../../docs/ASSET_LICENSES.md?raw';
import ASSET_LICENSES_ZH_SRC from '../../docs/ASSET_LICENSES.zh-CN.md?raw';
import SECURITY_EN_SRC from '../../SECURITY.md?raw';
import SECURITY_ZH_SRC from '../../docs/SECURITY.zh-CN.md?raw';
import CHANGELOG_EN_SRC from '../../docs/CHANGELOG.md?raw';
import CHANGELOG_ZH_SRC from '../../docs/CHANGELOG.zh-CN.md?raw';

// src/legal/content/* authored doc bodies (en+zh pairs).
import PRIVACY_EN_SRC from './content/privacy.en.md?raw';
import PRIVACY_ZH_SRC from './content/privacy.zh.md?raw';
import TERMS_EN_SRC from './content/terms.en.md?raw';
import TERMS_ZH_SRC from './content/terms.zh.md?raw';
import ABOUT_EN_SRC from './content/about.en.md?raw';
import ABOUT_ZH_SRC from './content/about.zh.md?raw';
import CONTACT_EN_SRC from './content/contact.en.md?raw';
import CONTACT_ZH_SRC from './content/contact.zh.md?raw';

export type DocId =
  | 'privacy'
  | 'terms'
  | 'license'
  | 'third-party'
  | 'asset-licenses'
  | 'about'
  | 'security'
  | 'contact'
  | 'changelog';

export interface DocSchema {
  requiresEffectiveDate: boolean;
  requiresPolicyVersion: boolean;
  // Substantive section/heading markers that must be present in the
  // resolved body for that language — the durable structural contract a
  // content stub commits to (and later tasks' prose must keep). Empty for
  // an en-only doc's `zh` list (there is no zh body to check).
  requiredTokens: { en: string[]; zh: string[] };
}

/** Where a document's body is authored — see the header note. */
export type DocSourceKind = 'authored' | 'canonical-root' | 'generated';

export interface DocMeta {
  id: DocId;
  slug: string; // URL path segment
  titleKey: string; // i18n key for chrome title
  source: { en: string; zh: string | null }; // raw markdown (?raw); zh null = en-only doc
  sourceKind: DocSourceKind;
  /** Repo-relative path of each `source` body, declared rather than derived from
   *  the `?raw` import; `doc-sources.test.ts` holds it to the filesystem. */
  sourcePath: { en: string; zh: string | null };
  schema: DocSchema;
}

const TERMS_SECTIONS_EN = [
  'Definitions',
  'Acceptance & Capacity',
  'Service Description',
  'BYOK & AI Providers',
  'Acceptable Use',
  'User Content & Third-Party Material',
  'Importable Images',
  'Availability, Updates & Discontinuation',
  'User Backup Responsibility',
  'Warranty Disclaimer',
  'Limitation of Liability',
  'Consumer-Law Savings Clause',
  'Intellectual-Property Complaints',
  'Governing Law & Disputes',
  'Entire Agreement',
  'Severability',
  'No Waiver',
  'No Assignment & Succession',
  'Notices',
  'Interpretation',
  'Changes',
];

const TERMS_SECTIONS_ZH = [
  '定义',
  '接受条款与行为能力',
  '服务说明',
  '自带密钥（BYOK）与 AI 服务提供商',
  '可接受使用',
  '用户内容与第三方素材',
  '可导入图片',
  '服务可用性、更新与终止',
  '用户备份责任',
  '保证免责声明',
  '责任限制',
  '消费者权益保留条款',
  '知识产权投诉',
  '适用法律与争议解决',
  '完整协议',
  '可分割性',
  '不弃权',
  '不得转让与运营继受',
  '通知',
  '解释',
  '变更',
];

const PRIVACY_SECTIONS_EN = [
  'At a Glance',
  'What We Store',
  'Share Images',
  'Local Data & "Clear Local Data"',
  'AI Providers (BYOK)',
  'API Keys',
  'Analytics & Consent',
  'Where Your Data Goes',
  'Data Retention',
  'Your Rights',
  'Changes to This Policy',
  'Contact Us',
];

const PRIVACY_SECTIONS_ZH = [
  '概览',
  '我们存储的内容',
  '分享图片',
  '本地数据与"清除本地数据"',
  'AI 服务提供商（自带密钥）',
  'API 密钥',
  '数据分析与同意',
  '数据去向',
  '数据保留',
  '你的权利',
  '政策变更',
  '联系我们',
];

const ABOUT_SECTIONS_EN = ['Mission', 'The Team', 'Fan-Project Disclaimer', 'Filing Information'];
const ABOUT_SECTIONS_ZH = ['使命', '团队', '同人项目声明', '备案信息'];

const CONTACT_SECTIONS_EN = [
  'General Inquiries',
  'Security Reports',
  'Intellectual Property / Takedown Requests',
  'Privacy Requests',
];
const CONTACT_SECTIONS_ZH = ['一般咨询', '安全问题报告', '知识产权 / 下架请求', '隐私相关请求'];

function minimalSchema(en: string[], zh: string[] = []): DocSchema {
  return { requiresEffectiveDate: false, requiresPolicyVersion: false, requiredTokens: { en, zh } };
}

export const DOCS: Record<DocId, DocMeta> = {
  privacy: {
    id: 'privacy',
    slug: 'privacy',
    titleKey: 'legal.doc_privacy',
    source: { en: PRIVACY_EN_SRC, zh: PRIVACY_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/privacy.en.md', zh: 'src/legal/content/privacy.zh.md' },
    schema: {
      requiresEffectiveDate: true,
      requiresPolicyVersion: true,
      requiredTokens: { en: PRIVACY_SECTIONS_EN, zh: PRIVACY_SECTIONS_ZH },
    },
  },
  terms: {
    id: 'terms',
    slug: 'terms',
    titleKey: 'legal.doc_terms',
    source: { en: TERMS_EN_SRC, zh: TERMS_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/terms.en.md', zh: 'src/legal/content/terms.zh.md' },
    schema: {
      requiresEffectiveDate: true,
      requiresPolicyVersion: true,
      requiredTokens: { en: TERMS_SECTIONS_EN, zh: TERMS_SECTIONS_ZH },
    },
  },
  license: {
    id: 'license',
    slug: 'license',
    titleKey: 'legal.doc_license',
    source: { en: LICENSE_SRC, zh: null },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'LICENSE', zh: null },
    schema: minimalSchema(['Apache License']),
  },
  'third-party': {
    id: 'third-party',
    slug: 'third-party-notices',
    titleKey: 'legal.doc_third_party',
    source: { en: THIRD_PARTY_SRC, zh: null },
    sourceKind: 'generated',
    sourcePath: { en: 'docs/THIRD_PARTY_NOTICES.md', zh: null },
    schema: minimalSchema(['Third-Party Notices']),
  },
  'asset-licenses': {
    id: 'asset-licenses',
    slug: 'asset-licenses',
    titleKey: 'legal.doc_asset_licenses',
    source: { en: ASSET_LICENSES_EN_SRC, zh: ASSET_LICENSES_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'docs/ASSET_LICENSES.md', zh: 'docs/ASSET_LICENSES.zh-CN.md' },
    schema: minimalSchema(['Asset Licenses'], ['素材许可与来源']),
  },
  about: {
    id: 'about',
    slug: 'about',
    titleKey: 'legal.doc_about',
    source: { en: ABOUT_EN_SRC, zh: ABOUT_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/about.en.md', zh: 'src/legal/content/about.zh.md' },
    schema: minimalSchema(ABOUT_SECTIONS_EN, ABOUT_SECTIONS_ZH),
  },
  security: {
    id: 'security',
    slug: 'security',
    titleKey: 'legal.doc_security',
    source: { en: SECURITY_EN_SRC, zh: SECURITY_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'SECURITY.md', zh: 'docs/SECURITY.zh-CN.md' },
    schema: minimalSchema(['Security Policy'], ['安全政策']),
  },
  contact: {
    id: 'contact',
    slug: 'contact',
    titleKey: 'legal.doc_contact',
    source: { en: CONTACT_EN_SRC, zh: CONTACT_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/contact.en.md', zh: 'src/legal/content/contact.zh.md' },
    schema: minimalSchema(CONTACT_SECTIONS_EN, CONTACT_SECTIONS_ZH),
  },
  changelog: {
    id: 'changelog',
    slug: 'changelog',
    titleKey: 'legal.doc_changelog',
    source: { en: CHANGELOG_EN_SRC, zh: CHANGELOG_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'docs/CHANGELOG.md', zh: 'docs/CHANGELOG.zh-CN.md' },
    schema: minimalSchema(['Changelog'], ['更新日志']),
  },
};

/**
 * The roster in alphabetical order — the ONE ordering both team surfaces (this
 * doc table and the About modal's cards) render. Ordered by each member's
 * romanized `sort` key rather than by a locale collator, which cannot produce a
 * single alphabetical sequence for a mixed Han/Latin roster (see config.ts).
 * Both surfaces print a note that the order carries no meaning.
 */
export function teamInReadingOrder(team: LegalConfig['team']): LegalConfig['team'] {
  return [...team].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
}

// The `{team}` token (About doc): the roster rendered as a markdown table
// (Name | Link) — names + Bilibili links only, no role column; mirrors the
// About-modal team rows. Substituted into the source before parsing, so the
// multi-line table string becomes real table lines the markdown parser reads.
function teamTable(lang: 'en' | 'zh', team: LegalConfig['team']): string {
  const header = lang === 'zh' ? '| 名称 | 链接 |' : '| Name | Link |';
  const sep = '| --- | --- |';
  const rows = teamInReadingOrder(team).map((m) => `| ${m.name} | [Bilibili](${m.url}) |`);
  return [header, sep, ...rows].join('\n');
}

// The `{team}` token for the CONTACT doc: the same roster as a bullet list of
// Bilibili spaces, in the same order (`teamInReadingOrder`) as the About table and
// the About modal's cards, generated from LEGAL.team so it cannot drift from it.
function teamContactList(lang: 'en' | 'zh', team: LegalConfig['team']): string {
  const colon = lang === 'zh' ? '：' : ': ';
  return teamInReadingOrder(team)
    .map((m) => `- ${m.name}${colon}[${m.url.replace(/^https?:\/\//, '')}](${m.url})`)
    .join('\n');
}

// The `{operator}` doc-surface value. `operatorDisplayName` is authored
// 'EN / ZH'; this picks the language-appropriate half, falling back to the
// whole string if it carries no ' / ' separator.
function operatorDisplay(lang: 'en' | 'zh', cfg: LegalConfig): string {
  const [enName, zhName] = cfg.operatorDisplayName.split(' / ');
  if (lang === 'zh') {
    return zhName ?? cfg.operatorDisplayName;
  }
  return enName ?? cfg.operatorDisplayName;
}

// Tokens resolvable from LegalConfig + the doc's own id/lang — a plain
// key->value map fed to a single substitution pass. Every token the authored
// docs use is resolved here; the substitution pass below leaves an UNKNOWN
// token untouched rather than throwing, and the static-page generator fails
// the build on any surviving `{...}`.
function tokensFor(id: DocId, lang: 'en' | 'zh', cfg: LegalConfig): Record<string, string> {
  const tokens: Record<string, string> = {
    app: brandName(lang),
    // Every email address in a rendered doc must be a mailto: link, never
    // plain text. This one substitution site covers every occurrence across
    // every doc/lang, so no authored source hand-wraps a `[…](mailto:…)`;
    // `mailto:` is an ALLOWED_SCHEMES entry, so sanitizeHref accepts it.
    email: `[${cfg.privacyContactEmail}](mailto:${cfg.privacyContactEmail})`,
    securityEmail: `[${cfg.securityContactEmail}](mailto:${cfg.securityContactEmail})`,
    origin: cfg.canonicalOrigin,
    operator: operatorDisplay(lang, cfg),
  };
  if (id === 'contact') {
    // Same roster, list shape instead of the About doc's table.
    tokens.team = teamContactList(lang, cfg.team);
  }
  if (id === 'privacy') {
    tokens.effectiveDate = cfg.effectiveDates.privacy;
    tokens.policyVersion = cfg.policyVersions.privacy;
    tokens.providers = providerDisclosureList(lang)
      .map((p) => `- ${p}`)
      .join('\n');
  }
  if (id === 'terms') {
    tokens.effectiveDate = cfg.effectiveDates.terms;
    tokens.policyVersion = cfg.policyVersions.terms;
  }
  if (id === 'about') {
    tokens.team = teamTable(lang, cfg.team);
  }
  return tokens;
}

function substituteTokens(src: string, tokens: Record<string, string>): string {
  return src.replace(/\{([a-zA-Z-]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key]! : match,
  );
}

/**
 * The token-substituted body for a document in the requested language. A
 * `zh`-null doc (license/third-party) falls back to its `en` body — the doc
 * viewer is the one that adds a zh intro note for those (chrome, not content;
 * see the design spec §6).
 */
export function docBody(id: DocId, lang: 'en' | 'zh', cfg: LegalConfig): string {
  const meta = DOCS[id];
  const src = lang === 'zh' ? (meta.source.zh ?? meta.source.en) : meta.source.en;
  return substituteTokens(src, tokensFor(id, lang, cfg));
}

// The set of root-relative slug paths ('/privacy', …) that HAVE a zh page —
// i.e. the docs whose source carries a zh companion. Cross-doc links pointing
// at one of these should route a zh reader to the zh page, not the en one.
const ZH_SLUG_PATHS: ReadonlySet<string> = new Set(
  Object.values(DOCS)
    .filter((m) => m.source.zh !== null)
    .map((m) => `/${m.slug}`),
);

/**
 * Resolve a root-relative slug PATH (`/privacy`, `/zh/terms`, `/security#x`,
 * …) to its `DocId`, or `null` if it names no known doc. Strips an optional
 * `/zh` language prefix and any `#fragment`. Used by the in-modal reader to
 * turn an intercepted cross-doc link into an in-place doc switch.
 */
export function docIdForPath(slugPath: string): DocId | null {
  const noFrag = slugPath.split('#')[0] ?? '';
  const noLang = noFrag.replace(/^\/zh(?=\/|$)/, '');
  const slug = noLang.replace(/^\//, '');
  const found = Object.values(DOCS).find((m) => m.slug === slug);
  return found ? found.id : null;
}

/**
 * When rendering a zh doc, an INTERNAL cross-doc link whose path exactly matches
 * a known en slug that ALSO has a zh page (`/privacy`, `/terms`, `/security`,
 * `/about`, `/contact`, `/asset-licenses`, `/changelog`) is rewritten to
 * `/zh/<slug>`, so a zh reader stays in Chinese across cross-references. A
 * fragment (`#anchor`) is preserved. Links to en-only docs (`/license`,
 * `/third-party-notices`), external links, and pure fragments are left
 * untouched.
 */
export function localizeZhSlug(href: string): string {
  const hashIdx = href.indexOf('#');
  const path = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const frag = hashIdx === -1 ? '' : href.slice(hashIdx);
  if (!ZH_SLUG_PATHS.has(path)) return href;
  return `/zh${path}${frag}`;
}

function localizeInlineZh(node: Inline): Inline {
  if (node.t === 'link' && !node.external) {
    const href = localizeZhSlug(node.href);
    return href === node.href ? node : { ...node, href };
  }
  return node;
}

function localizeNodeZh(node: MdNode): MdNode {
  switch (node.t) {
    case 'h':
      return { ...node, children: node.children.map(localizeInlineZh) };
    case 'p':
      return { ...node, children: node.children.map(localizeInlineZh) };
    case 'ul':
    case 'ol':
      return { ...node, items: node.items.map((item) => item.map(localizeInlineZh)) };
    case 'blockquote':
      return { ...node, children: node.children.map((line) => line.map(localizeInlineZh)) };
    case 'table':
      return {
        ...node,
        header: node.header.map((cell) => cell.map(localizeInlineZh)),
        rows: node.rows.map((row) => row.map((cell) => cell.map(localizeInlineZh))),
      };
    case 'hr':
      return node;
  }
}

/**
 * The rendered node tree for a doc, guaranteeing exactly one leading h1
 * (spec §14 heading-hierarchy criterion). Every authored doc
 * (`src/legal/content/*`) already opens with a `# ` heading — but a root-file doc
 * reproduced byte-exact (`LICENSE`, pinned verbatim by
 * `license-files.test.ts`: 201 lines / 11357 bytes) carries no markdown
 * heading at all, so one is injected here, titled from the doc's own chrome
 * title (passed in — this module stays i18n-free) rather than by touching the
 * pinned raw source. Both the React doc view and any static-page emitter call
 * this rather than `parseLegalMarkdown(docBody(...))` directly.
 */
export function docNodes(id: DocId, lang: 'en' | 'zh', cfg: LegalConfig, title: string): MdNode[] {
  const parsed = parseLegalMarkdown(docBody(id, lang, cfg));
  // Localized once, here, so both emitters render the same tree.
  const nodes = lang === 'zh' ? parsed.map(localizeNodeZh) : parsed;
  if (nodes.some((n) => n.t === 'h' && n.level === 1)) return nodes;
  return [{ t: 'h', level: 1, children: [{ t: 'text', text: title }] }, ...nodes];
}

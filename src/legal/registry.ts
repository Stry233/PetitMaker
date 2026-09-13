/**
 * Registry shared by the in-app viewer and static-page generator.
 * `sourceKind` distinguishes app-authored bodies, canonical repository documents, and generated documents.
 * `sourcePath` is checked against the imported bytes so every render surface reads the same source.
 */

import type { LegalConfig } from './config';
import { DOC_SLUGS } from './site-paths';
import { activeTarget } from './deploy-targets';
import { brandName } from '../version';
import { parseLegalMarkdown, type Inline, type MdNode } from './markdown';
import { agentProviderDisclosureList, illustrationProviderDisclosureList } from './providers-list';

// Canonical repository and generated document sources.
import LICENSE_SRC from '../../LICENSE?raw';
import THIRD_PARTY_SRC from '../../docs/THIRD_PARTY_NOTICES.md?raw';
import ASSET_LICENSES_EN_SRC from '../../docs/ASSET_LICENSES.md?raw';
import ASSET_LICENSES_ZH_SRC from '../../docs/ASSET_LICENSES.zh-CN.md?raw';
import SECURITY_EN_SRC from '../../SECURITY.md?raw';
import SECURITY_ZH_SRC from '../../docs/SECURITY.zh-CN.md?raw';
import CHANGELOG_EN_SRC from '../../docs/CHANGELOG.md?raw';
import CHANGELOG_ZH_SRC from '../../docs/CHANGELOG.zh-CN.md?raw';

// App-authored English and Chinese bodies.
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
  /** Required headings in each resolved language body. */
  requiredTokens: { en: string[]; zh: string[] };
}

export type DocSourceKind = 'authored' | 'canonical-root' | 'generated';

export interface DocMeta {
  id: DocId;
  slug: string;
  titleKey: string;
  source: { en: string; zh: string | null };
  sourceKind: DocSourceKind;
  /** Repository path for each imported source; Chinese is null for English-only documents. */
  sourcePath: { en: string; zh: string | null };
  schema: DocSchema;
}

const TERMS_SECTIONS_EN = [
  "Scope and Definitions",
  "Reading and Acceptance",
  "Service Description",
  "AI Features, Keys and Fees",
  "Content Rules and User Responsibility",
  "Creative Rights and Asset Use",
  "Exports, Sharing and Recoverable Data",
  "Service Changes and Discontinuation",
  "Saving and Backups",
  "Functional Limits and Warranties",
  "Allocation and Limitation of Liability",
  "Statutory Rights",
  "Content and Intellectual-Property Complaints",
  "Governing Law and Disputes",
  "Relationship Between Documents",
  "Severability",
  "Exercise of Rights",
  "Changes of Operator",
  "Notices and Contact",
  "Language and Interpretation",
  "Updates to These Terms",
];

const TERMS_SECTIONS_ZH = [
  "适用范围与用语",
  "阅读与接受",
  "本工具提供什么",
  "AI 功能、密钥与费用",
  "内容规范与使用责任",
  "作品权利与素材使用",
  "导出、分享与可恢复数据",
  "服务变化与停止提供",
  "保存与备份",
  "功能局限与保证",
  "责任分担与限制",
  "法定权利",
  "内容问题与知识产权投诉",
  "适用法律与争议处理",
  "文件之间的关系",
  "部分条款无效",
  "权利的行使",
  "运营主体变化",
  "通知与联系",
  "语言与解释",
  "条款更新",
];

const PRIVACY_SECTIONS_EN = [
  "Scope",
  "How Information Is Used",
  "Information Stored in Your Browser",
  "Exported Files and Content Checks",
  "Clearing Local Data",
  "Online AI and Model Information",
  "API-Key Storage and Protection",
  "Site Visits, Logs and Analytics",
  "Where Information May Be Processed",
  "Retention",
  "Content Checks and Automated Processing",
  "Your Choices and Rights",
  "Minors",
  "Security Measures and Incident Handling",
  "Policy Updates",
  "Contact and Complaints",
];

const PRIVACY_SECTIONS_ZH = [
  "适用范围",
  "信息处理方式",
  "保存在浏览器中的信息",
  "导出文件与内容检查",
  "清除本地数据",
  "在线 AI 与模型信息服务",
  "API 密钥的保存与保护",
  "网站访问、日志与数据分析",
  "信息可能在哪里处理",
  "保留期限",
  "内容检查与自动化处理",
  "您的选择与权利",
  "未成年人",
  "安全措施与事件处理",
  "政策更新",
  "联系与投诉",
];

const ABOUT_SECTIONS_EN = ["The Team", "Acknowledgements", "Using and Saving Your Work", "Fan-Project Disclosure", "Operator and Filing Information", "Support the Project"];
const ABOUT_SECTIONS_ZH = ["团队", "鸣谢", "使用与保存", "同人项目说明", "运营与备案", "支持项目"];

const CONTACT_SECTIONS_EN = ["Questions and Suggestions", "Security Reports", "Asset Permission and IP Complaints", "Content-Check Feedback", "Privacy Requests", "Community Updates"];
const CONTACT_SECTIONS_ZH = ["使用问题与建议", "安全漏洞", "素材授权与知识产权投诉", "内容检查反馈", "隐私请求", "社区动态"];

function minimalSchema(en: string[], zh: string[] = []): DocSchema {
  return { requiresEffectiveDate: false, requiresPolicyVersion: false, requiredTokens: { en, zh } };
}

export const DOCS: Record<DocId, DocMeta> = {
  privacy: {
    id: 'privacy',
    slug: DOC_SLUGS['privacy'],
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
    slug: DOC_SLUGS['terms'],
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
    slug: DOC_SLUGS['license'],
    titleKey: 'legal.doc_license',
    source: { en: LICENSE_SRC, zh: null },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'LICENSE', zh: null },
    schema: minimalSchema(['Apache License']),
  },
  'third-party': {
    id: 'third-party',
    slug: DOC_SLUGS['third-party'],
    titleKey: 'legal.doc_third_party',
    source: { en: THIRD_PARTY_SRC, zh: null },
    sourceKind: 'generated',
    sourcePath: { en: 'docs/THIRD_PARTY_NOTICES.md', zh: null },
    schema: minimalSchema(['Third-Party Notices']),
  },
  'asset-licenses': {
    id: 'asset-licenses',
    slug: DOC_SLUGS['asset-licenses'],
    titleKey: 'legal.doc_asset_licenses',
    source: { en: ASSET_LICENSES_EN_SRC, zh: ASSET_LICENSES_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'docs/ASSET_LICENSES.md', zh: 'docs/ASSET_LICENSES.zh-CN.md' },
    schema: minimalSchema(['Asset Licenses'], ['素材许可与来源']),
  },
  about: {
    id: 'about',
    slug: DOC_SLUGS['about'],
    titleKey: 'legal.doc_about',
    source: { en: ABOUT_EN_SRC, zh: ABOUT_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/about.en.md', zh: 'src/legal/content/about.zh.md' },
    schema: minimalSchema(ABOUT_SECTIONS_EN, ABOUT_SECTIONS_ZH),
  },
  security: {
    id: 'security',
    slug: DOC_SLUGS['security'],
    titleKey: 'legal.doc_security',
    source: { en: SECURITY_EN_SRC, zh: SECURITY_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'SECURITY.md', zh: 'docs/SECURITY.zh-CN.md' },
    schema: minimalSchema(['Security Policy'], ['安全政策']),
  },
  contact: {
    id: 'contact',
    slug: DOC_SLUGS['contact'],
    titleKey: 'legal.doc_contact',
    source: { en: CONTACT_EN_SRC, zh: CONTACT_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/contact.en.md', zh: 'src/legal/content/contact.zh.md' },
    schema: minimalSchema(CONTACT_SECTIONS_EN, CONTACT_SECTIONS_ZH),
  },
  changelog: {
    id: 'changelog',
    slug: DOC_SLUGS['changelog'],
    titleKey: 'legal.doc_changelog',
    source: { en: CHANGELOG_EN_SRC, zh: CHANGELOG_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'docs/CHANGELOG.md', zh: 'docs/CHANGELOG.zh-CN.md' },
    schema: minimalSchema(['Changelog'], ['更新日志']),
  },
};

/** Stable mixed-script roster order using each member's romanized sort key. */
export function teamInReadingOrder(team: LegalConfig['team']): LegalConfig['team'] {
  return [...team].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
}

/** Markdown table for the About document's `{team}` and `{acknowledgements}` tokens. */
function teamTable(lang: 'en' | 'zh', team: LegalConfig['team']): string {
  const header = lang === 'zh' ? '| 名称 | 链接 |' : '| Name | Link |';
  const sep = '| --- | --- |';
  const rows = teamInReadingOrder(team).map((m) => `| ${m.name} | [Bilibili](${m.url}) |`);
  return [header, sep, ...rows].join('\n');
}

/** Markdown list for the Contact document's `{team}` token. */
function teamContactList(lang: 'en' | 'zh', team: LegalConfig['team']): string {
  const colon = lang === 'zh' ? '：' : ': ';
  return teamInReadingOrder(team)
    .map((m) => `- ${m.name}${colon}[${m.url.replace(/^https?:\/\//, '')}](${m.url})`)
    .join('\n');
}

/** Locale-specific half of an `EN / ZH` operator name. */
function operatorDisplay(lang: 'en' | 'zh', cfg: LegalConfig): string {
  const [enName, zhName] = cfg.operatorDisplayName.split(' / ');
  if (lang === 'zh') {
    return zhName ?? cfg.operatorDisplayName;
  }
  return enName ?? cfg.operatorDisplayName;
}

/** Values available to authored document tokens. Unknown tokens survive for the build validator. */
function tokensFor(id: DocId, lang: 'en' | 'zh', cfg: LegalConfig): Record<string, string> {
  const tokens: Record<string, string> = {
    app: brandName(lang),
    // Email tokens always render as links.
    email: `[${cfg.privacyContactEmail}](mailto:${cfg.privacyContactEmail})`,
    securityEmail: `[${cfg.securityContactEmail}](mailto:${cfg.securityContactEmail})`,
    origin: cfg.canonicalOrigin,
    repo: cfg.repoUrl,
    operator: operatorDisplay(lang, cfg),
  };
  if (id === 'contact') {
    tokens.team = teamContactList(lang, cfg.team);
  }
  if (id === 'privacy') {
    tokens.effectiveDate = cfg.effectiveDates.privacy;
    tokens.policyVersion = cfg.policyVersions.privacy;
    const agentProviders = agentProviderDisclosureList(lang);
    const illustrationProviders = illustrationProviderDisclosureList(lang);
    tokens.agentProviderCount = String(agentProviders.length);
    tokens.illustrationProviderCount = String(illustrationProviders.length);
    tokens.providers = agentProviders
      .map((p) => `- ${p}`)
      .join('\n');
    tokens.illustrationProviders = illustrationProviders
      .map((p) => `- ${p}`)
      .join('\n');
    // Hosting disclosures follow the active deployment target.
    const target = activeTarget();
    tokens.hostNetwork = target.privacyHostNetwork[lang];
    tokens.edgeDelivery = target.privacyEdgeDelivery[lang];
  }
  if (id === 'terms') {
    tokens.effectiveDate = cfg.effectiveDates.terms;
    tokens.policyVersion = cfg.policyVersions.terms;
  }
  if (id === 'about') {
    tokens.team = teamTable(lang, cfg.team);
    tokens.acknowledgements = teamTable(lang, cfg.acknowledgements);
    tokens.patreon = cfg.sponsorship.patreon;
    tokens.afdian = cfg.sponsorship.afdian;
  }
  return tokens;
}

function substituteTokens(src: string, tokens: Record<string, string>): string {
  return src.replace(/\{([a-zA-Z-]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key]! : match,
  );
}

/** Resolved document body; English is the fallback for documents without a Chinese source. */
export function docBody(id: DocId, lang: 'en' | 'zh', cfg: LegalConfig): string {
  const meta = DOCS[id];
  const src = lang === 'zh' ? (meta.source.zh ?? meta.source.en) : meta.source.en;
  return substituteTokens(src, tokensFor(id, lang, cfg));
}

// Root-relative document paths that have a Chinese source.
const ZH_SLUG_PATHS: ReadonlySet<string> = new Set(
  Object.values(DOCS)
    .filter((m) => m.source.zh !== null)
    .map((m) => `/${m.slug}`),
);

/** Resolve a document path, with an optional Chinese prefix or fragment, to its id. */
export function docIdForPath(slugPath: string): DocId | null {
  const noFrag = slugPath.split('#')[0] ?? '';
  const noLang = noFrag.replace(/^\/zh(?=\/|$)/, '');
  const slug = noLang.replace(/^\//, '');
  const found = Object.values(DOCS).find((m) => m.slug === slug);
  return found ? found.id : null;
}

/** Add `/zh` to a cross-document link when that document has a Chinese source. */
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

/** Parsed document nodes with a level-one heading injected when the canonical source has none. */
export function docNodes(id: DocId, lang: 'en' | 'zh', cfg: LegalConfig, title: string): MdNode[] {
  const parsed = parseLegalMarkdown(docBody(id, lang, cfg));
  const nodes = lang === 'zh' ? parsed.map(localizeNodeZh) : parsed;
  if (nodes.some((n) => n.t === 'h' && n.level === 1)) return nodes;
  return [{ t: 'h', level: 1, children: [{ t: 'text', text: title }] }, ...nodes];
}

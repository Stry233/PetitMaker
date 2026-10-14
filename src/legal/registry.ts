/**
 * Registry shared by the in-app viewer and static-page generator.
 * `sourceKind` distinguishes app-authored bodies, canonical repository documents, and generated documents.
 * `sourcePath` is checked against the imported bytes so every render surface reads the same source.
 */

import { memberUrl, type LegalConfig } from './config';
import { DOC_IDS, DOC_SLUGS, type DocId } from './site-paths';
import { brandName } from '../i18n/brand';
import { parseLegalMarkdown, type Inline, type MdNode } from './markdown';
import { agentProviderDisclosureList, illustrationProviderDisclosureList } from './providers-list';
import { loadedTable } from '../i18n/translations';

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
import type { I18nKey } from '../i18n/keys';

export type { DocId };

export type DocSourceKind = 'authored' | 'canonical-root' | 'generated';

export interface DocMeta {
  id: DocId;
  slug: string;
  titleKey: I18nKey;
  source: { en: string; zh: string | null };
  sourceKind: DocSourceKind;
  /** Repository path for each imported source; Chinese is null for English-only documents. */
  sourcePath: { en: string; zh: string | null };
  /** Whether the document states an effective date and policy version. */
  dated: boolean;
}

/** QQ serves a channel's public page, with its join prompt, at pd.qq.com/g/<channel number>. */
export const qqChannelPageUrl = (channel: string): string => `https://pd.qq.com/g/${channel}`;

/** Each document's own facts; its id and slug come from `DOC_SLUGS`. */
const DOC_ENTRIES: Record<DocId, Omit<DocMeta, 'id' | 'slug'>> = {
  privacy: {
    titleKey: 'legal.doc_privacy',
    source: { en: PRIVACY_EN_SRC, zh: PRIVACY_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/privacy.en.md', zh: 'src/legal/content/privacy.zh.md' },
    dated: true,
  },
  terms: {
    titleKey: 'legal.doc_terms',
    source: { en: TERMS_EN_SRC, zh: TERMS_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/terms.en.md', zh: 'src/legal/content/terms.zh.md' },
    dated: true,
  },
  license: {
    titleKey: 'legal.doc_license',
    source: { en: LICENSE_SRC, zh: null },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'LICENSE', zh: null },
    dated: false,
  },
  'third-party': {
    titleKey: 'legal.doc_third_party',
    source: { en: THIRD_PARTY_SRC, zh: null },
    sourceKind: 'generated',
    sourcePath: { en: 'docs/THIRD_PARTY_NOTICES.md', zh: null },
    dated: false,
  },
  'asset-licenses': {
    titleKey: 'legal.doc_asset_licenses',
    source: { en: ASSET_LICENSES_EN_SRC, zh: ASSET_LICENSES_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'docs/ASSET_LICENSES.md', zh: 'docs/ASSET_LICENSES.zh-CN.md' },
    dated: false,
  },
  about: {
    titleKey: 'legal.doc_about',
    source: { en: ABOUT_EN_SRC, zh: ABOUT_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/about.en.md', zh: 'src/legal/content/about.zh.md' },
    dated: false,
  },
  security: {
    titleKey: 'legal.doc_security',
    source: { en: SECURITY_EN_SRC, zh: SECURITY_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'SECURITY.md', zh: 'docs/SECURITY.zh-CN.md' },
    dated: false,
  },
  contact: {
    titleKey: 'legal.doc_contact',
    source: { en: CONTACT_EN_SRC, zh: CONTACT_ZH_SRC },
    sourceKind: 'authored',
    sourcePath: { en: 'src/legal/content/contact.en.md', zh: 'src/legal/content/contact.zh.md' },
    dated: false,
  },
  changelog: {
    titleKey: 'legal.doc_changelog',
    source: { en: CHANGELOG_EN_SRC, zh: CHANGELOG_ZH_SRC },
    sourceKind: 'canonical-root',
    sourcePath: { en: 'docs/CHANGELOG.md', zh: 'docs/CHANGELOG.zh-CN.md' },
    dated: false,
  },
};

export const DOCS = Object.fromEntries(
  DOC_IDS.map((id) => [id, { id, slug: DOC_SLUGS[id], ...DOC_ENTRIES[id] }]),
) as Record<DocId, DocMeta>;

/** Stable mixed-script roster order using each member's romanized sort key. */
export function teamInReadingOrder(team: LegalConfig['team']): LegalConfig['team'] {
  return [...team].sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
}

/** A document language's interface table, for the few words a generated block writes itself;
 *  a Chinese body needs the zh table loaded (`i18n/translations.ts:loadLocale`). */
const copy = (lang: 'en' | 'zh') => loadedTable(lang);

/** Markdown table for the About document's `{team}` and `{acknowledgements}` tokens. */
function teamTable(lang: 'en' | 'zh', team: LegalConfig['team']): string {
  const header = `| ${copy(lang)['legal.team_name']} | ${copy(lang)['legal.team_link']} |`;
  const sep = '| --- | --- |';
  const rows = teamInReadingOrder(team).map((m) => `| ${m.name} | [Bilibili](${memberUrl(m)}) |`);
  return [header, sep, ...rows].join('\n');
}

/** Markdown list for the Contact document's `{team}` token. */
function teamContactList(lang: 'en' | 'zh', team: LegalConfig['team']): string {
  const colon = copy(lang)['legal.label_colon'];
  return teamInReadingOrder(team)
    .map((m) => { const url = memberUrl(m); return `- ${m.name}${colon}[${url.replace(/^https?:\/\//, '')}](${url})`; })
    .join('\n');
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
    operator: cfg.operatorName[lang],
  };
  if (id === 'contact') {
    tokens.qqFeedbackChannel = cfg.qqFeedbackChannel;
    tokens.qqFeedbackChannelUrl = qqChannelPageUrl(cfg.qqFeedbackChannel);
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
    tokens.hostNetwork = cfg.privacyHostNetwork[lang];
    tokens.edgeDelivery = cfg.privacyEdgeDelivery[lang];
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

import { describe, it, expect } from 'vitest';
import { DOCS, docBody, docNodes, localizeZhSlug, type DocId } from '../../legal/registry';
import type { Inline, MdNode } from '../../legal/markdown';
import { LEGAL } from '../../legal/config';
import { providerDisclosureList } from '../../legal/providers-list';
import { PROVIDER_IDS, PROVIDER_META } from '../../agent/providers/defaults';
import { parseLegalMarkdown, sanitizeHref } from '../../legal/markdown';
import { renderHtml } from '../../legal/markdown-html';
import { APP_NAME } from '../../version';

// Doc registry + per-doc schema. `src/legal/content/*` carry the authored
// prose; this test locks in the structural contract they must preserve:
// every DocId resolves a source, zh is present exactly where the schema
// demands it, and `docBody` substitutes tokens without ever leaking an
// unresolved `{...}` placeholder.

const ALL_DOC_IDS: DocId[] = [
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

// '{providers}' and '{team}' are both wired, and the deployment facts are written directly into the
// privacy body, so NO token is deferred: every doc/lang pair must resolve fully.
const DEFERRED_TOKENS: string[] = [];

function unresolvedTokens(body: string): string[] {
  const matches = body.match(/\{[a-zA-Z-]+\}/g) ?? [];
  return matches.map((m) => m.slice(1, -1));
}

describe('DOCS registry', () => {
  it('has an entry for every DocId with matching id/slug', () => {
    for (const id of ALL_DOC_IDS) {
      const meta = DOCS[id];
      expect(meta).toBeDefined();
      expect(meta.id).toBe(id);
      expect(meta.slug.length).toBeGreaterThan(0);
      expect(meta.titleKey.length).toBeGreaterThan(0);
    }
  });

  it('every DOCS entry titleKey matches the legal.doc_* naming convention', () => {
    const titleKeyPattern = /^legal\.doc_[a-z_]+$/;
    for (const id of ALL_DOC_IDS) {
      expect(DOCS[id].titleKey, `${id} titleKey should match legal.doc_* pattern`).toMatch(titleKeyPattern);
    }
  });

  it('every DocId resolves a non-empty en source', () => {
    for (const id of ALL_DOC_IDS) {
      expect(DOCS[id].source.en.trim().length).toBeGreaterThan(0);
    }
  });

  it('zh source is present exactly for the docs that carry a zh companion', () => {
    const zhDocs: DocId[] = ['privacy', 'terms', 'about', 'security', 'contact', 'asset-licenses', 'changelog'];
    const enOnlyDocs: DocId[] = ['license', 'third-party'];

    for (const id of zhDocs) {
      expect(DOCS[id].source.zh, `${id} should carry a zh source`).not.toBeNull();
      expect((DOCS[id].source.zh ?? '').trim().length).toBeGreaterThan(0);
    }
    for (const id of enOnlyDocs) {
      expect(DOCS[id].source.zh, `${id} should be en-only`).toBeNull();
    }
  });

  // Systemic guard: a link the sanitizer strips renders as dead
  // plain text (e.g. a dot-relative `./SECURITY.md`). No doc body, in any
  // language, may carry one. Mirrors the parser's own link pattern.
  it('no doc body (any language) carries a link that sanitizeHref strips', () => {
    // Same link grammar the inline tokenizer uses (one level of balanced parens).
    const LINK_RE = /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g;
    const offenders: string[] = [];
    for (const id of ALL_DOC_IDS) {
      const langs: Array<'en' | 'zh'> = DOCS[id].source.zh ? ['en', 'zh'] : ['en'];
      for (const lang of langs) {
        const body = docBody(id, lang, LEGAL);
        LINK_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = LINK_RE.exec(body)) !== null) {
          const href = m[2] ?? '';
          if (sanitizeHref(href) === null) {
            offenders.push(`${id}.${lang}: [${m[1]}](${href})`);
          }
        }
      }
    }
    expect(offenders, `these links are stripped by sanitizeHref and render dead:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('no authored content doc carries the DRAFT marker (privacy/terms/about/contact all finished)', () => {
    for (const id of ['privacy', 'terms', 'about', 'contact'] as DocId[]) {
      expect(DOCS[id].source.en, `${id}.en still marked DRAFT`).not.toContain('<!-- DRAFT -->');
      expect(DOCS[id].source.zh ?? '', `${id}.zh still marked DRAFT`).not.toContain('<!-- DRAFT -->');
    }
  });

  it('privacy and terms require effectiveDate/policyVersion; others do not', () => {
    expect(DOCS.privacy.schema.requiresEffectiveDate).toBe(true);
    expect(DOCS.privacy.schema.requiresPolicyVersion).toBe(true);
    expect(DOCS.terms.schema.requiresEffectiveDate).toBe(true);
    expect(DOCS.terms.schema.requiresPolicyVersion).toBe(true);

    for (const id of ALL_DOC_IDS.filter((i) => i !== 'privacy' && i !== 'terms')) {
      expect(DOCS[id].schema.requiresEffectiveDate).toBe(false);
      expect(DOCS[id].schema.requiresPolicyVersion).toBe(false);
    }
  });

  it('terms schema lists all twenty-one §9 section markers, found in order in both languages', () => {
    const { en, zh } = DOCS.terms.schema.requiredTokens;
    expect(en.length).toBe(21);
    expect(zh.length).toBe(21);

    const enBody = docBody('terms', 'en', LEGAL);
    const zhBody = docBody('terms', 'zh', LEGAL);

    // Match each section marker at its HEADING line, not as a bare substring:
    // a section name legitimately recurs in prose (e.g. a Definitions entry or
    // a cross-reference), and in zh a heading slug is the section name verbatim,
    // so a bare `indexOf` would find an out-of-order prose occurrence. "Found
    // in order" means the twenty-one section HEADINGS appear in order.
    const headingIdx = (body: string, token: string): number => {
      let offset = 0;
      for (const line of body.split('\n')) {
        if (/^#{2,4}\s/.test(line) && line.includes(token)) return offset;
        offset += line.length + 1;
      }
      return -1;
    };

    let cursor = -1;
    for (const token of en) {
      const idx = headingIdx(enBody, token);
      expect(idx, `"${token}" missing from terms.en`).toBeGreaterThan(cursor);
      cursor = idx;
    }
    cursor = -1;
    for (const token of zh) {
      const idx = headingIdx(zhBody, token);
      expect(idx, `"${token}" missing from terms.zh`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it('privacy schema tokens are found in both language bodies', () => {
    const { en, zh } = DOCS.privacy.schema.requiredTokens;
    expect(en.length).toBeGreaterThan(0);
    expect(zh.length).toBeGreaterThan(0);

    const enBody = docBody('privacy', 'en', LEGAL);
    const zhBody = docBody('privacy', 'zh', LEGAL);
    for (const token of en) expect(enBody).toContain(token);
    for (const token of zh) expect(zhBody).toContain(token);
  });

  it('every other doc schema carries requiredTokens found in its en body (zh only when present)', () => {
    for (const id of ALL_DOC_IDS.filter((i) => i !== 'privacy' && i !== 'terms')) {
      const { requiredTokens } = DOCS[id].schema;
      const enBody = docBody(id, 'en', LEGAL);
      for (const token of requiredTokens.en) expect(enBody).toContain(token);

      if (DOCS[id].source.zh !== null) {
        const zhBody = docBody(id, 'zh', LEGAL);
        for (const token of requiredTokens.zh) expect(zhBody).toContain(token);
      } else {
        expect(requiredTokens.zh).toEqual([]);
      }
    }
  });
});

describe('docBody — token substitution', () => {
  it('substitutes {app} with the locale brand name', () => {
    const en = docBody('privacy', 'en', LEGAL);
    const zh = docBody('privacy', 'zh', LEGAL);
    expect(en).toContain(APP_NAME);
    expect(zh).toContain('谷地工坊');
    expect(en).not.toContain('{app}');
    expect(zh).not.toContain('{app}');
  });

  it('substitutes {email}/{securityEmail} with the configured contact addresses', () => {
    const body = docBody('contact', 'en', LEGAL);
    expect(body).toContain(LEGAL.privacyContactEmail);
    expect(body).toContain(LEGAL.securityContactEmail);
    expect(body).not.toContain('{email}');
    expect(body).not.toContain('{securityEmail}');
  });

  // The effective-date/version stamp is emitted ONCE, programmatically — the
  // static page's `updatedLineHtml` and the in-app footer (`legal.updated`) —
  // NOT authored into the doc body (that would duplicate it). So the raw
  // `{effectiveDate}`/`{policyVersion}` tokens must not survive in any body, and
  // no unsubstituted token may leak either. The programmatic surface carrying
  // the date is proven by build-pages.test.ts ("shows effective date + policy
  // version for privacy/terms").
  it('does not author {effectiveDate}/{policyVersion} into the body (emitted programmatically instead)', () => {
    for (const id of ['privacy', 'terms'] as DocId[]) {
      for (const lang of ['en', 'zh'] as const) {
        const body = docBody(id, lang, LEGAL);
        expect(body, `${id}.${lang} must not carry the effectiveDate stamp in-body`).not.toContain('{effectiveDate}');
        expect(body, `${id}.${lang} must not carry the policyVersion stamp in-body`).not.toContain('{policyVersion}');
      }
    }
  });

  it('substitutes {operator} from operatorDisplayName, and {origin}', () => {
    // The reader sees the plain team label, with no "pending" qualifier on it.
    const enName = LEGAL.operatorDisplayName.split(' / ')[0] ?? LEGAL.operatorDisplayName;
    const zhName = LEGAL.operatorDisplayName.split(' / ')[1] ?? LEGAL.operatorDisplayName;

    const en = docBody('about', 'en', LEGAL);
    expect(en).not.toContain('{operator}');
    expect(en).toContain(enName);
    expect(en).not.toContain('operator identification pending');

    const zh = docBody('about', 'zh', LEGAL);
    expect(zh).toContain(zhName);
    expect(zh).not.toContain('运营主体待确定');

    const privacy = docBody('privacy', 'en', LEGAL);
    expect(privacy).not.toContain('{origin}');
  });

  it('resolves {providers} in privacy and {team} in about; no token stays deferred', () => {
    const privacy = docBody('privacy', 'en', LEGAL);
    expect(privacy).not.toContain('{providers}');
    expect(privacy).not.toContain('{deployment-facts}');

    for (const lang of ['en', 'zh'] as const) {
      const about = docBody('about', lang, LEGAL);
      expect(about, `about.${lang} left {team} unresolved`).not.toContain('{team}');
      // the roster renders as a table carrying every member's pseudonym
      for (const member of LEGAL.team) {
        expect(about, `about.${lang} missing team member ${member.name}`).toContain(member.name);
      }
    }
  });

  it('a zh-null doc falls back to its en body when zh is requested', () => {
    const en = docBody('third-party', 'en', LEGAL);
    const zh = docBody('third-party', 'zh', LEGAL);
    expect(zh).toBe(en);
  });

  it('leaves no unresolved {...} tokens beyond the deferred allowlist', () => {
    for (const id of ALL_DOC_IDS) {
      for (const lang of ['en', 'zh'] as const) {
        const body = docBody(id, lang, LEGAL);
        const unresolved = unresolvedTokens(body).filter((t) => !DEFERRED_TOKENS.includes(t));
        // No token is deferred, so every doc/lang pair must be fully resolved
        // (providers/team included).
        expect(unresolved, `${id}/${lang} left unresolved tokens`).toEqual([]);
      }
    }
  });

  it('the retired {deployment-facts} token appears in no document (any language)', () => {
    for (const id of ALL_DOC_IDS) {
      for (const lang of ['en', 'zh'] as const) {
        if (lang === 'zh' && DOCS[id].source.zh === null) continue;
        expect(docBody(id, lang, LEGAL)).not.toContain('{deployment-facts}');
      }
    }
  });
});

// Render-time zh slug localization. A zh reader must stay in
// Chinese across cross-doc references: an internal link to a slug that HAS a zh
// page routes to /zh/<slug>; en-only-doc links and en rendering stay untouched.
describe('zh slug localization (docNodes / localizeZhSlug)', () => {
  function linkHrefs(nodes: MdNode[]): string[] {
    const out: string[] = [];
    const visitInline = (i: Inline) => {
      if (i.t === 'link') out.push(i.href);
    };
    for (const n of nodes) {
      switch (n.t) {
        case 'h':
        case 'p':
          n.children.forEach(visitInline);
          break;
        case 'ul':
        case 'ol':
          n.items.forEach((item) => item.forEach(visitInline));
          break;
        case 'blockquote':
          n.children.forEach((line) => line.forEach(visitInline));
          break;
        case 'table':
          n.header.forEach((c) => c.forEach(visitInline));
          n.rows.forEach((r) => r.forEach((c) => c.forEach(visitInline)));
          break;
      }
    }
    return out;
  }

  it('localizeZhSlug maps zh-capable slugs, preserves fragments, leaves others alone', () => {
    expect(localizeZhSlug('/privacy')).toBe('/zh/privacy');
    expect(localizeZhSlug('/security')).toBe('/zh/security');
    expect(localizeZhSlug('/terms#changes')).toBe('/zh/terms#changes');
    expect(localizeZhSlug('/asset-licenses')).toBe('/zh/asset-licenses');
    expect(localizeZhSlug('/changelog')).toBe('/zh/changelog');
    // en-only docs have no zh page → untouched
    expect(localizeZhSlug('/license')).toBe('/license');
    // pure fragment / already-localized left alone
    expect(localizeZhSlug('#section')).toBe('#section');
    expect(localizeZhSlug('/zh/privacy')).toBe('/zh/privacy');
  });

  it('zh doc bodies render /zh/ hrefs for cross-doc slug links', () => {
    for (const id of ['about', 'terms', 'contact'] as DocId[]) {
      const nodes = docNodes(id, 'zh', LEGAL, 'T');
      const hrefs = linkHrefs(nodes);
      const rootRelative = hrefs.filter((h) => h.startsWith('/') && !h.startsWith('/zh/'));
      // Any remaining root-relative link must be to an en-only doc (no zh page).
      for (const h of rootRelative) {
        expect(
          ['/license', '/third-party-notices'].some((p) => h.startsWith(p)),
          `${id}.zh link ${h} should have been localized to /zh/`,
        ).toBe(true);
      }
      // and there is at least one localized cross-doc link
      expect(hrefs.some((h) => h.startsWith('/zh/')), `${id}.zh should carry a /zh/ cross-doc link`).toBe(true);
    }
  });

  it('en doc rendering is NOT localized', () => {
    const nodes = docNodes('about', 'en', LEGAL, 'T');
    const hrefs = linkHrefs(nodes);
    expect(hrefs.some((h) => h.startsWith('/zh/'))).toBe(false);
  });
});

// The privacy policy's binding factual anchors. These
// are content phrases (beyond the schema's section headings) that the authored
// prose MUST carry verbatim so the substance model cannot be quietly softened.
describe('privacy — required substance tokens', () => {
  const PRIVACY_TOKENS_EN = [
    'not stored on our servers by default',
    'may contain embedded map data',
    'may not remove every embedded carrier',
    'no request carrying your map data or prompts occurs until',
    'compromised browser, extension, script, or device',
    'will be reassessed',
    'Depending on where you live',
    'does not delete',
  ];

  const PRIVACY_TOKENS_ZH = [
    '默认不会存储在我们的服务器上',
    '可能包含嵌入的地图数据',
    '并不一定能移除所有嵌入的数据载体',
    '在你主动触发之前，不会有携带你的地图数据或提示词的请求发出',
    '被攻陷的浏览器、扩展、脚本或设备',
    '将重新评估',
    '根据你所在地区适用的法律',
    '不会删除',
  ];

  it('carries every en substance token', () => {
    const body = docBody('privacy', 'en', LEGAL);
    for (const token of PRIVACY_TOKENS_EN) {
      expect(body, `privacy.en missing "${token}"`).toContain(token);
    }
  });

  it('carries every zh substance token', () => {
    const body = docBody('privacy', 'zh', LEGAL);
    for (const token of PRIVACY_TOKENS_ZH) {
      expect(body, `privacy.zh missing "${token}"`).toContain(token);
    }
  });

  it('renders the AI-provider disclosure as a markdown list', () => {
    const en = docBody('privacy', 'en', LEGAL);
    for (const entry of providerDisclosureList('en')) {
      expect(en, `privacy.en missing provider entry "${entry}"`).toContain(`- ${entry}`);
    }
  });
});

// Round 3 — the "Where Your Data Goes" deployment-facts disclosure (former
// {deployment-facts} token, now authored inline). Pins the real, human-verified
// hosting facts so the location disclosure cannot be silently softened, and the
// plain "operated by {operator}" statement, with no qualifier on the doc surface.
describe('privacy — deployment-facts disclosure (§8)', () => {
  // Tokens chosen to sit on a single source line (the raw markdown hard-wraps,
  // so a phrase that crosses a line break is not a contiguous substring).
  const DEPLOY_TOKENS_EN = [
    'Cloudflare',
    'Workers static asset hosting',
    // The mainland-China fact is pinned in its NEGATIVE form: this edge network has no locations
    // there, and softening that to a bare mention of the region is the exact drift this guards.
    'no locations in mainland China',
    'Microsoft Outlook',
    'no servers of our own',
    'This service is operated by',
  ];
  const DEPLOY_TOKENS_ZH = [
    'Cloudflare',
    'Workers 静态资源托管',
    '在中国大陆没有节点',
    '微软 Outlook',
    '不运营任何自有服务器',
    '本服务由',
  ];

  it('en carries every deployment fact', () => {
    const body = docBody('privacy', 'en', LEGAL);
    for (const token of DEPLOY_TOKENS_EN) expect(body, `privacy.en missing "${token}"`).toContain(token);
  });

  it('zh carries every deployment fact', () => {
    const body = docBody('privacy', 'zh', LEGAL);
    for (const token of DEPLOY_TOKENS_ZH) expect(body, `privacy.zh missing "${token}"`).toContain(token);
  });
});

// The Terms of Use's binding factual anchors. Beyond
// the fourteen ordered section headings, these are the substance phrases the
// authored prose MUST carry verbatim so the most legally consequential document
// cannot be quietly softened: the free/local-tool posture, BYOK, the verbatim
// user-content and importable-image clauses, the AS-IS / max-extent liability
// framing that explicitly refuses to exclude the non-excludable, the
// consumer-law savings clause, the modest "mandatory applicable law controls"
// governing-law posture, and the honored real-world facts (unofficial fan
// project, HoYoverse ownership, the [IP] takedown tag, the parent/guardian
// note).
describe('terms — required substance tokens', () => {
  const TERMS_TOKENS_EN = [
    'Acceptance',
    'free',
    'local',
    'your own key',
    'Acceptable use',
    'As between you and us',
    'technically accessible',
    'discontinu',
    'back up',
    'AS IS',
    'to the maximum extent permitted',
    'consumer',
    'applicable law',
    'Changes',
    'mandatory applicable law controls',
    'mandatory consumer protections',
    'parent or guardian',
    'unofficial',
    'miHoYo',
    'HoYoverse',
    'cannot lawfully be excluded',
    '[IP]',
  ];

  const TERMS_TOKENS_ZH = [
    '接受',
    '免费',
    '本地',
    '自己的密钥',
    '可接受使用',
    '在你与我们之间',
    '在技术上可被',
    '终止',
    '备份',
    '现状',
    '在适用法律允许的最大范围内',
    '消费者',
    '适用法律',
    '变更',
    '以强制性适用法律为准',
    '强制性消费者保护',
    '父母或监护人',
    '非官方',
    '米哈游',
    'HoYoverse',
    '依法不可排除',
    '[IP]',
  ];

  it('carries every en substance token', () => {
    const body = docBody('terms', 'en', LEGAL);
    for (const token of TERMS_TOKENS_EN) {
      expect(body, `terms.en missing "${token}"`).toContain(token);
    }
  });

  it('carries every zh substance token', () => {
    const body = docBody('terms', 'zh', LEGAL);
    for (const token of TERMS_TOKENS_ZH) {
      expect(body, `terms.zh missing "${token}"`).toContain(token);
    }
  });

  it('names no specific AI-provider brand (that disclosure lives in the privacy policy)', () => {
    // BYOK stays generic here; provider brands only in the privacy registry.
    for (const lang of ['en', 'zh'] as const) {
      const body = docBody('terms', lang, LEGAL);
      for (const id of PROVIDER_IDS) {
        if (id === 'custom') continue;
        expect(body, `terms.${lang} must not name provider "${id}"`).not.toContain(
          PROVIDER_META[id].label,
        );
      }
    }
  });
});

// The About document's binding substance:
// the unofficial/nominative framing, the mission (plan in the
// browser → rebuild in-game), the team roster (every pseudonym — role labels
// carries names and links only, with no role column), a tech-stack
// line, the config-driven filing note (no fabricated numbers), and the
// affiliation disclaimer. Parity across en+zh.
describe('about — required substance tokens', () => {
  const ABOUT_TOKENS_EN = [
    'unofficial',
    'in your browser',
    'in-game',
    'PixiJS',
    'not affiliated with',
    'miHoYo',
    'HoYoverse',
    'when they are configured',
  ];

  const ABOUT_TOKENS_ZH = [
    '非官方',
    '浏览器',
    '游戏中',
    'PixiJS',
    '无任何关联',
    '米哈游',
    'HoYoverse',
    '在配置后',
  ];

  it('carries every en substance token', () => {
    const body = docBody('about', 'en', LEGAL);
    for (const token of ABOUT_TOKENS_EN) {
      expect(body, `about.en missing "${token}"`).toContain(token);
    }
  });

  it('carries every zh substance token', () => {
    const body = docBody('about', 'zh', LEGAL);
    for (const token of ABOUT_TOKENS_ZH) {
      expect(body, `about.zh missing "${token}"`).toContain(token);
    }
  });

  it('renders the team roster as a table row per member with their Bilibili link', () => {
    for (const lang of ['en', 'zh'] as const) {
      const body = docBody('about', lang, LEGAL);
      for (const member of LEGAL.team) {
        expect(body, `about.${lang} missing ${member.name}`).toContain(member.name);
        expect(body, `about.${lang} missing ${member.name}'s link`).toContain(member.url);
      }
    }
  });
});

// The Contact document's binding substance:
// a purpose-routed set of channels — general & bugs (GitHub
// issues + email), security ([SECURITY] → SECURITY.md), IP/takedown ([IP]),
// community (the four Bilibili spaces) — plus the "aim to respond within 14
// days" expectation. Parity across en+zh.
describe('contact — required substance tokens', () => {
  const CONTACT_TOKENS_EN = [
    '[SECURITY]',
    '[IP]',
    'GitHub',
    'Bilibili',
    '14',
    'aim to respond',
    LEGAL.privacyContactEmail,
  ];

  const CONTACT_TOKENS_ZH = [
    '[SECURITY]',
    '[IP]',
    'GitHub',
    'Bilibili',
    '14',
    '力求',
    LEGAL.privacyContactEmail,
  ];

  it('carries every en substance token', () => {
    const body = docBody('contact', 'en', LEGAL);
    for (const token of CONTACT_TOKENS_EN) {
      expect(body, `contact.en missing "${token}"`).toContain(token);
    }
  });

  it('carries every zh substance token', () => {
    const body = docBody('contact', 'zh', LEGAL);
    for (const token of CONTACT_TOKENS_ZH) {
      expect(body, `contact.zh missing "${token}"`).toContain(token);
    }
  });

  it('links each of the four Bilibili community spaces', () => {
    for (const lang of ['en', 'zh'] as const) {
      const body = docBody('contact', lang, LEGAL);
      for (const member of LEGAL.team) {
        expect(body, `contact.${lang} missing Bilibili space ${member.url}`).toContain(member.url);
      }
    }
  });
});

// Provider-list drift guard (design spec §8/§18): the disclosed provider list
// is DERIVED from the app's own registry, so it cannot silently omit a provider
// the app can actually reach.
describe('providerDisclosureList — no drift from the agent registry', () => {
  it('represents every provider id in src/agent/providers/defaults.ts', () => {
    const list = providerDisclosureList('en');
    for (const id of PROVIDER_IDS) {
      if (id === 'custom') {
        expect(
          list.some((entry) => /custom endpoint/i.test(entry)),
          'custom endpoints must be disclosed',
        ).toBe(true);
      } else {
        expect(
          list.some((entry) => entry.includes(PROVIDER_META[id].label)),
          `provider "${id}" (${PROVIDER_META[id].label}) must be disclosed`,
        ).toBe(true);
      }
    }
  });

  it('has exactly one entry per selectable provider', () => {
    expect(providerDisclosureList('en')).toHaveLength(PROVIDER_IDS.length);
  });

  it('localizes only the custom-endpoint line, keeping brand names stable', () => {
    const en = providerDisclosureList('en');
    const zh = providerDisclosureList('zh');
    // brand entries identical; the final (custom) entry differs by language
    expect(zh.slice(0, -1)).toEqual(en.slice(0, -1));
    expect(zh[zh.length - 1]).not.toBe(en[en.length - 1]);
  });
});

// Regression guard: the authored docs use GitHub-style in-doc
// anchors ([Share Images](#share-images)), so both emitters must emit a
// heading `id` — without one, every such link is DEAD (clicking it does nothing). This
// probes ALL doc-id × language pairs generically so it also catches a future
// doc that adds an internal link without a matching heading, not just
// privacy. Before headingSlug()/the emitter id wiring existed, this failed:
// zero headings carried an id, so every '#...' href had nothing to match.
function internalFragmentHrefs(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  return Array.from(doc.querySelectorAll('a[href^="#"]')).map((a) => (a.getAttribute('href') ?? '').slice(1));
}

function headingIds(html: string): Set<string> {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  const ids = new Set<string>();
  doc.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    const id = h.getAttribute('id');
    if (id) ids.add(id);
  });
  return ids;
}

describe('internal anchor links resolve to a real heading id (every doc x language)', () => {
  const ALL_IDS: DocId[] = [
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

  for (const id of ALL_IDS) {
    for (const lang of ['en', 'zh'] as const) {
      if (lang === 'zh' && DOCS[id].source.zh === null) continue;

      it(`${id}/${lang}: every #fragment href matches a rendered heading id`, () => {
        const html = renderHtml(parseLegalMarkdown(docBody(id, lang, LEGAL)));
        const hrefs = internalFragmentHrefs(html);
        const ids = headingIds(html);
        for (const href of hrefs) {
          expect(ids.has(href), `${id}/${lang}: #${href} has no matching heading id (dead anchor)`).toBe(true);
        }
      });
    }
  }
});

// Link-hygiene guard (link-hygiene sweep): every web link must be clickable
// and every email address must carry a mailto: link wherever it appears in a
// rendered doc. Scans the PLAIN-TEXT content of every doc x language for a
// bare `http(s)://` URL or a bare email address — i.e. one that survived
// OUTSIDE any `<a>` element, so it rendered as dead, unclickable text. A URL
// or email that is itself a link's visible label (e.g. the Bilibili
// "space.bilibili.com/…" links in contact.*.md, or an `{email}`/
// `{securityEmail}` token — both now substituted as `[addr](mailto:addr)`,
// see registry.ts `tokensFor`) is NOT bare: its whole subtree is excluded
// from the scan by skipping `<a>` nodes entirely (their label AND href).
describe('link hygiene: no bare URL or bare email outside a link (every doc x language)', () => {
  const BARE_URL_RE = /https?:\/\/[^\s<>]+/g;
  // A conservative bare-email matcher (local@domain.tld) — good enough to
  // catch a real address left unlinked without false-positiving on version
  // strings or file paths, which never contain '@'.
  const BARE_EMAIL_RE = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

  // Concatenates every text node's content EXCEPT text inside an <a> (an
  // anchor's own label is exempt — see the describe-level comment above).
  function nonLinkText(html: string): string {
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
    const parts: string[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === node.TEXT_NODE) {
        parts.push(node.textContent ?? '');
        return;
      }
      if (node.nodeType === node.ELEMENT_NODE && (node as Element).tagName === 'A') return;
      node.childNodes.forEach(walk);
    };
    doc.body.childNodes.forEach(walk);
    return parts.join('\n');
  }

  // Deliberate exceptions, both justified:
  //   - 'license': LICENSE is the Apache-2.0 text reproduced BYTE-EXACT
  //     (pinned by license-files.test.ts — 201 lines / 11,357 bytes). Its two
  //     `http://www.apache.org/licenses/...` occurrences are the verbatim
  //     official license text; altering them into markdown link syntax would
  //     break the byte-exact pin and is not a "doc we author" in the first
  //     place. A bare URL here is genuinely correct.
  //   - 'third-party': the npm-dependency audit table (one big markdown
  //     `<table>`, ~100 rows) is MACHINE-GENERATED from package-lock.json +
  //     each package's own package.json metadata by
  //     scripts/license-audit-core.mts (`npm run legal:licenses`), not
  //     hand-authored prose — linkifying its homepage/author-URL cells is out
  //     of this sweep's scope. The hand-authored Fonts section below that
  //     table (the part scripts/license-audit-core.mts hand-codes as
  //     `FONT_ENTRIES`) WAS linkified and is still scanned: only the
  //     `<table>` is excised here.
  function scannableText(id: DocId, lang: 'en' | 'zh'): string {
    const html = renderHtml(parseLegalMarkdown(docBody(id, lang, LEGAL)));
    if (id === 'license') return '';
    if (id === 'third-party') return nonLinkText(html.replace(/<div class="tbl">[\s\S]*?<\/div>/, ''));
    return nonLinkText(html);
  }

  for (const id of ALL_DOC_IDS) {
    for (const lang of ['en', 'zh'] as const) {
      if (lang === 'zh' && DOCS[id].source.zh === null) continue;

      it(`${id}/${lang}: no bare http(s) URL or bare email in rendered plain text`, () => {
        const text = scannableText(id, lang);
        const urls = text.match(BARE_URL_RE) ?? [];
        const emails = text.match(BARE_EMAIL_RE) ?? [];
        expect(urls, `${id}/${lang} has bare URL(s) rendered as dead text: ${urls.join(', ')}`).toEqual([]);
        expect(emails, `${id}/${lang} has bare email(s) rendered as dead text: ${emails.join(', ')}`).toEqual([]);
      });
    }
  }
});

// IP-elements sync guard. The contact.en.md document
// mirrors the Terms' "Intellectual-Property Complaints" section's four required
// elements (identify material, right you hold, contact info, good-faith belief).
// This test ensures both docs carry the same element tokens so a human edit
// cannot accidentally sync-break them (e.g. shortening one without the other).
describe('IP-elements sync guard: contact mirrors terms required elements', () => {
  const IP_ELEMENTS_EN = [
    'identify the material',
    'the right you hold',
    'your contact information',
    'good-faith',  // "statement of your good-faith / belief" spans line break in terms.en
  ];

  const IP_ELEMENTS_ZH = [
    '足以识别该素材',
    '你所持有的权利',
    '你的联系方式',
    '你善意相信',
  ];

  it('en: terms and contact both carry all four IP elements', () => {
    const termsBody = docBody('terms', 'en', LEGAL);
    const contactBody = docBody('contact', 'en', LEGAL);

    for (const token of IP_ELEMENTS_EN) {
      expect(termsBody, `terms.en missing IP element "${token}"`).toContain(token);
      expect(contactBody, `contact.en missing IP element "${token}"`).toContain(token);
    }
  });

  it('zh: terms and contact both carry all four IP elements', () => {
    const termsBody = docBody('terms', 'zh', LEGAL);
    const contactBody = docBody('contact', 'zh', LEGAL);

    for (const token of IP_ELEMENTS_ZH) {
      expect(termsBody, `terms.zh missing IP element "${token}"`).toContain(token);
      expect(contactBody, `contact.zh missing IP element "${token}"`).toContain(token);
    }
  });
});

import { providerName } from '../../i18n/providers';
import { describe, it, expect } from 'vitest';
import { DOCS, docBody, docNodes, localizeZhSlug, type DocId } from '../../legal/registry';
import type { Inline, MdNode } from '../../legal/markdown';
import { LEGAL } from '../../legal/config';
import { agentProviderDisclosureList, illustrationProviderDisclosureList } from '../../legal/providers-list';
import { PROVIDER_IDS, PROVIDER_META } from '../../agent/providers/defaults';
import { STYLIZE_PROVIDERS } from '../../io/stylize/providers';
import { en as enStrings } from '../../i18n/locales/en';
import { zh as zhStrings } from '../../i18n/locales/zh';
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

  it('links the QQ channel number to its page on pd.qq.com in both languages', () => {
    for (const lang of ['en', 'zh'] as const) {
      const body = docBody('contact', lang, LEGAL);
      expect(body).toContain(`[${LEGAL.qqFeedbackChannel}](https://pd.qq.com/g/${LEGAL.qqFeedbackChannel})`);
      expect(body).not.toContain('{qqFeedbackChannelUrl}');
    }
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

// Factual anchors for material privacy disclosures beyond the schema's required headings.
describe('privacy — required substance tokens', () => {
  const PRIVACY_TOKENS_EN = [
      "Maps are edited and saved in the current browser",
      "image includes a PetitGlyph ribbon",
      "Turning off Show notes does not remove annotations from the code",
      "After you submit or resume a task",
      "cannot establish these conditions from a key alone",
      "malicious extensions, a compromised device",
      "A minor may connect an AI service only if",
      "We will provide separate notice or obtain consent where required",
      "Depending on applicable law",
      "This does not clear downloaded files"
  ];

  const PRIVACY_TOKENS_ZH = [
      "地图在当前浏览器中编辑和保存",
      "图片会包含 PetitGlyph 色带",
      "关闭「显示标注」",
      "提交或恢复任务",
      "无法仅凭密钥",
      "恶意扩展",
      "未成年人连接 AI 服务时",
      "需要单独告知或取得同意",
      "适用法律",
      "此操作不清除已下载文件"
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
    for (const entry of agentProviderDisclosureList('en')) {
      expect(en, `privacy.en missing provider entry "${entry}"`).toContain(`- ${entry}`);
    }
    for (const entry of illustrationProviderDisclosureList('en')) {
      expect(en, `privacy.en missing illustration provider entry "${entry}"`).toContain(`- ${entry}`);
    }
    expect(en).toContain(`offers ${agentProviderDisclosureList('en').length} connection options`);
    expect(en).toContain(`offers ${illustrationProviderDisclosureList('en').length} connection options`);

    const zh = docBody('privacy', 'zh', LEGAL);
    expect(zh).toContain(`提供 ${agentProviderDisclosureList('zh').length} 种连接选项`);
    expect(zh).toContain(`提供 ${illustrationProviderDisclosureList('zh').length} 种连接选项`);
  });
});

// Deployment, mail, backend, and operator facts must remain explicit in the rendered policy.
describe('privacy — deployment-facts disclosure (§8)', () => {
  const DEPLOY_TOKENS_EN = [
      "Cloudflare",
      "Workers static asset hosting",
      "does not use Cloudflare's China Network",
      "Microsoft Outlook",
      "no separate application-log service that receives maps",
      "the tool's operator"
  ];
  const DEPLOY_TOKENS_ZH = [
      "Cloudflare",
      "Workers 静态资源托管",
      "未使用 Cloudflare 中国网络",
      "微软 Outlook",
      "应用日志",
      "本工具的运营方"
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

// Factual anchors for material terms beyond the schema's required headings.
describe('terms — required substance tokens', () => {
  const TERMS_TOKENS_EN = [
      "Scope and Definitions",
      "free",
      "browser",
      "API key you are entitled to use",
      "account, region, age and permitted-use requirements",
      "Content Rules and User Responsibility",
      "You retain the rights you lawfully hold in your original contributions",
      "recover its map and annotations",
      "discontinue",
      "backups",
      "available",
      "Where applicable law permits such a limitation",
      "consumer",
      "applicable law",
      "Updates to These Terms",
      "Mandatory applicable law prevails",
      "mandatory consumer protections",
      "parent or guardian",
      "unofficial",
      "miHoYo",
      "HoYoverse",
      "cannot lawfully be limited",
      "[IP]"
  ];

  const TERMS_TOKENS_ZH = [
      "适用范围",
      "免费",
      "浏览器",
      "有权使用的 API 密钥",
      "账户、地区、年龄和使用范围的要求",
      "内容规范与使用责任",
      "您对原创贡献依法享有的权利",
      "还原地图及规划标注",
      "停止提供",
      "备份",
      "实际可用",
      "在适用法律允许约定限制的范围内",
      "消费者",
      "适用法律",
      "条款更新",
      "以该规定为准",
      "其他不可排除的权利",
      "监护人的指导和同意",
      "非官方",
      "米哈游",
      "HoYoverse",
      "依法不得限制的责任",
      "[IP]"
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
          PROVIDER_META[id].name,
        );
      }
    }
  });
});

// The rendered About document retains its mission, technology, ownership, and filing facts.
describe('about — required substance tokens', () => {
  const ABOUT_TOKENS_EN = [
      "unofficial",
      "in your browser",
      "use the game itself as the final reference",
      "export a JSON save",
      "not affiliated with",
      "miHoYo",
      "HoYoverse",
      "applicable registration numbers it has obtained"
  ];

  const ABOUT_TOKENS_ZH = [
      "非官方",
      "浏览器",
      "搭建时请以游戏为准",
      "导出 JSON 存档",
      "无隶属关系",
      "米哈游",
      "HoYoverse",
      "已取得且适用于本站的备案信息"
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
    '哔哩哔哩',
    '14',
    '目标',
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

// The disclosure is derived from the provider registry so every reachable provider is represented.
describe('provider disclosure lists', () => {
  it('represents every provider id in src/agent/providers/defaults.ts', () => {
    const list = agentProviderDisclosureList('en');
    for (const id of PROVIDER_IDS) {
      if (id === 'custom') {
        expect(
          list.some((entry) => /custom endpoint/i.test(entry)),
          'custom endpoints must be disclosed',
        ).toBe(true);
      } else {
        expect(
          list.some((entry) => entry.includes(PROVIDER_META[id].name)),
          `provider "${id}" (${PROVIDER_META[id].name}) must be disclosed`,
        ).toBe(true);
      }
    }
  });

  it('has exactly one entry per selectable provider', () => {
    expect(agentProviderDisclosureList('en')).toHaveLength(PROVIDER_IDS.length);
  });

  it('uses the same localized provider names as the interface', () => {
    for (const lang of ['en', 'zh'] as const) {
      const strings = lang === 'zh' ? zhStrings : enStrings;
      const list = agentProviderDisclosureList(lang);
      const ids = PROVIDER_IDS.filter(id => id !== 'custom');
      expect(list.slice(0, -1)).toEqual(ids.map(id => providerName(id, key => strings[key] ?? key)));
    }
    expect(agentProviderDisclosureList('zh')).toContain('豆包');
    expect(agentProviderDisclosureList('zh')).toContain('月之暗面');
    expect(agentProviderDisclosureList('zh')).not.toContain('Doubao');
    expect(agentProviderDisclosureList('zh').slice(-1)[0]).not.toBe(agentProviderDisclosureList('en').slice(-1)[0]);
  });

  it('derives the illustration list from its provider registry and locale labels', () => {
    const en = illustrationProviderDisclosureList('en');
    const zh = illustrationProviderDisclosureList('zh');
    expect(en).toHaveLength(STYLIZE_PROVIDERS.length);
    expect(zh).toHaveLength(STYLIZE_PROVIDERS.length);
    for (const [index, provider] of STYLIZE_PROVIDERS.entries()) {
      if (provider.id === 'custom') {
        expect(en[index]).toMatch(/custom endpoint/i);
        expect(zh[index]).toContain('自定义端点');
      } else {
        expect(en[index]).toBe(enStrings[`stylize.provider_${provider.id}`]);
        expect(zh[index]).toBe(zhStrings[`stylize.provider_${provider.id}`]);
      }
    }
  });
});

// The authored docs use GitHub-style in-doc anchors ([Share Images](#share-images)), so both
// emitters must emit a heading `id` — without one, every such link is DEAD (clicking it does
// nothing). This probes ALL doc-id × language pairs generically, so it also catches a future doc
// that adds an internal link with no matching heading.
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

// Every web link must be clickable and every email address must carry a mailto: link wherever it
// appears in a rendered doc. Scans the PLAIN-TEXT content of every doc x language for a bare
// `http(s)://` URL or a bare email address — one that survives OUTSIDE any `<a>` element, and so
// renders as dead, unclickable text. A URL or email that is itself a link's visible label (the
// Bilibili "space.bilibili.com/…" links in contact.*.md, or an `{email}`/`{securityEmail}` token,
// substituted as `[addr](mailto:addr)` by registry.ts `tokensFor`) is NOT bare: its whole subtree
// is excluded by skipping `<a>` nodes entirely (their label AND href).
describe('link hygiene: no bare URL or bare email outside a link (every doc x language)', () => {
  const BARE_URL_RE = /https?:\/\/[^\s<>]+/g;
  // A conservative bare-email matcher (local@domain.tld) — good enough to
  // catch a real address left unlinked without false-positiving on version
  // strings or file paths, which never contain '@'.
  const BARE_EMAIL_RE = /[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

  // Concatenates every text node's content EXCEPT text inside an <a>.
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

  // Two exceptions, neither of them prose this project authors:
  //   - 'license': LICENSE is the Apache-2.0 text reproduced BYTE-EXACT
  //     (pinned by license-files.test.ts — 201 lines / 11,357 bytes), so its two
  //     `http://www.apache.org/licenses/...` occurrences are the official
  //     license text and markdown link syntax would break the byte-exact pin.
  //   - 'third-party': the npm-dependency audit table (one big markdown
  //     `<table>`, ~100 rows) is MACHINE-GENERATED from package-lock.json +
  //     each package's own package.json metadata by
  //     scripts/license-audit-core.mts (`npm run legal:licenses`), so only the
  //     `<table>` is excised. The hand-authored Fonts section below it (the
  //     part scripts/license-audit-core.mts hand-codes as `FONT_ENTRIES`) is
  //     linkified and still scanned.
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
      "location",
      "basis of your rights",
      "contact information",
      "truthful and accurate"
  ];

  const IP_ELEMENTS_ZH = [
      "位置",
      "权利依据",
      "联系方式",
      "真实、准确"
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

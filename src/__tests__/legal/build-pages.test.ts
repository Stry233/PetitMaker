import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:os is untyped here (no @types/node)
import { tmpdir } from 'node:os';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join } from 'node:path';
// @ts-ignore
declare const process: { cwd(): string; chdir(dir: string): void; env: Record<string, string | undefined> };

import type { LegalConfig } from '../../legal/config';
import { LEGAL } from '../../legal/config';
import { DEPLOY_TARGETS } from '../../legal/deploy-targets';
import { isIndexablePage } from '../../legal/site-paths';
import { DOCS } from '../../legal/registry';
import type { MdNode } from '../../legal/markdown';
import {
  ALL_DOC_IDS,
  computeExpires,
  metaDescription,
  pageHtml,
  pagePlan,
  securityTxt,
  sitemapXml,
  writeAll,
  resolveMode,
} from '../../../scripts/legal-pages-core.mts';

// `writeAll` genuinely drives the license copy (`licenses/`, 185 files), which these tests never
// used to reach — the synchronous recursive copy aborted the worker before it got there. The
// complete-tree check measures ~1.4s on an idle machine; the budget is stated rather than inherited
// because that copy is real file I/O competing with every other file in a parallel run, and 60s is
// the value this repository's other heavy suites already use.
vi.setConfig({ testTimeout: 60_000 });

// The static legal-page generator (crawlable zero-JS pages +
// sitemap/robots/security.txt).

// A fully release-ready fixture config — mirrors validate-config.test.ts's
// `resolvedConfig()` fixture so this suite exercises a config that passes
// validateLegalConfig cleanly, isolating the page-generation logic under test
// from the real LEGAL instance.
function fixtureCfg(overrides: Partial<LegalConfig> = {}): LegalConfig {
  return {
    canonicalOrigin: 'https://example.org',
    legacyOrigins: [],
    productName: 'PetitMaker',
    operatorDisplayName: 'PetitMaker Team / 谷地工坊团队',
    privacyContactEmail: 'legal@example.org',
    securityContactEmail: 'security@example.org',
    qqFeedbackGroup: '123456789',
    icpNumber: null,
    icpUrl: null,
    psbNumber: null,
    psbUrl: null,
    effectiveDates: { privacy: '2026-01-01', terms: '2026-01-01' },
    policyVersions: { privacy: '1.0', terms: '1.0' },
    team: [{ name: 'Jane Doe', sort: 'janedoe', url: 'https://example.com/jane' }],
    acknowledgements: [{ name: 'Sam Roe', sort: 'samroe', url: 'https://example.com/sam' }],
    repoUrl: 'https://github.com/example/petitmaker',
    sponsorship: { patreon: 'https://www.patreon.com/c/example', afdian: 'https://afdian.com/a/example' },
    ...overrides,
  };
}

describe('pageHtml', () => {
  const cfg = fixtureCfg();

  it('emits a full document: doctype, html lang, no <script>', () => {
    const html = pageHtml('privacy', 'en', cfg);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('<script');
  });

  it('emits the canonical URL from cfg.canonicalOrigin', () => {
    const html = pageHtml('privacy', 'en', cfg);
    expect(html).toContain('<link rel="canonical" href="https://example.org/privacy" />');
  });

  it('keeps utility documents readable without indexing them', () => {
    const html = pageHtml('privacy', 'en', cfg);
    expect(html).toContain('name="robots" content="noindex, follow"');
    expect(html).not.toContain('rel="alternate"');
  });

  it('zh page sets html lang to zh-CN and canonical to the /zh path', () => {
    const html = pageHtml('privacy', 'zh', cfg);
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('<link rel="canonical" href="https://example.org/zh/privacy" />');
  });

  it('escapes config values placed into the page (operatorDisplayName in the © line)', () => {
    const html = pageHtml('privacy', 'en', fixtureCfg({ operatorDisplayName: 'A & B <Co>' }));
    expect(html).toContain('A &amp; B &lt;Co&gt;');
    expect(html).not.toContain('A & B <Co>');
  });

  it('an en-only doc renders only English, regardless of requested lang', () => {
    const en = pageHtml('license', 'en', cfg);
    const zh = pageHtml('license', 'zh', cfg);
    expect(en).toContain('<html lang="en">');
    expect(zh).toContain('<html lang="en">'); // falls back — no zh source exists
    expect(zh).not.toContain('hreflang="zh"');
  });

  it('every doc/lang page contains zero <script> tags', () => {
    for (const id of ALL_DOC_IDS) {
      const html = pageHtml(id, 'en', cfg);
      expect(html, `${id}/en contains <script`).not.toContain('<script');
      if (DOCS[id].source.zh !== null) {
        const zhHtml = pageHtml(id, 'zh', cfg);
        expect(zhHtml, `${id}/zh contains <script`).not.toContain('<script');
      }
    }
  });

  it('the /security page renders the reporting policy, not the developer threat model', () => {
    // The technical annex lives in docs/THREAT_MODEL.md, a dev doc rather than a
    // rendered page, so the /security page carries only the public reporting policy.
    for (const lang of ['en', 'zh'] as const) {
      const html = pageHtml('security', lang, cfg);
      expect(html, `security/${lang} leaked the threat-model annex`).not.toContain('Tool sandbox invariant');
      expect(html, `security/${lang} leaked the threat-model annex`).not.toContain('Agent (LLM) threat model');
    }
    // and the reporting policy itself is present
    expect(pageHtml('security', 'en', cfg)).toContain('How we handle your report');
  });

  it('renders the footer disclaimer and a filing row when configured', () => {
    const withFiling = fixtureCfg({
      icpNumber: '京ICP备2026xxxxxx号-1',
      icpUrl: 'https://beian.miit.gov.cn/',
      psbNumber: '京公网安备 1101xxxxxxxxx号',
      psbUrl: 'https://example.gov.cn/psb',
    });
    const html = pageHtml('privacy', 'en', withFiling);
    expect(html).toContain('not affiliated with');
    expect(html).toContain('京ICP备2026xxxxxx号-1');
    expect(html).toContain('京公网安备 1101xxxxxxxxx号');

    const withoutFiling = pageHtml('privacy', 'en', cfg);
    expect(withoutFiling.match(/<footer[\s\S]*?<\/footer>/)?.[0]).not.toContain('filing');
  });

  it('shows effective date + policy version for privacy/terms, not for docs without that schema flag', () => {
    const privacy = pageHtml('privacy', 'en', cfg);
    expect(privacy).toContain('Effective 2026-01-01, version 1.0');

    const about = pageHtml('about', 'en', cfg);
    expect(about).not.toContain('class="updated"');
  });

  it('pairs the international English page with its Chinese counterpart', () => {
    const en = pageHtml('about', 'en', fixtureCfg({ canonicalOrigin: DEPLOY_TARGETS.global.canonicalOrigin }));
    const zh = pageHtml('about', 'zh', fixtureCfg({ canonicalOrigin: DEPLOY_TARGETS.cn.canonicalOrigin }));
    expect(en).toContain('hreflang="zh-CN" href="https://petitmaker.com.cn/zh/about/"');
    expect(zh).toContain('hreflang="en" href="https://petitmaker.cc/about"');
    expect(en.match(/<link rel="alternate"[^>]+>/g)).toEqual(zh.match(/<link rel="alternate"[^>]+>/g));
  });

});

describe('metaDescription', () => {
  it('takes the first paragraph, truncated to 155 chars', () => {
    const long = 'x'.repeat(200);
    const nodes: MdNode[] = [
      { t: 'h', level: 1, children: [{ t: 'text', text: 'Title' }] },
      { t: 'p', children: [{ t: 'text', text: long }] },
    ];
    const desc = metaDescription(nodes);
    expect(desc.length).toBeLessThanOrEqual(155);
    expect(desc.endsWith('…')).toBe(true);
  });

  it('escapes a raw & from an injected value in the page (the effective-date stamp)', () => {
    const html = pageHtml(
      'privacy',
      'en',
      fixtureCfg({ effectiveDates: { privacy: '2026 & Beyond', terms: '2026-01-01' } }),
    );
    // The effective-date stamp is emitted programmatically in the
    // `<p class="updated">` line (not authored into the doc body), so the
    // raw '&' must render escaped there and never unescaped anywhere.
    expect(html).toContain('2026 &amp; Beyond');
    expect(html).not.toMatch(/2026 & Beyond/);
  });

  it('returns the untruncated text when already short', () => {
    const nodes: MdNode[] = [{ t: 'p', children: [{ t: 'text', text: 'Short.' }] }];
    expect(metaDescription(nodes)).toBe('Short.');
  });
});

describe('sitemapXml', () => {
  for (const target of Object.values(DEPLOY_TARGETS)) {
    it(`lists only the ${target.id} homepage and primary-language product pages`, () => {
      const cfg = fixtureCfg({ canonicalOrigin: target.canonicalOrigin });
      const xml = sitemapXml(cfg);
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      const expected = [cfg.canonicalOrigin + '/', ...pagePlan(cfg)
        .filter((p) => isIndexablePage(p.slug, p.lang, cfg.canonicalOrigin))
        .map((p) => cfg.canonicalOrigin + p.path)];
      expect(locs.sort()).toEqual(expected.sort());
      expect(locs).toHaveLength(4);
      expect(xml).not.toContain('hreflang');
      expect(xml).not.toContain('<lastmod>');
    });
  }
});

describe('securityTxt', () => {
  it('carries all five required fields', () => {
    const cfg = fixtureCfg();
    const txt = securityTxt(cfg, '2027-07-15T00:00:00.000Z');
    expect(txt).toContain('Contact: mailto:security@example.org');
    expect(txt).toContain('Expires: 2027-07-15T00:00:00.000Z');
    expect(txt).toContain('Canonical: https://example.org/.well-known/security.txt');
    expect(txt).toContain('Policy: https://example.org/security');
    expect(txt).toContain('Preferred-Languages: en, zh-CN');
  });

  it('computeExpires is build date + exactly one year, UTC', () => {
    const now = new Date('2026-07-15T12:34:56.000Z');
    expect(computeExpires(now)).toBe('2027-07-15T12:34:56.000Z');
  });
});

describe('writeAll', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'legal-pages-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // `writeAll` is async because the license copy uses the asynchronous recursive copy (the
  // synchronous one aborts the process on Windows when the source path has non-ASCII characters).
  it('produces the expected file tree', async () => {
    const cfg = fixtureCfg();
    await writeAll(dir, cfg, 'dev', new Date('2026-07-15T00:00:00.000Z'));

    expect(existsSync(join(dir, 'privacy', 'index.html'))).toBe(true);
    expect(existsSync(join(dir, 'zh', 'privacy', 'index.html'))).toBe(true);
    expect(existsSync(join(dir, 'license', 'index.html'))).toBe(true);
    expect(existsSync(join(dir, 'zh', 'license', 'index.html'))).toBe(false); // en-only doc
    expect(existsSync(join(dir, 'sitemap.xml'))).toBe(true);
    expect(existsSync(join(dir, 'robots.txt'))).toBe(true);
    expect(existsSync(join(dir, '.well-known', 'security.txt'))).toBe(true);

    const security = readFileSync(join(dir, '.well-known', 'security.txt'), 'utf8');
    expect(security).toContain('Expires: 2027-07-15T00:00:00.000Z');

    const robots = readFileSync(join(dir, 'robots.txt'), 'utf8');
    expect(robots).toContain('Sitemap: https://example.org/sitemap.xml');
  });

  it('every emitted page file is present for every DocId per pagePlan', async () => {
    const cfg = fixtureCfg();
    await writeAll(dir, cfg, 'dev', new Date('2026-07-15T00:00:00.000Z'));
    for (const page of pagePlan()) {
      const file = join(dir, ...page.path.split('/').filter(Boolean), 'index.html');
      expect(existsSync(file), `${page.path}/index.html missing`).toBe(true);
    }
  });

  /** Every file under `root`, as slash-joined relative paths, sorted — what "the copy is complete"
   *  means, as opposed to "the destination exists". */
  function filesUnder(root: string, prefix = ''): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...filesUnder(join(root, entry.name), rel));
      else out.push(rel);
    }
    return out.sort();
  }

  it('copies licenses/ through, in full', async () => {
    const cfg = fixtureCfg();
    await writeAll(dir, cfg, 'dev', new Date('2026-07-15T00:00:00.000Z'));
    expect(existsSync(join(dir, 'licenses'))).toBe(true);
    // The same tree with the same bytes, not just a non-empty directory.
    const source = join(process.cwd(), 'licenses');
    const relative = filesUnder(source);
    expect(relative.length).toBeGreaterThan(0);
    expect(filesUnder(join(dir, 'licenses'))).toEqual(relative);
    for (const rel of relative) {
      expect(readFileSync(join(dir, 'licenses', rel)), rel).toEqual(readFileSync(join(source, rel)));
    }
  });

  it('copies licenses/ completely when the checkout path is not ASCII', async () => {
    // The synchronous recursive copy this used to run ABORTS the process (0xC0000409) on Windows
    // when the SOURCE path holds a non-ASCII character, so `npm run build` from a checkout under
    // e.g. `E:\项目\...` exited non-zero with an empty `dist/licenses` and no error message. The
    // copy below is driven from a non-ASCII working directory, which is the condition; the
    // assertions are about the complete result — same tree, same bytes — rather than that the call
    // returned. Windows + Node 24 in CI runs this, as does any local checkout under such a path.
    const root = mkdtempSync(join(tmpdir(), 'legal-pages-nonascii-'));
    const checkout = join(root, '项目', 'petit-星布谷地');
    const src = join(checkout, 'licenses');
    mkdirSync(join(src, 'nested'), { recursive: true });
    writeFileSync(join(src, 'MIT.txt'), 'MIT — 麻省理工');
    writeFileSync(join(src, 'nested', 'Apache-2.0.txt'), 'Apache-2.0');
    const cwd = process.cwd();
    try {
      process.chdir(checkout); // writeAll resolves the license source against the working directory
      await writeAll(dir, fixtureCfg(), 'dev', new Date('2026-07-15T00:00:00.000Z'));
    } finally {
      process.chdir(cwd); // restored before the temp tree goes, so nothing holds it open
      rmSync(root, { recursive: true, force: true });
    }
    expect(filesUnder(join(dir, 'licenses'))).toEqual(['MIT.txt', 'nested/Apache-2.0.txt']);
    expect(readFileSync(join(dir, 'licenses', 'MIT.txt'), 'utf8')).toBe('MIT — 麻省理工');
    expect(readFileSync(join(dir, 'licenses', 'nested', 'Apache-2.0.txt'), 'utf8')).toBe('Apache-2.0');
  });

  it('release mode throws when cfg is invalid (validateLegalConfig problems)', async () => {
    const invalid = fixtureCfg({ canonicalOrigin: '' });
    await expect(writeAll(dir, invalid, 'release')).rejects.toThrow();
  });

  it('release mode builds the real LEGAL config cleanly', async () => {
    await expect(writeAll(dir, LEGAL, 'release', new Date('2026-07-15T00:00:00.000Z'))).resolves.toBeUndefined();
  });

  it('dev mode does NOT throw against the real LEGAL config (warnings only)', async () => {
    await expect(writeAll(dir, LEGAL, 'dev', new Date('2026-07-15T00:00:00.000Z'))).resolves.toBeUndefined();
  });

  it('release mode builds a release-valid fixture cleanly, no token deferred', async () => {
    // No token is deferred: the deployment facts are authored directly into
    // privacy.*.md. A release-valid fixture therefore resolves every token,
    // so writeAll must NOT throw in release mode.
    const cfg = fixtureCfg();
    await expect(writeAll(dir, cfg, 'release')).resolves.toBeUndefined();
  });

  it('the retired {deployment-facts} token appears on no privacy page', () => {
    const cfg = fixtureCfg();
    expect(pageHtml('privacy', 'en', cfg)).not.toContain('{deployment-facts}');
    expect(pageHtml('privacy', 'zh', cfg)).not.toContain('{deployment-facts}');
  });
});

describe('resolveMode', () => {
  it('returns "release" when PETIT_RELEASE=1', () => {
    expect(resolveMode({ PETIT_RELEASE: '1' })).toBe('release');
  });

  it('returns "dev" when PETIT_RELEASE is missing or not "1"', () => {
    expect(resolveMode({})).toBe('dev');
    expect(resolveMode({ PETIT_RELEASE: '0' })).toBe('dev');
    expect(resolveMode({ PETIT_RELEASE: 'true' })).toBe('dev');
  });
});

describe('package.json build:release script', () => {
  it('contains PETIT_RELEASE=1 prefixing the vite-node scripts/build-legal-pages.mts command', () => {
    const pkgPath = join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const buildRelease = pkg.scripts['build:release'];

    expect(buildRelease).toContain('PETIT_RELEASE=1 vite-node scripts/build-legal-pages.mts');
    // Ensure the env var is NOT at the front of the entire chain where it would get lost to POSIX scoping
    expect(buildRelease).not.toContain('PETIT_RELEASE=1 npm run legal:validate');
  });
});

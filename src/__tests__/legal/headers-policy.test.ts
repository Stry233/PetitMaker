import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync } from 'node:fs';

import {
  CSP_META_MARKER,
  fullCspString,
  HEADERS_POLICY,
  headerEntries,
  parseExtraConnectSrc,
  toCspMeta,
  toEsaDoc,
  toNetlifyHeaders,
  toVercelJson,
  withExtraConnectSrc,
  type VercelJsonLike,
} from '../../../security/headers-policy';
import { rewriteIndexHtmlCsp, stringifyVercelJson } from '../../../scripts/generate-headers-core.mts';
import { LEGAL } from '../../legal/config';

// Canonical headers policy + platform adapters, with no external font hosts.
// SECURITY-RELEVANT: this file's job is to prove the policy reproduces the
// live protections exactly, with no Google Fonts hosts allowed.

const PROVIDER_ORIGINS = [
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://api.deepseek.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai',
  'https://open.bigmodel.cn',
  'https://api.z.ai',
  'https://dashscope-intl.aliyuncs.com',
  'https://dashscope.aliyuncs.com',
  'https://api.moonshot.cn',
  'https://api.moonshot.ai',
  'https://api.perplexity.ai',
];

describe('HEADERS_POLICY — shape', () => {
  it('carries every named-provider origin in connect-src, plus self and the custom-endpoint sources', () => {
    const connect = HEADERS_POLICY.cspDirectives['connect-src'];
    expect(connect).toBeDefined();
    expect(connect).toContain("'self'");
    for (const origin of PROVIDER_ORIGINS) {
      expect(connect).toContain(origin);
    }
    // the Custom BYO endpoint works on the deployed site: any https origin
    // plus loopback http for local gateways (see docs/THREAT_MODEL.md
    // "Custom (BYO-endpoint) provider")
    expect(connect).toContain('https:');
    expect(connect).toContain('http://localhost:*');
    expect(connect).toContain('http://127.0.0.1:*');
    // CSP's host grammar cannot express an IPv6 literal; sanitizeEndpointUrl writes such an
    // endpoint as localhost.
    expect((connect ?? []).join(' ')).not.toContain('[::1]');
    // 'self' + the named providers + the three custom-endpoint sources, and nothing else: a new
    // origin has to be a deliberate edit here, not an accident of the policy file.
    expect(connect).toHaveLength(1 + PROVIDER_ORIGINS.length + 3);
  });

  it('names every host the provider adapters actually call', async () => {
    // These origins are documentation: connect-src's broad `https:` is what actually admits them.
    // The list is worth reading only while it equals what the adapters call, which this holds.
    const { PROVIDER_IDS, providerBaseUrls } = await import('../../agent/providers/defaults');
    for (const id of PROVIDER_IDS) {
      for (const url of providerBaseUrls(id)) {
        expect(PROVIDER_ORIGINS, `${id} calls ${url}`).toContain(new URL(url).origin);
      }
    }
  });

  it('names no operator-specific / campus gateway in the canonical policy', () => {
    const asText = JSON.stringify(HEADERS_POLICY);
    expect(asText).not.toMatch(/purdue|rcac/i);
  });

  it('lists frame-ancestors and Strict-Transport-Security as header-only', () => {
    expect(HEADERS_POLICY.headerOnlyDirectives).toContain('frame-ancestors');
    expect(HEADERS_POLICY.headerOnlyDirectives).toContain('Strict-Transport-Security');
  });

  it('carries no Google Fonts hosts anywhere in the policy', () => {
    const asText = JSON.stringify(HEADERS_POLICY);
    expect(asText).not.toMatch(/googleapis\.com\/css|fonts\.googleapis|fonts\.gstatic/);
  });

  it('style-src has no Google host (only self + unsafe-inline)', () => {
    expect(HEADERS_POLICY.cspDirectives['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it('font-src has no Google host (self only)', () => {
    expect(HEADERS_POLICY.cspDirectives['font-src']).toEqual(["'self'"]);
  });
});

describe('dev-only connect-src extension (VITE_EXTRA_CONNECT_SRC) — never in the canonical policy', () => {
  it('parses space- and comma-separated origins, ignoring blanks', () => {
    expect(parseExtraConnectSrc(undefined)).toEqual([]);
    expect(parseExtraConnectSrc('   ')).toEqual([]);
    expect(parseExtraConnectSrc('https://a.example.edu https://b.example.edu')).toEqual([
      'https://a.example.edu',
      'https://b.example.edu',
    ]);
    expect(parseExtraConnectSrc('https://a.example.edu, https://b.example.edu')).toEqual([
      'https://a.example.edu',
      'https://b.example.edu',
    ]);
  });

  it('withExtraConnectSrc appends only to connect-src, and is a no-op when empty', () => {
    expect(withExtraConnectSrc(HEADERS_POLICY, [])).toBe(HEADERS_POLICY);
    const extended = withExtraConnectSrc(HEADERS_POLICY, ['https://x.example.edu']);
    expect(extended.cspDirectives['connect-src']).toContain('https://x.example.edu');
    // canonical policy is not mutated
    expect(HEADERS_POLICY.cspDirectives['connect-src']).not.toContain('https://x.example.edu');
    // other directives untouched
    expect(extended.cspDirectives['script-src']).toEqual(HEADERS_POLICY.cspDirectives['script-src']);
  });
});

describe('toCspMeta() — meta-expressible subset only', () => {
  it('lacks frame-ancestors', () => {
    expect(toCspMeta()).not.toContain('frame-ancestors');
  });

  it('lacks Strict-Transport-Security (never a CSP directive to begin with)', () => {
    expect(toCspMeta()).not.toContain('Strict-Transport-Security');
  });

  it('includes connect-src with every named-provider origin', () => {
    const meta = toCspMeta();
    expect(meta).toContain('connect-src');
    for (const origin of PROVIDER_ORIGINS) {
      expect(meta).toContain(origin);
    }
  });

  it('throws when forced to include a header-only directive', () => {
    expect(() => toCspMeta(HEADERS_POLICY, { forceInclude: ['frame-ancestors'] })).toThrow(/header-only/);
    expect(() => toCspMeta(HEADERS_POLICY, { forceInclude: ['Strict-Transport-Security'] })).toThrow(/header-only/);
  });

  it('carries every other directive present in the full policy', () => {
    const meta = toCspMeta();
    for (const name of [
      'default-src',
      'base-uri',
      'object-src',
      'script-src',
      'style-src',
      'font-src',
      'img-src',
      'media-src',
      'form-action',
    ]) {
      expect(meta).toContain(name);
    }
  });
});

describe('fullCspString() / headerEntries() — the header-adapter view', () => {
  it('includes frame-ancestors (unlike the meta subset)', () => {
    expect(fullCspString()).toContain("frame-ancestors 'none'");
  });

  it('headerEntries lists CSP first, then every static header', () => {
    const entries = headerEntries();
    expect(entries[0]?.[0]).toBe('Content-Security-Policy');
    const keys = entries.map(([k]) => k);
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Strict-Transport-Security');
  });
});

describe('toNetlifyHeaders()', () => {
  const out = toNetlifyHeaders();

  it('includes X-Content-Type-Options: nosniff', () => {
    expect(out).toContain('X-Content-Type-Options: nosniff');
  });

  it('includes HSTS', () => {
    expect(out).toContain('Strict-Transport-Security: max-age=31536000; includeSubDomains');
  });

  it('includes the full CSP with frame-ancestors', () => {
    expect(out).toContain("frame-ancestors 'none'");
  });

  it('has no Google Fonts host', () => {
    expect(out).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });

  it('preserves the asset/index caching rules', () => {
    expect(out).toContain('/assets/*');
    expect(out).toContain('Cache-Control: public, max-age=31536000, immutable');
    expect(out).toContain('/index.html');
    expect(out).toContain('Cache-Control: public, max-age=0, must-revalidate');
  });
});

describe('toVercelJson(existing)', () => {
  const existing: VercelJsonLike = {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    '//': 'some comment',
    headers: [
      { source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: 'stale' }] },
      { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ],
  };

  it('replaces only the security-header rule, keeping other keys/rules intact', () => {
    const next = toVercelJson(existing);
    expect(next.$schema).toBe(existing.$schema);
    expect(next['//']).toBe(existing['//']);
    const assetRule = next.headers?.find((r) => r.source === '/assets/(.*)');
    expect(assetRule).toEqual(existing.headers![1]);
  });

  it('the regenerated security rule has no Google host and includes HSTS + frame-ancestors', () => {
    const next = toVercelJson(existing);
    const secRule = next.headers?.find((r) => r.source === '/(.*)');
    expect(secRule).toBeDefined();
    const csp = secRule!.headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(csp).toContain('frame-ancestors');
    const hsts = secRule!.headers.find((h) => h.key === 'Strict-Transport-Security');
    expect(hsts?.value).toBe('max-age=31536000; includeSubDomains');
  });

  it('produces valid JSON via stringifyVercelJson', () => {
    const text = stringifyVercelJson(toVercelJson(existing));
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe('toEsaDoc()', () => {
  const doc = toEsaDoc();

  it('documents every header name/value as a table row', () => {
    for (const [key, value] of headerEntries()) {
      expect(doc).toContain(`| \`${key}\` |`);
      expect(doc).toContain(value.replace(/\|/g, '\\|'));
    }
  });

  it('has a verify-live-post-deploy section', () => {
    expect(doc).toMatch(/Verify live post-deploy/i);
  });

  it('has no Google Fonts host', () => {
    expect(doc).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});

describe('rewriteIndexHtmlCsp()', () => {
  it('replaces the comment + meta pair and stamps the marker', () => {
    const src = [
      '<head>',
      '    <!--',
      '      old comment',
      '    -->',
      '    <meta http-equiv="Content-Security-Policy" content="default-src \'self\'" />',
      '</head>',
    ].join('\n');
    const out = rewriteIndexHtmlCsp(src, HEADERS_POLICY);
    expect(out).toContain(CSP_META_MARKER);
    expect(out).not.toContain('old comment');
    expect(out).toContain(toCspMeta(HEADERS_POLICY));
  });

  it('throws if the CSP meta/comment pair cannot be found', () => {
    expect(() => rewriteIndexHtmlCsp('<head></head>', HEADERS_POLICY)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Standing drift guard (integration): the committed public/_headers,
// vercel.json, docs/internal/deployment/esa-headers.md, and index.html's CSP <meta>
// must all match what the policy generates RIGHT NOW — this is what
// `npm run legal:headers:check` also verifies, but as a plain vitest assertion
// it runs on every `npm run test:run` with no CLI step required.
// ---------------------------------------------------------------------------

describe('generated files — standing drift guard', () => {
  it('public/_headers matches toNetlifyHeaders()', () => {
    expect(readFileSync('public/_headers', 'utf8')).toBe(toNetlifyHeaders());
  });

  it('vercel.json matches toVercelJson(existing)', () => {
    const existing: VercelJsonLike = JSON.parse(readFileSync('vercel.json', 'utf8'));
    const regenerated = stringifyVercelJson(toVercelJson(existing));
    expect(readFileSync('vercel.json', 'utf8')).toBe(regenerated);
  });

  // internal-repo-only check: docs/internal/deployment/esa-headers.md never ships publicly (see
  // docs/internal/deployment/public-repo-manifest.md), so this self-skips on a public-repo export
  // instead of failing on ENOENT — same convention as ops-docs.test.ts.
  if (existsSync('docs/internal/deployment/esa-headers.md')) {
    it('docs/internal/deployment/esa-headers.md matches toEsaDoc()', () => {
      // Same domain data the generator passes (scripts/generate-headers.mts): the
      // runbook's legacy-domain 301 table comes from LEGAL, so a domain change has
      // to be regenerated like any other policy change.
      expect(readFileSync('docs/internal/deployment/esa-headers.md', 'utf8')).toBe(toEsaDoc(
        HEADERS_POLICY, { canonicalOrigin: LEGAL.canonicalOrigin, legacyOrigins: LEGAL.legacyOrigins },
      ));
    });

    it('lists a 301 for every legacy domain, and none once there are none', () => {
      const doc = toEsaDoc(HEADERS_POLICY, {
        canonicalOrigin: 'https://new.example', legacyOrigins: ['https://old.example'],
      });
      expect(doc).toContain('## Legacy domain redirects');
      expect(doc).toContain('| `https://old.example/*` | `301 https://new.example/$1` |');
      expect(toEsaDoc(HEADERS_POLICY, { canonicalOrigin: 'https://new.example', legacyOrigins: [] }))
        .not.toContain('## Legacy domain redirects');
      // A stale entry equal to the canonical origin would render a redirect loop.
      expect(toEsaDoc(HEADERS_POLICY, {
        canonicalOrigin: 'https://new.example', legacyOrigins: ['https://new.example'],
      })).not.toContain('## Legacy domain redirects');
    });
  } else {
    it.skip('internal-repo-only: docs/internal/deployment/esa-headers.md not present (public-repo export)', () => {});
  }

  it("index.html's CSP <meta> matches rewriteIndexHtmlCsp() applied to itself (idempotent)", () => {
    const html = readFileSync('index.html', 'utf8');
    expect(rewriteIndexHtmlCsp(html, HEADERS_POLICY)).toBe(html);
  });

  it('index.html contains the marker comment', () => {
    expect(readFileSync('index.html', 'utf8')).toContain(CSP_META_MARKER);
  });

  it('index.html has no Google Fonts link/preconnect/host anywhere', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
  });
});

describe('fonts.css — PW Rounded Sans self-hosted (renamed Quicksand, OFL-1.1 clause 3)', () => {
  const css = readFileSync('src/assets/fonts/fonts.css', 'utf8');

  it('declares a PW Rounded Sans @font-face with a local url(), and no Quicksand family remains', () => {
    expect(css).toMatch(/@font-face\s*{\s*[^}]*font-family:\s*'PW Rounded Sans'/);
    const blocks = css.split('@font-face').filter((b: string) => /font-family:\s*'PW Rounded Sans'/.test(b));
    expect(blocks.length).toBeGreaterThanOrEqual(2); // 500 + 700
    for (const block of blocks) {
      expect(block).toMatch(/url\('\.\/Quicksand-(Medium|Bold)\.woff2'\)/);
    }
    expect(css).not.toMatch(/font-family:\s*'Quicksand'/);
  });

  it('declares both weight 500 and weight 700', () => {
    expect(css).toMatch(/font-family:\s*'PW Rounded Sans';\s*font-weight:\s*500/);
    expect(css).toMatch(/font-family:\s*'PW Rounded Sans';\s*font-weight:\s*700/);
  });

  it('has no remote (Google) font source', () => {
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\//);
  });
});

describe('Quicksand woff2 name tables — renamed per OFL-1.1 clause 3 (Reserved Font Name)', () => {
  // The shipped Quicksand-*.woff2 files are Modified Versions (variable→static instancing).
  // OFL-1.1 clause 3 forbids a Modified Version from using the Reserved Font Name "Quicksand"
  // in its name table without written permission, so the family/full/PostScript name records
  // were rewritten to "PW Rounded Sans". A byte-level check is unreliable (woff2/brotli-compressed,
  // and name-table strings are UTF-16BE for the Windows platform records) — this is a structural
  // assertion on fonts.css (the only thing browsers/CSS actually consult for `url()`-sourced
  // fonts) rather than a raw-byte scan of the binary. The name-table rewrite itself was verified
  // via `fontTools.ttLib.TTFont(...)['name']`.
  const css = readFileSync('src/assets/fonts/fonts.css', 'utf8');

  it('fonts.css comment documents the OFL-1.1 clause 3 rename', () => {
    expect(css).toMatch(/OFL-1\.1 clause 3/);
    expect(css).toMatch(/Reserved Font Name "Quicksand"/);
  });
});

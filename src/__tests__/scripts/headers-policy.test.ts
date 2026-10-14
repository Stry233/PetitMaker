import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

import {
  CSP_META_MARKER,
  fullCspString,
  HEADERS_POLICY,
  headerEntries,
  NETWORK_SOURCES,
  parseExtraConnectSrc,
  toCspMeta,
  withExtraConnectSrc,
  withExtraFontSrc,
} from '../../../security/headers-policy';
import {
  headerOutputs,
  rewriteIndexHtmlCsp,
  toEsaDoc,
  toHeadersFile,
} from '../../../scripts/generate-headers-core.mts';
import { MODEL_CATALOG_URL, PROVIDER_IDS, providerBaseUrls } from '../../agent/providers/defaults';
import { STYLIZE_PROVIDERS } from '../../pipelines/stylize/providers';

// Canonical headers policy + platform adapters, with no external font hosts.
// Security-relevant: this file's job is to prove the policy reproduces the
// live protections exactly, with no Google Fonts hosts allowed.

describe('HEADERS_POLICY — shape', () => {
  it('lets connect-src reach data: URLs, which the embedded OCR core fetches its own WebAssembly from', () => {
    expect(HEADERS_POLICY.cspDirectives['connect-src']).toContain('data:');
  });

  it('carries self, data: and the network sources in connect-src', () => {
    const connect = HEADERS_POLICY.cspDirectives['connect-src'];
    expect(connect).toBeDefined();
    expect(connect).toContain("'self'");
    // the Custom BYO endpoint works on the deployed site: any https origin
    // plus loopback http for local gateways (see docs/THREAT_MODEL.md
    // "Custom (BYO-endpoint) provider")
    expect(connect).toContain('https:');
    expect(connect).toContain('http://localhost:*');
    expect(connect).toContain('http://127.0.0.1:*');
    // CSP's host grammar cannot express an IPv6 literal; sanitizeEndpointUrl writes such an
    // endpoint as localhost.
    expect((connect ?? []).join(' ')).not.toContain('[::1]');
    // 'self' + data: + the three network sources, and nothing else: a new source has to be a
    // deliberate edit here, not an accident of the policy file.
    expect(connect).toEqual(["'self'", 'data:', ...NETWORK_SOURCES]);
    expect(NETWORK_SOURCES).toHaveLength(3);
  });

  it('reaches every host the provider adapters call through the https: source', () => {
    const urls = [
      ...PROVIDER_IDS.flatMap((id) => providerBaseUrls(id)),
      MODEL_CATALOG_URL,
      ...STYLIZE_PROVIDERS.filter((provider) => !provider.needsBaseUrl).map((provider) => provider.baseUrl),
    ];
    for (const url of urls) expect(new URL(url).protocol, url).toBe('https:');
  });

  it('names no operator-specific / campus gateway in the canonical policy', () => {
    const asText = JSON.stringify(HEADERS_POLICY);
    expect(asText).not.toMatch(/purdue|rcac/i);
  });

  it('lists frame-ancestors as the header-only directive', () => {
    expect(HEADERS_POLICY.headerOnlyDirectives).toEqual(['frame-ancestors']);
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
    expect(HEADERS_POLICY.cspDirectives['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
  });
});

describe('dev-only font-src extension (VITE_EXTRA_FONT_SRC) — never in the canonical policy', () => {
  it('appends only to font-src, and is a no-op when empty', () => {
    expect(withExtraFontSrc(HEADERS_POLICY, [])).toBe(HEADERS_POLICY);
    const extended = withExtraFontSrc(HEADERS_POLICY, ['https://fonts.example.edu']);
    expect(extended.cspDirectives['font-src']).toEqual(["'self'", 'https://fonts.example.edu']);
    expect(HEADERS_POLICY.cspDirectives['font-src']).toEqual(["'self'"]);
    expect(extended.cspDirectives['connect-src']).toEqual(HEADERS_POLICY.cspDirectives['connect-src']);
  });
});

describe('toCspMeta() — meta-expressible subset only', () => {
  it('lacks frame-ancestors', () => {
    expect(toCspMeta()).not.toContain('frame-ancestors');
  });

  it('lacks Strict-Transport-Security (never a CSP directive to begin with)', () => {
    expect(toCspMeta()).not.toContain('Strict-Transport-Security');
  });

  it('includes connect-src with the network sources', () => {
    const meta = toCspMeta();
    expect(meta).toContain(`connect-src 'self' data: ${NETWORK_SOURCES.join(' ')}`);
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

  it('emits every directive in declaration order, including one added later', () => {
    const policy = { ...HEADERS_POLICY, cspDirectives: { ...HEADERS_POLICY.cspDirectives, 'worker-src': ["'self'"] } };
    const names = fullCspString(policy).split('; ').map((part) => part.split(' ')[0]);
    expect(names).toEqual(Object.keys(policy.cspDirectives));
    const meta = toCspMeta(policy).split('; ').map((part) => part.split(' ')[0]);
    expect(meta).toEqual(Object.keys(policy.cspDirectives).filter((name) => !policy.headerOnlyDirectives.includes(name)));
  });

  it('headerEntries lists CSP first, then every static header', () => {
    const entries = headerEntries();
    expect(entries[0]?.[0]).toBe('Content-Security-Policy');
    const keys = entries.map(([k]) => k);
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Strict-Transport-Security');
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

describe('toHeadersFile()', () => {
  const out = toHeadersFile();

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

  it('writes every cache rule as a path line followed by its Cache-Control', () => {
    for (const rule of HEADERS_POLICY.cacheRules) {
      expect(out).toContain(`${rule.path}\n  Cache-Control: ${rule.cacheControl}\n`);
    }
  });
});

describe('cache rules', () => {
  it('give every directory the site serves from public/ an explicit Cache-Control', () => {
    const dirs = readdirSync('public', { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    expect(dirs.length).toBeGreaterThan(0);
    const paths = HEADERS_POLICY.cacheRules.map((rule) => rule.path);
    for (const dir of dirs) expect(paths).toContain(`/${dir}/*`);
  });

  it('keep the long immutable cache for content-hashed paths only: the bundle and the map check folder', () => {
    const immutable = HEADERS_POLICY.cacheRules.filter((rule) => rule.cacheControl.includes('immutable'));
    expect(immutable.map((rule) => rule.path)).toEqual(['/assets/*', '/moderation/*']);
  });

  it('reach the ESA rule set, whose host sends no Cache-Control of its own', () => {
    const doc = toEsaDoc();
    for (const rule of HEADERS_POLICY.cacheRules) expect(doc).toContain(`| \`${rule.path}\` | \`${rule.cacheControl}\` |`);
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

// Every committed header surface must match the canonical policy generator.

describe('generated files — standing drift guard', () => {
  it('public/_headers matches toHeadersFile()', () => {
    expect(readFileSync('public/_headers', 'utf8')).toBe(toHeadersFile());
  });

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
  // fonts) rather than a raw-byte scan of the binary. The name tables themselves are checkable
  // with `fontTools.ttLib.TTFont(...)['name']`.
  const css = readFileSync('src/assets/fonts/fonts.css', 'utf8');

  it('fonts.css comment documents the OFL-1.1 clause 3 rename', () => {
    expect(css).toMatch(/OFL-1\.1 clause 3/);
    expect(css).toMatch(/Reserved Font Name "Quicksand"/);
  });
});

describe('headerOutputs', () => {
  const indexHtml = readFileSync('index.html', 'utf8');

  it('renders the host file, the operator copy and the index CSP in the private tree', () => {
    const outputs = headerOutputs(HEADERS_POLICY, { internalDocs: true, indexHtml });
    expect(outputs.map((o) => o.path)).toEqual(['public/_headers', 'docs/internal/deployment/esa-headers.md', 'index.html']);
    expect(outputs[1]!.content).toBe(toEsaDoc(HEADERS_POLICY));
  });

  it('leaves the operator copy out where docs/internal is absent, as in the public repository', () => {
    const outputs = headerOutputs(HEADERS_POLICY, { internalDocs: false, indexHtml });
    expect(outputs.map((o) => o.path)).toEqual(['public/_headers', 'index.html']);
    expect(outputs[0]!.content).toBe(toHeadersFile(HEADERS_POLICY));
    expect(outputs[1]!.content).toBe(rewriteIndexHtmlCsp(indexHtml, HEADERS_POLICY));
  });
});

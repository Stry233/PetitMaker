/**
 * Canonical response-header and CSP policy for static hosts, the ESA rule set, and `index.html`.
 * Provider origins are derived from their registries; custom endpoints use the scheme sources below.
 * Run `npx vite-node scripts/generate-headers.mts` after changing this policy or either provider registry.
 */

import { PROVIDER_IDS, providerNetworkUrls } from '../src/agent/providers/defaults.ts';
import { STYLIZE_PROVIDERS } from '../src/io/stylize/providers.ts';

/** Named provider origins, derived from both provider registries. Custom endpoints are admitted by
 *  the scheme and loopback sources below. */
export const PROVIDER_ORIGINS: readonly string[] = Array.from(new Set([
  ...PROVIDER_IDS.flatMap((id) => providerNetworkUrls(id)),
  ...STYLIZE_PROVIDERS.filter((provider) => !provider.needsBaseUrl).map((provider) => provider.baseUrl),
].map((url) => new URL(url).origin)));

/** HTTPS custom endpoints and HTTP loopback gateways. */
const CUSTOM_ENDPOINT_SOURCES: readonly string[] = [
  'https:',
  'http://localhost:*',
  'http://127.0.0.1:*',
  // CSP host sources cannot express an IPv6 literal; endpoint normalization maps ::1 to localhost.
];

export interface HeadersPolicy {
  /** Ordered CSP sources, including response-header-only directives. */
  cspDirectives: Record<string, string[]>;
  /** Names that cannot be enforced by a CSP meta tag. */
  headerOnlyDirectives: readonly string[];
  /** Non-CSP response headers. */
  staticHeaders: Record<string, string>;
}

export const HEADERS_POLICY: HeadersPolicy = {
  cspDirectives: {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    // Local illustration and map checks require WebAssembly compilation, not JavaScript eval.
    'script-src': ["'self'", "'wasm-unsafe-eval'"],
    // React uses inline styles; fonts are self-hosted.
    'style-src': ["'self'", "'unsafe-inline'"],
    'font-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'none'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'connect-src': ["'self'", ...PROVIDER_ORIGINS, ...CUSTOM_ENDPOINT_SOURCES],
  },
  headerOnlyDirectives: ['frame-ancestors', 'Strict-Transport-Security'],
  staticHeaders: {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  },
};

/** Stable directive order for generated output. */
const CSP_ORDER = [
  'default-src',
  'base-uri',
  'object-src',
  'script-src',
  'style-src',
  'font-src',
  'img-src',
  'media-src',
  'form-action',
  'frame-ancestors',
  'connect-src',
] as const;

function buildCspString(policy: HeadersPolicy, opts: { includeHeaderOnly: boolean }): string {
  const names = CSP_ORDER.filter((name) => {
    if (!(name in policy.cspDirectives)) return false;
    if (!opts.includeHeaderOnly && policy.headerOnlyDirectives.includes(name)) return false;
    return true;
  });
  return names.map((name) => `${name} ${policy.cspDirectives[name]!.join(' ')}`).join('; ');
}

/** Full response-header CSP, including header-only directives. */
export function fullCspString(policy: HeadersPolicy = HEADERS_POLICY): string {
  return buildCspString(policy, { includeHeaderOnly: true });
}

/** Marker immediately above the generated CSP meta tag. */
export const CSP_META_MARKER =
  '<!-- CSP fallback subset — production headers are authoritative (see security/headers-policy.ts) -->';

/** CSP subset enforceable by a meta tag. Rejects attempts to include header-only names. */
export function toCspMeta(
  policy: HeadersPolicy = HEADERS_POLICY,
  opts?: { forceInclude?: readonly string[] }
): string {
  for (const name of opts?.forceInclude ?? []) {
    if (policy.headerOnlyDirectives.includes(name)) {
      throw new Error(
        `toCspMeta: "${name}" is a header-only directive and cannot be expressed by a CSP meta tag; ` +
          'production response headers (security/headers-policy.ts adapters) ' +
          'remain authoritative.'
      );
    }
  }
  return buildCspString(policy, { includeHeaderOnly: false });
}

// ---------------------------------------------------------------------------
// Static legal pages
// ---------------------------------------------------------------------------

/** CSP directives for the static legal pages, which run no script and make no network request. */
export const DOCUMENT_CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'none'"],
  'img-src': ["'self'"],
  'style-src': ["'unsafe-inline'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

/** The `content` value of the static legal pages' CSP meta tag. */
export function toDocumentCspMeta(
  directives: Readonly<Record<string, readonly string[]>> = DOCUMENT_CSP_DIRECTIVES
): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

/** Ordered response-header entries, with CSP first. */
export function headerEntries(policy: HeadersPolicy = HEADERS_POLICY): Array<[string, string]> {
  return [['Content-Security-Policy', fullCspString(policy)], ...Object.entries(policy.staticHeaders)];
}

// ---------------------------------------------------------------------------
// Dev-only connect-src / font-src extensions (NEVER shipped)
// ---------------------------------------------------------------------------

/** Parse space- or comma-separated development-only origins. */
export function parseExtraConnectSrc(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Clone a policy with development-only origins appended to one directive. */
export function withExtraSources(
  policy: HeadersPolicy,
  directive: 'connect-src' | 'font-src',
  extraOrigins: readonly string[]
): HeadersPolicy {
  if (extraOrigins.length === 0) return policy;
  return {
    ...policy,
    cspDirectives: {
      ...policy.cspDirectives,
      [directive]: [...(policy.cspDirectives[directive] ?? []), ...extraOrigins],
    },
  };
}

/** Development-server `connect-src` extension. */
export function withExtraConnectSrc(
  policy: HeadersPolicy = HEADERS_POLICY,
  extraOrigins: readonly string[] = []
): HeadersPolicy {
  return withExtraSources(policy, 'connect-src', extraOrigins);
}

/** Development-server `font-src` extension for injected browser tooling. */
export function withExtraFontSrc(
  policy: HeadersPolicy = HEADERS_POLICY,
  extraOrigins: readonly string[] = []
): HeadersPolicy {
  return withExtraSources(policy, 'font-src', extraOrigins);
}

// ---------------------------------------------------------------------------
// Netlify adapter
// ---------------------------------------------------------------------------

/**
 * Renders the full `public/_headers` file (Netlify-compatible; Vite copies
 * `public/` to the build root, so this lands at `dist/_headers`). Includes the
 * caching rules for `/assets/*` and `/index.html`: not security policy proper,
 * but that file carries them too.
 */
export function toNetlifyHeaders(policy: HeadersPolicy = HEADERS_POLICY): string {
  const lines = [
    '# Security + cache headers for Netlify-style static hosts. Vite copies public/ to the build root,',
    '# so this lands at dist/_headers. GENERATED — do not hand-edit; run',
    '# `npx vite-node scripts/generate-headers.mts` after changing security/headers-policy.ts.',
    '# (Vercel uses vercel.json; the CSP <meta> in index.html is the portable fallback. Production',
    '# deploys to Alibaba OSS/ESA, where neither file applies — those headers are set as ESA rules',
    '# generated from this same policy.)',
    '/*',
    ...headerEntries(policy).map(([key, value]) => `  ${key}: ${value}`),
    '',
    '# Fingerprinted assets are immutable; HTML must always re-validate so new builds ship.',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/index.html',
    '  Cache-Control: public, max-age=0, must-revalidate',
  ];
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Vercel adapter
// ---------------------------------------------------------------------------

export interface VercelHeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

export interface VercelJsonLike {
  $schema?: string;
  headers?: VercelHeaderRule[];
  [key: string]: unknown;
}

/**
 * Merges the canonical policy into an existing (parsed) `vercel.json` object,
 * replacing only the security-header rule for `source: "/(.*)"` and leaving
 * every other rule (e.g. the `/assets/(.*)` cache-control rule) and top-level
 * key (`$schema`, the `"//"` comment) exactly as `existing` provided them.
 * Pure — the caller owns reading/parsing/writing the file.
 */
export function toVercelJson(existing: VercelJsonLike, policy: HeadersPolicy = HEADERS_POLICY): VercelJsonLike {
  const securityHeaders = headerEntries(policy).map(([key, value]) => ({ key, value }));
  const existingRules = existing.headers ?? [];
  let replaced = false;
  const headers = existingRules.map((rule) => {
    if (rule.source === '/(.*)') {
      replaced = true;
      return { ...rule, headers: securityHeaders };
    }
    return rule;
  });
  if (!replaced) {
    headers.unshift({ source: '/(.*)', headers: securityHeaders });
  }
  return { ...existing, headers };
}

// ---------------------------------------------------------------------------
// Alibaba ESA adapter (documented rule set — no repo config file on that host)
// ---------------------------------------------------------------------------

/**
 * Renders the ESA rule-set document: the exact header names/values a maintainer
 * applies in the Alibaba ESA console/API (edge rule / response header actions),
 * since ESA has no in-repo config format the way Netlify/Vercel do. Includes a
 * "verify live post-deploy" reminder, because what gates a launch is a checked
 * response header on the deployed site, not the existence of this document.
 */
export function toEsaDoc(
  policy: HeadersPolicy = HEADERS_POLICY,
  domains: { canonicalOrigin?: string; legacyOrigins?: readonly string[] } = {},
): string {
  const entries = headerEntries(policy);
  const legacy = (domains.legacyOrigins ?? []).filter((o) => o && o !== domains.canonicalOrigin);
  const canonical = domains.canonicalOrigin ?? '<canonicalOrigin>';
  const lines = [
    '# Alibaba ESA — response header rule set',
    '',
    '<!-- GENERATED by `npx vite-node scripts/generate-headers.mts` from `security/headers-policy.ts`. -->',
    '<!-- Do not hand-edit — change the policy file and regenerate. -->',
    '',
    // One line per paragraph / list item / table row: markdown joins a hard-wrapped
    // paragraph back together anyway, and wrapping makes every later edit rewrap.
    'The mainland site deploys to **Aliyun ESA Pages**, which reads no header file from the repository — these response-header rules must be applied directly in the ESA console (or via its API) as an edge rule / response-header action attached to the production domain. (The global site runs on Cloudflare Workers and takes its headers from the generated `public/_headers`.)',
    '',
    "Apply exactly these header names and values (matching `security/headers-policy.ts`, the same policy that generates `public/_headers` / `vercel.json` / index.html's CSP <meta>):",
    '',
    '| Header | Value |',
    '|---|---|',
    ...entries.map(([key, value]) => `| \`${key}\` | \`${value}\` |`),
    '',
    '## Notes',
    '',
    '- The `Content-Security-Policy` value above is the FULL policy, including `frame-ancestors` — ESA sets it as a real response header, so it isn\'t subject to the `<meta>` tag\'s limitations (a `<meta http-equiv="Content-Security-Policy">` cannot express `frame-ancestors` or `Strict-Transport-Security` at all; see `security/headers-policy.ts`\'s `toCspMeta()`).',
    '- Apply the same immutable caching for fingerprinted assets and no-cache/must-revalidate for `index.html` as `public/_headers` documents, using whatever cache-rule mechanism ESA exposes.',
    '- Only enable `Strict-Transport-Security` (and `includeSubDomains`) once the production domain serves HTTPS exclusively and every subdomain is ready for it — reverting HSTS after enabling it is slow (clients cache it for the `max-age`).',
    '',
    ...(legacy.length
      ? [
        '## Legacy domain redirects',
        '',
        `The site moved to \`${canonical}\`. Every domain below must answer with a **301 to the same path** on the canonical origin, so old links, bookmarks, and search results keep working and only one origin is indexed (the sitemap, canonical tags, and security.txt all name the canonical origin alone). Configure the redirect as an ESA rule on each legacy domain; keep it in place indefinitely, since links live longer than deployments.`,
        '',
        '| Legacy domain | Redirect target |',
        '|---|---|',
        ...legacy.map((o) => `| \`${o}/*\` | \`301 ${canonical}/$1\` |`),
        '',
        '- Serve the redirect over HTTPS on the legacy domain too: its certificate must stay valid, or a visitor on an old `https://` link gets a TLS error instead of the redirect.',
        '- The legacy domain must keep answering `/.well-known/security.txt`, or redirect it, so a reporter following an old link still reaches the policy.',
        '',
      ]
      : []),
    '## Verify live post-deploy',
    '',
    "- [ ] After the ESA rule is applied, fetch the production origin and confirm every header above is present with the exact value (e.g. `curl -sI https://<canonicalOrigin> | grep -i 'content-security-policy\\|strict-transport-security\\|x-frame-options\\|x-content-type-options\\|referrer-policy\\|permissions-policy'`).",
    "- [ ] Confirm `frame-ancestors` and `Strict-Transport-Security` are present in the LIVE response — these can never be verified from the CSP `<meta>` alone, since the meta doesn't carry them.",
    ...(legacy.length
      ? [`- [ ] Confirm each legacy domain 301s to \`${canonical}\` with the path preserved (e.g. \`curl -sI ${legacy[0]}/privacy | grep -i 'HTTP/\\|location'\`).`]
      : []),
    '- [ ] Re-run this check after any ESA rule change; the release checklist gates launch on this being green.',
  ];
  return lines.join('\n') + '\n';
}

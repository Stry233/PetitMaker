/**
 * Canonical response-header and CSP policy for static hosts, the ESA rule set, and `index.html`.
 * Provider calls reach the network through the scheme sources below, which custom endpoints need.
 * The host renderers live in `scripts/generate-headers-core.mts`; run
 * `npx vite-node scripts/generate-headers.mts` after changing this policy or either provider registry.
 */

/** Every HTTPS origin, which custom endpoints need and which covers every built-in provider host, and
 *  HTTP loopback gateways. Listing the built-in hosts beside `https:` would restrict nothing. */
export const NETWORK_SOURCES: readonly string[] = [
  'https:',
  'http://localhost:*',
  'http://127.0.0.1:*',
  // CSP host sources cannot express an IPv6 literal; endpoint normalization maps ::1 to localhost.
];

export interface HeadersPolicy {
  /** CSP sources in output order (key insertion order), including response-header-only directives. */
  cspDirectives: Record<string, string[]>;
  /** CSP directives a meta tag cannot enforce. */
  headerOnlyDirectives: readonly string[];
  /** Non-CSP response headers. */
  staticHeaders: Record<string, string>;
  /** Cache-Control per served path, in `_headers` path syntax. */
  cacheRules: readonly CacheRule[];
}

export interface CacheRule {
  path: string;
  cacheControl: string;
}

/** For files whose name changes with their content. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** For files served under a stable name: every use revalidates, and an unchanged file answers 304. */
const REVALIDATE = 'public, max-age=0, must-revalidate';

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
    // The planet video import plays the chosen recording from a blob: URL and its guide's example
    // recording from the site; neither reaches the network beyond the site.
    'media-src': ["'self'", 'blob:'],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    // The OCR core carries its WebAssembly as a data: URL and fetches it; a data: URL reaches no network.
    'connect-src': ["'self'", 'data:', ...NETWORK_SOURCES],
  },
  headerOnlyDirectives: ['frame-ancestors'],
  staticHeaders: {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  },
  cacheRules: [
    // Vite names every bundled file after its content hash.
    { path: '/assets/*', cacheControl: IMMUTABLE },
    // HTML must always re-validate so new builds ship.
    { path: '/index.html', cacheControl: REVALIDATE },
    // The build moves the map check's model and OCR files into a folder named after their content
    // hash (`moderation/<hash>/`), so a changed file arrives under a new URL.
    { path: '/moderation/*', cacheControl: IMMUTABLE },
  ],
};

function buildCspString(policy: HeadersPolicy, opts: { includeHeaderOnly: boolean }): string {
  const names = Object.keys(policy.cspDirectives)
    .filter((name) => opts.includeHeaderOnly || !policy.headerOnlyDirectives.includes(name));
  return names.map((name) => `${name} ${policy.cspDirectives[name]!.join(' ')}`).join('; ');
}

/** Full response-header CSP, including header-only directives. */
export function fullCspString(policy: HeadersPolicy = HEADERS_POLICY): string {
  return buildCspString(policy, { includeHeaderOnly: true });
}

/** Marker immediately above the generated CSP meta tag. */
export const CSP_META_MARKER =
  '<!-- CSP fallback subset — production headers are authoritative (see security/headers-policy.ts) -->';

/** CSP subset enforceable by a meta tag: every directive but the header-only ones. */
export function toCspMeta(policy: HeadersPolicy = HEADERS_POLICY): string {
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
// Dev-only connect-src / font-src extensions (never shipped)
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

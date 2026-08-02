/**
 * Canonical security-headers / CSP policy — ONE typed source of truth for every
 * surface that needs to express it: Netlify (`public/_headers`, preview host),
 * Vercel (`vercel.json`, preview host), Alibaba ESA (the production edge — no
 * repo-file format, so the generator instead emits a documented rule set at
 * `docs/internal/deployment/esa-headers.md`), and the CSP `<meta>` fallback in
 * `index.html` (a portable subset for hosts/contexts without header support).
 *
 * Regenerate every derived output with `npx vite-node scripts/generate-headers.mts`
 * (drift-guarded by `src/__tests__/legal/headers-policy.test.ts`, the same pattern
 * as `npm run legal:licenses:check`). To add a new agent-provider origin: edit
 * `cspDirectives['connect-src']` HERE ONLY, then regenerate — never hand-edit
 * `public/_headers`, `vercel.json`, `docs/internal/deployment/esa-headers.md`, or the
 * `index.html` CSP `<meta>` line; the drift guard will catch it if you do.
 *
 * See docs/internal/superpowers/specs/2026-07-14-legal-docs-design.md §13 "Headers policy
 * — Alibaba-first" + "CSP meta limitations", and docs/THREAT_MODEL.md's "Headers / CSP"
 * + "Maintenance" sections.
 *
 * PROVENANCE: this policy reproduces the protections that were live in
 * `index.html` + `public/_headers` + `vercel.json` as of 2026-07-14, MINUS the
 * two Google Fonts hosts (`fonts.googleapis.com` in `style-src`,
 * `fonts.gstatic.com` in `font-src`) — Quicksand is now self-hosted (see
 * `src/assets/fonts/fonts.css`). Nothing else was weakened or removed.
 */

/** Origins the app may fetch: the named BYOK providers are listed for
 *  documentation, and `connect-src` ALSO carries the broad `https:` scheme
 *  source (plus loopback http for local gateways like Ollama) so a user's
 *  Custom BYO endpoint works on the DEPLOYED site, not only in dev.
 *
 *  Rationale: the Custom provider is a shipped feature, and a fixed origin
 *  allowlist would block every user gateway in production. The residual risk
 *  is bounded — `script-src 'self'` still forbids foreign code, and the agent
 *  tool sandbox never touches the network; `connect-src https:` only widens
 *  where in-page code could POST, which the key vault + redaction already
 *  treat as hostile surface. See docs/THREAT_MODEL.md "Custom (BYO-endpoint)
 *  provider". The dev-only `VITE_EXTRA_CONNECT_SRC` hook (vite.config.ts)
 *  covers non-https experiments. */
const PROVIDER_ORIGINS: readonly string[] = [
  'https://api.anthropic.com',
  'https://api.openai.com',
  'https://api.deepseek.com',
  'https://generativelanguage.googleapis.com',
  'https://openrouter.ai',
  // Zhipu, Qwen and Moonshot each run a second regional deployment; both hosts are named because
  // which one serves a user is decided by which one issued their key.
  'https://open.bigmodel.cn',
  'https://api.z.ai',
  'https://dashscope-intl.aliyuncs.com',
  'https://dashscope.aliyuncs.com',
  'https://api.moonshot.cn',
  'https://api.moonshot.ai',
];

/** Broad sources that make the Custom endpoint reachable everywhere:
 *  any https origin + loopback http (Ollama / LiteLLM on localhost). */
const CUSTOM_ENDPOINT_SOURCES: readonly string[] = [
  'https:',
  'http://localhost:*',
  'http://127.0.0.1:*',
  // CSP's host-source grammar admits only letters, digits and hyphens, so no IPv6 literal can
  // appear here; `sanitizeEndpointUrl` writes such an endpoint as `localhost`, the spelling that
  // names the same interface and that this grammar can express.
];

export interface HeadersPolicy {
  /** CSP directive name -> ordered list of sources. Includes EVERY directive
   *  this app's CSP carries, including header-only ones (`frame-ancestors`) —
   *  the full record is what the response-header adapters (Netlify/Vercel/ESA)
   *  emit. Code that needs the meta-safe subset must go through `toCspMeta()`,
   *  never read this record directly. */
  cspDirectives: Record<string, string[]>;
  /** Directive/header names a `<meta http-equiv="Content-Security-Policy">` tag
   *  can never express: `frame-ancestors` (a real CSP directive that browsers
   *  ignore when delivered via meta — CSP spec, not a bug) and
   *  `Strict-Transport-Security` (not a CSP directive at all — a distinct
   *  response header with no meta equivalent). `toCspMeta()` always excludes
   *  both; it throws if a caller explicitly forces one in. */
  headerOnlyDirectives: readonly string[];
  /** Non-CSP static response headers (nosniff, frame options, referrer policy,
   *  permissions policy, HSTS). Header-only by nature — none has a meta form. */
  staticHeaders: Record<string, string>;
}

export const HEADERS_POLICY: HeadersPolicy = {
  cspDirectives: {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'script-src': ["'self'"],
    // 'unsafe-inline' is required for React inline styles; no Google Fonts host
    // anymore now that Quicksand is self-hosted (src/assets/fonts/fonts.css).
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
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  },
};

/** Fixed directive order — matches the CSP string historically shipped in
 *  `public/_headers` / `vercel.json` so regeneration diffs stay clean/minimal. */
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

/** The full CSP string (every directive, including header-only ones) as shipped
 *  in a response header — used by the Netlify/Vercel/ESA adapters. */
export function fullCspString(policy: HeadersPolicy = HEADERS_POLICY): string {
  return buildCspString(policy, { includeHeaderOnly: true });
}

/** The comment marker the generator stamps immediately above the CSP `<meta>`
 *  line in `index.html`, so anyone reading the file sees the limitation without
 *  having to know to look here. Also asserted by the drift-guard test. */
export const CSP_META_MARKER =
  '<!-- CSP fallback subset — production headers are authoritative (see security/headers-policy.ts) -->';

/**
 * The meta-expressible CSP subset for `index.html`'s `<meta http-equiv=
 * "Content-Security-Policy">` fallback. Always excludes `headerOnlyDirectives`
 * (`frame-ancestors`, and `Strict-Transport-Security` — which was never a CSP
 * directive to begin with, so it never appears in `cspDirectives`).
 *
 * Throws if `opts.forceInclude` names a header-only directive — a defensive
 * guard so nobody can silently ship a meta tag that LOOKS like it enforces
 * frame-ancestors/HSTS when a `<meta>` tag structurally cannot.
 */
export function toCspMeta(
  policy: HeadersPolicy = HEADERS_POLICY,
  opts?: { forceInclude?: readonly string[] }
): string {
  for (const name of opts?.forceInclude ?? []) {
    if (policy.headerOnlyDirectives.includes(name)) {
      throw new Error(
        `toCspMeta: "${name}" is a header-only directive (see CSP meta limitations, spec §13) and cannot be ` +
          'expressed in a <meta> CSP tag — production response headers (security/headers-policy.ts adapters) ' +
          'remain authoritative.'
      );
    }
  }
  return buildCspString(policy, { includeHeaderOnly: false });
}

/** Ordered [key, value] pairs for every response header this policy emits
 *  (CSP first, then the static headers in `staticHeaders`'s own key order) —
 *  shared by the Netlify/Vercel/ESA adapters so their header SET and ORDER
 *  never drift from one another. */
export function headerEntries(policy: HeadersPolicy = HEADERS_POLICY): Array<[string, string]> {
  return [['Content-Security-Policy', fullCspString(policy)], ...Object.entries(policy.staticHeaders)];
}

// ---------------------------------------------------------------------------
// Dev-only connect-src extension (NEVER shipped)
// ---------------------------------------------------------------------------

/** Parses a `VITE_EXTRA_CONNECT_SRC` value (space- or comma-separated origins)
 *  into a clean list. Empty / whitespace-only → `[]`. Used ONLY by the Vite dev
 *  server (see vite.config.ts) so a maintainer can reach a personal Custom
 *  endpoint locally without adding its origin to the canonical, public policy. */
export function parseExtraConnectSrc(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Returns a policy clone with `extraOrigins` appended to `connect-src`. Pure;
 *  used by the dev-server CSP-meta rewrite only. A no-op when `extraOrigins` is
 *  empty. */
export function withExtraConnectSrc(
  policy: HeadersPolicy = HEADERS_POLICY,
  extraOrigins: readonly string[] = []
): HeadersPolicy {
  if (extraOrigins.length === 0) return policy;
  return {
    ...policy,
    cspDirectives: {
      ...policy.cspDirectives,
      'connect-src': [...(policy.cspDirectives['connect-src'] ?? []), ...extraOrigins],
    },
  };
}

// ---------------------------------------------------------------------------
// Netlify adapter
// ---------------------------------------------------------------------------

/**
 * Renders the full `public/_headers` file (Netlify-compatible; Vite copies
 * `public/` to the build root, so this lands at `dist/_headers`). Includes the
 * caching rules for `/assets/*` and `/index.html`, which aren't part of the
 * security policy proper but have always shipped alongside it in this file.
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
 * Renders `docs/internal/deployment/esa-headers.md`: the exact header names/values a
 * maintainer applies in the Alibaba ESA console/API (edge rule / response
 * header actions), since ESA has no in-repo config format the way Netlify/
 * Vercel do. Includes a "verify live post-deploy" reminder — the release
 * checklist gates on actually checking the deployed response headers, not just
 * on this document existing (see spec §13, §17).
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
    'Production deploys to **Alibaba OSS (static hosting) + ESA (edge acceleration/security)**. Unlike Netlify/Vercel, ESA has no repo-committed header config — these response-header rules must be applied directly in the ESA console (or via its API) as an edge rule / response-header action attached to the production domain.',
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
    '- [ ] Re-run this check after any ESA rule change; the release checklist (`docs/internal/deployment/legal-release-checklist.md`) gates launch on this being green.',
  ];
  return lines.join('\n') + '\n';
}

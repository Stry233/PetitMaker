// Pure core of the headers-policy generator: the index.html CSP <meta> rewrite
// (string in, string out) plus small helpers for JSON-stringifying vercel.json
// the way this repo commits it. No file I/O, no process access — everything
// here is safe to unit-test directly and is imported by both
// src/__tests__/legal/headers-policy.test.ts and scripts/generate-headers.mts
// (the CLI, which owns all fs reads/writes and unconditionally runs `main()`;
// see that file's doc comment for why a main-module guard doesn't work under
// `vite-node` — the same trap scripts/license-audit.mts documents).

import { CSP_META_MARKER, toCspMeta, type HeadersPolicy, type VercelJsonLike } from '../security/headers-policy';

/** Matches the CSP-explanation HTML comment immediately followed by the CSP
 *  `<meta http-equiv="Content-Security-Policy" ...>` tag — the exact two
 *  things the generator is allowed to touch in index.html (brief: "nothing
 *  else in index.html"). */
const CSP_BLOCK_PATTERN = /[ \t]*<!--[\s\S]*?-->\s*\n[ \t]*<meta http-equiv="Content-Security-Policy"[^>]*\/>/;

/**
 * Surgically replaces the CSP explanation-comment + `<meta>` line pair in an
 * `index.html` source string with the generated marker comment + a fresh meta
 * tag built from the policy's meta-expressible directive subset. Throws if the
 * expected block isn't found (so a hand-edited/reformatted index.html fails
 * loudly instead of silently leaving stale CSP behind).
 */
export function rewriteIndexHtmlCsp(
  html: string,
  policy: HeadersPolicy,
  opts?: { indent?: string }
): string {
  if (!CSP_BLOCK_PATTERN.test(html)) {
    throw new Error(
      'rewriteIndexHtmlCsp: could not find the CSP explanation-comment + <meta http-equiv="Content-Security-Policy"> ' +
        'pair in index.html — has the surrounding markup changed?'
    );
  }
  const indent = opts?.indent ?? '    ';
  const metaContent = toCspMeta(policy);
  const replacement = `${indent}${CSP_META_MARKER}\n${indent}<meta http-equiv="Content-Security-Policy" content="${metaContent}" />`;
  return html.replace(CSP_BLOCK_PATTERN, replacement);
}

/** This repo's committed vercel.json is 2-space indented with a trailing newline. */
export function stringifyVercelJson(json: VercelJsonLike): string {
  return JSON.stringify(json, null, 2) + '\n';
}

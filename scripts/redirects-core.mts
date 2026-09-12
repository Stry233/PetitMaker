// Static redirect rules for Cloudflare Workers static assets (`dist/_redirects`).
// Page aliases resolve to the unslashed canonical path in one permanent hop; scheme and host
// consolidation is handled by zone redirect rules, and every other path is served as an asset.

import type { PlannedPage } from './legal-pages-core.mts';

const STATUS = 308;

/** Alias request paths that lead to a canonical page path. */
export function pageAliases(canonicalPath: string): string[] {
  if (canonicalPath === '/') return ['/index.html', '/index'];
  return [`${canonicalPath}/`, `${canonicalPath}.html`, `${canonicalPath}/index.html`];
}

/** One `source destination status` line per alias of the homepage and every planned page. */
export function redirectsFile(pages: readonly PlannedPage[]): string {
  const lines: string[] = [];
  for (const path of ['/', ...pages.map((page) => page.path)]) {
    for (const alias of pageAliases(path)) lines.push(`${alias} ${path} ${STATUS}`);
  }
  return `${lines.join('\n')}\n`;
}

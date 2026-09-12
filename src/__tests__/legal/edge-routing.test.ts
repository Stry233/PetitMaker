// @vitest-environment node
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { DEPLOY_TARGETS } from '../../legal/deploy-targets';
import { LEGAL } from '../../legal/config';
import { canonicalPagePath } from '../../legal/site-paths';
import { pagePlan } from '../../../scripts/legal-pages-core.mts';
import { pageAliases, redirectsFile } from '../../../scripts/redirects-core.mts';

const GLOBAL = DEPLOY_TARGETS.global.canonicalOrigin;
const cfg = { ...LEGAL, canonicalOrigin: GLOBAL };
const pages = pagePlan(cfg);
const rules = new Map(
  redirectsFile(pages).trim().split('\n').map((line) => {
    const [source = '', destination = '', status = ''] = line.split(' ');
    return [source, { destination, status }] as const;
  }),
);

describe('international edge routing', () => {
  it('redirects every page alias to its unslashed canonical path in one permanent hop', () => {
    for (const path of ['/', ...pages.map((page) => page.path)]) {
      for (const alias of pageAliases(path)) {
        expect(canonicalPagePath(alias, GLOBAL)).toBe(path);
        expect(rules.get(alias)).toEqual({ destination: path, status: '308' });
      }
    }
  });

  it('lists no rule whose source is already canonical, and none for a page that has no Chinese edition', () => {
    for (const source of rules.keys()) expect(canonicalPagePath(source, GLOBAL)).not.toBe(source);
    expect([...rules.keys()].some((source) => source.startsWith('/zh/license'))).toBe(false);
  });

  it('serves the site as static assets without a Worker script', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, '')) as {
      main?: string; assets: { html_handling: string; not_found_handling: string; run_worker_first?: unknown };
    };
    expect(config.main).toBeUndefined();
    expect(config.assets.run_worker_first).toBeUndefined();
    expect(config.assets.html_handling).toBe('drop-trailing-slash');
    expect(config.assets.not_found_handling).toBe('404-page');
  });
});

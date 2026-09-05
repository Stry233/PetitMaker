import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { LEGAL } from '../../legal/config';

import { DEPLOY_TARGETS } from '../../legal/deploy-targets';
import { canonicalPagePath } from '../../legal/site-paths';

// README links must name canonical production pages on either deployment.
const read = (p: string) => readFileSync(p, 'utf8');
const README_EN = read('README.md');
const README_ZH = read('docs/README.zh-CN.md');
const READMES: Array<[string, string]> = [
  ['README.md', README_EN],
  ['docs/README.zh-CN.md', README_ZH],
];

const REPO = new URL(LEGAL.repoUrl);
// The owner path segment (e.g. "/Stry233") — any repo-host URL under this owner
// is treated as "the project repository URL" and must equal LEGAL.repoUrl.
const REPO_OWNER_PREFIX = `/${REPO.pathname.split('/').filter(Boolean)[0] ?? ''}`;

// Bare http(s) URLs, trailing sentence/markup punctuation trimmed.
function urlsIn(md: string): string[] {
  return (md.match(/https?:\/\/[^\s)>\]]+/g) ?? []).map((u) => u.replace(/[.,;)]+$/, ''));
}

describe('README URL single-source drift guard', () => {
  it('every production link goes directly to a canonical page on its deployment', () => {
    const targets = Object.values(DEPLOY_TARGETS);
    const legacyHosts = targets.flatMap((t) => t.legacyOrigins.map((o) => new URL(o).host));
    for (const [name, md] of READMES) {
      for (const u of urlsIn(md)) {
        const parsed = new URL(u);
        expect(legacyHosts, `${name}: legacy link ${u}`).not.toContain(parsed.host);
        const target = targets.find((t) => new URL(t.canonicalOrigin).host === parsed.host);
        if (!target) continue;
        expect(parsed.origin).toBe(target.canonicalOrigin);
        expect(parsed.pathname).toBe(canonicalPagePath(parsed.pathname, target.canonicalOrigin));
      }
      for (const target of targets) expect(md).toContain(target.canonicalOrigin + '/');
    }
  });

  it('every project-repo URL in each README equals LEGAL.repoUrl exactly', () => {
    for (const [name, md] of READMES) {
      for (const u of urlsIn(md)) {
        let parsed: URL;
        try {
          parsed = new URL(u);
        } catch {
          continue;
        }
        if (parsed.host === REPO.host && parsed.pathname.startsWith(REPO_OWNER_PREFIX)) {
          expect(u, `${name}: repo URL "${u}" must equal LEGAL.repoUrl`).toBe(LEGAL.repoUrl);
        }
      }
    }
  });

  it('each README actually uses the configured site + repo URLs (so a config change forces an update)', () => {
    for (const [name, md] of READMES) {
      expect(md, `${name} must contain LEGAL.canonicalOrigin`).toContain(LEGAL.canonicalOrigin);
      expect(md, `${name} must contain LEGAL.repoUrl`).toContain(LEGAL.repoUrl);
    }
  });

  it('no README still carries the pre-launch "link lands here" placeholder', () => {
    for (const [name, md] of READMES) {
      expect(md, `${name} still has a link placeholder`).not.toMatch(/lands here|after deploy|补充链接/);
    }
  });
});

import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { LEGAL } from '../../legal/config';

// SINGLE-SOURCE URL drift guard. README.md and
// README.zh-CN.md are plain GitHub markdown — they cannot be token-processed
// like the src/legal/content/* docs (which use the `{origin}` token) or read
// `cfg.canonicalOrigin` like the static-page generator. To keep
// `src/legal/config.ts` the SOLE edit point for the live-site + repository
// URLs, this test pins every literal site/repo URL in both READMEs to the
// config values: change `canonicalOrigin` or `repoUrl` in config and this test
// fails until the READMEs follow. See config.ts's "SINGLE-SOURCE URL POLICY".

const read = (p: string) => readFileSync(p, 'utf8');
const README_EN = read('README.md');
const README_ZH = read('docs/README.zh-CN.md');
const READMES: Array<[string, string]> = [
  ['README.md', README_EN],
  ['docs/README.zh-CN.md', README_ZH],
];

const CANON = new URL(LEGAL.canonicalOrigin);
const REPO = new URL(LEGAL.repoUrl);
// The owner path segment (e.g. "/Stry233") — any repo-host URL under this owner
// is treated as "the project repository URL" and must equal LEGAL.repoUrl.
const REPO_OWNER_PREFIX = `/${REPO.pathname.split('/').filter(Boolean)[0] ?? ''}`;

// Bare http(s) URLs, trailing sentence/markup punctuation trimmed.
function urlsIn(md: string): string[] {
  return (md.match(/https?:\/\/[^\s)>\]]+/g) ?? []).map((u) => u.replace(/[.,;)]+$/, ''));
}

describe('README URL single-source drift guard', () => {
  it('every site-host URL in each README equals LEGAL.canonicalOrigin exactly', () => {
    for (const [name, md] of READMES) {
      for (const u of urlsIn(md)) {
        let host = '';
        try {
          host = new URL(u).host;
        } catch {
          continue;
        }
        if (host === CANON.host) {
          expect(u, `${name}: site URL "${u}" must equal LEGAL.canonicalOrigin`).toBe(LEGAL.canonicalOrigin);
        }
      }
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

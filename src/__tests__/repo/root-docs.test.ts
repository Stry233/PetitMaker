import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { APP_NAME } from '../../i18n/terms/brand';
import { LEGAL, memberUrl } from '../../legal/config';

// The public root documents: the facts they carry come from `legal/config.ts`, their links reach
// the documents the export ships, each Chinese edition keeps its English source's structure, and
// none promises what the project cannot keep.

const read = (p: string) => readFileSync(p, 'utf8');

/** The `##`/`###`/… headings in a markdown slice. */
const headingCount = (md: string) => (md.match(/^#{2,}\s/gm) ?? []).length;
const translatedHeadings = (md: string) => (md.match(/^#{2,}\s+.+$/gm) ?? []).every((h) => /[一-鿿]/.test(h));
const ROSTER = [...LEGAL.team, ...LEGAL.acknowledgements];

describe('SECURITY.md', () => {
  const SEC = read('SECURITY.md');

  it('opens with a single top-level title', () => {
    expect((SEC.match(/^#\s/gm) ?? []).length).toBe(1);
  });

  it('reports to the security contact with the [SECURITY] subject prefix', () => {
    expect(SEC).toContain(LEGAL.securityContactEmail);
    expect(SEC).toContain('[SECURITY]');
  });

  it('promises no guaranteed response', () => {
    expect(SEC.toLowerCase()).not.toContain('guarantee');
  });

  it('carries the affiliation disclaimer naming miHoYo and HoYoverse', () => {
    expect(SEC).toContain('not affiliated');
    expect(SEC).toContain('miHoYo');
    expect(SEC).toContain('HoYoverse');
  });

  it('is the reporting policy and points to the threat model for the technical detail', () => {
    expect(SEC).not.toContain('## Technical threat model');
    expect(SEC).toContain('docs/THREAT_MODEL.md');
  });
});

describe('docs/THREAT_MODEL.md', () => {
  const TM = read('docs/THREAT_MODEL.md');

  it('opens with a single top-level title and points back to the reporting policy', () => {
    expect((TM.match(/^#\s/gm) ?? []).length).toBe(1);
    expect(TM).toContain('SECURITY.md');
  });
});

describe('docs/SECURITY.zh-CN.md', () => {
  const EN = read('SECURITY.md');
  const ZH = read('docs/SECURITY.zh-CN.md');

  it('reports to the same contact with the same subject prefix', () => {
    expect(ZH).toContain(LEGAL.securityContactEmail);
    expect(ZH).toContain('[SECURITY]');
  });

  it('keeps the English source heading for heading, each one translated', () => {
    expect(headingCount(ZH)).toBe(headingCount(EN));
    expect(headingCount(ZH)).toBeGreaterThan(0);
    expect(translatedHeadings(ZH)).toBe(true);
  });
});

describe('docs/ASSET_LICENSES.md', () => {
  const A = read('docs/ASSET_LICENSES.md');

  it('names the licence of each scope: code, original art, third-party assets', () => {
    expect(A).toContain('Apache-2.0');
    expect(A).toContain('All Rights Reserved');
    expect(A).toContain('SIL Open Font License 1.1');
  });

  it('carries the affiliation disclaimer and the IP-request channel', () => {
    expect(A).toContain('not affiliated');
    expect(A).toContain('HoYoverse');
    expect(A).toContain('[IP]');
    expect(A).toContain(LEGAL.privacyContactEmail);
  });
});

describe('docs/ASSET_LICENSES.zh-CN.md', () => {
  const EN = read('docs/ASSET_LICENSES.md');
  const ZH = read('docs/ASSET_LICENSES.zh-CN.md');

  it('keeps the English source heading for heading, each one translated', () => {
    expect(headingCount(ZH)).toBe(headingCount(EN));
    expect(headingCount(ZH)).toBeGreaterThan(0);
    expect(translatedHeadings(ZH)).toBe(true);
  });

  it('keeps the licence names in English, which a reader matches against other documents', () => {
    for (const term of ['Apache-2.0', 'All Rights Reserved', 'SIL Open Font License 1.1']) expect(ZH).toContain(term);
  });

  it('carries the affiliation disclaimer and the IP-request channel', () => {
    expect(ZH).toContain('米哈游');
    expect(ZH).toContain('HoYoverse');
    expect(ZH).toContain('[IP]');
    expect(ZH).toContain(LEGAL.privacyContactEmail);
  });
});

describe('the changelogs', () => {
  const EN = read('docs/CHANGELOG.md');
  const ZH = read('docs/CHANGELOG.zh-CN.md');
  // The staged section only: the Chinese file carries released history the English one keeps in
  // the public repository, so whole files differ.
  const staged = (md: string) => md.split(/^##\s/m).find((s) => /^\[(Unreleased|未发布)\]/.test(s)) ?? '';

  it('each carry the staged section the publish step rewrites into a release', () => {
    expect(EN).toMatch(/^##\s*\[Unreleased\]\s*$/m);
    expect(ZH).toMatch(/^##\s*\[未发布\]\s*$/m);
  });

  it('stage the same structure in both languages', () => {
    expect(headingCount(staged(ZH))).toBe(headingCount(staged(EN)));
  });

  it('hold no released section in English, so a first publish reads as one release', () => {
    expect(EN.match(/^##\s*\[\d/gm)).toBeNull();
  });
});

describe('CONTRIBUTING.md', () => {
  const C = read('CONTRIBUTING.md');

  it('requires DCO sign-off under the code licence', () => {
    expect(C).toContain('Developer Certificate of Origin');
    expect(C).toContain('git commit -s');
    expect(C).toContain('Apache-2.0');
  });
});

describe('README.md', () => {
  const R = read('README.md');
  const scripts = Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts);

  // The app name is set in the masthead artwork, so it reaches a reader through the image's alt
  // text; an H1 beside it would render the name twice.
  it('opens with a masthead whose alt text names the app, and repeats it in no heading', () => {
    expect((R.match(/^#\s/gm) ?? []).length).toBe(0);
    expect(R.slice(0, 600)).toMatch(new RegExp(`<img[^>]*\\balt="[^"]*${APP_NAME}`));
  });

  it('carries the affiliation disclaimer, the code licence and the contact', () => {
    expect(R).toContain('not affiliated');
    expect(R).toContain('HoYoverse');
    expect(R).toContain('Apache-2.0');
    expect(R).toContain(LEGAL.privacyContactEmail);
  });

  it('links the legal documents and the Chinese README', () => {
    for (const target of ['./LICENSE', './SECURITY.md', './docs/ASSET_LICENSES.md', './docs/THIRD_PARTY_NOTICES.md',
      './CONTRIBUTING.md', './docs/CHANGELOG.md', './docs/README.zh-CN.md']) expect(R).toContain(`(${target})`);
  });

  it('credits the team and the acknowledged members by name, each linked to their space', () => {
    // The displayed name, not any occurrence: alt text carries the names too.
    for (const member of ROSTER) {
      expect(R).toContain(`<b>${member.name}</b>`);
      expect(R).toContain(`${memberUrl(member)}"`);
    }
    expect(R).not.toContain('spm_id_from');
  });

  it('runs only package scripts that exist', () => {
    const named = [...R.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !scripts.includes(name))).toEqual([]);
  });
});

describe('docs/README.zh-CN.md', () => {
  const EN = read('README.md');
  const ZH = read('docs/README.zh-CN.md');

  it('opens with a masthead, carrying the name in no heading', () => {
    expect((ZH.match(/^#\s/gm) ?? []).length).toBe(0);
    expect(ZH.slice(0, 600)).toMatch(/<img[^>]*\balt="[^"]*谷地工坊/);
  });

  it('carries the contact and the affiliation disclaimer', () => {
    expect(ZH).toContain(LEGAL.privacyContactEmail);
    expect(ZH).toContain('米哈游');
    expect(ZH).toContain('HoYoverse');
  });

  it('links the same documents as the English README, one folder deeper', () => {
    for (const target of ['../LICENSE', '../SECURITY.md', './ASSET_LICENSES.md', './THIRD_PARTY_NOTICES.md',
      '../CONTRIBUTING.md', './CHANGELOG.md']) expect(ZH).toContain(`(${target})`);
    expect(ZH).toContain('README.md');
  });

  it('credits every member with their space', () => {
    for (const member of ROSTER) expect(ZH).toContain(`${memberUrl(member)}"`);
    expect(ZH).not.toContain('spm_id_from');
  });

  it('has the same heading count as the English source', () => {
    expect(headingCount(ZH)).toBe(headingCount(EN));
  });
});

describe('public docs never reference the internal tree', () => {
  const PUBLIC_DOCS = [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'NOTICE',
    'docs/README.zh-CN.md',
    'docs/SECURITY.zh-CN.md',
    'docs/ASSET_LICENSES.md',
    'docs/ASSET_LICENSES.zh-CN.md',
    'docs/THIRD_PARTY_NOTICES.md',
    'docs/THREAT_MODEL.md',
    'docs/ARCHITECTURE.md',
    'docs/CHANGELOG.md',
    'docs/CHANGELOG.zh-CN.md',
  ];
  it.each(PUBLIC_DOCS)('%s names neither docs/internal nor scripts/internal', (f) => {
    const body = read(f);
    expect(body).not.toContain('docs/internal');
    expect(body).not.toContain('scripts/internal');
  });
});

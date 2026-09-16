import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync } from 'node:fs';
import { APP_NAME } from '../../version';

// Root docs — the authored legal prose. These tests are the honesty
// contract: every material COMMITMENT in the docs must be one we can keep
// (e.g. "aim to acknowledge", never "guarantee"), and the bilingual SECURITY
// pair must not drift in its policy half.

const read = (p: string) => readFileSync(p, 'utf8');

// Count `##`/`###`/… headings in a markdown slice.
const headingCount = (md: string) => (md.match(/^#{2,}\s/gm) ?? []).length;

/*
 * Changelog state helpers. `scripts/changelog-core.mts` rewrites the staged heading
 * (`## [Unreleased]` / `## [未发布]`) into a released one (`## [x.y.z] - date`), so a changelog is
 * legitimately in one of two states and moves between them on every publish: STAGED (pending work
 * sits under the staged heading) or PUBLISHED (that heading has already become a release). Pin what
 * must hold in BOTH — a single staged section at most, and well-formed released headings — rather
 * than the repository's current release stage, which the guards below cannot see.
 */
const STAGED_HEADING = /^##\s*\[(?:Unreleased|未发布)\]\s*$/gm;
const RELEASED_HEADING = /^##\s*\[\d+\.\d+\.\d+\]\s*-\s*\d{4}-\d{2}-\d{2}\s*$/gm;
const stagedHeadings = (md: string) => md.match(STAGED_HEADING) ?? [];
const releasedHeadings = (md: string) => md.match(RELEASED_HEADING) ?? [];

describe('SECURITY.md — reporting policy', () => {
  const SEC = read('SECURITY.md');

  it('exists and opens with a single top-level title', () => {
    expect((SEC.match(/^#\s/gm) ?? []).length).toBe(1);
  });

  it('reports to the security contact with the [SECURITY] subject prefix', () => {
    expect(SEC).toContain('selka.craft@outlook.com');
    expect(SEC).toContain('[SECURITY]');
  });

  it('uses the exact non-committal acknowledgement language', () => {
    expect(SEC).toContain('aim to acknowledge');
    expect(SEC).toContain('72 hours');
  });

  it('never promises a guaranteed response / SLA', () => {
    expect(SEC.toLowerCase()).not.toContain('guarantee');
  });

  it('carries the affiliation disclaimer naming miHoYo and HoYoverse', () => {
    expect(SEC).toContain('not affiliated');
    expect(SEC).toContain('miHoYo');
    expect(SEC).toMatch(/HoYoverse/);
  });

  it('states that publishing security.txt does not authorize arbitrary testing', () => {
    expect(SEC).toContain('does not authorize');
  });

  it('scopes the safe harbor to systems we control and excludes third parties', () => {
    expect(SEC).toContain('systems we control');
    expect(SEC).toMatch(/HoYoverse/);
    // no immunity we lack authority to grant
    expect(SEC.toLowerCase()).toContain('only matters within our authority');
  });

  it('documents the report-handling lifecycle (triage → assessment → disclosure)', () => {
    expect(SEC).toContain('How we handle your report');
    expect(SEC).toContain('Triage');
    expect(SEC).toContain('Disclosure');
  });

  it('carries an explicit out-of-scope list (game, providers, social engineering)', () => {
    expect(SEC).toContain('Out of scope');
    expect(SEC).toContain('social engineering');
    expect(SEC).toMatch(/game itself/i);
  });

  it('is policy-only: the technical threat-model annex now lives in docs/THREAT_MODEL.md', () => {
    // SECURITY.md is the public reporting policy the /security page renders. It must
    // NOT carry the developer threat-model content, only a plain pointer to it.
    expect(SEC).not.toContain('## Technical threat model');
    expect(SEC).not.toContain('Agent (LLM) threat model');
    expect(SEC).not.toContain('Tool sandbox invariant');
    expect(SEC).toContain('docs/THREAT_MODEL.md');
  });
});

describe('docs/THREAT_MODEL.md — developer threat-model (split out of SECURITY.md)', () => {
  const TM = read('docs/THREAT_MODEL.md');

  it('exists and is marked developer documentation', () => {
    expect((TM.match(/^#\s/gm) ?? []).length).toBe(1);
    expect(TM).toContain('Developer documentation');
  });

  it('covers the browser, Agent, and illustration security boundaries', () => {
    expect(TM).toContain('## Build and browser controls');
    expect(TM).toContain('## Agent threat model');
    expect(TM).toContain('## Illustration threat model');
    expect(TM).toContain('Tool boundary');
  });

  it('points back to the public reporting policy', () => {
    expect(TM).toContain('SECURITY.md');
  });
});

describe('SECURITY.zh-CN.md — authored equivalent + parity', () => {
  const EN = read('SECURITY.md');
  const ZH = read('docs/SECURITY.zh-CN.md');

  // The technical annex lives in docs/THREAT_MODEL.md, so SECURITY.md ↔ SECURITY.zh-CN.md
  // are fully parallel policy documents. Parity is asserted over the WHOLE file: there is
  // no annex half to special-case.

  it('exists', () => {
    expect(existsSync('docs/SECURITY.zh-CN.md')).toBe(true);
  });

  it('carries the same contact + acknowledgement window (localized)', () => {
    expect(ZH).toContain('selka.craft@outlook.com');
    expect(ZH).toContain('72 小时');
    expect(ZH).toContain('[SECURITY]');
  });

  it('has the same heading structure as the English source (whole file)', () => {
    expect(headingCount(ZH)).toBe(headingCount(EN));
    expect(headingCount(ZH)).toBeGreaterThan(0);
  });

  it('every heading is translated (no verbatim English headings, whole file)', () => {
    const headings = ZH.match(/^##\s+.+$/gm) ?? [];
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) {
      expect(h).toMatch(/[一-鿿]/);
    }
  });
});

describe('ASSET_LICENSES.md — four-way scope split', () => {
  const A = read('docs/ASSET_LICENSES.md');

  it('states the code scope: Apache-2.0', () => {
    expect(A).toContain('Apache-2.0');
  });

  it('states brand/original art: All Rights Reserved', () => {
    expect(A).toContain('All Rights Reserved');
  });

  it('states third-party assets/fonts carry their own licenses', () => {
    expect(A).toMatch(/their own licenses/);
  });

  it('states user maps belong to their creators', () => {
    expect(A).toContain('User maps');
  });

  it('makes clear the provenance audit summary is not itself a permission grant', () => {
    expect(A).toContain('do not themselves grant you or the project rights');
  });

  it('carries the affiliation disclaimer (miHoYo/HoYoverse) and an IP-request channel', () => {
    expect(A).toContain('not affiliated');
    expect(A).toContain('miHoYo');
    expect(A).toMatch(/HoYoverse/);
    expect(A).toContain('[IP]');
    expect(A).toContain('selka.craft@outlook.com');
  });
});

describe('ASSET_LICENSES.zh-CN.md — authored equivalent + parity', () => {
  const EN = read('docs/ASSET_LICENSES.md');
  const ZH = read('docs/ASSET_LICENSES.zh-CN.md');

  it('exists', () => {
    expect(existsSync('docs/ASSET_LICENSES.zh-CN.md')).toBe(true);
  });

  it('has the same heading structure as the English source', () => {
    expect(headingCount(ZH)).toBe(headingCount(EN));
    expect(headingCount(ZH)).toBeGreaterThan(0);
  });

  it('every heading is translated (no verbatim English headings)', () => {
    const headings = ZH.match(/^#{2,}\s+.+$/gm) ?? [];
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) expect(h).toMatch(/[一-鿿]/);
  });

  it('states the same four-way scope split, keeping the English legal terms alongside', () => {
    // A licence term is the thing a reader may have to match against another document, so
    // the Chinese carries it: translating it away would make the two versions say
    // different things to anyone checking.
    expect(ZH).toContain('Apache-2.0');
    expect(ZH).toContain('All Rights Reserved');
    expect(ZH).toContain('保留所有权利');
    expect(ZH).toContain('用户地图');
    expect(ZH).toContain('SIL Open Font License 1.1');
  });

  it('keeps the permission to share exports, and its two limits', () => {
    expect(ZH).toContain('非独占、免版税且在全球有效');
    expect(ZH).toMatch(/不包括提取素材/);
    expect(ZH).toMatch(/不转移/);
  });

  it('keeps the audit disclaimer: a provenance record is not a permission', () => {
    expect(EN).toContain('do not themselves grant you or the project rights'); // the sentence being mirrored
    expect(ZH).toContain('本身不授予您或本项目再利用、再分发或转授权相关素材的权利');
  });

  it('carries the affiliation disclaimer (米哈游/HoYoverse) and the IP channel', () => {
    expect(ZH).toContain('米哈游');
    expect(ZH).toMatch(/HoYoverse/);
    expect(ZH).toContain('[IP]');
    expect(ZH).toContain('selka.craft@outlook.com');
  });
});

describe('CHANGELOG.zh-CN.md — authored equivalent', () => {
  const EN = read('docs/CHANGELOG.md');
  const ZH = read('docs/CHANGELOG.zh-CN.md');
  // The STAGED section only. The two files hold different amounts of already-released history:
  // the Chinese one was written after v0.1 shipped, so it carries that section itself while the
  // English one's lives in the public repository. Comparing whole files would read that as drift.
  const staged = (md: string) => md.split(/^##\s/m).find((s) => /^\[(Unreleased|未发布)\]/.test(s)) ?? '';

  it('exists and follows the same format, in Chinese', () => {
    expect(existsSync('docs/CHANGELOG.zh-CN.md')).toBe(true);
    expect(ZH).toContain('Keep a Changelog');
    expect(headingCount(staged(ZH))).toBe(headingCount(staged(EN)));
  });

  it('carries the staged section the publish step rewrites into a release', () => {
    // changelog-core.mts matches this heading in either language; losing it while staged work
    // remains would publish a Chinese changelog with no release notes at all. Its mechanics are
    // pinned in scripts/__tests__/release.test.mts. A published changelog has already spent it, so
    // the guard is "at most one, and never none of both states".
    expect(stagedHeadings(ZH).length).toBeLessThanOrEqual(1);
    expect(stagedHeadings(ZH).length + releasedHeadings(ZH).length).toBeGreaterThan(0);
  });
});

describe('CONTRIBUTING.md — DCO + inbound=outbound', () => {
  const C = read('CONTRIBUTING.md');

  it('requires DCO sign-off', () => {
    expect(C).toContain('Developer Certificate of Origin');
    expect(C).toContain('Signed-off-by');
    expect(C).toContain('git commit -s');
  });

  it('states inbound=outbound Apache-2.0 and that contributors retain copyright', () => {
    expect(C).toContain('Apache-2.0');
    expect(C).toMatch(/retain/i);
  });

  it('requires written permission for art contributions, without naming internal paths', () => {
    expect(C).toContain('written permission');
    // public docs must never reference the internal tree (absent from the public repo)
    expect(C).not.toContain('docs/internal');
  });
});

describe('CHANGELOG.md — Keep a Changelog, one staged section', () => {
  const CL = read('docs/CHANGELOG.md');

  it('follows Keep a Changelog and links the format', () => {
    expect(CL).toContain('Keep a Changelog');
  });

  it('carries the staged section the publish step rewrites into a release', () => {
    // changelog-core.mts turns this heading into `## [version] - date`, so a second staged heading
    // would be rewritten ambiguously, and a changelog with neither state has no notes to publish.
    expect(stagedHeadings(CL).length).toBeLessThanOrEqual(1);
    expect(stagedHeadings(CL).length + releasedHeadings(CL).length).toBeGreaterThan(0);
  });

  it('marks every released section with a version and a date', () => {
    // The publish rewrite is the only thing that introduces released headings, and it writes the
    // date with the version. A numeric heading that is not `## [x.y.z] - YYYY-MM-DD` (a bare
    // `## [1.2]`, a missing date) would leave the next publish without a date to order by.
    const numericHeadings = CL.match(/^##\s*\[\d[^\]]*\]/gm) ?? [];
    expect(numericHeadings.length).toBe(releasedHeadings(CL).length);
  });
});

describe('README.md — public front page', () => {
  const R = read('README.md');

  // The app name is set in the masthead artwork, so it reaches a reader through the image's alt
  // text. An H1 alongside it would render the name twice; the guard follows the name, not the tag.
  it('opens with a masthead whose alt text names the app, and repeats it in no heading', () => {
    expect((R.match(/^#\s/gm) ?? []).length).toBe(0);
    expect(R.slice(0, 600)).toMatch(new RegExp(`<img[^>]*\\balt="[^"]*${APP_NAME}`));
  });

  it('states it is an unofficial fan project', () => {
    expect(R).toContain('unofficial');
  });

  it('carries the affiliation disclaimer naming miHoYo and HoYoverse', () => {
    expect(R).toContain('not affiliated');
    expect(R).toContain('miHoYo');
    expect(R).toMatch(/HoYoverse/);
  });

  it('names the code license: Apache-2.0', () => {
    expect(R).toContain('Apache-2.0');
  });

  it('links to the legal docs (root-level six + docs/ for the moved docs)', () => {
    // Root keeps the GitHub-conventional docs; THIRD_PARTY_NOTICES + ASSET_LICENSES
    // moved under docs/, so the README links to them there.
    expect(R).toContain('(./LICENSE)');
    expect(R).toContain('(./SECURITY.md)');
    expect(R).toContain('(./docs/ASSET_LICENSES.md)');
    expect(R).toContain('(./docs/THIRD_PARTY_NOTICES.md)');
    expect(R).toContain('(./CONTRIBUTING.md)');
    expect(R).toContain('(./docs/CHANGELOG.md)');
  });

  it('cross-links the Chinese README (now under docs/)', () => {
    expect(R).toContain('(./docs/README.zh-CN.md)');
  });

  it('states the four-way license scope split (§11)', () => {
    expect(R).toContain('Apache-2.0');
    expect(R).toContain('All Rights Reserved');
    expect(R).toMatch(/their own licenses/);
    expect(R).toContain('User maps');
  });

  it('credits all four named contributors with their Bilibili links', () => {
    // Match the DISPLAYED name, not just any occurrence: alt text carries these names too, so a
    // loose match would keep passing after the visible credit broke.
    for (const name of ['Selka', '火山野牛王', '镜喵MirrorCat', '鱼松吃点吗']) {
      expect(R).toContain(`<b>${name}</b>`);
    }
    expect(R).toContain('https://space.bilibili.com/3546659724200757');
    expect(R).toContain('https://space.bilibili.com/16699168');
    expect(R).toContain('https://space.bilibili.com/25599535');
    expect(R).toContain('https://space.bilibili.com/3632319829116985');
  });

  it('acknowledges the three community members with clean Bilibili links', () => {
    for (const name of ['晶焰EXFire', '奕言君', '星灭散落']) expect(R).toContain(`<b>${name}</b>`);
    for (const mid of ['215541807', '397542864', '671142687']) expect(R).toContain(`https://space.bilibili.com/${mid}"`);
    expect(R).not.toContain('spm_id_from');
  });

  it('carries the contact email', () => {
    expect(R).toContain('selka.craft@outlook.com');
  });

  it('gives a verified quick-start matching package.json scripts', () => {
    expect(R).toContain('Node.js');
    expect(R).toContain('npm install');
    expect(R).toContain('npm run dev');
    expect(R).toContain('npm run test:run');
    expect(R).toContain('npm run lint');
    expect(R).toContain('npm run build');
  });

  it('names the headline features', () => {
    for (const feature of [
      'rule',
      'generator',
      'your own API key',
      '3D editor',
      'PetitGlyph',
      'autosave',
      'multilingual',
    ]) {
      expect(R.toLowerCase()).toContain(feature.toLowerCase());
    }
  });
});

describe('README.zh-CN.md — authored equivalent + parity', () => {
  const EN = read('README.md');
  const ZH = read('docs/README.zh-CN.md');

  it('exists and opens with a masthead, carrying the name in no heading', () => {
    expect(existsSync('docs/README.zh-CN.md')).toBe(true);
    expect((ZH.match(/^#\s/gm) ?? []).length).toBe(0);
    expect(ZH.slice(0, 600)).toMatch(/<img[^>]*\balt="[^"]*谷地工坊/);
  });

  it('cross-links back to the English README', () => {
    expect(ZH).toContain('README.md');
  });

  it('carries the same contact + affiliation disclaimer (米哈游/HoYoverse)', () => {
    expect(ZH).toContain('selka.craft@outlook.com');
    expect(ZH).toContain('米哈游');
    expect(ZH).toMatch(/HoYoverse/);
  });

  it('links to the same set of legal docs as the English README (paths differ by depth)', () => {
    // EN README is at the repo root; the ZH README now lives under docs/, so its
    // relative links to the root-level docs use ../ and to the docs/-level docs use ./.
    const enTargets = [
      './LICENSE',
      './SECURITY.md',
      './docs/ASSET_LICENSES.md',
      './docs/THIRD_PARTY_NOTICES.md',
      './CONTRIBUTING.md',
      './docs/CHANGELOG.md',
    ];
    const zhTargets = [
      '../LICENSE',
      '../SECURITY.md',
      './ASSET_LICENSES.md',
      './THIRD_PARTY_NOTICES.md',
      '../CONTRIBUTING.md',
      './CHANGELOG.md',
    ];
    for (const target of enTargets) expect(EN).toContain(`(${target})`);
    for (const target of zhTargets) expect(ZH).toContain(`(${target})`);
  });

  it('credits the same four contributors with the same Bilibili links', () => {
    for (const url of [
      'https://space.bilibili.com/3546659724200757',
      'https://space.bilibili.com/16699168',
      'https://space.bilibili.com/25599535',
      'https://space.bilibili.com/3632319829116985',
    ]) {
      expect(ZH).toContain(url);
    }
    for (const mid of ['215541807', '397542864', '671142687']) expect(ZH).toContain(`https://space.bilibili.com/${mid}"`);
    expect(ZH).not.toContain('spm_id_from');
  });

  it('has the same heading count as the English source', () => {
    expect(headingCount(ZH)).toBe(headingCount(EN));
  });
});

describe('public docs never reference the internal tree', () => {
  // Public-facing documents must not point readers toward files withheld from the export.
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
  for (const f of PUBLIC_DOCS) {
    it(`${f} does not mention docs/internal or scripts/internal`, () => {
      const body = read(f);
      expect(body).not.toContain('docs/internal');
      expect(body).not.toContain('scripts/internal');
    });
  }
});

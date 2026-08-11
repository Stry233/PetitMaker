import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { PREF_STORAGE_KEYS } from '../../core/runtime/prefs';

// Internal operational source documents (data inventory, retention
// schedule, asset-provenance ledger, consent-record README, release
// checklist). These are the documents the public legal texts are CHECKED
// AGAINST; never exported publicly.

const read = (p: string) => readFileSync(p, 'utf8');

const DATA_INVENTORY = 'docs/internal/legal/data-inventory.md';
const RETENTION_SCHEDULE = 'docs/internal/legal/retention-schedule.md';
const ASSET_PROVENANCE = 'docs/internal/legal/asset-provenance.md';
const CONSENTS_README = 'docs/internal/legal/consents/README.md';
const RELEASE_CHECKLIST = 'docs/internal/deployment/legal-release-checklist.md';

// docs/internal/legal/** and docs/internal/deployment/legal-release-checklist.md are
// internal-only — never exported to the public repo (see docs/internal/deployment/public-repo-manifest.md).
// This whole file ships publicly as part of tier 1's src/**, so every describe block below that
// reads one of these paths self-skips (rather than fails) when the file is absent — that's the
// public-repo state, not a regression. This repo (internal) always has them, so the real
// assertions still run and still gate here.
const ALL_OPS_DOCS = [DATA_INVENTORY, RETENTION_SCHEDULE, ASSET_PROVENANCE, CONSENTS_README, RELEASE_CHECKLIST];

describe('operational docs — existence', () => {
  // internal-repo-only check: skip if none of the internal docs are present (public-repo export)
  if (!ALL_OPS_DOCS.some((p) => existsSync(p))) {
    it.skip('internal-repo-only: docs/internal/legal/** + legal-release-checklist.md not present (public-repo export)', () => {});
  } else {
    it('all five files exist', () => {
      for (const p of ALL_OPS_DOCS) {
        expect(existsSync(p), `${p} should exist`).toBe(true);
      }
    });
  }
});

describe('legal-release-checklist.md — spec §17 gate list', () => {
  // internal-repo-only check: docs/internal/deployment/legal-release-checklist.md is never exported.
  if (!existsSync(RELEASE_CHECKLIST)) {
    it.skip('internal-repo-only: legal-release-checklist.md not present (public-repo export)', () => {});
    return;
  }
  const C = read(RELEASE_CHECKLIST);

  it('gates on no unresolved game-derived assets', () => {
    expect(C).toContain('game-derived');
  });

  it('requires headers verified live on ESA', () => {
    expect(C).toContain('verified live');
  });

  it('references the launch-blocker spec section for each major gate', () => {
    for (const ref of ['§5', '§8', '§10', '§11', '§13', '§16', '§21']) {
      expect(C).toContain(ref);
    }
  });

  it('names a verification command for the items that have one', () => {
    expect(C).toContain('legal:validate');
    expect(C).toContain('legal:licenses:check');
    expect(C).toContain('legal:headers:check');
  });

  it('flags the still-unimplemented verification paths rather than inventing them', () => {
    expect(C).toContain('asset-audit test');
    expect(C).toMatch(/export.{0,20}dry run|dry run.{0,20}export/i);
  });
});

describe('data-inventory.md — real storage keys', () => {
  // internal-repo-only check: docs/internal/legal/data-inventory.md is never exported.
  if (!existsSync(DATA_INVENTORY)) {
    it.skip('internal-repo-only: data-inventory.md not present (public-repo export)', () => {});
    return;
  }
  const D = read(DATA_INVENTORY);

  it('names every storage key PREFS declares', () => {
    // PREFS (src/core/runtime/prefs.ts) is the single declaration of every key this origin
    // persists; the inventory must name each one so this doc cannot drift silently as keys
    // are added, renamed or removed there.
    for (const key of PREF_STORAGE_KEYS) {
      expect(D, `data-inventory.md is missing storage key ${key}`).toContain(key);
    }
  });

  it('covers off-device categories: CDN/edge logs, email, AI-provider requests, Share Image data', () => {
    expect(D).toMatch(/CDN|edge/);
    expect(D).toMatch(/email/i);
    expect(D).toMatch(/AI-provider/);
    expect(D).toMatch(/Share Image/);
  });

  it('cross-checks against the privacy policy and reports its finding here (not silently editing privacy)', () => {
    expect(D).toMatch(/Cross-check/i);
    const privacy = read('src/legal/content/privacy.en.md');
    // The privacy doc is untouched by this task — its content is read, not written.
    expect(privacy).toContain('What We Store');
  });
});

describe('retention-schedule.md — spec §8 categories', () => {
  // internal-repo-only check: docs/internal/legal/retention-schedule.md is never exported.
  if (!existsSync(RETENTION_SCHEDULE)) {
    it.skip('internal-repo-only: retention-schedule.md not present (public-repo export)', () => {});
    return;
  }
  const R = read(RETENTION_SCHEDULE);

  it('marks provider-controlled rows explicitly', () => {
    expect(R).toContain('provider-controlled');
  });

  it('never uses "indefinitely" for anything other than aggregated/anonymized data', () => {
    // Any occurrence of "indefinit" must appear only alongside "aggregat" and
    // "anonymiz" reasoning in this document's Notes section.
    const hasIndefinite = /indefinit/i.test(R);
    if (hasIndefinite) {
      expect(R).toMatch(/aggregat/i);
      expect(R).toMatch(/anonymiz/i);
    }
  });

  it('carries the two default-period categories from spec §8', () => {
    expect(R).toContain('24 months');
    expect(R).toMatch(/life of the affected code/i);
    expect(R).toContain('12 months');
  });
});

describe('asset-provenance.md — spec §10 ledger', () => {
  // internal-repo-only check: docs/internal/legal/asset-provenance.md is never exported.
  if (!existsSync(ASSET_PROVENANCE)) {
    it.skip('internal-repo-only: asset-provenance.md not present (public-repo export)', () => {});
    return;
  }
  const A = read(ASSET_PROVENANCE);

  it('opens with a definite audit status, dated when closed', () => {
    // The status line drives the export gate, so what matters is that it states a status the
    // reader can act on. Which status it is changes as rows get resolved.
    expect(A).toMatch(/audit (OPEN|CLOSED)/i);
    if (/audit CLOSED/i.test(A)) expect(A).toMatch(/audit CLOSED, \d{4}-\d{2}-\d{2}/i);
    else expect(A).toMatch(/launch-gated/i);
  });

  it('parses as a table with the exact spec header fields', () => {
    const headerLine = A.split('\n').find((l: string) => l.trim().startsWith('| path |'));
    expect(headerLine, 'expected a markdown table header row starting with "| path |"').toBeTruthy();
    const cols = (headerLine as string)
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    expect(cols).toEqual([
      'path',
      'category',
      'creator/owner',
      'source',
      'permission basis',
      'modified',
      'redistribution allowed',
      'attribution required',
      'review date + reviewer',
    ]);
  });

  it('marks the known high-risk rows exactly as the spec requires', () => {
    // catalog sprites: pending per-file determination with 火山野牛王, permission basis none-yet
    expect(A).toContain('火山野牛王');
    expect(A).toMatch(/permission basis.{0,5}\|.{0,60}none-yet|none-yet/);
    // hexia/tafa: game-derived, none-yet
    expect(A).toContain('hexia.json');
    expect(A).toContain('tafa.json');
    // model3d: redrawn-referential pending review
    expect(A).toMatch(/redrawn-referential/);
    // fonts: licensed-third-party, cite the notices
    expect(A).toContain('licensed-third-party');
    expect(A).toContain('THIRD_PARTY_NOTICES.md');
  });

  it('covers every top-level src/assets asset group + map templates (glob-driven completeness)', () => {
    // Discover the real top-level asset groups from the filesystem rather than
    // hard-coding them, so a new asset directory fails this test until it is
    // ledgered.
    const groups: string[] = [];
    for (const top of readdirSync('src/assets', { withFileTypes: true })) {
      if (!top.isDirectory()) continue;
      if (top.name === 'icons') {
        for (const sub of readdirSync('src/assets/icons', { withFileTypes: true })) {
          if (sub.isDirectory()) groups.push(`icons/${sub.name}`);
        }
      } else {
        groups.push(top.name);
      }
    }
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      // Every group must be referenced by name somewhere in the ledger
      // (e.g. "fonts", "icons/catalog", "icons/ui").
      expect(A, `asset group "${g}" must have a ledger row`).toMatch(
        new RegExp(g.replace('/', '\\/')),
      );
    }
    // Map templates (src/config/maps/*.json) must each have a row.
    const mapFiles = readdirSync('src/config/maps').filter((f: string) => f.endsWith('.json'));
    expect(mapFiles.length).toBeGreaterThan(0);
    for (const f of mapFiles) {
      expect(A, `map template "${f}" must have a ledger row`).toContain(f);
    }
    // model3d specs (src/config/catalog/**) must be covered as a group.
    expect(A).toContain('model3d');
  });
});

describe('consents/README.md — record types + status table', () => {
  // internal-repo-only check: docs/internal/legal/consents/README.md is never exported.
  if (!existsSync(CONSENTS_README)) {
    it.skip('internal-repo-only: consents/README.md not present (public-repo export)', () => {});
    return;
  }
  const R = read(CONSENTS_README);

  it('defines what a consent record must contain', () => {
    for (const field of ['Who', 'What scope', 'Date', 'Evidence form']) {
      expect(R).toContain(field);
    }
  });

  it('gives a file-naming template', () => {
    expect(R).toMatch(/internal\/legal\/consents\/<type>-<slug>-<YYYY-MM-DD>\.md/);
  });

  it('names the three record types', () => {
    for (const type of ['relicensing', 'art-permission', 'credit']) {
      expect(R).toContain(type);
    }
  });

  it('tracks all six §21 human items, each either pending or closed by a filed record', () => {
    // 1 code-relicensing conclusion + 1 art-permission grant (火山野牛王) +
    // 4 team-credit consents (one per current member) = 6. Which ones are still open changes
    // over time; that all six are accounted for does not, so the count is what this pins.
    const pending = (R.match(/\*\*pending\*\*/g) ?? []).length;
    const closed = (R.match(/\*\*closed\*\*/g) ?? []).length;
    expect(pending + closed).toBe(6);
    // A closed row must name the record that closes it: this directory's own rule is that
    // nothing is closed by inference, so a bare "closed" would defeat the point.
    for (const row of (R.split('\n') as string[]).filter((l) => l.includes('**closed**'))) {
      expect(row, `closed row cites no record file: ${row}`).toMatch(/`[a-z-]+-[a-z-]+-\d{4}-\d{2}-\d{2}\.md`/);
    }
    for (const name of ['Selka', '火山野牛王', '镜喵MirrorCat', '鱼松吃点吗']) {
      expect(R).toContain(name);
    }
  });
});

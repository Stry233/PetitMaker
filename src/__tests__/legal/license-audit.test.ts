import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync, statSync } from 'node:fs';

// Minimal ambient shape for `process.cwd()` — this repo declares the node globals it uses locally,
// per file, rather than carrying an @types/node dependency.
declare const process: { cwd(): string };

import {
  computeClosure,
  auditPackages,
  renderNoticesMarkdown,
  expectedLicenseTreeFiles,
  FONT_ENTRIES,
  type LockJson,
} from '../../../scripts/license-audit-core.mts';

// A minimal, representative excerpt of this repo's own package-lock.json (lockfileVersion 3)
// shape: root "" holds the prod `dependencies` (never devDependencies); each package's own
// `dependencies` (never devDependencies) is what the closure walk follows.
const FIXTURE_LOCK: LockJson = {
  name: 'fixture',
  version: '0.0.0',
  lockfileVersion: 3,
  packages: {
    '': {
      dependencies: {
        react: '^18.3.1',
        zustand: '^4.5.5',
        three: '^0.169.0',
      },
      devDependencies: {
        vitest: '^2.1.8',
        typescript: '~5.6.2',
      },
    },
    'node_modules/react': {
      version: '18.3.1',
      license: 'MIT',
      dependencies: { 'loose-envify': '^1.1.0' },
    },
    'node_modules/loose-envify': {
      version: '1.4.0',
      license: 'MIT',
      dependencies: { 'js-tokens': '^3.0.0 || ^4.0.0' },
    },
    'node_modules/js-tokens': {
      version: '4.0.0',
      license: 'MIT',
    },
    'node_modules/zustand': {
      version: '4.5.7',
      license: 'MIT',
      dependencies: { 'use-sync-external-store': '^1.2.2' },
    },
    'node_modules/use-sync-external-store': {
      version: '1.2.2',
      license: 'MIT',
    },
    'node_modules/three': {
      version: '0.169.0',
      license: 'MIT',
    },
    // Dev-only tooling: present in the lockfile (installed), reachable ONLY via root
    // devDependencies, never via any prod package's own `dependencies` — must NOT appear
    // in the closure.
    'node_modules/vitest': {
      version: '2.1.8',
      license: 'MIT',
      dev: true,
      dependencies: { chai: '^5.1.2' },
    },
    'node_modules/chai': {
      version: '5.1.2',
      license: 'MIT',
      dev: true,
    },
    'node_modules/typescript': {
      version: '5.6.3',
      license: 'Apache-2.0',
      dev: true,
    },
  },
};

describe('computeClosure', () => {
  const closure = computeClosure(FIXTURE_LOCK);
  const names = closure.map((c) => c.name);

  it('includes root prod dependencies', () => {
    expect(names).toContain('react');
    expect(names).toContain('zustand');
    expect(names).toContain('three');
  });

  it('includes transitive prod dependencies reached via each package\'s own dependencies', () => {
    expect(names).toContain('loose-envify');
    expect(names).toContain('js-tokens');
    expect(names).toContain('use-sync-external-store');
  });

  it('excludes dev-only tooling never reachable via prod dependencies', () => {
    expect(names).not.toContain('vitest');
    expect(names).not.toContain('chai');
    expect(names).not.toContain('typescript');
  });

  it('resolves each entry to its lockfile version', () => {
    const react = closure.find((c) => c.name === 'react');
    expect(react?.version).toBe('18.3.1');
    const three = closure.find((c) => c.name === 'three');
    expect(three?.version).toBe('0.169.0');
  });
});

describe('auditPackages (against this repo\'s real node_modules)', () => {
  it('reads version/license/homepage from a real installed package.json', () => {
    const closure = computeClosure(FIXTURE_LOCK).filter((c) => c.name === 'react');
    const audits = auditPackages(closure, { rootDir: process.cwd() });
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    if (!audit) throw new Error('expected one audit entry');
    expect(audit.name).toBe('react');
    expect(audit.license).toBe('MIT');
    expect(audit.version).toMatch(/^18\./);
  });

  it('finds a LICENSE-like file for a real installed package', () => {
    const closure = computeClosure(FIXTURE_LOCK).filter((c) => c.name === 'react');
    const audits = auditPackages(closure, { rootDir: process.cwd() });
    const [audit] = audits;
    if (!audit) throw new Error('expected one audit entry');
    expect(audit.licenseFile).toBeTruthy();
    expect(existsSync(audit.licenseFile!)).toBe(true);
  });
});

describe('renderNoticesMarkdown', () => {
  it('includes a fonts section with a subsetting finding per font', () => {
    const md = renderNoticesMarkdown([], FONT_ENTRIES);
    expect(md).toContain('## Fonts');
    for (const font of FONT_ENTRIES) {
      expect(md).toContain(font.displayName);
      expect(md).toMatch(/Subsetting permitted:/);
    }
  });
});

// ---------------------------------------------------------------------------
// Standing drift-guard (integration): the REAL lockfile's closure must be fully
// represented, at the correct version, in the COMMITTED THIRD_PARTY_NOTICES.md —
// this is what `npm run legal:licenses:check` also verifies, but as a plain vitest
// assertion it runs on every `npm run test:run` with no build/CLI step required.
// ---------------------------------------------------------------------------

describe('THIRD_PARTY_NOTICES.md — standing drift guard', () => {
  const lock: LockJson = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const closure = computeClosure(lock);
  const notices = readFileSync('docs/THIRD_PARTY_NOTICES.md', 'utf8');

  it('lists every closure package at its lockfile version', () => {
    const missing: string[] = [];
    for (const entry of closure) {
      const rowNeedle = `| ${entry.name} | ${entry.version} |`;
      if (!notices.includes(rowNeedle)) missing.push(`${entry.name}@${entry.version}`);
    }
    expect(missing, `packages missing/stale in THIRD_PARTY_NOTICES.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('excludes dev-only tooling', () => {
    expect(notices).not.toMatch(/\|\s*vitest\s*\|/);
    expect(notices).not.toMatch(/\|\s*typescript\s*\|/);
  });

  it('has a committed license file for every package that ships one', () => {
    const audits = auditPackages(closure, { rootDir: process.cwd() });
    const expected = expectedLicenseTreeFiles(audits);
    const missing = expected.filter((rel) => !existsSync(`licenses/${rel}`));
    expect(missing, `missing committed license files: ${missing.join(', ')}`).toEqual([]);
  });

  it('has non-empty committed LICENSE files for both font entries', () => {
    for (const font of FONT_ENTRIES) {
      const path = `licenses/${font.dirName}/LICENSE`;
      expect(existsSync(path), `${path} should exist`).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
    }
  });
});

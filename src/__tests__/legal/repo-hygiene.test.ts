import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, existsSync } from 'node:fs';
// @ts-ignore - node:child_process is untyped here (no @types/node)
import { execFileSync } from 'node:child_process';

// Minimal ambient shape for `process.cwd()` — matches this repo's existing convention (see
// license-audit.test.ts).
declare const process: { cwd(): string };

import {
  auditStatus,
  classifyPaths,
  AGENT_DOC_NAMES,
  AGENT_DOC_SCAN_EXEMPT,
  AI_ATTRIBUTION_MARKERS,
  ATTRIBUTION_SCAN_EXEMPT,
  planPublicSync,
  DENYLIST_SPOTCHECK,
  findAgentDocPointers,
  findAiAttribution,
  findByBasename,
  isProbablyText,
  findLeakedPaths,
  globToRegExp,
  isInternalPath,
  isPublicPath,
  matchesGlob,
  parseAssetProvenanceStatus,
  parseManifest,
  publicGitignore,
  selectPublicPaths,
  shouldRefuseVerify,
  type ManifestGlobs,
} from '../../../scripts/export-public-repo-core.mts';

// The allowlist and exporter must keep private documents and game-derived source material out of
// every public selection.

const MANIFEST_PATH = 'docs/internal/deployment/public-repo-manifest.md';

/** `git ls-files -z` — NUL-separated so non-ASCII filenames aren't quote-escaped by git. */
function gitTrackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-z'], { maxBuffer: 1024 * 1024 * 64 }) as { toString(enc: string): string };
  return out
    .toString('utf8')
    .split('\0')
    .filter((p: string) => p.length > 0);
}

function loadManifest(): ManifestGlobs {
  const markdown = readFileSync(MANIFEST_PATH, 'utf8');
  return parseManifest(markdown);
}

describe('public-repo-manifest.md — exists and parses', () => {
  // internal-repo-only checks: MANIFEST_PATH never ships publicly, so a public-repo export
  // self-skips the existence/parse checks rather than failing on ENOENT — same convention as
  // ops-docs.test.ts. The fixture-only test below doesn't touch the file, so it stays
  // unconditional.
  if (existsSync(MANIFEST_PATH)) {
    it('exists', () => {
      expect(() => readFileSync(MANIFEST_PATH, 'utf8')).not.toThrow();
    });

    it('contains all three fenced glob blocks, non-empty', () => {
      const manifest = loadManifest();
      expect(manifest.tier1.length).toBeGreaterThan(0);
      expect(manifest.tier23.length).toBeGreaterThan(0);
      expect(manifest.internal.length).toBeGreaterThan(0);
    });
  } else {
    it.skip('internal-repo-only: public-repo-manifest.md not present (public-repo export)', () => {});
  }

  it('throws a clear error when a fenced block is missing', () => {
    expect(() => parseManifest('# no fenced blocks here')).toThrow(/globs-tier1/);
  });
});

describe('public-repo-manifest.md — internal block carries the critical entries', () => {
  // The manifest is absent from exported trees. Guard collection-time reads so the remaining
  // fixture-based exporter tests can still run there.
  if (!existsSync(MANIFEST_PATH)) {
    it.skip('internal-repo-only: public-repo-manifest.md not present (public-repo export)', () => {});
    return;
  }
  const manifest = loadManifest();

  it('classifies CLAUDE.md as internal', () => {
    expect(isInternalPath('CLAUDE.md', manifest)).toBe(true);
    expect(isPublicPath('CLAUDE.md', manifest)).toBe(false);
  });

  it('classifies every AGENTS.md as internal, at the root and beside source that ships', () => {
    // The agent instructions are working notes: they name internal paths freely, and one sits
    // in nearly every module directory inside `src/**`, which tier 1 ships whole. The by-name
    // glob therefore has to WIN over the allowlist, which is what `withholdingGlobs` does.
    for (const path of [
      'AGENTS.md',
      'src/core/AGENTS.md',
      'src/ui/AGENTS.md',
      'scripts/internal/AGENTS.md',
      'src/some/module/added/later/AGENTS.md',
    ]) {
      expect(isInternalPath(path, manifest), `${path} must be internal`).toBe(true);
      expect(isPublicPath(path, manifest), `${path} must not be public`).toBe(false);
    }
    // The name is exact: a file that merely contains it still ships.
    expect(isPublicPath('src/ui/AGENTS.md.tsx', manifest)).toBe(true);
  });

  it('classifies docs/internal/design/** as internal (PSDs, in-game references, IP-sensitive)', () => {
    expect(isInternalPath('docs/internal/design/v2/some-file.psd', manifest)).toBe(true);
  });

  it('classifies docs/internal/superpowers/** as internal (specs/plans)', () => {
    expect(isInternalPath('docs/internal/superpowers/specs/2026-07-14-legal-docs-design.md', manifest)).toBe(true);
  });

  it('classifies docs/internal/legal/** as internal (operational docs, consent records)', () => {
    expect(isInternalPath('docs/internal/legal/data-inventory.md', manifest)).toBe(true);
    expect(isInternalPath('docs/internal/legal/consents/README.md', manifest)).toBe(true);
  });

  it('classifies docs/internal/deprecated/** as internal', () => {
    expect(isInternalPath('docs/internal/deprecated/PROPOSALS.md', manifest)).toBe(true);
  });

  it('classifies .claude/**, .superpowers/**, .shots-tmp/** as internal', () => {
    expect(isInternalPath('.claude/settings.json', manifest)).toBe(true);
    expect(isInternalPath('.superpowers/anything.md', manifest)).toBe(true);
    expect(isInternalPath('.shots-tmp/shot.png', manifest)).toBe(true);
  });

  it('classifies any .xlsx anywhere as internal (game-derived reference data)', () => {
    expect(isInternalPath('docs/internal/design/v2/multilingual.xlsx', manifest)).toBe(true);
    expect(isInternalPath('docs/internal/references/some-grid.xlsx', manifest)).toBe(true);
    expect(isInternalPath('random-nested/dir/whatever.xlsx', manifest)).toBe(true);
  });

  it('classifies all of scripts/internal/** as internal (one dev-tooling subtree, mirrors docs/internal/**)', () => {
    // The game-derived extractors, the dev-verification renderers, and the art-authoring
    // tooling all live under one subtree now, so the exclusion is a single glob.
    expect(isInternalPath('scripts/internal/extract-map.py', manifest)).toBe(true);
    expect(isInternalPath('scripts/internal/extract_ingame_icons.py', manifest)).toBe(true);
    expect(isInternalPath('scripts/internal/render-terrain.py', manifest)).toBe(true);
    expect(isInternalPath('scripts/internal/render-cuts.py', manifest)).toBe(true);
    expect(isInternalPath('scripts/internal/render-model.py', manifest)).toBe(true);
    expect(isInternalPath('scripts/internal/render-export.py', manifest)).toBe(true);
    expect(isInternalPath('scripts/internal/mock_layer.py', manifest)).toBe(true);
    expect(isInternalPath('scripts/internal/squircle.py', manifest)).toBe(true);
    // ...and the PUBLIC scripts at the scripts/ root are NOT internal:
    expect(isInternalPath('scripts/export-public-repo.mts', manifest)).toBe(false);
    expect(isInternalPath('scripts/license-audit.mts', manifest)).toBe(false);
  });

  it('leaves docs/ARCHITECTURE.md public (tier 3 default-included) and keeps the map-building rules internal', () => {
    expect(isPublicPath('docs/ARCHITECTURE.md', manifest)).toBe(true);
    expect(isInternalPath('docs/ARCHITECTURE.md', manifest)).toBe(false);
    // Game-derived building rules are withheld rather than grouped with public architecture docs.
    expect(isInternalPath('docs/internal/RULES.md', manifest)).toBe(true);
    expect(isPublicPath('docs/internal/RULES.md', manifest)).toBe(false);
    expect(isPublicPath('docs/RULES.md', manifest)).toBe(false);
  });

  it('classifies the deployment docs (esa-headers, manifest, checklist) as internal', () => {
    // Deployment records are withheld while the reusable export scripts remain public.
    expect(isInternalPath('docs/internal/deployment/esa-headers.md', manifest)).toBe(true);
    expect(isPublicPath('docs/internal/deployment/esa-headers.md', manifest)).toBe(false);
    expect(isInternalPath('docs/internal/deployment/public-repo-manifest.md', manifest)).toBe(true);
    expect(isPublicPath('docs/internal/deployment/public-repo-manifest.md', manifest)).toBe(false);
    expect(isInternalPath('docs/internal/deployment/legal-release-checklist.md', manifest)).toBe(true);
    expect(isPublicPath('scripts/export-public-repo-core.mts', manifest)).toBe(true);
    expect(isPublicPath('scripts/export-public-repo.mts', manifest)).toBe(true);
  });
});

describe('repo hygiene — every tracked file is classified', () => {
  // internal-repo-only check: needs the manifest to classify against — self-skip on export.
  if (!existsSync(MANIFEST_PATH)) {
    it.skip('internal-repo-only: public-repo-manifest.md not present (public-repo export)', () => {});
    return;
  }
  it('every `git ls-files` path matches at least one manifest glob, and no path matches both', () => {
    const manifest = loadManifest();
    const files = gitTrackedFiles();
    expect(files.length).toBeGreaterThan(0);
    const { unclassified, conflicting } = classifyPaths(files, manifest);
    expect(unclassified, `unclassified paths (file a tier before shipping):\n${unclassified.join('\n')}`).toEqual([]);
    expect(
      conflicting,
      `paths matching BOTH a public and an internal glob (manifest conflict):\n${conflicting.join('\n')}`
    ).toEqual([]);
  });
});

describe('repo hygiene — no source file hides from text search', () => {
  // grep and ripgrep classify a file containing a NUL byte as binary and print no matching lines
  // from it, so such a file answers no text search over the repo — including the searches the
  // guards in this suite and every audit are run with. Binary assets carry NUL bytes legitimately
  // and are the only exemption.
  const BINARY_EXT = /\.(?:png|jpg|webp|woff2|onnx)$/;

  it('no tracked file under src/, scripts/ or security/ contains a NUL byte', () => {
    const scanned = gitTrackedFiles().filter(
      (p) => /^(?:src|scripts|security)\//.test(p) && !BINARY_EXT.test(p),
    );
    expect(scanned.length).toBeGreaterThan(100); // the scan is real, not an empty filter
    const offenders = scanned.filter((p) => (readFileSync(p) as unknown as Uint8Array).includes(0));
    expect(
      offenders,
      'a NUL byte makes grep and ripgrep read the file as binary, so it returns no matches and '
      + 'goes missing from every text search over the repo. Write the byte as an escape — or, for '
      + `a newly tracked binary asset format, add its extension to BINARY_EXT:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('export leak check — re-derived independently of the copy step', () => {
  // Re-deriving the live selection requires the private manifest; fixture-only tests run without it.
  if (!existsSync(MANIFEST_PATH)) {
    it.skip('internal-repo-only: public-repo-manifest.md not present (public-repo export)', () => {});
    return;
  }

  it('the selected public path set contains no path matching an internal glob', () => {
    const manifest = loadManifest();
    const files = gitTrackedFiles();
    const toCopy = selectPublicPaths(files, manifest);
    expect(toCopy.length).toBeGreaterThan(0);
    const leaked = findLeakedPaths(toCopy, manifest);
    expect(leaked, `leaked internal path(s):\n${leaked.join('\n')}`).toEqual([]);
  });

  it('a planted AGENTS.md never lands in the output, wherever it sits', () => {
    const manifest = loadManifest();
    // A tracked-file list with agent docs planted at every shape they can take, including
    // inside `src/**`, which tier 1 ships whole.
    const planted = [
      'AGENTS.md',
      'CLAUDE.md',
      'src/x/AGENTS.md',
      'src/ui/shell/bars/AGENTS.md',
      'scripts/internal/AGENTS.md',
    ];
    const tracked = ['README.md', 'package.json', 'src/App.tsx', ...planted];
    const toCopy = selectPublicPaths(tracked, manifest);
    expect(toCopy).toEqual(['README.md', 'package.json', 'src/App.tsx']);
    // ...and each of the three later gates catches one that reached the output anyway.
    expect(findLeakedPaths(planted, manifest)).toEqual(planted);
    expect(findByBasename(planted, AGENT_DOC_NAMES)).toEqual(planted);
    expect(DENYLIST_SPOTCHECK).toContain('AGENTS.md');
  });

  it('no file the export would copy has a denied basename at any depth', () => {
    const toCopy = selectPublicPaths(gitTrackedFiles(), loadManifest());
    expect(findByBasename(toCopy, AGENT_DOC_NAMES)).toEqual([]);
  });

  it('none of the explicit denylist-spotcheck names are selected for copy', () => {
    const manifest = loadManifest();
    const files = gitTrackedFiles();
    const toCopy = new Set(selectPublicPaths(files, manifest));
    for (const denied of DENYLIST_SPOTCHECK) {
      const hit = [...toCopy].find((p) => p === denied || p.startsWith(`${denied}/`));
      expect(hit, `denylisted path "${denied}" must not be selected for copy (matched: ${hit})`).toBeUndefined();
    }
  });

  // The tracked-file sanity check applies only where the private repository files are present.
  if (existsSync('CLAUDE.md')) {
    it('known real internal files are excluded from the public selection', () => {
      const manifest = loadManifest();
      const files = gitTrackedFiles();
      const toCopy = new Set(selectPublicPaths(files, manifest));
      for (const real of [
        'CLAUDE.md',
        'docs/internal/legal/data-inventory.md',
        'docs/internal/legal/consents/README.md',
        'docs/internal/deployment/legal-release-checklist.md',
      ]) {
        expect(files).toContain(real); // sanity: the file really is tracked in this repo
        expect(toCopy.has(real), `${real} must not be in the public selection`).toBe(false);
      }
    });

    it('tracks nothing under .claude at all — per-developer tool state, not shared', () => {
      // Stronger than "excluded from the export": it is gitignored, so there is no
      // tracked file for a manifest mistake to leak in the first place.
      expect(gitTrackedFiles().filter((f) => f.startsWith('.claude/'))).toEqual([]);
      expect(readFileSync('.gitignore', 'utf8')).toMatch(/^\.claude\/$/m);
      // The export's denylist keeps naming it, so a re-added file would still be caught.
      expect(DENYLIST_SPOTCHECK).toContain('.claude');
    });
  } else {
    it.skip('internal-repo-only: CLAUDE.md not present (public-repo export)', () => {});
  }

  it('known real public files ARE included in the public selection', () => {
    const manifest = loadManifest();
    const files = gitTrackedFiles();
    const toCopy = new Set(selectPublicPaths(files, manifest));
    for (const real of [
      'LICENSE',
      'README.md',
      '.github/FUNDING.yml',
      'package.json',
      'docs/ARCHITECTURE.md',
      'docs/THIRD_PARTY_NOTICES.md',
      'docs/README.zh-CN.md',
      'docs/ASSET_LICENSES.zh-CN.md',
      'docs/CHANGELOG.zh-CN.md',
      'scripts/export-public-repo.mts',
      'scripts/export-public-repo-core.mts',
    ]) {
      expect(files).toContain(real);
      expect(toCopy.has(real), `${real} should be in the public selection`).toBe(true);
    }
  });
});

describe('AI-attribution guard — the snapshot carries no commit-trailer authorship', () => {
  // The public repository's history is created fresh per publish, so this repo's commit
  // trailers never reach it. A trailer pasted into a FILE would, so the export refuses one.
  it('finds a trailer wherever it appears in a copied file', () => {
    const hits = findAiAttribution([
      { path: 'docs/CHANGELOG.md', text: '## 0.1.0\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>\n' },
      { path: 'README.md', text: 'A map editor.\n' },
      { path: 'docs/notes.md', text: 'see 🤖 Generated with [Claude Code](https://claude.com/claude-code)' },
    ]);
    expect(hits.map((h) => h.path)).toEqual(['docs/CHANGELOG.md', 'docs/notes.md']);
    expect(hits[0]!.marker).toBe('Co-Authored-By: Claude');
  });

  it('exempts only the two files that hold the markers as data', () => {
    // Anything else on this list would be a hole in the guard.
    expect([...ATTRIBUTION_SCAN_EXEMPT].sort()).toEqual([
      'scripts/export-public-repo-core.mts',
      'src/__tests__/legal/repo-hygiene.test.ts',
    ]);
    expect(findAiAttribution([{ path: ATTRIBUTION_SCAN_EXEMPT[0]!, text: 'Co-Authored-By: Claude' }])).toEqual([]);
  });

  it('does not flag the product talking about LLM providers', () => {
    // src/agent/** and the privacy doc name providers legitimately; that is not authorship.
    const text = 'The AI Agent supports Anthropic (Claude), OpenAI, DeepSeek and a custom endpoint.';
    expect(findAiAttribution([{ path: 'src/agent/providers/defaults.ts', text }])).toEqual([]);
    expect(AI_ATTRIBUTION_MARKERS.every((m) => m.includes(':') || m.includes('['))).toBe(true);
  });

  it('treats binary content as having nothing to scan', () => {
    expect(isProbablyText(new Uint8Array([0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(false);
    expect(isProbablyText(new TextEncoder().encode('# README\n'))).toBe(true);
  });

  // internal-repo-only check: needs the manifest to know what would ship.
  if (!existsSync(MANIFEST_PATH)) {
    it.skip('internal-repo-only: public-repo-manifest.md not present (public-repo export)', () => {});
  } else {
    it('no file the manifest would publish carries a trailer today', () => {
      const files = selectPublicPaths(gitTrackedFiles(), loadManifest())
        .map((path) => ({ path, bytes: readFileSync(path) as unknown as Uint8Array }))
        .filter(({ bytes }) => isProbablyText(bytes))
        .map(({ path, bytes }) => ({ path, text: new TextDecoder().decode(bytes) }));
      expect(files.length).toBeGreaterThan(100);
      expect(findAiAttribution(files)).toEqual([]);
    });
  }
});

describe('agent-doc pointer guard — nothing that ships names an AGENTS.md', () => {
  // Shipped prose states the relevant fact directly instead of pointing to withheld instructions.
  it('finds a pointer wherever it appears in a copied file', () => {
    const hits = findAgentDocPointers([
      { path: 'src/ui/shell/Shell.tsx', text: '// layout rules: see AGENTS.md\n' },
      { path: 'docs/ARCHITECTURE.md', text: 'The stack is described in CLAUDE.md.\n' },
      { path: 'README.md', text: 'A map editor.\n' },
    ]);
    expect(hits.map((h) => h.path)).toEqual(['src/ui/shell/Shell.tsx', 'docs/ARCHITECTURE.md']);
    expect(hits[0]!.name).toBe('AGENTS.md');
  });

  it('exempts only the two files that hold the names as data', () => {
    expect([...AGENT_DOC_SCAN_EXEMPT].sort()).toEqual([
      'scripts/export-public-repo-core.mts',
      'src/__tests__/legal/repo-hygiene.test.ts',
    ]);
    expect(findAgentDocPointers([{ path: AGENT_DOC_SCAN_EXEMPT[0]!, text: 'AGENTS.md' }])).toEqual([]);
  });

  // internal-repo-only check: needs the manifest to know what would ship.
  if (!existsSync(MANIFEST_PATH)) {
    it.skip('internal-repo-only: public-repo-manifest.md not present (public-repo export)', () => {});
  } else {
    it('no file the manifest would publish names one today', () => {
      const files = selectPublicPaths(gitTrackedFiles(), loadManifest())
        .map((path) => ({ path, bytes: readFileSync(path) as unknown as Uint8Array }))
        .filter(({ bytes }) => isProbablyText(bytes))
        .map(({ path, bytes }) => ({ path, text: new TextDecoder().decode(bytes) }));
      expect(files.length).toBeGreaterThan(100);
      expect(findAgentDocPointers(files)).toEqual([]);
    });
  }
});

describe('applying a snapshot to the public checkout', () => {
  // internal-repo-only check: the plan consults the manifest.
  if (!existsSync(MANIFEST_PATH)) {
    it.skip('internal-repo-only: public-repo-manifest.md not present (public-repo export)', () => {});
  } else {
    const plan = (exported: string[], existing: string[], published: string[]) =>
      planPublicSync(exported, existing, published, loadManifest());

    it('leaves the public repository its own files, even after we have published over them', () => {
      // A previous snapshot can contain maintainer-owned files outside the export allowlist.
      const theirs = ['.github/workflows/codeql.yml', '.github/PULL_REQUEST_TEMPLATE.md', 'CODE_OF_CONDUCT.md'];
      const previousTree = ['README.md', ...theirs]; // the whole repo, as a tree always is
      const { deletions, foreign, orphaned } = plan(['README.md'], ['README.md', ...theirs], previousTree);
      expect(deletions).toEqual([]);
      expect(orphaned).toEqual([...theirs].sort());
      expect(foreign).not.toContain('.github/workflows/codeql.yml');
    });

    it('retires an issue template we published, since templates are ours', () => {
      const path = '.github/ISSUE_TEMPLATE/bug_report.yml';
      const { deletions, foreign } = plan(['README.md'], ['README.md', path], ['README.md', path]);
      expect(deletions).toEqual([path]);
      expect(foreign).toEqual([]);
    });

    it('retires a file we published that the snapshot no longer contains', () => {
      const { deletions, foreign } = plan(['README.md'], ['README.md', 'src/gone.ts'], ['README.md', 'src/gone.ts']);
      expect(deletions).toEqual(['src/gone.ts']); // ours by both signals
      expect(foreign).toEqual([]);
    });

    it('never deletes a path we did not publish, however public its shape', () => {
      // A maintainer adding src/theirs.ts publicly is not our file to remove.
      const { deletions, foreign } = plan(['src/a.ts'], ['src/a.ts', 'src/theirs.ts'], ['src/a.ts']);
      expect(deletions).toEqual([]);
      expect(foreign).toEqual(['src/theirs.ts']);
    });

    it('flags, rather than deletes, a file whose manifest entry has been removed', () => {
      const { deletions, orphaned } = plan([], ['docs/OLD_GUIDE.md'], ['docs/OLD_GUIDE.md']);
      expect(deletions).toEqual([]);
      expect(orphaned).toEqual(['docs/OLD_GUIDE.md']);
    });

    it('deletes nothing on a first publish', () => {
      const existing = ['README.md', 'docs/ARCHITECTURE.md', 'CODE_OF_CONDUCT.md'];
      const { deletions, foreign } = plan(['README.md'], existing, []);
      expect(deletions).toEqual([]);
      expect(foreign).toEqual(['CODE_OF_CONDUCT.md', 'docs/ARCHITECTURE.md']);
    });

    it('is a no-op plan when the public repo already matches', () => {
      const files = ['README.md', 'docs/ARCHITECTURE.md'];
      expect(plan(files, files, files)).toEqual({
        write: [...files].sort(), deletions: [], foreign: [], orphaned: [],
      });
    });

    it('deletes a path recorded as retired, which nothing else would', () => {
      // A path dropped from the allowlist reads as "not ours" and would stay published
      // forever; the retired list is how "delete it" gets recorded. Exercised against a
      // fixture so the case holds whatever the live manifest happens to be retiring.
      const retiring = { ...loadManifest(), retired: ['OLD_DOC.md'] };
      expect(planPublicSync([], ['OLD_DOC.md'], ['OLD_DOC.md'], retiring).deletions).toEqual(['OLD_DOC.md']);
      // Explicit enough to apply even to something we never published.
      expect(planPublicSync([], ['OLD_DOC.md'], [], retiring).deletions).toEqual(['OLD_DOC.md']);
      // And it does not fire while the path is still in the snapshot.
      expect(planPublicSync(['OLD_DOC.md'], ['OLD_DOC.md'], [], retiring).deletions).toEqual([]);
    });

    it('never proposes deleting a path the manifest calls internal', () => {
      const { deletions } = plan([], ['CLAUDE.md', 'docs/internal/x.md'], ['CLAUDE.md', 'docs/internal/x.md']);
      expect(deletions).toEqual([]);
    });
  }
});

describe('generated public .gitignore', () => {
  it('carries the ordinary node/editor ignores', () => {
    const gi = publicGitignore();
    for (const line of ['node_modules/', 'dist/', '*.local', '.idea/', '__pycache__/', 'coverage/']) {
      expect(gi).toContain(line);
    }
    expect(gi.endsWith('\n')).toBe(true);
  });

  // internal-repo-only check: needs the manifest to know what the internal names ARE.
  if (!existsSync(MANIFEST_PATH)) {
    it.skip('internal-repo-only: public-repo-manifest.md not present (public-repo export)', () => {});
  } else {
    it('names no internal path — a published .gitignore would otherwise map what is withheld', () => {
      const gi = publicGitignore();
      const names = loadManifest().internal
        .map((g) => g.replace(/\/\*\*$/, '').replace(/\*\*$/, ''))
        .filter((n) => !n.includes('*'));
      expect(names.length).toBeGreaterThan(4); // the list is real, not accidentally empty
      for (const name of names) {
        expect(gi, `${name} must not appear in the public .gitignore`).not.toContain(name);
      }
      // The guards that actually keep internal files out (allowlist copy, by-name denylist,
      // basename walk, the workflow's re-assertion) do not need one more that leaks structure.
      expect(gi).not.toMatch(/internal|CLAUDE|AGENTS|superpowers|claude/i);
    });
  }
});

describe('glob matcher — unit tests (minimal, documented limitations)', () => {
  it('matches an exact literal path', () => {
    expect(matchesGlob('CLAUDE.md', 'CLAUDE.md')).toBe(true);
    expect(matchesGlob('CLAUDE2.md', 'CLAUDE.md')).toBe(false);
  });

  it('"dir/**" matches anything nested under dir, not a sibling with the same prefix', () => {
    expect(matchesGlob('docs/internal/design/x.psd', 'docs/internal/design/**')).toBe(true);
    expect(matchesGlob('docs/internal/design/v2/deep/nested.png', 'docs/internal/design/**')).toBe(true);
    expect(matchesGlob('docs/internal/design-notes.md', 'docs/internal/design/**')).toBe(false);
  });

  it('"*" matches within one path segment only, never crossing "/"', () => {
    expect(matchesGlob('scripts/internal/render-terrain.py', 'scripts/internal/render-*.py')).toBe(true);
    expect(matchesGlob('scripts/internal/sub/render-terrain.py', 'scripts/internal/render-*.py')).toBe(false);
  });

  it('"**/*.ext" matches at any depth, including the repo root', () => {
    expect(matchesGlob('a.xlsx', '**/*.xlsx')).toBe(true);
    expect(matchesGlob('docs/internal/design/v2/a.xlsx', '**/*.xlsx')).toBe(true);
    expect(matchesGlob('a.xlsxx', '**/*.xlsx')).toBe(false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    expect(matchesGlob('a+b.md', 'a+b.md')).toBe(true);
    expect(matchesGlob('a.md', 'a+b.md')).toBe(false);
    expect(matchesGlob('aXb.md', 'a+b.md')).toBe(false);
  });

  it('documents an unsupported feature: "?" is treated as a literal character, not a wildcard', () => {
    // No manifest glob needs "?" — this pins the documented limitation rather than silently
    // treating it as a single-char wildcard.
    expect(globToRegExp('a?.md').source).toContain('\\?');
    expect(matchesGlob('ax.md', 'a?.md')).toBe(false);
    expect(matchesGlob('a?.md', 'a?.md')).toBe(true);
  });
});

// The asset-provenance audit gate: `--verify` refuses while the ledger's audit is open,
// so publish-readiness cannot be reached by forgetting to check it.
describe('asset-provenance audit gate', () => {
  const OPEN_FIXTURE = `**STATUS: audit OPEN, launch-gated.** No row below marked \`permission basis:
none-yet\` may ship.

| path | permission basis |
|---|---|
| a.png | none-yet |
| b.png | **permission basis: none-yet** — review pending |
| c.png | resolved |
`;

  const CLOSED_FIXTURE = `**STATUS: audit CLOSED, launch-cleared.** Every row below carries a
resolved permission basis.

| path | permission basis |
|---|---|
| a.png | created-for-project |
| b.png | licensed-third-party |
`;

  describe('parseAssetProvenanceStatus — pure parse (fixture strings)', () => {
    it('open form: reports open=true and counts only table-row "none-yet" cells', () => {
      // Both plain and annotated cells count; the prose occurrence above the table does not.
      expect(parseAssetProvenanceStatus(OPEN_FIXTURE)).toEqual({ open: true, noneYetCount: 2 });
    });

    it('closed form: reports open=false and zero none-yet rows', () => {
      expect(parseAssetProvenanceStatus(CLOSED_FIXTURE)).toEqual({ open: false, noneYetCount: 0 });
    });
  });

  describe('auditStatus — reads docs/internal/legal/asset-provenance.md under a repoRoot', () => {
    // Compare with the live private ledger only in a checkout that contains it.
    if (existsSync('docs/internal/legal/asset-provenance.md')) {
      it('reflects this (internal) repo\'s real ledger', () => {
        // A live integration check against the real file, not a fixture: whatever the ledger
        // says today, the reader must agree with it. The open/closed cases are covered by
        // fixtures elsewhere in this block, so this one only pins that the two stay in step.
        const status = auditStatus(process.cwd());
        const ledger = readFileSync('docs/internal/legal/asset-provenance.md', 'utf8') as string;
        expect(status.open).toBe(/audit OPEN/i.test(ledger));
        if (status.open) expect(status.noneYetCount).toBeGreaterThan(0);
      });
    } else {
      it.skip('internal-repo-only: docs/internal/legal/asset-provenance.md not present (public-repo export)', () => {});
    }

    it('absent file (no docs/internal/legal/ present) → {open: false, noneYetCount: 0}, not a throw', () => {
      // A tree without the private ledger has no internal audit gate to enforce.
      expect(auditStatus('/nonexistent-repo-root-for-audit-gate-test')).toEqual({
        open: false,
        noneYetCount: 0,
      });
    });
  });

  describe('shouldRefuseVerify — pure refusal rule', () => {
    it('refuses when open and --allow-open-audit is not passed', () => {
      expect(shouldRefuseVerify({ open: true, noneYetCount: 3 }, false)).toBe(true);
    });

    it('does not refuse when open but --allow-open-audit is passed', () => {
      expect(shouldRefuseVerify({ open: true, noneYetCount: 3 }, true)).toBe(false);
    });

    it('does not refuse when closed, regardless of the flag', () => {
      expect(shouldRefuseVerify({ open: false, noneYetCount: 0 }, false)).toBe(false);
      expect(shouldRefuseVerify({ open: false, noneYetCount: 0 }, true)).toBe(false);
    });
  });
});

// Pure export-manifest parsing, glob matching and file-set classification. The manifest content is
// authoritative; this module interprets it. Keeping these helpers outside the CLI lets tests import
// them without running copy operations or subprocesses.

// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, readFileSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Minimal glob matcher — intentionally small, no dependency added.
//
// Supported syntax:
//   - `**`  matches zero or more path segments (only meaningful as a whole segment, i.e.
//           preceded/followed by `/` or at a pattern boundary — `foo/**`, `**/foo`, `a/**/b`).
//   - `*`   matches zero or more characters WITHIN a single path segment (never crosses `/`).
//   - anything else is matched literally (regex metacharacters are escaped).
//
// NOT supported (by design — every manifest glob below avoids needing these): `?` single-char
// wildcard, brace expansion (`{a,b}`), character classes (`[abc]`), extglob, negation. If the
// manifest ever needs one of those, extend this matcher and its unit tests first.
// ---------------------------------------------------------------------------

const DOUBLESTAR_SLASH = ''; // placeholder for a leading/embedded "**/" segment
const SLASH_DOUBLESTAR = ''; // placeholder for a trailing "/**" segment
const BARE_DOUBLESTAR = ''; // placeholder for a standalone "**" with no adjacent slash

function escapeRegExpLiteral(s: string): string {
  // Escape regex metacharacters EXCEPT '*' and '/', which the steps below handle specially.
  // '?' IS escaped here (treated as a literal character, never a wildcard) — this matcher
  // intentionally doesn't support "?" single-char globbing; see the module doc comment.
  return s.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
}

/** Compile one manifest glob into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  let pattern = escapeRegExpLiteral(glob);
  // Order matters: consume the two-character "**/" / "/**" tokens before any leftover bare
  // "**", and consume all of those before turning remaining lone '*' into a char-class — a
  // placeholder pass keeps the '*' inside those replacements from being re-matched by the
  // later single-'*' step.
  pattern = pattern.split('**/').join(DOUBLESTAR_SLASH);
  pattern = pattern.split('/**').join(SLASH_DOUBLESTAR);
  pattern = pattern.split('**').join(BARE_DOUBLESTAR);
  pattern = pattern.split('*').join('[^/]*');
  pattern = pattern.split(DOUBLESTAR_SLASH).join('(?:.*/)?');
  pattern = pattern.split(SLASH_DOUBLESTAR).join('(?:/.*)?');
  pattern = pattern.split(BARE_DOUBLESTAR).join('.*');
  return new RegExp(`^${pattern}$`);
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => matchesGlob(path, g));
}

// ---------------------------------------------------------------------------
// Manifest parsing — reads the three fenced code blocks
// ```globs-tier1 / ```globs-tier23 / ```globs-internal from public-repo-manifest.md.
// ---------------------------------------------------------------------------

export interface ManifestGlobs {
  tier1: string[];
  tier23: string[];
  internal: string[];
  /** Paths removed by the next publish when present. Sync preserves unowned paths, so removals are
   *  explicit rather than inferred from the allowlist. Optional for manifests without retirements. */
  retired: string[];
}

function extractFencedBlock(markdown: string, info: string): string[] {
  const re = new RegExp('```' + info + '\\n([\\s\\S]*?)```', 'm');
  const match = re.exec(markdown);
  if (!match) {
    throw new Error(`public-repo-manifest.md: missing \`\`\`${info} fenced block`);
  }
  return (match[1] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

export function parseManifest(markdown: string): ManifestGlobs {
  return {
    tier1: extractFencedBlock(markdown, 'globs-tier1'),
    tier23: extractFencedBlock(markdown, 'globs-tier23'),
    internal: extractFencedBlock(markdown, 'globs-internal'),
    retired: extractFencedBlock(markdown, 'globs-retired'),
  };
}

/** All globs that mark a path as belonging in the public export (tier 1 ∪ tier 2/3). */
export function publicGlobs(manifest: ManifestGlobs): string[] {
  return [...manifest.tier1, ...manifest.tier23];
}

// A leading doublestar segment withholds matching basenames inside otherwise-public trees. These
// patterns take precedence over the allowlist.
//
// Every other internal glob names its own path, which no public glob should also claim, so an
// overlap there stays reported as a manifest authoring bug (`classifyPaths`). The cost of this
// shape is that a careless by-name entry would silently withhold something meant to ship,
// which is why the "known real public files ARE included" check exists.
function withholdingGlobs(manifest: ManifestGlobs): string[] {
  return manifest.internal.filter((g) => g.startsWith('**/'));
}

export function isPublicPath(path: string, manifest: ManifestGlobs): boolean {
  if (matchesAny(path, withholdingGlobs(manifest))) return false;
  return matchesAny(path, publicGlobs(manifest));
}

export function isInternalPath(path: string, manifest: ManifestGlobs): boolean {
  return matchesAny(path, manifest.internal);
}

/**
 * Every tracked path must be classified as public XOR internal. Returns:
 *   - unclassified: matches neither list (hygiene bug — a new file was never filed into a tier)
 *   - conflicting: matches BOTH a public glob and an internal glob (manifest authoring bug —
 *     an internal glob is unintentionally shadowing something meant to ship, or vice versa)
 */
export function classifyPaths(
  paths: readonly string[],
  manifest: ManifestGlobs
): { unclassified: string[]; conflicting: string[] } {
  const unclassified: string[] = [];
  const conflicting: string[] = [];
  for (const p of paths) {
    const pub = isPublicPath(p, manifest);
    const int = isInternalPath(p, manifest);
    if (pub && int) conflicting.push(p);
    else if (!pub && !int) unclassified.push(p);
  }
  return { unclassified, conflicting };
}

/** The subset of `paths` that should be copied into the public export. */
export function selectPublicPaths(paths: readonly string[], manifest: ManifestGlobs): string[] {
  return paths.filter((p) => isPublicPath(p, manifest));
}

/** Copied paths that also match an internal glob. */
export function findLeakedPaths(copiedPaths: readonly string[], manifest: ManifestGlobs): string[] {
  return copiedPaths.filter((p) => isInternalPath(p, manifest));
}

/** Internal paths checked directly in the produced snapshot. */
export const DENYLIST_SPOTCHECK: readonly string[] = [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/internal',
  'docs/internal/PRD.md',
  'docs/internal/deprecated/build.md',
  'docs/internal/deprecated/EXTENSIBILITY.md',
  'docs/internal/deprecated/CODE_REVIEW.md',
  'docs/internal/superpowers',
  'docs/internal/design',
  'docs/internal/deprecated',
  'docs/internal/legal',
  'docs/internal/references',
  'docs/internal/deployment',
  'docs/internal/deployment/legal-release-checklist.md',
  '.claude',
  '.superpowers',
  '.shots-tmp',
  'scripts/internal',
];

/** Withheld instruction-document basenames, checked at every output depth. */
export const AGENT_DOC_NAMES: readonly string[] = ['AGENTS.md', 'CLAUDE.md'];

/** Paths in `paths` whose basename is one of `names`. */
export function findByBasename(paths: readonly string[], names: readonly string[]): string[] {
  return paths.filter((p) => names.includes(p.slice(p.lastIndexOf('/') + 1)));
}

/** Files that necessarily hold instruction-document names as scanner data. */
export const AGENT_DOC_SCAN_EXEMPT: readonly string[] = [
  'scripts/export-public-repo-core.mts',
];

/** Finds shipped files that point at a withheld instruction document. */
export function findAgentDocPointers(
  files: ReadonlyArray<{ path: string; text: string }>,
): Array<{ path: string; name: string }> {
  const hits: Array<{ path: string; name: string }> = [];
  for (const { path, text } of files) {
    if (AGENT_DOC_SCAN_EXEMPT.includes(path)) continue;
    const name = AGENT_DOC_NAMES.find((n) => text.includes(n));
    if (name) hits.push({ path, name });
  }
  return hits;
}

/**
 * Commit-trailer style AI attribution. The public repository's history is created fresh
 * by the publish workflow, so the private repo's trailers never reach it — but a trailer
 * pasted into a FILE (a changelog entry, a doc quoting a commit) would, so the export
 * refuses to copy one. Authorship is declared once, in the project's own documents,
 * rather than repeated per commit.
 *
 * Matches the trailer/footer forms only. The product legitimately talks about LLM
 * providers (src/agent/**, the privacy doc's provider list), and none of that is
 * attribution, so the word "Claude" alone is not a marker.
 */
export const AI_ATTRIBUTION_MARKERS: readonly string[] = [
  'Co-Authored-By: Claude',
  'Co-authored-by: Claude',
  'Generated with [Claude Code]',
  'Co-Authored-By: Codex',
  'Co-authored-by: Codex',
];

/**
 * What applying a snapshot to the public checkout must do, decided per existing path.
 *
 * The public repository is not a mirror of this one. It keeps its own history and may
 * hold files that were never here — issue templates, a funding file, a code of conduct,
 * anything added through GitHub's UI — and those must survive a publish. Deleting
 * nothing is equally wrong, because a file this repository published and later dropped
 * would stay published forever.
 *
 * A path is ours to retire only when BOTH signals agree: the previous publish commit
 * contained it, AND the manifest still calls it public. Either alone is wrong. The
 * publish commit's TREE is the whole repository at that moment, so it lists the
 * maintainer's own files too (taking it as the ownership signal deletes their bug-report
 * template); the manifest alone would let us delete a file we never put there. Requiring
 * both means the only thing a sync can remove is something it once wrote and no longer ships.
 *
 * The residue is reported rather than guessed at: a path we published whose manifest entry
 * has since been removed is `orphaned` — still published, no longer claimed, so a
 * maintainer decides. A first publish (no previous publish commit) deletes nothing.
 */
export interface PublicSyncPlan {
  /** Files the snapshot provides (copied over whatever is there). */
  write: string[];
  /** Published by us, still manifest-public, absent from this snapshot → delete. */
  deletions: string[];
  /** Never published by us → untouched. */
  foreign: string[];
  /** Published by us, but the manifest no longer claims it → left, needs a decision. */
  orphaned: string[];
}

export function planPublicSync(
  exported: readonly string[],
  existing: readonly string[],
  previouslyPublished: readonly string[],
  manifest: ManifestGlobs,
): PublicSyncPlan {
  const snapshot = new Set(exported);
  const ours = new Set(previouslyPublished);
  const deletions: string[] = [];
  const foreign: string[] = [];
  const orphaned: string[] = [];
  for (const path of existing) {
    if (snapshot.has(path)) continue;
    // A recorded removal is a decision already taken, so it outranks every other rule.
    if (matchesAny(path, manifest.retired)) { deletions.push(path); continue; }
    // A path the manifest calls INTERNAL cannot have been published by us, so its presence
    // in our tree only means it was in the repository when we committed — it is the public
    // repository's own (this is what `.github/ISSUE_TEMPLATE/**` looks like from here).
    if (!ours.has(path) || isInternalPath(path, manifest)) foreign.push(path);
    else if (isPublicPath(path, manifest)) deletions.push(path);
    else orphaned.push(path);
  }
  return {
    write: [...exported].sort(),
    deletions: deletions.sort(),
    foreign: foreign.sort(),
    orphaned: orphaned.sort(),
  };
}

/** The scanner itself carries attribution markers as data. */
export const ATTRIBUTION_SCAN_EXEMPT: readonly string[] = [
  'scripts/export-public-repo-core.mts',
];

/** Paths whose text contains an AI-attribution trailer, with the marker found. */
export function findAiAttribution(
  files: ReadonlyArray<{ path: string; text: string }>,
): Array<{ path: string; marker: string }> {
  const hits: Array<{ path: string; marker: string }> = [];
  for (const { path, text } of files) {
    if (ATTRIBUTION_SCAN_EXEMPT.includes(path)) continue;
    const marker = AI_ATTRIBUTION_MARKERS.find((m) => text.includes(m));
    if (marker) hits.push({ path, marker });
  }
  return hits;
}

/** Binary files have no trailers to find and must not be decoded as text. A NUL byte is
 *  the practical tell (no UTF-8 text file contains one). */
export function isProbablyText(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8192);
  for (let i = 0; i < limit; i++) if (bytes[i] === 0) return false;
  return true;
}

/** Public `.gitignore` containing general development ignores without private repository paths. */
export function publicGitignore(): string {
  return [
    '# Dependencies',
    'node_modules/',
    '',
    '# Build output',
    'dist/',
    '',
    '# Local env files',
    '*.local',
    '.env',
    '.env.*',
    '',
    '# Editor directories and files',
    '.vscode/*',
    '!.vscode/extensions.json',
    '.idea/',
    '*.suo',
    '*.ntvs*',
    '*.njsproj',
    '*.sln',
    '*.sw?',
    'tsconfig.tsbuildinfo',
    '',
    '# Logs and coverage',
    '*.log',
    'npm-debug.log*',
    'coverage/',
    '',
    '# OS files',
    '.DS_Store',
    'Thumbs.db',
    '',
    '# Python cache',
    '__pycache__/',
    '*.pyc',
    '',
  ].join('\n');
}
export interface AuditStatus {
  /** True unless the ledger has one CLOSED status and no unresolved permission rows. */
  open: boolean;
  /** Count of table rows whose permission-basis column is still "none-yet". */
  noneYetCount: number;
}

/** Parse the ledger status and count table rows with an unresolved permission basis. */
export function parseAssetProvenanceStatus(markdown: string): AuditStatus {
  const statuses = [...markdown.matchAll(/^\*\*STATUS:\s*audit\s+(\w+)\b/gim)];
  const noneYetCount = markdown.split(/\r?\n/).filter((line) => {
    if (!/^\s*\|.*\|\s*$/.test(line)) return false;
    return line.split('|').some((cell) => {
      const plain = cell.replace(/[*_`]/g, '').trim();
      return /^(?:permission basis:\s*)?none-yet\b/i.test(plain);
    });
  }).length;
  const open = statuses.length !== 1 || statuses[0]![1]!.toUpperCase() !== 'CLOSED' || noneYetCount > 0;
  return { open, noneYetCount };
}

/** Release verification needs the private ledger; ordinary public builds do not read it. */
export function auditStatus(repoRoot: string): AuditStatus {
  const path = join(repoRoot, 'docs', 'internal', 'legal', 'asset-provenance.md');
  if (!existsSync(path)) return { open: true, noneYetCount: 0 };
  return parseAssetProvenanceStatus(readFileSync(path, 'utf8'));
}

/** A successful verification requires both the review decision and complete permission rows. */
export function shouldRefuseVerify(status: AuditStatus): boolean {
  return status.open || status.noneYetCount > 0;
}

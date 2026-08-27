// Pure core of the license-audit pipeline: lockfile prod-dependency closure computation,
// per-package metadata/license-file discovery, and Markdown/tree rendering.
//
// Split from scripts/license-audit.mts (the CLI entry point) SPECIFICALLY so tests can import
// this module's exports (computeClosure, auditPackages, …) with zero CLI side effects — a
// main-module guard cannot do that job under `vite-node`, for the reason that file's doc
// comment gives. So there is NO CLI/`main()` logic and NO top-level side effect here: every
// function is pure or explicitly scoped I/O (auditPackages/writeLicenseTree read/copy real
// files, but never write THIRD_PARTY_NOTICES.md or exit the process).
//
// auditPackages/writeLicenseTree never print license file CONTENTS — only paths — and
// writeLicenseTree copies bytes via fs.copyFile rather than reading+re-writing text.

// @ts-ignore - node:fs is untyped here (no @types/node)
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
// @ts-ignore - node:fs/promises is untyped here (no @types/node)
import { copyFile } from 'node:fs/promises';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join } from 'node:path';

// Minimal ambient shape for the pieces of `process` this module uses — this repo declares the node
// globals it uses locally, per file, rather than adding an @types/node dependency.
declare const process: { cwd(): string };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockPackageInfo {
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dev?: boolean;
}

export interface LockJson {
  name?: string;
  version?: string;
  lockfileVersion?: number;
  packages: Record<string, LockPackageInfo>;
}

export interface ClosureEntry {
  /** Import/package name, e.g. "react" or "@anthropic-ai/sdk". */
  name: string;
  /** Path key into lock.packages, e.g. "node_modules/react". */
  path: string;
  version: string;
}

export interface PackageAudit {
  name: string;
  version: string;
  license: string;
  author: string;
  homepage: string;
  /** Absolute path to the first LICENSE / LICENCE / COPYING file found, if any. */
  licenseFile?: string;
  /** Absolute path to a shipped NOTICE file, if any. */
  noticeFile?: string;
}

export interface FontEntry {
  /** Directory name under licenses/. */
  dirName: string;
  displayName: string;
  license: string;
  copyright: string;
  source: string;
  /** One-line finding on whether subsetting/modification is permitted, cited from the license text. */
  subsettingFinding: string;
  /**
   * Optional one-line note on Reserved Font Name (RFN) compliance for a Modified Version
   * (OFL-1.1 clause 3: a Modified Version may not use the original's Reserved Font Name
   * without written permission).
   */
  rfnCompliance?: string;
}

// ---------------------------------------------------------------------------
// computeClosure — pure, no fs access. Walks root `dependencies` (never
// `devDependencies`) recursively through each resolved package's own
// `dependencies` (never its devDependencies), using node_modules nested-first
// resolution order (deepest ancestor first, then each ancestor up to the root).
// ---------------------------------------------------------------------------

function candidatePaths(fromPath: string, name: string): string[] {
  const candidates: string[] = [];
  let path = fromPath;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const base = path === '' ? '' : `${path}/`;
    candidates.push(`${base}node_modules/${name}`);
    if (path === '') break;
    const idx = path.lastIndexOf('/node_modules/');
    path = idx === -1 ? '' : path.slice(0, idx);
  }
  return candidates;
}

function resolvePackagePath(lock: LockJson, fromPath: string, name: string): string | undefined {
  for (const candidate of candidatePaths(fromPath, name)) {
    if (lock.packages[candidate]) return candidate;
  }
  return undefined;
}

/**
 * Runtime dependency closure: root `dependencies` (from package-lock.json's `packages[""]`),
 * followed recursively through each package's own `dependencies` — devDependencies (root or
 * nested) are never walked, so dev-only tooling (vitest, typescript, …) never enters the set
 * unless a PROD package itself depends on it (which would be unusual and is not special-cased).
 */
export function computeClosure(lock: LockJson): ClosureEntry[] {
  const root = lock.packages?.[''] ?? {};
  const seen = new Map<string, ClosureEntry>();
  const queue: Array<{ name: string; fromPath: string }> = Object.keys(root.dependencies ?? {}).map(
    (name) => ({ name, fromPath: '' })
  );

  while (queue.length > 0) {
    const { name, fromPath } = queue.shift()!;
    const path = resolvePackagePath(lock, fromPath, name);
    if (!path || seen.has(path)) continue;
    const pkg = lock.packages[path];
    if (!pkg) continue;
    seen.set(path, { name, path, version: pkg.version ?? '' });
    for (const depName of Object.keys(pkg.dependencies ?? {})) {
      queue.push({ name: depName, fromPath: path });
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// auditPackages — reads node_modules/<path>/package.json + the first LICENSE*-like
// file per closure entry, off this repo's own node_modules.
// ---------------------------------------------------------------------------

function normalizeLicense(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    if ('type' in raw && typeof (raw as { type?: unknown }).type === 'string') {
      return (raw as { type: string }).type;
    }
  }
  if (Array.isArray(raw)) {
    const parts = raw
      .map((entry) => (typeof entry === 'string' ? entry : (entry as { type?: string })?.type))
      .filter((v): v is string => typeof v === 'string');
    if (parts.length > 0) return parts.join(' OR ');
  }
  return '';
}

function normalizeAuthor(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as { name?: string; email?: string; url?: string };
    const parts = [obj.name, obj.email && `<${obj.email}>`, obj.url && `(${obj.url})`].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  }
  return '';
}

function findFirstMatch(dir: string, prefixes: string[]): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  for (const prefix of prefixes) {
    const hit = entries
      .filter((f) => f.toUpperCase().startsWith(prefix))
      .sort()
      .find((f) => {
        try {
          return statSync(join(dir, f)).isFile();
        } catch {
          return false;
        }
      });
    if (hit) return join(dir, hit);
  }
  return undefined;
}

export function auditPackages(closure: ClosureEntry[], opts: { rootDir?: string } = {}): PackageAudit[] {
  const rootDir = opts.rootDir ?? process.cwd();
  return closure.map((entry) => {
    const pkgDir = join(rootDir, entry.path);
    let pkgJson: Record<string, unknown> = {};
    try {
      pkgJson = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    } catch {
      // package.json missing/unreadable (shouldn't happen with a real install) — fall back
      // to lockfile-known version below, empty metadata otherwise.
    }
    const licenseFile = findFirstMatch(pkgDir, ['LICENSE', 'LICENCE', 'COPYING']);
    const noticeFile = findFirstMatch(pkgDir, ['NOTICE']);
    return {
      name: entry.name,
      version: typeof pkgJson.version === 'string' ? pkgJson.version : entry.version,
      license: normalizeLicense(pkgJson.license ?? pkgJson.licenses),
      author: normalizeAuthor(pkgJson.author),
      homepage: typeof pkgJson.homepage === 'string' ? pkgJson.homepage : '',
      licenseFile,
      noticeFile,
    };
  });
}

// ---------------------------------------------------------------------------
// Fonts section (static — fonts aren't npm packages, their license texts are
// fetched/verified manually; see licenses/{alibaba-puhuiti-3,quicksand}/LICENSE).
// ---------------------------------------------------------------------------

export const FONT_ENTRIES: FontEntry[] = [
  {
    dirName: 'alibaba-puhuiti-3',
    displayName: 'Alibaba PuHuiTi 3 (阿里巴巴普惠体 3.0)',
    license: 'Alibaba PuHuiTi 3.0 official license statement (proprietary, free-of-charge grant)',
    copyright: 'Alibaba (China) Co., Ltd. (阿里巴巴（中国）有限公司)',
    source:
      '[https://www.alibabafonts.com/](https://www.alibabafonts.com/) ; statement: ' +
      '[https://www.yuque.com/yiguang-wkqc2/puhuiti/nus9wiinq4aeiegy](https://www.yuque.com/yiguang-wkqc2/puhuiti/nus9wiinq4aeiegy)',
    subsettingFinding:
      'NOT clearly permitted. Clause 4(1) requires Alibaba’s written authorization to "拆分" (split) the font; ' +
      'this project ships the original, unmodified font files (no subsetting performed).',
  },
  {
    dirName: 'quicksand',
    displayName: 'Quicksand',
    license: 'SIL Open Font License 1.1 (OFL-1.1)',
    copyright:
      'Copyright 2011 The Quicksand Project Authors ' +
      '([https://github.com/andrew-paglinawan/QuicksandFamily](https://github.com/andrew-paglinawan/QuicksandFamily)), ' +
      'with Reserved Font Name "Quicksand"',
    source:
      '[https://github.com/google/fonts/blob/main/ofl/quicksand/OFL.txt](https://github.com/google/fonts/blob/main/ofl/quicksand/OFL.txt)',
    subsettingFinding:
      'Permitted. The OFL-1.1 grant ("Permission is hereby granted... to use, study, copy, merge, embed, ' +
      'modify, redistribute, and sell modified and unmodified copies of the Font Software") covers subsetting as ' +
      'a Modified Version, subject to condition 3) not reusing the Reserved Font Name on a modified copy.',
    rfnCompliance:
      'The shipped files are a Modified Version (variable→static instancing) and have been renamed to ' +
      '"PW Rounded Sans" in their name tables and in this project\'s CSS, in compliance with OFL-1.1 clause 3 ' +
      '(no reuse of the Reserved Font Name "Quicksand" on a Modified Version).',
  },
];

export interface VendoredEntry {
  /** Directory name under licenses/. */
  dirName: string;
  displayName: string;
  license: string;
  copyright: string;
  source: string;
  /** What of ours it is vendored into, so a reader can find it. */
  usedIn: string;
  /** Rights the license does NOT convey. Trademarks are the usual one. */
  rightsNotGranted: string;
}

// ---------------------------------------------------------------------------
// Vendored assets (static — copied into the source tree rather than installed,
// so the lockfile closure above cannot see them at all).
// ---------------------------------------------------------------------------

export const VENDORED_ENTRIES: VendoredEntry[] = [
  {
    dirName: 'lobe-icons',
    displayName: 'Lobe Icons (AI/LLM provider brand marks)',
    license: 'MIT',
    copyright: 'Copyright (c) 2023 LobeHub',
    source: '[https://github.com/lobehub/lobe-icons](https://github.com/lobehub/lobe-icons)',
    usedIn:
      'Single-colour provider silhouettes inlined as SVG path data in ' +
      '`src/ui/agent/logos.tsx`, shown beside the API-key field so a user can see which ' +
      'platform a key belongs to.',
    rightsNotGranted:
      'The MIT grant covers the icon collection, NOT the brand marks it depicts. Every provider ' +
      'name and logo is a trademark of its respective owner, reproduced here nominatively for ' +
      'identification only; no affiliation, sponsorship or endorsement is implied. Upstream states ' +
      'the same and advises reviewing each brand\'s own trademark guidelines before bundling.',
  },
];

// ---------------------------------------------------------------------------
// Rendering + writing
// ---------------------------------------------------------------------------

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderNoticesMarkdown(
  audits: PackageAudit[],
  fonts: FontEntry[] = FONT_ENTRIES,
  vendored: VendoredEntry[] = VENDORED_ENTRIES,
): string {
  const lines: string[] = [];
  lines.push('# Third-Party Notices');
  lines.push('');
  lines.push(
    'This project includes the following third-party open-source packages, resolved from the ' +
      'installed `package-lock.json` runtime dependency closure. **Generated by `scripts/license-audit.mts` ' +
      '(`npm run legal:licenses`). Do not hand-edit; regenerate instead.** Full upstream license texts are ' +
      'copied verbatim under `licenses/<package>/LICENSE`.'
  );
  lines.push('');
  lines.push('| Package | Version | License | Copyright / Author | Homepage |');
  lines.push('|---|---|---|---|---|');
  const sorted = [...audits].sort((a, b) => a.name.localeCompare(b.name));
  for (const a of sorted) {
    lines.push(
      `| ${escapeCell(a.name)} | ${escapeCell(a.version)} | ${escapeCell(a.license) || '—'} | ` +
        `${escapeCell(a.author) || '—'} | ${a.homepage ? escapeCell(a.homepage) : '—'} |`
    );
  }
  lines.push('');
  lines.push('## Fonts');
  lines.push('');
  lines.push(
    'Fonts are not npm packages and are not part of the lockfile closure above; their license texts are ' +
      'fetched and verified manually (never paraphrased) and recorded here.'
  );
  lines.push('');
  for (const f of fonts) {
    lines.push(`### ${f.displayName}`);
    lines.push('');
    lines.push(`- License: ${f.license}`);
    lines.push(`- Copyright: ${f.copyright}`);
    lines.push(`- Source: ${f.source}`);
    lines.push(`- Full text: \`licenses/${f.dirName}/LICENSE\``);
    lines.push(`- Subsetting permitted: ${f.subsettingFinding}`);
    if (f.rfnCompliance) lines.push(`- RFN compliance: ${f.rfnCompliance}`);
    lines.push('');
  }
  if (vendored.length) {
    lines.push('## Vendored assets');
    lines.push('');
    lines.push(
      'These are copied into the source tree rather than installed, so they are not part of the ' +
        'lockfile closure above and no dependency audit can discover them. Their license texts are ' +
        'fetched and verified manually and recorded here.'
    );
    lines.push('');
    for (const v of vendored) {
      lines.push(`### ${v.displayName}`);
      lines.push('');
      lines.push(`- License: ${v.license}`);
      lines.push(`- Copyright: ${v.copyright}`);
      lines.push(`- Source: ${v.source}`);
      lines.push(`- Full text: \`licenses/${v.dirName}/LICENSE\``);
      lines.push(`- Used in: ${v.usedIn}`);
      lines.push(`- Rights NOT granted: ${v.rightsNotGranted}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/** Relative (to the license-tree root) paths this audit set would produce, e.g. "react/LICENSE". */
export function expectedLicenseTreeFiles(audits: PackageAudit[]): string[] {
  const files: string[] = [];
  for (const a of audits) {
    if (a.licenseFile) files.push(join(a.name, 'LICENSE'));
    if (a.noticeFile) files.push(join(a.name, 'NOTICE'));
  }
  return files.sort();
}

export async function writeLicenseTree(audits: PackageAudit[], destRoot: string): Promise<void> {
  for (const a of audits) {
    const pkgDest = join(destRoot, a.name);
    if (a.licenseFile) {
      mkdirSync(pkgDest, { recursive: true });
      await copyFile(a.licenseFile, join(pkgDest, 'LICENSE'));
    }
    if (a.noticeFile) {
      mkdirSync(pkgDest, { recursive: true });
      await copyFile(a.noticeFile, join(pkgDest, 'NOTICE'));
    }
  }
}

export function filesEqual(a: string, b: string): boolean {
  try {
    return readFileSync(a).equals(readFileSync(b));
  } catch {
    return false;
  }
}

export function writeTextFile(path: string, contents: string): void {
  writeFileSync(path, contents, 'utf8');
}

export function fileExists(path: string): boolean {
  return existsSync(path);
}

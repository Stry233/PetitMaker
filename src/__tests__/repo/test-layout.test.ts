/**
 * Tests mirror `src/`: a test file sits in the folder of the source it covers, so a test of
 * `view/map3d/geometry/pick.ts` lives in `__tests__/view/map3d/geometry/`. A test covers its folder
 * when it loads a module from it, from below it or from a folder above it within its layer (an import,
 * a dynamic import or a `vi.mock`, directly or through a test helper), or names the folder or a path
 * in it as a string (a guard that reads the folder's source); a test at the root of `__tests__`
 * covers the entry files at the root of `src/`, and a browser journey (`.e2e.`) drives a page.
 * Folders that hold no single subject (shared builders, data, repository-wide checks, tests of the
 * shipped root scripts, browser journeys, timing benches) are named in `test-layout-allowlist.json`,
 * as is any single file that cannot follow the rule, each by repository path with its reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { REPO, SRC, loadedSpecifiers, parseSource, posix, resolveModule, srcRelative, walkFiles } from '../_support/source-graph';
import allowlist from './test-layout-allowlist.json';

// Parsing every test file is one long synchronous pass that outlasts the default timeout on a loaded machine.
vi.setConfig({ testTimeout: 60_000 });

const TESTS = join(SRC, '__tests__');
/** The public snapshot withholds the private tools and every `.internal.` test. */
const PRIVATE_TREE = existsSync(join(REPO, 'scripts', 'internal'));

/** A listed path relative to `__tests__/`, as the checks below read it. */
const underTests = (entries: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(entries).map(([path, reason]) => [path.replace(/^src\/__tests__\//, ''), reason]));
const ALLOW = { crossCutting: underTests(allowlist.crossCutting), files: underTests(allowlist.files) };

const FILES = walkFiles(TESTS, { accept: /\.test\.tsx?$/ }).map((full) => posix(relative(TESTS, full)));
const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();
const folderOf = (file: string): string => file.split('/').slice(0, -1).join('/');

/** The src-relative modules a test loads, itself or through the test helpers it loads. */
function subjectsOf(file: string, seen: Set<string> = new Set()): string[] {
  seen.add(file);
  const full = join(SRC, '__tests__', file);
  return loadedSpecifiers(full).filter((spec) => spec.startsWith('.')).flatMap((spec) => {
    const path = resolveModule(full, spec) ?? join(dirname(full), spec);
    const rel = srcRelative(path).replace(/\.tsx?$/, '').replace(/\/index$/, '');
    if (rel.startsWith('..')) return [];
    if (!rel.startsWith('__tests__/')) return [rel];
    const helper = srcRelative(path).slice('__tests__/'.length);
    return seen.has(helper) || !/\.tsx?$/.test(path) ? [] : subjectsOf(helper, seen);
  });
}

/** Every string of a test and every literal part of its templates, read as a src-relative path: a
 *  leading `src/` is dropped. */
function pathsNamed(file: string): string[] {
  const out: string[] = [];
  const add = (text: string): void => { out.push(text.split('?')[0]!.replace(/^\/?src\//, '').replace(/\/$/, '')); };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) add(node.text);
    else if (ts.isTemplateExpression(node)) for (const span of node.templateSpans) add(span.literal.text);
    ts.forEachChild(node, visit);
  };
  visit(parseSource(join(TESTS, file)));
  return out;
}

const within = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`);

/** Whether a test covers its own folder of `src/`; at the root, a root entry. */
function coversItsFolder(file: string): boolean {
  const folder = folderOf(file);
  if (/\.e2e\./.test(file)) return true;
  const subjects = subjectsOf(file);
  if (folder === '') return subjects.some((p) => !p.includes('/'));
  // A module in a folder above the test's (a door, or the module that drives the folder) also counts.
  const above = (p: string): boolean => {
    const dir = isDir(join(SRC, p)) ? p : folderOf(p);
    return dir !== '' && folder.startsWith(`${dir}/`);
  };
  return subjects.some((p) => within(p, folder) || above(p)) || pathsNamed(file).some((p) => within(p, folder));
}

/** Test files outside the cross-cutting folders. */
function mirrored(): string[] {
  const exempt = Object.keys(ALLOW.crossCutting);
  return FILES.filter((file) => !exempt.some((folder) => file.startsWith(`${folder}/`)));
}

describe('test layout', () => {
  it('places every test file in a folder that exists in src/', () => {
    const stray = mirrored().filter((file) => !(file in ALLOW.files) && !isDir(join(SRC, folderOf(file))));
    expect(stray).toEqual([]);
  });

  it('places every test file in the folder of a module it loads', () => {
    const elsewhere = mirrored().filter((file) => !(file in ALLOW.files) && !coversItsFolder(file));
    expect(elsewhere).toEqual([]);
  });

  // A cross-cutting folder may be absent from a tree that withholds its only tests, and so may an
  // internal test the public snapshot withholds.
  it('keeps the file exceptions current', () => {
    for (const file of Object.keys(ALLOW.files)) {
      if (file.includes('.internal.') && !PRIVATE_TREE) continue;
      expect(FILES, file).toContain(file);
      const follows = isDir(join(SRC, folderOf(file))) && coversItsFolder(file);
      expect(follows, `${file} now sits in its subject's folder`).toBe(false);
    }
  });
});

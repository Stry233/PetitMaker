/**
 * A stroke group closes only through its `Stroke` handle: the executor's commit, rollback, collapse
 * and command read by depth are its own steps. The type checker holds them private for typed
 * code; this holds them for the strings it never reads (page code harnesses send to a browser).
 *
 * A stroke group opens with `beginStroke()` only in the pointer tools and the editor operations; every
 * other editor path runs its group through `CommandExecutor.transaction`, which owns the rollback
 * on a throw.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { walkFiles } from '../../_support/source-graph';
import ALLOWLIST from './stroke-doors-allowlist.json';

const ROOT = resolve(__dirname, '../../../..');
const OWNER = 'src/core/commands/command-executor.ts';
const RAW = /\.(commitStroke|rollbackTo|collapseHistory|commandsSince)\(/g;
const BEGIN = /\.beginStroke\(/;
/** Folders of `src/` whose code may open a stroke group itself. */
const STROKE_OPENERS = ['src/tools/', 'src/editor/'];
/** Other `src/` paths (a file or a folder prefix) that open one, each with its reason in
 *  `stroke-doors-allowlist.json`. */
const OPENER_EXCEPTIONS: Readonly<Record<string, string>> = ALLOWLIST;

const sources = (dir: string): string[] => walkFiles(dir, { accept: /\.(?:[cm]?[jt]sx?)$/ });

describe('stroke doors', () => {
  it('leave the raw stroke steps to the executor', () => {
    const hits: string[] = [];
    for (const file of [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'scripts'))]) {
      const path = relative(ROOT, file).split('\\').join('/');
      if (path === OWNER || path === 'src/__tests__/core/commands/stroke-doors.test.ts') continue;
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(RAW)) hits.push(`${path}: ${m[1]}`);
    }
    expect(hits).toEqual([]);
  });

  it('open a stroke group only in the tools and the editor layer', () => {
    const hits: string[] = [];
    for (const file of sources(join(ROOT, 'src'))) {
      const path = relative(ROOT, file).split('\\').join('/');
      if (path === OWNER || path.startsWith('src/__tests__/')) continue;
      if ([...STROKE_OPENERS, ...Object.keys(OPENER_EXCEPTIONS)].some((p) => path === p || path.startsWith(p))) continue;
      if (BEGIN.test(readFileSync(file, 'utf8'))) hits.push(path);
    }
    expect(hits).toEqual([]);
  });

  it('list only exceptions that still open a stroke group', () => {
    const files = sources(join(ROOT, 'src')).map((file) => relative(ROOT, file).split('\\').join('/'));
    const stale = Object.keys(OPENER_EXCEPTIONS).filter((p) =>
      !files.some((path) => (path === p || path.startsWith(p)) && BEGIN.test(readFileSync(join(ROOT, path), 'utf8'))));
    expect(stale).toEqual([]);
  });
});

/**
 * The view folder layout and its engine boundaries.
 *
 * The root holds only the view seam; view-neutral code lives in a feature folder under `shared/`
 * and serves more than one view; the 2D view alone reaches PixiJS and the 3D view alone reaches
 * three.js, neither view imports the other, and each view's `geometry/` holds engine-free builders.
 * File names are kebab-case, React components excepted. Browser harnesses and Python tools name
 * view files by path, which the type-checker never sees, so every such path must still exist.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { REPO, SRC, allSpecifiers, posix, resolveSpec, resolvesIn, sourceFiles as listSources, sourceText, walkFiles } from '../_support/source-graph';

const VIEW = join(SRC, 'view');

/** Every source file the view root may hold besides its folders; instruction files are not source. */
const ROOT_FILES = ['active-view.ts', 'hover-target.ts', 'map-capture.ts', 'view-settled.ts'];
const ROOT_DIRS = ['interaction', 'map2d', 'map3d', 'shared'];

const PIXI = /^(?:pixi\.js(?:-legacy)?|@pixi\/)/;
const THREE = /^three(?:\/|$)/;
const sourceFiles = listSources();

/** Each import specifier of a source file, type-only ones included, with relative ones resolved to a
 *  src-relative path. */
const importsOf = (file: string): { spec: string; target: string | null }[] =>
  allSpecifiers(file).map((spec) => ({ spec, target: resolveSpec(file, spec) }));

/** The src-relative file an import target names, extension resolved, or null outside src. */
function fileOf(target: string): string | null {
  for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(join(SRC, target + ext))) return target + ext;
  return existsSync(join(SRC, target)) ? target : null;
}

const viewOf = (srcRel: string): 'map2d' | 'map3d' | null =>
  srcRel.startsWith('view/map2d/') ? 'map2d' : srcRel.startsWith('view/map3d/') ? 'map3d' : null;

describe('view structure', () => {
  it('the root holds only the view seam and the four folders', () => {
    const extra = readdirSync(VIEW).filter((name: string) => !name.endsWith('.md')).filter((name: string) => {
      const isDir = statSync(join(VIEW, name)).isDirectory();
      return isDir ? !ROOT_DIRS.includes(name) : !ROOT_FILES.includes(name);
    });
    expect(extra).toEqual([]);
  });

  it('every shared file sits in a feature folder', () => {
    const dir = join(VIEW, 'shared');
    const loose = existsSync(dir)
      ? readdirSync(dir).filter((name: string) => !statSync(join(dir, name)).isDirectory())
      : [];
    expect(loose).toEqual([]);
  });

  it('the root, interaction and shared code import no engine and no view', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = posix(relative(SRC, file));
      if (!rel.startsWith('view/') || viewOf(rel)) continue;
      for (const { spec, target } of importsOf(file)) {
        if (PIXI.test(spec) || THREE.test(spec) || (target && viewOf(target))) offenders.push(`${rel} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only the 2D view imports PixiJS and only the 3D view imports three.js', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = posix(relative(SRC, file));
      const view = viewOf(rel);
      for (const { spec } of importsOf(file)) {
        if (PIXI.test(spec) && view !== 'map2d') offenders.push(`${rel} -> ${spec}`);
        if (THREE.test(spec) && view !== 'map3d') offenders.push(`${rel} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no view file branches on a concrete tool: a tool answers through its own hooks', () => {
    const offenders = sourceFiles
      .map((file) => posix(relative(SRC, file)))
      .filter((rel) => rel.startsWith('view/') && /\bToolType\.\w/.test(sourceText(join(SRC, rel))));
    expect(offenders).toEqual([]);
  });

  it('the 2D and 3D views never import each other', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = posix(relative(SRC, file));
      const view = viewOf(rel);
      if (!view) continue;
      for (const { spec, target } of importsOf(file)) {
        const other = target ? viewOf(target) : null;
        if (other && other !== view) offenders.push(`${rel} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every view path a script names exists', () => {
    const scripts = walkFiles(join(REPO, 'scripts'), { accept: /\.(?:m?[jt]sx?|py)$/, skip: ['__tests__'] });
    const missing: string[] = [];
    for (const file of scripts) {
      const text = sourceText(file);
      for (const m of text.matchAll(/src\/view\/[\w./-]*[\w]/g)) {
        const path = join(REPO, m[0]);
        const found = resolvesIn(path, existsSync, ['.ts', '.tsx', '.d.ts']);
        if (!found) missing.push(`${posix(relative(REPO, file))}: ${m[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('a shared file serves more than one view', () => {
    const importers = new Map<string, Set<string>>();
    for (const file of sourceFiles) {
      const rel = posix(relative(SRC, file));
      for (const { target } of importsOf(file)) {
        const to = target && fileOf(target);
        if (to) (importers.get(to) ?? importers.set(to, new Set()).get(to)!).add(rel);
      }
    }
    /** The areas a file reaches through its importers, looking through other shared files. */
    const areas = (file: string, seen: Set<string> = new Set([file])): Set<string> => {
      const out = new Set<string>();
      for (const by of importers.get(file) ?? []) {
        if (!by.startsWith('view/shared/')) { out.add(viewOf(by) ?? 'other'); continue; }
        if (seen.has(by)) continue;
        seen.add(by);
        for (const a of areas(by, seen)) out.add(a);
      }
      return out;
    };
    // A type declaration and a Lite build replacement are reached by no import.
    const shared = sourceFiles.map((f) => posix(relative(SRC, f)))
      .filter((rel) => rel.startsWith('view/shared/') && !rel.endsWith('.d.ts') && !/-lite\.tsx?$/.test(rel));
    const oneView = shared.filter((rel) => { const a = areas(rel); return a.size === 1 && !a.has('other'); });
    expect(oneView).toEqual([]);
  });

  it("each view's geometry folder imports no engine", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const rel = posix(relative(SRC, file));
      if (!/^view\/map[23]d\/geometry\//.test(rel)) continue;
      for (const { spec } of importsOf(file)) if (PIXI.test(spec) || THREE.test(spec)) offenders.push(`${rel} -> ${spec}`);
    }
    expect(offenders).toEqual([]);
  });

  it('names files in kebab-case, React components in PascalCase', () => {
    const names = listSources(VIEW).filter((f) => !f.endsWith('.d.ts')).map((f) => posix(relative(SRC, f)));
    const odd = names.filter((rel) => {
      const base = rel.slice(rel.lastIndexOf('/') + 1);
      return !/^[a-z0-9]+(?:-[a-z0-9]+)*\.tsx?$/.test(base) && !/^[A-Z][A-Za-z0-9]*\.tsx$/.test(base);
    });
    expect(odd).toEqual([]);
  });
});

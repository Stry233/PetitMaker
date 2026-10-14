/**
 * Callers outside `tools/` reach every tools module through its door: the module's `index.ts`, or
 * its `facts.ts`, what a surface reads without the module's workings. Generation has more: the
 * recipe vocabulary, the kinds, `terrain-plan/`, the run and the `index.ts` of each generator and of
 * the carry. Peers inside `tools/` import implementation
 * files directly, never a module's `index.ts`, so no barrel closes a cycle.
 *
 * The pointer tools are the modules under `pointer/`; every other module is a library, which
 * never imports anything under `pointer/`.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC, allSpecifiers, resolveSpec, sourceFiles, srcRelative, subfolders } from '../_support/source-graph';

const POINTER = 'pointer';
/** Every module as its path under `tools/`: the library folders, and each folder of `pointer/`. */
const MODULES = [
  ...subfolders(join(SRC, 'tools')).filter((name) => name !== POINTER),
  ...subfolders(join(SRC, 'tools', POINTER)).map((name) => `${POINTER}/${name}`),
];
const LIBRARIES = MODULES.filter((name) => !name.startsWith(`${POINTER}/`));

const DOORS: ReadonlySet<string> = new Set(MODULES.flatMap((name) => [`tools/${name}`, `tools/${name}/facts`]));

/** Generation's further doors, which a caller outside `tools/` may also import. */
const GENERATION_DOORS: ReadonlySet<string> = new Set(
  ['/recipe', '/kinds', '/terrain-plan', '/run', '/designer', '/maze', '/stencil', '/transfer'].map((door) => `tools/generation${door}`),
);

/** A resolved target as its module path: no extension, and a folder's index as the folder. */
const modulePath = (target: string): string => target.replace(/\.(?:tsx?|js)$/, '').replace(/\/index$/, '');

function bypasses(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const from = srcRelative(file);
    if (from.startsWith('tools/')) continue;
    for (const spec of allSpecifiers(file)) {
      const target = resolveSpec(file, spec);
      if (target === null || !target.startsWith('tools/')) continue;
      if (!DOORS.has(modulePath(target)) && !GENERATION_DOORS.has(modulePath(target))) found.add(`${from} -> ${modulePath(target)}`);
    }
  }
  return [...found].sort();
}

describe('tools doors', () => {
  const found = bypasses();

  it('no file outside tools/ imports a tools module past its door', () => {
    expect(found, 'import through the module door').toEqual([]);
  });

  it('keeps peers inside tools/ off the doors, so no barrel closes a cycle', () => {
    // A facts module is no barrel, so only the index doors are off limits.
    const doors = new Set(MODULES.flatMap((name) => [`tools/${name}`, `tools/${name}/index`]));
    const offenders: string[] = [];
    for (const file of sourceFiles(join(SRC, 'tools'))) {
      const from = srcRelative(file);
      for (const spec of allSpecifiers(file)) {
        const target = resolveSpec(file, spec);
        if (target !== null && doors.has(target.replace(/\.(?:tsx?|js)$/, ''))) offenders.push(`${from} -> ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every library off the pointer tools', () => {
    const offenders: string[] = [];
    for (const name of LIBRARIES) {
      for (const file of sourceFiles(join(SRC, 'tools', name))) {
        for (const spec of allSpecifiers(file)) {
          const target = resolveSpec(file, spec);
          if (target?.startsWith(`tools/${POINTER}/`)) offenders.push(`${srcRelative(file)} -> ${target}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('holds only modules in pointer/', () => {
    expect(sourceFiles(join(SRC, 'tools', POINTER)).map(srcRelative).filter((f) => f.split('/').length < 4)).toEqual([]);
  });

  it('gives every tools module a door', () => {
    expect(MODULES.filter((name) => !sourceFiles(join(SRC, 'tools', name)).some((f) => srcRelative(f) === `tools/${name}/index.ts`))).toEqual([]);
  });
});

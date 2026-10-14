/**
 * Callers outside `io/` reach the share service through its documented entry point: `share/index.ts`,
 * or a light facts module (a `facts.ts` or `<name>-facts.ts` in the service) that carries constants
 * without pulling the service into the eager bundle. Peers inside `io/` import implementation files
 * directly and are not checked. The entry point carries nothing a facts module does, so a light
 * import never reaches the codec. The pipelines' doors are checked by `pipelines/doors.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { SRC, allSpecifiers, resolveSpec, sourceFiles, srcRelative } from '../_support/source-graph';

const SERVICES = ['io/share'] as const;

/** A resolved target as its module path: no extension, and a folder's index as the folder. */
const modulePath = (target: string): string => target.replace(/\.(?:tsx?|js|json)$/, '').replace(/\/index$/, '');

const serviceOf = (path: string) => SERVICES.find((s) => path === s || path.startsWith(`${s}/`));
const isDoor = (path: string) => (SERVICES as readonly string[]).includes(path) || /^io\/share\/(?:[a-z]+-)?facts$/.test(path);

function bypasses(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const from = srcRelative(file);
    if (from.startsWith('io/')) continue;
    for (const spec of allSpecifiers(file)) {
      const target = resolveSpec(file, spec);
      if (target === null) continue;
      const module = modulePath(target);
      if (serviceOf(module) && !isDoor(module)) found.add(`${from} -> ${module}`);
    }
  }
  return [...found].sort();
}

describe('io doors', () => {
  const found = bypasses();

  it('no file outside io/ imports share internals', () => {
    expect(found, 'import through the service entry or its facts module').toEqual([]);
  });

  it('keeps what a facts module carries out of the heavy entry point', () => {
    const shareFiles = sourceFiles(SRC).filter((f) => serviceOf(modulePath(srcRelative(f))) === 'io/share');
    const targetsOf = (file: string) => allSpecifiers(file).map((spec) => resolveSpec(file, spec)).filter((t): t is string => t !== null).map(modulePath);
    const entry = shareFiles.find((f) => modulePath(srcRelative(f)) === 'io/share')!;
    const facts = shareFiles.filter((f) => /^io\/share\/(?:[a-z]+-)?facts$/.test(modulePath(srcRelative(f))));
    const light = new Set([...facts.map((f) => modulePath(srcRelative(f))), ...facts.flatMap(targetsOf)]);
    expect(targetsOf(entry).filter((t) => light.has(t))).toEqual([]);
  });
});

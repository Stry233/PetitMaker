/**
 * A primitive is generic: it reads no store, no i18n and no game data (callers pass what it shows),
 * and at least two other production files use it, or it belongs with its one owner. A file another
 * primitive imports is a part of that primitive. Type-only imports are contracts and do not count
 * as reading.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC, allSpecifiers, resolveSpec, runtimeSpecifiers, sourceFiles, srcRelative } from '../../_support/source-graph';

type Clause = 'store' | 'i18n' | 'gameData' | 'users';
const CLAUSES: readonly Clause[] = ['store', 'i18n', 'gameData', 'users'];

const READS: Record<Exclude<Clause, 'users'>, RegExp> = {
  store: /^state\//,
  i18n: /^i18n\//,
  gameData: /^(?:config\/|core\/game\/)/,
};

const PRIMITIVES = 'ui/primitives/';
const moduleOf = (path: string) => path.replace(/\.(?:tsx?|js)$/, '').replace(/\/index$/, '');

function scan(): Record<Clause, string[]> {
  const files = sourceFiles(SRC);
  const found: Record<Clause, Set<string>> = { store: new Set(), i18n: new Set(), gameData: new Set(), users: new Set() };
  const users = new Map<string, Set<string>>();
  for (const file of files) {
    const from = srcRelative(file);
    if (from.startsWith(PRIMITIVES)) {
      for (const spec of runtimeSpecifiers(file)) {
        const target = resolveSpec(file, spec);
        if (target === null) continue;
        for (const clause of ['store', 'i18n', 'gameData'] as const) if (READS[clause].test(target)) found[clause].add(from);
      }
    }
    for (const spec of allSpecifiers(file)) {
      const target = resolveSpec(file, spec);
      if (target === null || !target.startsWith(PRIMITIVES)) continue;
      const module = moduleOf(target);
      if (module === moduleOf(from)) continue;
      if (!users.has(module)) users.set(module, new Set());
      users.get(module)!.add(from);
    }
  }
  for (const file of sourceFiles(join(SRC, 'ui/primitives'))) {
    const path = srcRelative(file);
    const by = [...(users.get(moduleOf(path)) ?? [])];
    if (!by.some((u) => u.startsWith(PRIMITIVES)) && by.length < 2) found.users.add(path);
  }
  return Object.fromEntries(CLAUSES.map((c) => [c, [...found[c]].sort()])) as Record<Clause, string[]>;
}

const found = scan();

describe('primitives contract', () => {
  it.each(CLAUSES)('no primitive breaks the %s clause', (clause) => {
    expect(found[clause], 'take it from the caller, or move the part to its owner').toEqual([]);
  });
});

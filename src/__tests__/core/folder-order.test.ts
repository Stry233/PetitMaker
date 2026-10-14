/**
 * Inside `src/core`, folders import downward in the order of `scripts/layers.mts:CORE_FOLDERS`: the
 * kernel, `base` (pure primitives) < `game` (the game profile) < `grid` < `provenance` < `model` <
 * `commands`, then the game's terrain domain, `domain/terrain` < `domain/edge-cut`. Type-only
 * imports count as edges, and none points up. A kernel folder names nothing in `domain/`: the executor reaches the terrain
 * domain only through the `StrokePolicy` `state/executor.ts` passes in.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC, allSpecifiers, resolveSpec, sourceFiles, srcRelative, subfolders } from '../_support/source-graph';
import { CORE_FOLDERS } from '../../../scripts/layers.mts';

const CORE = join(SRC, 'core');

const RANK = new Map<string, number>(CORE_FOLDERS.flatMap((group, i) => group.map((f): [string, number] => [f, i])));
const DOMAIN = 'domain';

/** The ranked folder a core-relative path lies in: its first segment, or its first two under `domain/`. */
const folderOf = (rel: string): string => {
  const [head, sub] = rel.split('/');
  return head === DOMAIN ? `${head}/${sub}` : head!;
};

/** Every folder core holds, as the ranking names them. */
function coreFolders(): string[] {
  const dirs = subfolders;
  return dirs(CORE).flatMap((name) => (name === DOMAIN ? dirs(join(CORE, DOMAIN)).map((sub) => `${DOMAIN}/${sub}`) : [name]));
}

/** Each upward edge inside core as `importer -> target`, core-relative, the target without extension. */
function upwardEdges(): string[] {
  const edges: string[] = [];
  for (const file of sourceFiles(CORE)) {
    const from = srcRelative(file).slice('core/'.length);
    for (const spec of allSpecifiers(file)) {
      const resolved = resolveSpec(file, spec);
      if (!resolved?.startsWith('core/')) continue;
      const to = resolved.slice('core/'.length).replace(/\.(?:tsx?|js)$/, '');
      if (RANK.get(folderOf(to))! > RANK.get(folderOf(from))!) edges.push(`${from} -> ${to}`);
    }
  }
  return edges;
}

describe('core folder order', () => {
  it('ranks every core folder', () => {
    expect(coreFolders().filter((f) => !RANK.has(f))).toEqual([]);
  });

  it('no kernel file names the terrain domain', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(CORE)) {
      const from = srcRelative(file).slice('core/'.length);
      if (from.startsWith(`${DOMAIN}/`)) continue;
      for (const spec of allSpecifiers(file)) {
        if (resolveSpec(file, spec)?.startsWith(`core/${DOMAIN}/`)) offenders.push(`${from} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no core file imports from a folder above its own', () => {
    expect(upwardEdges()).toEqual([]);
  });
});

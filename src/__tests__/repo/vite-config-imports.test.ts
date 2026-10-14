/**
 * Every module `vite.config.ts` loads names its relative imports with their file
 * extension, type-only ones included: Vite's native config loader hands the config to Node, which
 * resolves no extensionless path, and Vite flags type imports the same way.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { REPO, repoRelative, allSpecifiers } from '../_support/source-graph';

const SOURCE = /\.(?:m?ts|tsx)$/;
const WITH_EXTENSION = /\.(?:m?[jt]sx?|json)$/;

function configGraph(): { files: string[]; bare: string[] } {
  const seen = new Set<string>();
  const bare: string[] = [];
  const queue = [resolve(REPO, 'vite.config.ts')];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of allSpecifiers(file)) {
      if (!spec.startsWith('.')) continue;
      const path = spec.replace(/[?#].*$/, '');
      if (!WITH_EXTENSION.test(path)) { bare.push(`${repoRelative(file)}: ${spec}`); continue; }
      const target = resolve(dirname(file), path);
      if (SOURCE.test(target) && existsSync(target)) queue.push(target);
    }
  }
  return { files: [...seen].map(repoRelative), bare };
}

describe('vite config imports', () => {
  const graph = configGraph();

  it('follows the config into the source it loads', () => {
    expect(graph.files).toContain('src/platform/build/deploy-targets.ts');
  });

  it('name every relative import with its extension', () => {
    expect(graph.bare).toEqual([]);
  });
});

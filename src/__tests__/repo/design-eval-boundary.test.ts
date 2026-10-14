/**
 * The design evaluation (`_support/design-eval`) reads finished maps and lives with the tests, so no
 * shipped module reads it and a generator cannot tune to its own scorer. Map readings that stages and
 * the evaluation both need live in `tools/reading`, which imports no generator.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { SRC, allSpecifiers, resolveSpec, sourceFiles, srcRelative } from '../_support/source-graph';

const EVALUATION = '__tests__/_support/design-eval';

function importsInto(dir: string, target: (resolved: string) => boolean): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(join(SRC, dir))) {
    for (const spec of allSpecifiers(file)) {
      const resolved = resolveSpec(file, spec);
      if (resolved !== null && target(resolved)) out.push(`${srcRelative(file)} -> ${resolved}`);
    }
  }
  return out;
}

describe('designer evaluation boundary', () => {
  it('no shipped module imports the evaluation', () => {
    const offenders = importsInto('', (r) => r === EVALUATION || r.startsWith(`${EVALUATION}/`));
    expect(offenders).toEqual([]);
  });

  it('map readings import no generator', () => {
    expect(importsInto('tools/reading', (r) => r === 'tools/generation' || r.startsWith('tools/generation/'))).toEqual([]);
  });
});

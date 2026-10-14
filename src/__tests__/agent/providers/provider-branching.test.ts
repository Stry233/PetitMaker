/**
 * Per-provider behaviour is a `Quirks` field: code outside the provider tables compares a provider id
 * with no literal id but `custom`, the one provider whose host is the user's.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROVIDER_IDS } from '../../../agent/providers/defaults';
import { repoFiles } from '../../_support/source-graph';

const ROOTS = ['src/agent', 'src/ui/agent'];
/** The provider tables themselves, where each id names its own row. */
const TABLES = new Set(['src/agent/providers/defaults.ts']);

const files = (dir: string): string[] => repoFiles(dir);

describe('provider branching', () => {
  it('compares a provider id with no literal id but custom', () => {
    const ids = PROVIDER_IDS.filter((id) => id !== 'custom').join('|');
    const compare = new RegExp(`\\b(?:provider|providerId|id)\\s*[!=]==\\s*'(?:${ids})'`);
    const offenders = ROOTS.flatMap((root) => files(root))
      .filter((path) => !TABLES.has(path))
      .flatMap((path) => readFileSync(path, 'utf8').split('\n')
        .map((line, i) => (compare.test(line) ? `${path}:${i + 1}` : null))
        .filter((hit): hit is string => hit !== null));
    expect(offenders).toEqual([]);
  });
});

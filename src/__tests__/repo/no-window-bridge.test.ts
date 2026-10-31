/**
 * A shell drives the map through a typed surface. A `window.__petit*` bridge published by one canvas's
 * mount effect would make every view command depend on that canvas being mounted and every call site
 * an optional call.
 */
import { describe, it, expect } from 'vitest';
import { resolve, relative } from 'node:path';
import { sourceFiles, sourceText } from '../_support/source-graph';

describe('window bridge', () => {
  it('is gone', () => {
    const src = resolve(__dirname, '../..');
    const offenders: string[] = [];
    for (const full of sourceFiles(src)) {
      if (sourceText(full).includes('__petit')) offenders.push(relative(src, full));
    }
    expect(offenders.sort()).toEqual([]);
  });
});

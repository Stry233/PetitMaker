/**
 * Every lazy interface chunk of the web edition loads through one memoized loader, so the warm
 * schedule and the surface share the load. An inline `import()` at a `React.lazy` site would fetch
 * the same chunk through a second path the schedule never warms.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { walkFiles } from '../_support/source-graph';

const UI = resolve('src/ui');

const sources = (dir: string): string[] => walkFiles(dir, { skip: ['lite'] });

describe('the lazy interface chunks', () => {
  it('load through shared loaders, never an inline import at the lazy site', () => {
    const inline = sources(UI)
      .filter((file) => /\blazy\(\s*\(\)\s*=>\s*import\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(UI, file));
    expect(inline).toEqual([]);
  });

  it('are found by the walk, so a rename cannot quietly pass it', () => {
    const lazySites = sources(UI).filter((file) => /\blazy\(/.test(readFileSync(file, 'utf8')));
    expect(lazySites.length).toBeGreaterThanOrEqual(6);
  });
});

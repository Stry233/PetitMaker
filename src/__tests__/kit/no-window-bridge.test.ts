/**
 * A shell drives the map through a typed surface. `window.__petit*` was published by one canvas's
 * mount effect, so every view command in the app depended on that canvas being mounted, and every
 * call site carried an optional-call in place of a type.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join, resolve, relative } from 'node:path';

declare const __dirname: string;

describe('window bridge', () => {
  it('is gone', () => {
    const src = resolve(__dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) { if (name !== '__tests__') walk(full); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        if (readFileSync(full, 'utf8').includes('__petit')) offenders.push(relative(src, full));
      }
    };
    walk(src);
    expect(offenders.sort()).toEqual([]);
  });
});

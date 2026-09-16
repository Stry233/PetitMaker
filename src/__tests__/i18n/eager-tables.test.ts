/**
 * English is the only interface table on the eager bundle; the other six are their own chunks
 * (`i18n/locales/index.ts`). This is what keeps them off it: the merged record in
 * `i18n/translations.ts` is for tests and scripts, and the moment a module the app loads imports
 * it, all seven tables are back on the start-up payload — 155 KB gzip of the first paint.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join, resolve, relative } from 'node:path';
import { LOCALES } from '../../i18n/locales';

declare const __dirname: string;

const SRC = resolve(__dirname, '../..');
const LOCALES_DIR = join(SRC, 'i18n', 'locales');

/** An import of the merged record, whichever relative depth it is written from. */
const MERGED_IMPORT = /from '(?:[^']*\/)?translations'/;

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const toPosix = (file: string): string => file.replace(/\\/g, '/');

/** Every module the app can reach: `src` minus the test tree, which legitimately reads the merged
 *  record, and minus `locales/` itself, whose whole job is to hold the tables. */
const runtimeFiles = (): string[] => filesUnder(SRC).filter((file) => {
  const path = toPosix(file);
  return !path.includes('/__tests__/') && !path.includes('/i18n/locales/');
});

describe('eager interface tables', () => {
  it('nothing the app loads imports the merged record', () => {
    const offenders = runtimeFiles()
      .filter((file) => MERGED_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => toPosix(relative(SRC, file)));
    expect(offenders, 'read the table for the locale in hand, not all seven').toEqual([]);
  });

  it('the eager table set is English alone', () => {
    // `translateFor` falls back to English for every key a locale is missing, so it is the one table
    // that cannot arrive late. Anything else imported here is a chunk that stopped being a chunk.
    const context = readFileSync(join(SRC, 'i18n', 'context.tsx'), 'utf8');
    const eager = [...context.matchAll(/from '\.\/locales\/([a-z]+)'/g)].map((m) => m[1]);
    expect(eager).toEqual(['en']);
  });

  it('every table on disk is one the loader can fetch', () => {
    // Adding `de.ts` without listing it in LOCALES (settings) and LOADERS (the fetch) would leave a
    // language that can be read but never loaded.
    const onDisk = readdirSync(LOCALES_DIR)
      .filter((name) => /^[a-z]{2}\.ts$/.test(name))
      .map((name) => name.slice(0, -3))
      .sort();
    expect([...LOCALES].sort()).toEqual(onDisk);
    const loader = readFileSync(join(LOCALES_DIR, 'index.ts'), 'utf8');
    for (const locale of onDisk) {
      if (locale === 'en') continue;
      expect(loader, `${locale} has a table but no loader`).toContain(`import('./${locale}')`);
    }
  });
});

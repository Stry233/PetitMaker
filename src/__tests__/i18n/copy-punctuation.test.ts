/**
 * No dot separator (· or •) and no em dash in the app's copy: facts join with the locale's own
 * punctuation or split into lines. Locale strings are checked for both marks; source that writes text
 * inline is scanned for dot separators outside comments, where a dot may stand for arithmetic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { translations } from '../../i18n/translations';
import { HELP_TABLES } from '../_support/locale-tables';
import { repoFiles } from '../_support/source-graph';

// Vitest runs from the repo root.
const REPO = process.cwd();

const DOTS = ['·', '•'];
const EM_DASH = '—';

/** Every locale table the app reads, the help chunk's included. */
const TABLES: [string, Record<string, string>][] = [
  ...Object.entries(translations),
  ...Object.entries(HELP_TABLES).map(([locale, table]): [string, Record<string, string>] => [`${locale} help`, table]),
];

/** Where text can be written inline: all of `src/` but its tests, plus the generator of the public
 *  legal pages, the one shipped surface no locale table covers. */
const ROOTS = ['src', 'scripts/legal-pages-core.mts'];

const walk = (dir: string, out: string[]): void => { out.push(...repoFiles(dir, { accept: /\.(ts|tsx|mts)$/ })); };

function sources(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) {
    if (statSync(`${REPO}/${root}`).isDirectory()) walk(root, files);
    else files.push(root);
  }
  // The locale tables have their own sweep.
  return files.filter((f) => !f.startsWith('src/i18n/locales/') && !f.startsWith('src/__tests__/')).sort();
}

/** The source with its comments removed. A `//` after a colon is a URL, not a comment, so it cannot
 *  hide the rest of its line. */
export function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every line in one file that carries a dot separator outside a comment. */
export function scanText(file: string, src: string): string[] {
  const problems: string[] = [];
  withoutComments(src).split('\n').forEach((line, i) => {
    for (const dot of DOTS) {
      if (line.includes(dot)) problems.push(`${file}:${i + 1} carries '${dot}' — join with the locale's own punctuation, or split the line.`);
    }
  });
  return problems;
}

describe('no dot separator in user-facing text', () => {
  it('[UI-05] no locale string carries one', () => {
    const problems: string[] = [];
    for (const [locale, table] of TABLES) {
      for (const [key, value] of Object.entries(table)) {
        for (const dot of DOTS) {
          if (value.includes(dot)) problems.push(`${locale} ${key}: '${dot}'`);
        }
      }
    }
    expect(problems.join('\n')).toBe('');
  });

  it('[UI-05] no locale string carries an em dash', () => {
    const problems: string[] = [];
    for (const [locale, table] of TABLES) {
      for (const [key, value] of Object.entries(table)) {
        if (value.includes(EM_DASH)) problems.push(`${locale} ${key}`);
      }
    }
    expect(problems.join('\n')).toBe('');
  });

  it('sweeps every locale, the help tables included', () => {
    expect(TABLES.length).toBe(Object.keys(translations).length * 2);
  });

  it('and no surface writes one inline', () => {
    const problems: string[] = [];
    for (const file of sources()) {
      problems.push(...scanText(file, readFileSync(`${REPO}/${file}`, 'utf8')));
    }
    expect(problems.join('\n')).toBe('');
  });

  it('scans a real, non-empty set of sources', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('src/ui/chrome/modals/about/AboutModal.tsx');
    expect(files).toContain('src/ui/chrome/LegalBar.tsx');
    expect(files).toContain('scripts/legal-pages-core.mts');
  });

  it('reads a comment as a comment and a string as text', () => {
    expect(scanText('x.ts', '// area · count\nconst a = 1;')).toEqual([]);
    expect(scanText('x.ts', '/* a · b */\nconst a = 1;')).toEqual([]);
    expect(scanText('x.ts', "const s = 'a · b';")).toHaveLength(1);
    expect(scanText('x.ts', "const s = 'https://host/api · v2';")).toHaveLength(1);
  });
});

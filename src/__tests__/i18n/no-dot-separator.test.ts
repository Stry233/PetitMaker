/**
 * No dot separator and no em dash in anything the app says.
 *
 * A middot (·) or bullet (•) chaining fragments is a punctuation mark English borrowed from
 * dashboards and no locale here writes by hand: Chinese joins with its own comma, Russian and French
 * with theirs, and a list that wants marks wants lines. It also cannot be read aloud, which makes it
 * the one separator that carries nothing. So facts join with the locale's own punctuation, or they
 * split into lines. An em dash crowds the compact panels most copy stands in and reads as a pasted
 * aside, so no locale string carries one either.
 *
 * TWO SWEEPS, because copy lives in two places. Every locale string is checked directly, and the
 * surfaces that write text INLINE (a build stamp, a filing bar, a watermark) are scanned for the two
 * characters outside their comments — a comment may hold either as arithmetic (`a · b`) or as a
 * keycap, and a comment is not something the app says.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { translations } from '../../i18n/translations';
import { HELP_TABLES } from '../../i18n/locales/help';

// Minimal ambient shape for `process.cwd()` — this repo's convention for node globals in tests
// (see legal/repo-hygiene.test.ts). Vitest runs from the repo root.
declare const process: { cwd(): string };

const REPO = process.cwd();

const DOTS = ['·', '•'];
const EM_DASH = '—';

/** Every locale table the app reads, the help chunk's included. */
const TABLES: [string, Record<string, string>][] = [
  ...Object.entries(translations),
  ...Object.entries(HELP_TABLES).map(([locale, table]): [string, Record<string, string>] => [`${locale} help`, table]),
];

/** Everywhere the app writes user-facing text inline rather than through a locale table. The whole
 *  of `src/` is in, since a string can be written anywhere and a comment costs the scan nothing —
 *  plus the page generator, which writes the PUBLIC legal pages and is the one shipped surface that
 *  no locale table covers. */
const ROOTS = [
  'src/ui', 'src/agent', 'src/legal', 'src/state', 'src/io',
  'src/kit', 'src/core', 'src/tools', 'src/canvas', 'src/rules', 'src/api',
  'scripts/legal-pages-core.mts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir) as string[]) {
    const rel = `${dir}/${name}`;
    if (statSync(`${REPO}/${rel}`).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(rel);
  }
  return out;
}

function sources(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) {
    if (statSync(`${REPO}/${root}`).isDirectory()) walk(root, files);
    else files.push(root);
  }
  // The locale tables are the other sweep's subject; scanning them here would report each twice.
  return files.filter((f) => !f.startsWith('src/i18n/locales/')).sort();
}

/**
 * The source with its comments blanked out.
 *
 * A line comment is only recognised where the `//` is not part of a URL, so a `https://…` inside a
 * string cannot swallow the rest of its line and hide what follows it.
 */
export function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every offending line in one file, as a reader-facing line. */
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
  it('no locale string carries one', () => {
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

  it('no locale string carries an em dash', () => {
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
    expect(files).toContain('src/ui/chrome/modals/AboutModal.tsx');
    expect(files).toContain('src/legal/LegalBar.tsx');
    // The public pages are written by a script, so a root list that only walks src/ would let the
    // one shipped surface no locale table covers regress unwatched.
    expect(files).toContain('scripts/legal-pages-core.mts');
  });

  it('reads a comment as a comment and a string as text', () => {
    expect(scanText('x.ts', '// area · count\nconst a = 1;')).toEqual([]);
    expect(scanText('x.ts', '/* a · b */\nconst a = 1;')).toEqual([]);
    expect(scanText('x.ts', "const s = 'a · b';")).toHaveLength(1);
    // A URL is not the start of a comment, so what follows it on the line is still read.
    expect(scanText('x.ts', "const s = 'https://host/api · v2';")).toHaveLength(1);
  });
});

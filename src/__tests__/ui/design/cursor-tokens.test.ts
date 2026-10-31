/**
 * No DOM source names a cursor keyword: a raw keyword hands the pointer back to the operating system.
 * Cursors go through the `cursors` tokens in ui/design/styles (custom properties ui/design/cursors/
 * cursor-vars writes onto <html>) or `cursorCss(id)`. The canvas surface's one writer,
 * `view/interaction/cursor-controller`, is outside these roots. A `var(--pw-cursor-*, keyword)`
 * fallback is legitimate wherever it appears.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { cursors } from '../../../ui/design/styles';
import { repoFiles } from '../../_support/source-graph';

// Vitest runs from the repo root.
const REPO = process.cwd();

/** Everywhere the app renders DOM, including the React around both canvas views. */
const ROOTS = ['src/ui', 'src/legal', 'src/view/map2d', 'src/view/map3d'];

/**
 * Every CSS cursor keyword that makes the OS draw the pointer, and the token that replaces it. `null`
 * means no token exists: the remedy is a new id in `assets/cursors/cursor-spec`, not a literal.
 */
const REPLACEMENT: Record<string, keyof typeof cursors | null> = {
  pointer: 'clickable',
  default: 'default',
  auto: 'default',
  'not-allowed': 'blocked',
  text: 'text',
  grab: 'clickable',
  grabbing: 'clickable',
  move: 'clickable',
  crosshair: 'clickable',
  progress: 'blocked',
  wait: 'blocked',
  help: 'clickable',
  copy: 'clickable',
  'all-scroll': 'clickable',
  alias: 'clickable',
  cell: 'clickable',
  'context-menu': 'clickable',
  'no-drop': 'blocked',
  'vertical-text': 'text',
  none: null,
  'zoom-in': null,
  'zoom-out': null,
  'col-resize': null,
  'row-resize': null,
  'ew-resize': null,
  'ns-resize': null,
  'nesw-resize': null,
  'nwse-resize': null,
  'n-resize': null,
  'e-resize': null,
  's-resize': null,
  'w-resize': null,
  'ne-resize': null,
  'nw-resize': null,
  'se-resize': null,
  'sw-resize': null,
};

const KEYWORDS = Object.keys(REPLACEMENT);

/** Appends the repo-relative path of every `.ts`, `.tsx` and `.css` file under `dir`. */
function walk(dir: string, out: string[]): void {
  out.push(...repoFiles(dir, { accept: /\.(ts|tsx|css)$/ }));
}

function sources(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) {
    if (statSync(`${REPO}/${root}`).isDirectory()) walk(root, files);
    else files.push(root);
  }
  return files.sort();
}

/** The three ways a cursor value is produced; each matches up to the value, which `valueEnd` delimits. */
const STARTS: readonly { re: RegExp; label: string }[] = [
  // A stylesheet declaration or an inline-style object entry. The leading guard keeps
  // `--pw-cursor:`-style custom properties and identifiers ending in "cursor" out.
  { re: /(?:^|[^-\w])cursor\s*:/g, label: 'cursor:' },
  { re: /\.style\.cursor\s*=/g, label: 'style.cursor =' },
  { re: /setProperty\(\s*['"]cursor['"]\s*,/g, label: "setProperty('cursor', …)" },
];

/**
 * Index just past the end of a value starting at `from`: a top-level `,` `;` `}` or `)`, never a
 * newline, which ends nothing in either language and would cut a wrapped ternary short. Nesting is
 * tracked so a comma inside `url(…)`, `var(…)` or a call does not end the value.
 */
function valueEnd(src: string, from: number): number {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i]!;
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { if (depth === 0) return i; depth--; }
    else if (depth === 0 && (c === ',' || c === ';' || c === '}')) return i;
  }
  return src.length;
}

/** The keyword literals in one value: quoted in TS/TSX, bare in CSS. */
function offendingKeywords(value: string, isCss: boolean): string[] {
  const hits = isCss
    // A var() reference resolves to one of ours; anything else in a stylesheet is a raw keyword.
    ? (value.trim().startsWith('var(') ? [] : KEYWORDS.filter((k) => new RegExp(`\\b${k}\\b`).test(value)))
    : [...value.matchAll(/['"]([a-z-]+)['"]/g)].map((m) => m[1]!).filter((k) => KEYWORDS.includes(k));
  return [...new Set(hits)];
}

/** Every offence in one file, as a reader-facing line. */
export function scanSource(file: string, src: string): string[] {
  const isCss = file.endsWith('.css');
  const problems: string[] = [];
  for (const { re, label } of STARTS) {
    for (const match of src.matchAll(new RegExp(re.source, re.flags))) {
      const start = match.index + match[0].length;
      const value = src.slice(start, valueEnd(src, start));
      for (const keyword of offendingKeywords(value, isCss)) {
        // From the match's own offset: one value can appear many times in a file.
        const line = src.slice(0, match.index).split('\n').length;
        const token = REPLACEMENT[keyword];
        problems.push(
          `${file}:${line} ${label} ${isCss ? keyword : `'${keyword}'`} — `
          + (token
            ? `use cursors.${token} from ui/design/styles`
            : '../../../assets/cursors/cursor-spec')
          + ' (a keyword hands this control back to the OS cursor).',
        );
      }
    }
  }
  return problems;
}

describe('cursors come from the tokens, never from a keyword', () => {
  it('scans a real, non-empty set of DOM sources', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter((f) => readFileSync(`${REPO}/${f}`, 'utf8').includes('cursor:')).length)
      .toBeGreaterThan(20);
    // Named so that narrowing `ROOTS` fails here rather than silently shrinking the sweep.
    expect(files).toContain('src/ui/design/styles.ts');
    expect(files).toContain('src/view/map2d/PixiCanvas.tsx');
  });

  it('catches the shapes a keyword actually comes back in', () => {
    // A wrapped ternary whose keywords sit on neither its first nor its last line.
    expect(scanSource('x.tsx', "style={{\n  cursor: disabled\n    ? 'not-allowed'\n    : 'pointer',\n}}"))
      .toHaveLength(2);
    expect(scanSource('x.ts', "el.style.cursor = 'pointer';")).toHaveLength(1);
    expect(scanSource('x.ts', "el.style.setProperty('cursor', 'wait');")).toHaveLength(1);
    expect(scanSource('x.tsx', "{ cursor: 'zoom-in' }")).toHaveLength(1);
    expect(scanSource('x.css', 'a { cursor: ew-resize; }')).toHaveLength(1);
    expect(scanSource('x.css', 'a { cursor: none; }')).toHaveLength(1);
    // The two legitimate forms.
    expect(scanSource('x.tsx', '{ cursor: cursors.clickable, pointerEvents: \'none\' }')).toEqual([]);
    expect(scanSource('x.css', 'a { cursor: var(--pw-cursor-clickable, pointer); }')).toEqual([]);
  });

  it('finds no raw cursor keyword in any DOM source', () => {
    const problems: string[] = [];
    for (const file of sources()) problems.push(...scanSource(file, readFileSync(`${REPO}/${file}`, 'utf8')));
    expect(problems.join('\n')).toBe('');
  });
});

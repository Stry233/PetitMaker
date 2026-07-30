/**
 * No DOM source may name a cursor keyword.
 *
 * A raw keyword hands that control back to the operating system, and one reintroduced literal is
 * invisible in review.
 *
 * Every cursor outside the canvas goes through the `cursors` tokens in ui/styles (which resolve to
 * the custom properties ui/cursors/cursor-vars writes onto <html>) or, where a component genuinely
 * needs a canvas cursor, through `cursorCss(id)`. The canvas surface itself is exempt by
 * construction: `canvas/interaction/cursor-controller` is the one writer of `style.cursor`, and it
 * is not under these roots.
 *
 * The scan covers all three ways a value can be produced — the declaration in a stylesheet or an
 * inline-style object, `el.style.cursor = …`, and `setProperty('cursor', …)` — and it reads a
 * declaration to the END of its value rather than to the end of the line, because a prettier-
 * wrapped ternary is the likeliest shape a regression actually arrives in.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { cursors } from '../../ui/styles';

// Minimal ambient shape for `process.cwd()` — this repo's convention for node globals in tests
// (see legal/repo-hygiene.test.ts). Vitest runs from the repo root.
declare const process: { cwd(): string };

const REPO = process.cwd();

/** Everywhere the app renders DOM. Both canvas views are here because both render React around
 *  their surface; only the surface itself is the controller's, and the controller lives elsewhere. */
const ROOTS = ['src/ui', 'src/legal', 'src/canvas/map2d', 'src/canvas/map3d'];

/** The cursor module owns the keywords: they ARE the fallbacks it emits, and its sheet is the one
 *  place a keyword is spelled out on purpose. Nothing else is exempt. */
const EXEMPT = ['src/ui/cursors'];

/**
 * Every CSS cursor keyword that makes the OS draw the pointer, and the token that replaces it.
 * `null` means the catalogue has no equivalent yet: naming the keyword is still the bug, and the
 * fix is a new id in `ui/cursors/cursor-spec`, not a literal at the call site.
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

/** Repo-relative POSIX paths of every source file under `dir`. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir) as string[]) {
    const rel = `${dir}/${name}`;
    if (statSync(`${REPO}/${rel}`).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(rel);
  }
  return out;
}

function sources(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) {
    if (statSync(`${REPO}/${root}`).isDirectory()) walk(root, files);
    else files.push(root);
  }
  return files
    .filter((f) => !EXEMPT.some((e) => f === e || f.startsWith(`${e}/`)))
    .sort();
}

/**
 * The three ways a cursor value is produced. Each pattern matches only up TO the value, which
 * `valueEnd` then delimits.
 */
const STARTS: readonly { re: RegExp; label: string }[] = [
  // A stylesheet declaration or an inline-style object entry. The leading guard keeps
  // `--pw-cursor:`-style custom properties and identifiers ending in "cursor" out.
  { re: /(?:^|[^-\w])cursor\s*:/g, label: 'cursor:' },
  { re: /\.style\.cursor\s*=/g, label: 'style.cursor =' },
  { re: /setProperty\(\s*['"]cursor['"]\s*,/g, label: "setProperty('cursor', …)" },
];

/**
 * Index just past the end of a value starting at `from`.
 *
 * Stops at a top-level `,` `;` `}` or `)` — never at a newline. A newline is not a terminator in
 * either language, and treating it as one is what let a prettier-wrapped ternary
 * (`cursor: disabled\n  ? 'not-allowed'\n  : 'pointer',`) through: the scan saw the bare condition
 * and nothing else. Nesting is tracked so a comma inside `url(…)`, `var(…)` or a call argument
 * list does not end the value early.
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

/** The keyword literals in one value — quoted in TS/TSX, bare in CSS. */
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
        // From the match's own offset: the same value can appear many times in one file.
        const line = src.slice(0, match.index).split('\n').length;
        const token = REPLACEMENT[keyword];
        problems.push(
          `${file}:${line} ${label} ${isCss ? keyword : `'${keyword}'`} — `
          + (token
            ? `use cursors.${token} from ui/styles`
            : 'no cursor token covers this state: add one to ui/cursors/cursor-spec')
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
    // The two roots the scan used to miss, named so a future narrowing of ROOTS/EXEMPT fails here
    // rather than silently shrinking the sweep.
    expect(files).toContain('src/ui/styles.ts');
    expect(files).toContain('src/canvas/map2d/PixiCanvas.tsx');
  });

  it('catches the shapes a keyword actually comes back in', () => {
    // A prettier-wrapped ternary: the value continues over three lines and the keywords are on
    // neither the first nor the last of them.
    expect(scanSource('x.tsx', "style={{\n  cursor: disabled\n    ? 'not-allowed'\n    : 'pointer',\n}}"))
      .toHaveLength(2);
    // The imperative forms, which no declaration pattern can see.
    expect(scanSource('x.ts', "el.style.cursor = 'pointer';")).toHaveLength(1);
    expect(scanSource('x.ts', "el.style.setProperty('cursor', 'wait');")).toHaveLength(1);
    // Keywords outside the original list.
    expect(scanSource('x.tsx', "{ cursor: 'zoom-in' }")).toHaveLength(1);
    expect(scanSource('x.css', 'a { cursor: ew-resize; }')).toHaveLength(1);
    expect(scanSource('x.css', 'a { cursor: none; }')).toHaveLength(1);
    // …and no false positive on the two legitimate forms.
    expect(scanSource('x.tsx', '{ cursor: cursors.clickable, pointerEvents: \'none\' }')).toEqual([]);
    expect(scanSource('x.css', 'a { cursor: var(--pw-cursor-clickable, pointer); }')).toEqual([]);
  });

  it('finds no raw cursor keyword outside ui/cursors', () => {
    const problems: string[] = [];
    for (const file of sources()) problems.push(...scanSource(file, readFileSync(`${REPO}/${file}`, 'utf8')));
    expect(problems.join('\n')).toBe('');
  });
});

/**
 * Every type size the interface draws comes from `ui/design/text-weight.ts`: the roles stand on the
 * closed `TYPE_SIZES` set, and a font size written anywhere under `ui/` or `lite/` reaches that module, directly
 * or through a constant or type of its own file, rather than being a number or a sum of its own. A size of 0
 * draws no text and is not a size.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { TEXT_ROLES, TYPE_SIZES } from '../../../ui/design/text-weight';
import { posix, walkFiles } from '../../_support/source-graph';

const SRC = resolve(__dirname, '../../..');
const ROOTS = ['ui', 'lite'].map((dir) => resolve(SRC, dir));

/** The table's exports a size may be taken through. */
const TABLE = /\b(?:TEXT_ROLES|TYPE_SIZES|roleFont|roleSize|mapMarkSize|INPUT_NO_ZOOM)\b/;

/** Every place a source sets a font size, with the expression that sets it. */
const SETTERS: { pattern: RegExp; open?: string }[] = [
  // `fontSize: expr` in a style object or a prop type.
  { pattern: /\bfontSize\??\s*:/g },
  // `fontSize={expr}` on an element.
  { pattern: /\bfontSize=\{/g, open: '{' },
  // `fontSize="12"` on an element.
  { pattern: /\bfontSize=(?=["'])/g },
  // `font-size: …` in a stylesheet string.
  { pattern: /font-size\s*:/g },
];

/** The expression from `start` up to the first `,` `;` or closing bracket outside brackets and strings. */
function expressionAt(text: string, start: number, open?: string): string {
  let depth = open ? 1 : 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0 || (open && depth === 1)) return text.slice(start, i).trim();
      depth--;
    } else if (depth === 0 && (c === ',' || c === ';' || c === '\n')) return text.slice(start, i).trim();
  }
  return text.slice(start).trim();
}

/** Whether `expr` reaches the table, through same-file `const`s and types up to a few hops. */
function reachesTable(expr: string, text: string, hops = 3): boolean {
  if (TABLE.test(expr)) return true;
  if (hops === 0) return false;
  for (const [name] of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const decl = new RegExp(`\\b(?:const|type)\\s+${name.replace(/\$/g, '\\$')}\\b[^=]*=`).exec(text);
    if (decl && reachesTable(expressionAt(text, decl.index + decl[0].length), text, hops - 1)) return true;
  }
  return false;
}

/** A style shorthand, `{ ...style, fontSize }`, names a variable for its value. */
const SHORTHAND = /[{,]\s*fontSize\s*(?=[,}])/g;
/** A `font` shorthand carrying a length. */
const FONT_SHORTHAND = /\bfont\s*:\s*['"`][^'"`]*\d(?:px|em|rem)\b/g;

function offenders(): string[] {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const file of walkFiles(root, { accept: /\.(?:tsx?|css)$/ })) {
      const text = readFileSync(file, 'utf8');
      const rel = posix(relative(SRC, file));
      const line = (at: number) => text.slice(0, at).split('\n').length;
      for (const { pattern, open } of SETTERS) {
        for (const m of text.matchAll(pattern)) {
          const expr = expressionAt(text, m.index + m[0].length, open);
          if (/^['"`]?0(?:px)?['"`]?$/.test(expr)) continue;
          if (!reachesTable(expr, text)) found.push(`${rel}:${line(m.index)}: ${expr}`);
        }
      }
      for (const m of text.matchAll(SHORTHAND)) {
        if (!reachesTable('fontSize', text)) found.push(`${rel}:${line(m.index)}: fontSize`);
      }
      for (const m of text.matchAll(FONT_SHORTHAND)) found.push(`${rel}:${line(m.index)}: ${m[0]}`);
    }
  }
  return found;
}

describe('the type sizes', () => {
  it('stands every role on one of the closed set of sizes', () => {
    const sizes = new Set<number>(Object.values(TYPE_SIZES));
    for (const [role, { px }] of Object.entries(TEXT_ROLES)) expect(sizes.has(px), `${role} at ${px}`).toBe(true);
  });

  it('keeps the set to distinct sizes from the 12 px floor up', () => {
    const sizes = Object.values(TYPE_SIZES);
    expect(new Set(sizes).size).toBe(sizes.length);
    expect(Math.min(...sizes)).toBe(12);
  });

  it('sets no font size under ui/ or lite/ outside the table', () => {
    expect(offenders()).toEqual([]);
  });

  it('finds the setters it checks, so the scan cannot pass by reading nothing', () => {
    const text = ROOTS.flatMap((root) => walkFiles(root)).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(text.match(/\bfontSize\s*:/g)?.length ?? 0).toBeGreaterThan(20);
    expect(text).toMatch(/font-size\s*:/);
  });
});

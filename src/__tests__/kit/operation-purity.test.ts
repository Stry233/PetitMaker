/**
 * An operation that speaks to the user can only ever have one caller. These modules run below the
 * layer that knows what a toast is, and the import check is what keeps it that way.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
// @ts-ignore - node:path is untyped here (no @types/node)
import { join, resolve, relative } from 'node:path';

declare const __dirname: string;

const FORBIDDEN = [
  { pattern: /from '.*chrome\/Toast'/,        why: 'shows a toast' },
  { pattern: /\bshowToast\s*\(/,              why: 'shows a toast' },
  { pattern: /\btranslate\s*\(/,              why: 'localizes its own message' },
  { pattern: /from 'react'/,                  why: 'imports React' },
  { pattern: /\bwindow\./,                    why: 'reaches for the window' },
  { pattern: /\bdocument\./,                  why: 'reaches for the document' },
];

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

/** The pointer binding receives ToolContext and reports outcomes; macro bodies stay silent. */
const isToolBinding = (file: string): boolean => ['macros/macro-tool.ts', 'macros/drag-tool.ts', 'macros/spray-tool.ts'].some(binding => file.endsWith(binding));

describe('operations stay silent', () => {
  it('never narrates its own result', () => {
    const roots = [
      resolve(__dirname, '../../kit/operations'),
      resolve(__dirname, '../../tools/macros'),
      resolve(__dirname, '../../tools/objects'),
    ];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of filesUnder(root)) {
        if (isToolBinding(file)) continue;
        const text = readFileSync(file, 'utf8');
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(text)) offenders.push(`${relative(resolve(__dirname, '../..'), file)} ${why}`);
        }
      }
    }
    expect(offenders.sort()).toEqual([]);
  });

  // The broader tool-store boundary is enforced by import-direction.test.ts.
  it('never imports the store directly (kit/operations + tools/macros only)', () => {
    const roots = [resolve(__dirname, '../../kit/operations'), resolve(__dirname, '../../tools/macros')];
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of filesUnder(root)) {
        if (isToolBinding(file)) continue;
        const text = readFileSync(file, 'utf8');
        if (/\buseEditorStore\b/.test(text)) offenders.push(relative(resolve(__dirname, '../..'), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

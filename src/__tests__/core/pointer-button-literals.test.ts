/**
 * No interaction source may compare a pointer button to a literal.
 *
 * Which buttons navigate the camera was written out by hand in three separate files, and a
 * reintroduced literal is invisible in review. Everything goes through
 * `core/interaction/pointer-buttons`, which holds the values and is not under this root.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readdirSync, readFileSync, statSync } from 'node:fs';

declare const process: { cwd(): string };

const REPO = process.cwd();
const ROOT = `${REPO}/src/canvas/interaction`;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name: string) => {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** `e.button === 0`, `button !== 1`, `e.button == 2`, and the same with the literal first. */
const LITERAL = /\bbutton\s*[!=]==?\s*\d|\d\s*[!=]==?\s*\w*\.?button\b/;

describe('pointer button literals', () => {
  it('are absent from the interaction sources', () => {
    const offenders = sources(ROOT).filter((path: string) => LITERAL.test(readFileSync(path, 'utf8')));
    expect(offenders.map((p: string) => p.slice(REPO.length + 1))).toEqual([]);
  });
});

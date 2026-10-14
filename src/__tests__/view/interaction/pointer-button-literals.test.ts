/**
 * No interaction source may compare a pointer button to a literal.
 *
 * Which buttons navigate the camera would otherwise be written out by hand file by file, and a
 * reintroduced literal is invisible in review. Everything goes through
 * `view/interaction/press/pointer-buttons`, which holds the values and is the one file exempt.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { posix, walkFiles } from '../../_support/source-graph';

const REPO = process.cwd();
const ROOT = `${REPO}/src/view/interaction`;

const sources = (dir: string): string[] => walkFiles(dir).map(posix);

/** `e.button === 0`, `button !== 1`, `e.button == 2`, and the same with the literal first. */
const LITERAL = /\bbutton\s*[!=]==?\s*\d|\d\s*[!=]==?\s*\w*\.?button\b/;

describe('pointer button literals', () => {
  it('are absent from the interaction sources', () => {
    const offenders = sources(ROOT).filter((path: string) => LITERAL.test(readFileSync(path, 'utf8')));
    expect(offenders.map((p: string) => p.slice(REPO.length + 1))).toEqual([]);
  });
});

/**
 * Shown state leaves `visibility` unset. `visible` is inherited, and an element that writes it shows
 * itself through a hidden ancestor, so with the interface hidden or a bar covered it would stand
 * there invisible behind its veil's opacity and still take presses, Tab and the wheel.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { posix, walkFiles } from '../_support/source-graph';

const UI_DIR = resolve(__dirname, '../../ui');

/** `visibility` given the value `visible`, in a script (a style, a write or a comparison) or a stylesheet. */
const SHOWN = /visibility[^,;{}]*?['"]visible['"]|visibility\s*:\s*visible\b/g;

describe('shown state never writes visibility visible', () => {
  it('finds no `visible` value for visibility under ui/', () => {
    const offenders: string[] = [];
    for (const full of walkFiles(UI_DIR, { accept: /\.(tsx?|css)$/ })) {
      const text = readFileSync(full, 'utf8');
      for (const hit of text.matchAll(SHOWN)) {
        const line = text.slice(0, hit.index).split('\n').length;
        offenders.push(`${posix(relative(UI_DIR, full))}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

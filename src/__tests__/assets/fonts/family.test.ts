import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FONT_FACES } from '../../../assets/fonts/family';

const css = readFileSync(resolve(__dirname, '../../../assets/fonts/fonts.css'), 'utf8') as string;

describe('shipped font faces', () => {
  it('list exactly the families and weights fonts.css declares', () => {
    const declared = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(([, block]) => {
      const family = /font-family:\s*'([^']+)'/.exec(block!)![1];
      const weight = /font-weight:\s*(\d+)/.exec(block!)![1];
      return `${weight} ${family}`;
    });
    const listed = FONT_FACES.flatMap(({ family, weights }) => weights.map((weight) => `${weight} ${family}`));
    expect(listed.sort()).toEqual(declared.sort());
  });
});

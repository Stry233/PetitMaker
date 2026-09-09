import { describe, expect, it } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { referenceBlocks, rewriteReferenceDoc } from '../../scripts/generate-reference-core.mts';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('architecture reference generation', () => {
  it('keeps the committed reference synchronized with runtime rules, constants and TypeScript contracts', () => {
    const current = read('docs/ARCHITECTURE.md');
    expect(rewriteReferenceDoc(current, referenceBlocks(read)), 'Run npm run docs:generate').toBe(current);
  });

  it('preserves authored prose around generated sections', () => {
    const current = 'Before.\n<!-- generated:a:start -->\nOld.\n<!-- generated:a:end -->\nAfter.\n';
    expect(rewriteReferenceDoc(current, { a: 'New.' })).toBe('Before.\n<!-- generated:a:start -->\n\nNew.\n\n<!-- generated:a:end -->\nAfter.\n');
  });

  it.each([
    '<!-- generated:a:start -->',
    '<!-- generated:a:end --><!-- generated:a:start -->',
    '<!-- generated:a:start --><!-- generated:a:start --><!-- generated:a:end -->',
  ])('refuses malformed markers instead of overwriting prose', (markdown) => {
    expect(() => rewriteReferenceDoc(markdown, { a: 'New.' })).toThrow();
  });
});

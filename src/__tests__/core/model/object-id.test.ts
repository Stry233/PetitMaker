// Tests run on sequential ids: every id is new, carries its prefix, and the same calls mint the same
// ids on every run.
import { describe, it, expect } from 'vitest';
import { generateId, generateObjectId } from '../../../core/model/object-id';

describe('object ids under test', () => {
  it('are sequential, distinct and prefixed', () => {
    const a = generateObjectId(), b = generateObjectId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^seq[0-9a-z]+$/);
    expect(parseInt(b.slice(3), 36)).toBe(parseInt(a.slice(3), 36) + 1);
    expect(generateId('an')).toMatch(/^anseq[0-9a-z]+$/);
  });
});

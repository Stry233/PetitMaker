import { describe, it, expect } from 'vitest';
import { TaintFlag, hasFlag, setFlag } from '../../../core/provenance/types';

describe('provenance types', () => {
  it('flag bitset set/has round-trips', () => {
    let f = 0;
    f = setFlag(f, TaintFlag.CONTAINS_AI);
    f = setFlag(f, TaintFlag.HUMAN_AFTER_AI);
    expect(hasFlag(f, TaintFlag.CONTAINS_AI)).toBe(true);
    expect(hasFlag(f, TaintFlag.AI_AFTER_HUMAN)).toBe(false);
  });
});

// The frame writes an object's model shape as a plain byte (`payload.ts`'s `w.u8(variant)`), so a
// position in MODEL_VARIANTS is part of the wire format exactly like SHARE_CATALOG_ORDER: a code
// written today names shape N, and a build reading it tomorrow must resolve N to the same
// { parity, half } pair. This file holds the table's current order fixed.
import { describe, it, expect } from 'vitest';
import { MODEL_VARIANTS } from '../../../../io/share/codec/map-coder';

/**
 * The shapes as this release ships them: the original parity pair (indices 0-1), plus the
 * half-capable pair (indices 2-3) appended for issue #4. Every later shape appends after these.
 */
const RELEASED_PREFIX = [
  { parity: false, half: false },
  { parity: true, half: false },
  { parity: false, half: true },
  { parity: true, half: true },
];

describe('share codec model-shape wire order', () => {
  it('keeps the released prefix exactly where it shipped', () => {
    expect(MODEL_VARIANTS.slice(0, RELEASED_PREFIX.length)).toEqual(RELEASED_PREFIX);
  });

  it('lists each shape once', () => {
    const keys = MODEL_VARIANTS.map((v) => `${v.parity}-${v.half}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stays inside the byte the frame writes it as', () => {
    expect(MODEL_VARIANTS.length).toBeLessThanOrEqual(256);
  });
});

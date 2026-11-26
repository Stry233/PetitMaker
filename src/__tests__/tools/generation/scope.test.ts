/** What Generate's scope asks of the region brush, and when a painted scope is too small for a fill. */
import { describe, expect, it } from 'vitest';
import { REGION_TOOLS } from '../../../state/editing/vocabulary';
import { STENCIL_MIN_SIDE, scopeFallsShort, scopeRequestFor } from '../../../tools/generation/facts';

const square = (side: number) => Array.from({ length: side * side }, (_, i) => ({ x: i % side, y: Math.floor(i / side) }));

describe("Generate's scope", () => {
  it('asks a fill for one rectangle or circle no shorter than its floor', () => {
    expect(scopeRequestFor('image')).toEqual({ tools: ['rect', 'circle'], single: true, minSide: STENCIL_MIN_SIDE.image });
    expect(scopeRequestFor('text')).toEqual({ tools: ['rect', 'circle'], single: true, minSide: STENCIL_MIN_SIDE.text });
  });

  it('lets the terrain kinds paint any number of figures with every tool', () => {
    expect(scopeRequestFor('island')).toEqual({ tools: REGION_TOOLS, single: false, minSide: null });
  });

  it('falls short only where a side is under the floor', () => {
    const floor = STENCIL_MIN_SIDE.image;
    expect(scopeFallsShort(square(floor), floor)).toBe(false);
    expect(scopeFallsShort(square(floor - 1), floor)).toBe(true);
    expect(scopeFallsShort(square(2), null), 'a request without a floor').toBe(false);
    expect(scopeFallsShort([], floor), 'no scope is the whole planet').toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { chunkVisible, CHUNK_PX } from '../../../../view/map2d/geometry/chunk-cull';

describe('chunkVisible', () => {
  const rect = { left: 0, top: 0, right: 2 * CHUNK_PX, bottom: CHUNK_PX };

  it('keeps intersecting chunks and culls the rest', () => {
    expect(chunkVisible(0, 0, rect)).toBe(true);
    expect(chunkVisible(1, 0, rect)).toBe(true);
    expect(chunkVisible(2, 0, rect)).toBe(false);  // starts exactly at rect.right: open interval
    expect(chunkVisible(0, 1, rect)).toBe(false);
    expect(chunkVisible(-1, 0, rect)).toBe(false); // ends exactly at rect.left
    expect(chunkVisible(-1, -1, rect)).toBe(false);
  });

  it('a chunk merely touching the rect interior is visible', () => {
    expect(chunkVisible(1, 0, { left: 2 * CHUNK_PX - 1, top: 0, right: 3 * CHUNK_PX, bottom: 1 })).toBe(true);
  });
});

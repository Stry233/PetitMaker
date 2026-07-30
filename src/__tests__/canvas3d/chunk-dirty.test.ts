/**
 * Which 3D chunks must remesh after an edit: the chunks holding the changed
 * cells PLUS any chunk whose cells neighbor them — exposed-face culling, cut
 * backing, and silhouette reads cross one cell, so a border edit changes the
 * adjacent chunk's geometry too.
 */
import { describe, it, expect } from 'vitest';
import { dirtyChunksFor } from '../../canvas/map3d/build/chunk-dirty';
import { CHUNK_SIZE } from '../../core/model/constants';

const key = (cx: number, cy: number) => `${cx},${cy}`;

describe('dirtyChunksFor', () => {
  it('an interior cell dirties only its own chunk', () => {
    const set = dirtyChunksFor([{ x: 5, y: 5 }], 64, 64);
    expect([...set]).toEqual([key(0, 0)]);
  });

  it('a cell on a chunk border dirties the neighboring chunk too', () => {
    const set = dirtyChunksFor([{ x: CHUNK_SIZE - 1, y: 3 }], 64, 64);
    expect(set.has(key(0, 0))).toBe(true);
    expect(set.has(key(1, 0))).toBe(true);
    expect(set.size).toBe(2);
  });

  it('a chunk-corner cell dirties all four touching chunks', () => {
    const set = dirtyChunksFor([{ x: CHUNK_SIZE, y: CHUNK_SIZE }], 64, 64);
    expect(set.size).toBe(4);
  });

  it('never emits chunks outside the map', () => {
    const set = dirtyChunksFor([{ x: 0, y: 0 }, { x: 63, y: 63 }], 64, 64);
    for (const k of set) {
      const [cx, cy] = k.split(',').map(Number);
      expect(cx! >= 0 && cy! >= 0 && cx! * CHUNK_SIZE < 64 && cy! * CHUNK_SIZE < 64).toBe(true);
    }
  });

  it('deduplicates across many cells in one chunk', () => {
    const cells = Array.from({ length: 10 }, (_, i) => ({ x: 4 + i % 3, y: 4 + Math.floor(i / 3) }));
    expect(dirtyChunksFor(cells, 64, 64).size).toBe(1);
  });
});

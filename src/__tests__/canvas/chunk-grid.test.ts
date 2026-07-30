import { describe, it, expect } from 'vitest';
import { cullRect, chunkVisible } from '../../canvas/map2d/layers/chunk-cull';
import { TILE_SIZE, CHUNK_SIZE } from '../../core/model/constants';

const CHUNK_PX = CHUNK_SIZE * TILE_SIZE;
const MARGIN = 8 * TILE_SIZE;

describe('cullRect', () => {
  it('maps the screen corners through world = (screen + offset) / zoom, plus the overscan margin', () => {
    const r = cullRect(0, 0, 1, 800, 600);
    expect(r.left).toBe(-MARGIN);
    expect(r.top).toBe(-MARGIN);
    expect(r.right).toBe(800 + MARGIN);
    expect(r.bottom).toBe(600 + MARGIN);
  });

  it('zooming in shrinks the visible world rect; panning shifts it', () => {
    const r = cullRect(1000, 500, 2, 800, 600);
    expect(r.left).toBe(500 - MARGIN);
    expect(r.top).toBe(250 - MARGIN);
    expect(r.right).toBe((800 + 1000) / 2 + MARGIN);
    expect(r.bottom).toBe((600 + 500) / 2 + MARGIN);
  });
});

describe('chunkVisible', () => {
  const rect = { left: 0, top: 0, right: 2 * CHUNK_PX, bottom: CHUNK_PX };

  it('keeps intersecting chunks and culls the rest', () => {
    expect(chunkVisible(0, 0, rect)).toBe(true);
    expect(chunkVisible(1, 0, rect)).toBe(true);
    expect(chunkVisible(2, 0, rect)).toBe(false);  // starts exactly at rect.right — open interval
    expect(chunkVisible(0, 1, rect)).toBe(false);
    expect(chunkVisible(-1, 0, rect)).toBe(false); // ends exactly at rect.left
    expect(chunkVisible(-1, -1, rect)).toBe(false);
  });

  it('a chunk merely touching the rect interior is visible', () => {
    expect(chunkVisible(1, 0, { left: 2 * CHUNK_PX - 1, top: 0, right: 3 * CHUNK_PX, bottom: 1 })).toBe(true);
  });
});

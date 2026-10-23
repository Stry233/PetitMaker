/** The load each chunk of the map may carry. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, world, type SpecWorld } from '../_world';
import { findCell, groundAt, move, placed, setLoadCheck, turn } from './_rules';
import { CHUNK_LOAD_LIMIT, CHUNK_SIZE } from '../../../core/game/profile';
import { GRASS_ZONE } from '../../../core/game/zones';
import { mapChunkOrigin } from '../../../core/grid/map-chunks';
import { cellKey } from '../../../core/grid/rect';
import { buildObjectOccupancy } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import type { MacroCoord } from '../../../core/model/types';

const TREE = 'tree-apple';
const LIGHT_TREE = 'tree-fir';
const FLOWER = 'flower-protea';
const PAVILION = 'facility-pavilion';
const load = (item: string): number => getCatalogItem(item)!.loadValue;

/** The top-left cell of a chunk of open grass with another open chunk to its right. */
function openChunkPair(w: SpecWorld): MacroCoord {
  const origin = mapChunkOrigin(w.state.template);
  const occupied = buildObjectOccupancy(w.state);
  const open = (x: number, y: number) => groundAt(w, x, y) === GRASS_ZONE && !w.terrainAt({ x, y }) && !occupied.has(cellKey(x, y));
  return findCell(w, (x, y) => (x - origin.x) % CHUNK_SIZE === 0 && (y - origin.y) % CHUNK_SIZE === 0
    && rect({ x, y }, 2 * CHUNK_SIZE, CHUNK_SIZE).every((c) => open(c.x, c.y)));
}

/** As many of `TREE` as one chunk's limit takes. */
const FITS = Math.floor(CHUNK_LOAD_LIMIT / load(TREE));

/** Plant FITS trees a cell apart from the corner `a` of an empty chunk; returns the open cell where
 *  the next would go. */
function crowd(w: SpecWorld, a: MacroCoord): MacroCoord {
  const side = Math.ceil(Math.sqrt(FITS));
  for (let i = 0; i < FITS; i++) placed(w, TREE, a.x + 2 * (i % side), a.y + 2 * Math.floor(i / side));
  return { x: a.x + 2 * side, y: a.y };
}

/** Crowd the chunk at `a`, then add a lighter tree that still fits; returns the chunk's load. */
function fill(w: SpecWorld, a: MacroCoord): number {
  const next = crowd(w, a);
  placed(w, LIGHT_TREE, next.x, next.y);
  return FITS * load(TREE) + load(LIGHT_TREE);
}

describe('chunk load', () => {
  spec('V-CHUNK-01', 'refuses a placement that would push a chunk past its limit and takes a lighter one that stays within it', () => {
    const w = world();
    const a = openChunkPair(w);
    const next = crowd(w, a);
    const before = w.fingerprint();
    expect(w.place(TREE, next.x, next.y).refusedBy).toContain('V-CHUNK-01');
    expect(w.fingerprint()).toBe(before);
    expect(FITS * load(TREE) + load(LIGHT_TREE)).toBeLessThanOrEqual(CHUNK_LOAD_LIMIT);
    expect(w.place(LIGHT_TREE, next.x, next.y).ok).toBe(true);
  });

  spec('V-CHUNK-01', 'charges an object in full to every chunk it touches', () => {
    const w = world();
    const a = openChunkPair(w);
    const total = fill(w, a);
    expect(total + load(PAVILION)).toBeGreaterThan(CHUNK_LOAD_LIMIT);
    // One column in the full chunk, five in the empty one beside it.
    const edge = { x: a.x + CHUNK_SIZE - 1, y: a.y + 8 };
    const before = w.fingerprint();
    expect(w.place(PAVILION, edge.x, edge.y).refusedBy).toContain('V-CHUNK-01');
    expect(w.fingerprint()).toBe(before);
    expect(w.place(PAVILION, edge.x + 1, edge.y).ok).toBe(true);
  });

  spec('V-CHUNK-01', 'lets the check be switched off, and charges a move or turn only its net change in a chunk over the limit', () => {
    const w = world();
    const a = openChunkPair(w);
    const total = fill(w, a);
    const inside = { x: a.x + 9, y: a.y + 9 };
    expect(total + load(PAVILION)).toBeGreaterThan(CHUNK_LOAD_LIMIT);
    expect(w.place(PAVILION, inside.x, inside.y).refusedBy).toContain('V-CHUNK-01');
    setLoadCheck(w, false);
    const pavilion = placed(w, PAVILION, inside.x, inside.y);
    const tree = placed(w, TREE, a.x + 12, a.y);
    setLoadCheck(w, true);
    const before = w.fingerprint();
    expect(w.place(FLOWER, a.x + 14, a.y + 2).refusedBy).toContain('V-CHUNK-01');
    expect(w.fingerprint()).toBe(before);
    expect(turn(w, pavilion, 90).ok).toBe(true);
    expect(move(w, tree, a.x + 14, a.y).ok).toBe(true);
  });
});

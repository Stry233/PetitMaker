import { describe, it, expect } from 'vitest';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { allChunkLoads, chunkLoad, getMapStats, placedLoad } from '../../state/map-stats';
import { makeObject, makeState } from '../_support/map-state';
import { chunkColumnLabel, chunkName, chunkRowLabel } from '../../core/grid/map-chunks';
import { CHUNK_SIZE } from '../../core/game/profile';


describe('a region\'s name', () => {
  it('is the row letter and the column number the map itself draws', () => {
    expect(chunkName(0, 0)).toBe('A1');
    expect(chunkName(3, 1)).toBe('B4');
    expect(chunkName(10, 8)).toBe('I11');
  });

  it('wraps its letters at Z, from the row label the map legends draw', () => {
    expect(chunkName(0, 26)).toBe('A1');
    expect(chunkName(4, 27)).toBe(`${chunkRowLabel(27)}${chunkColumnLabel(4)}`);
  });

});

describe('what a region carries', () => {
  it('is the load of that region alone, never a total for the map', () => {
    const state = makeState(CHUNK_SIZE * 2, CHUNK_SIZE * 2);
    const here = makeObject('building-stall', 1, 1);
    const elsewhere = makeObject('building-stall2', CHUNK_SIZE + 1, CHUNK_SIZE + 1);
    state.objects.set(here.id, here);
    state.objects.set(elsewhere.id, elsewhere);
    bumpObjectsVersion(state, { added: [here, elsewhere] });

    const stats = getMapStats(state);
    const a1 = chunkLoad(stats, 0, 0)!;
    const b2 = chunkLoad(stats, 1, 1)!;
    expect(a1.name).toBe('A1');
    expect(b2.name).toBe('B2');
    expect(a1.objects).toBe(1);
    expect(b2.objects).toBe(1);
  });

  it('reads a region holding nothing as empty rather than as absent', () => {
    const state = makeState(CHUNK_SIZE, CHUNK_SIZE);
    const empty = chunkLoad(getMapStats(state), 0, 0);
    expect(empty.value).toBe(0);
    expect(empty.objects).toBe(0);
  });

  it('carries each object at the load a placement is held to, and follows the map as objects leave', () => {
    const state = makeState(CHUNK_SIZE * 2, CHUNK_SIZE);
    const stall = makeObject('building-stall', 1, 1);
    const tree = makeObject('tree-apple', 4, 4);
    state.objects.set(stall.id, stall);
    state.objects.set(tree.id, tree);
    bumpObjectsVersion(state, { added: [stall, tree] });
    expect(placedLoad(stall), 'the fixture carries a measured load').toBeGreaterThan(0);

    const full = chunkLoad(getMapStats(state), 0, 0);
    expect(full.objects).toBe(2);
    expect(full.value).toBeCloseTo(placedLoad(stall) + placedLoad(tree), 6);
    expect(chunkLoad(getMapStats(state), 1, 0).value).toBe(0);

    state.objects.delete(stall.id);
    bumpObjectsVersion(state, { removed: [stall] });
    const after = allChunkLoads(getMapStats(state), state.template);
    expect(after.map((r) => r.objects)).toEqual([1, 0]);
    expect(after[0]!.value).toBeCloseTo(placedLoad(tree), 6);
  });

  /** The window's question is where there is room, so a list of only the busy regions has no map
   *  in it and cannot answer it. */
  it('lists every region of the map, in reading order, empty ones included', () => {
    const state = makeState(CHUNK_SIZE * 3, CHUNK_SIZE * 2);
    const rows = allChunkLoads(getMapStats(state), state.template);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.name)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
  });

  it('includes the complete sea regions surrounding an offset island', () => {
    const state = makeState(169, 140);
    state.template.chunkGrid = { origin: { x: -15, y: -23 }, columns: 13, rows: 12 };
    const rows = allChunkLoads(getMapStats(state), state.template);
    expect(rows).toHaveLength(156);
    expect(rows[0]!.name).toBe('A1');
    expect(rows[12]!.name).toBe('A13');
    expect(rows[155]!.name).toBe('L13');
  });
});

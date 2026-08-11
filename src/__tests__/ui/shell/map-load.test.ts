/**
 * The regional load reading: which region a point falls in, what that region is called, and the
 * shape that keeps a provisional figure out of a release.
 *
 * The NAME matters as much as the number. The 2D renderer already letters the map's rows down the
 * left edge and numbers its columns along the bottom, so a region is "B4" on screen before anything
 * here says so; a window that named the same region something else would be a second map. That rule
 * is duplicated in two files by necessity (one draws, one reads), so this is what holds them equal.
 *
 * The other thing a test can reach is the gate: while the game has not published per-item load
 * values, a PRODUCTION build has no reading at all. A test cannot see a production bundle, so what
 * it pins is the shape that makes the reading impossible to build into one — every path that
 * returns a figure without `CHUNK_LOAD_ENABLED` sits behind `import.meta.env.DEV`, which Vite
 * replaces with the literal `false` and esbuild then drops along with everything past it.
 */
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { CHUNK_LOAD_ENABLED, CHUNK_SIZE } from '../../../core/model/constants';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { getMapStats } from '../../../state/map-stats';
import {
  allChunkLoads, chunkAt, chunkLoad, chunkName, chunksAcross, MAP_LOAD_SHOWN,
} from '../../../ui/shell/windows/map-load';
import { makeObject, makeState } from '../../rules/_helpers';

const SOURCE = readFileSync('src/ui/shell/windows/map-load.ts', 'utf8');
const RENDERER = readFileSync('src/canvas/map2d/map-renderer.ts', 'utf8');

describe('a region\'s name', () => {
  it('is the row letter and the column number the map itself draws', () => {
    expect(chunkName(0, 0)).toBe('A1');
    expect(chunkName(3, 1)).toBe('B4');
    expect(chunkName(10, 8)).toBe('I11');
  });

  it('wraps its letters at Z, the way the renderer does', () => {
    expect(chunkName(0, 26)).toBe('A1');
    expect(RENDERER, 'the drawing side of the same rule').toContain('String.fromCharCode(65 + (row % 26))');
  });

  it('is asked for by macro cell, not by chunk index', () => {
    expect(chunkAt(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(chunkAt(CHUNK_SIZE, CHUNK_SIZE * 2 + 5)).toEqual({ cx: 1, cy: 2 });
  });

  it('divides a map into as many regions as the renderer letters', () => {
    expect(chunksAcross(CHUNK_SIZE * 3)).toBe(3);
    // A part-filled last column is still a region: a map is not a whole number of chunks wide.
    expect(chunksAcross(CHUNK_SIZE * 3 + 1)).toBe(4);
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
    expect(empty).not.toBeNull();
    expect(empty!.value).toBe(0);
    expect(empty!.objects).toBe(0);
  });

  /** The window's question is where there is ROOM, so a list of only the busy regions has no map
   *  in it and cannot answer it. */
  it('lists every region of the map, in reading order, empty ones included', () => {
    const state = makeState(CHUNK_SIZE * 3, CHUNK_SIZE * 2);
    const rows = allChunkLoads(getMapStats(state), CHUNK_SIZE * 3, CHUNK_SIZE * 2);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.name)).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3']);
  });
});

describe('the reading a release cannot carry', () => {
  it('is provisional today: the values are not confirmed, and this is a development build', () => {
    expect(CHUNK_LOAD_ENABLED, 'the game has not published per-item load values').toBe(false);
    expect(MAP_LOAD_SHOWN, 'so the control is drawn only because this is a dev build').toBe(true);
  });

  it('gates every path that answers without the rule armed behind the development flag', () => {
    const guards = SOURCE.match(/if \(!CHUNK_LOAD_ENABLED && !import\.meta\.env\.DEV\) return/g) ?? [];
    // One per exported reading: the single region, and every region.
    expect(guards).toHaveLength(2);
    expect(SOURCE).toContain('export const MAP_LOAD_SHOWN = CHUNK_LOAD_ENABLED || import.meta.env.DEV');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { placeTileCell, eraseTileCells, tileCatalogId, tileGhostColor } from '../../tools/paint/tile-coating';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { TerrainType, type EditorEvents } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { makeState, setTerrain } from '../rules/_helpers';
import { makeToolCtx, objectsByCatalog } from './_tool-ctx';
import { getObjectIndex } from '../../state/object-index';

const exec = (state: any) => new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());

describe('tile-coating helper', () => {
  beforeEach(() => useEditorStore.getState().setTileMaterial('dirt'));

  it('maps material to catalog id', () => {
    expect(tileCatalogId('dirt')).toBe('road-dirt');
    expect(tileCatalogId('stone')).toBe('road-stone');
  });

  it('places the active material on a grass cell', () => {
    const state = makeState(10, 10);
    placeTileCell({ x: 1, y: 1 }, makeToolCtx(state, exec(state)), new Set());
    const t = objectsByCatalog(state, 'road-dirt');
    expect(t.length).toBe(1);
    expect(t[0].position).toEqual({ x: 1, y: 1 });
  });

  it('places stone when material is stone', () => {
    useEditorStore.getState().setTileMaterial('stone');
    const state = makeState(10, 10);
    placeTileCell({ x: 2, y: 2 }, makeToolCtx(state, exec(state)), new Set());
    expect(objectsByCatalog(state, 'road-stone').length).toBe(1);
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(0);
  });

  it('skips water cells', () => {
    const state = makeState(10, 10);
    setTerrain(state, 3, 3, TerrainType.Water, 1);
    const ok = placeTileCell({ x: 3, y: 3 }, makeToolCtx(state, exec(state)), new Set());
    expect(ok).toBe(false);
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(0);
  });

  it('replaces an existing tile with a different material (one object)', () => {
    const state = makeState(10, 10);
    const e = exec(state);
    placeTileCell({ x: 4, y: 4 }, makeToolCtx(state, e), new Set());
    useEditorStore.getState().setTileMaterial('stone');
    placeTileCell({ x: 4, y: 4 }, makeToolCtx(state, e), new Set());
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(0);
    expect(objectsByCatalog(state, 'road-stone').length).toBe(1);
  });

  it('dedups repeated cells within a stroke', () => {
    const state = makeState(10, 10);
    const ctx = makeToolCtx(state, exec(state));
    const painted = new Set<string>();
    placeTileCell({ x: 5, y: 5 }, ctx, painted);
    const again = placeTileCell({ x: 5, y: 5 }, ctx, painted);
    expect(again).toBe(false);
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(1);
  });

  it('erases tiles on the given cells', () => {
    const state = makeState(10, 10);
    const e = exec(state);
    placeTileCell({ x: 6, y: 6 }, makeToolCtx(state, e), new Set());
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(1);
    eraseTileCells([{ x: 6, y: 6 }], makeToolCtx(state, e));
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(0);
  });

  /**
   * A tile fill places one object per cell, and every consumer between cells asks the
   * object index. If a cell's mutation loses its objectsDelta (or a coating lookup goes
   * back to scanning state.objects) the index rebuilds per cell and the fill turns
   * quadratic in the map's object count: a 40x40 fill over ~4k objects took 1.2s that
   * way, against ~30ms here. Rebuilds allocate a fresh entries array, so array identity
   * is the check that does not depend on machine speed.
   */
  it('fills a large area without rebuilding the object index per cell', () => {
    const state = makeState(60, 60);
    const e = exec(state);
    const ctx = makeToolCtx(state, e);
    // decorate away from the fill, so a rebuild would have plenty to re-derive
    for (let i = 0; i < 400; i++) {
      placeTileCell({ x: 40 + (i % 20), y: 30 + Math.floor(i / 20) }, ctx, new Set());
    }
    const before = getObjectIndex(state).entries;

    const painted = new Set<string>();
    for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) placeTileCell({ x, y }, ctx, painted);

    expect(painted.size).toBe(625);
    expect(getObjectIndex(state).entries).toBe(before);
    expect(getObjectIndex(state).entries.length).toBe(state.objects.size);

    // repainting the same area strips each old coating first: still no rebuild
    useEditorStore.getState().setTileMaterial('stone');
    const repaint = new Set<string>();
    for (let y = 0; y < 25; y++) for (let x = 0; x < 25; x++) placeTileCell({ x, y }, ctx, repaint);

    expect(getObjectIndex(state).entries).toBe(before);
    expect(objectsByCatalog(state, 'road-stone').length).toBe(625);
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(400);
  });

  it('ghost color matches the active material', () => {
    useEditorStore.getState().setTileMaterial('dirt');
    expect(tileGhostColor()).toBe(0xc4a882);
    useEditorStore.getState().setTileMaterial('stone');
    expect(tileGhostColor()).toBe(0x9ca3af);
  });
});

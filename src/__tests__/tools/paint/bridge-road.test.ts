import { describe, expect, it } from 'vitest';
import { TerrainType, type GridState } from '../../../core/model/types';
import { objectRect } from '../../../state/object-geometry';
import { placementOverlapRule } from '../../../rules/placement-overlap';
import { DrawingTool } from '../../../tools/paint/drawing-tool';
import { placeTileCell } from '../../../tools/paint/tile-coating';
import { ObjectPlacerTool } from '../../../tools/objects/object-placer';
import { makeExecutor, makeObject, makeState, paintCmd, placeCmd, setTerrain } from '../../rules/_helpers';
import { makeToolCtx, objectsByCatalog } from '../_tool-ctx';

function ravine(vertical = false, floor = 0, water = false): GridState {
  const state = makeState(24, 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const along = vertical ? y : x;
    if (along < 10 || along > 13) setTerrain(state, x, y, TerrainType.Mountain, 2);
    else if (water || floor > 0) setTerrain(state, x, y, water ? TerrainType.Water : TerrainType.Mountain, floor);
  }
  return state;
}

describe('roads beneath bridges', () => {
  const cases = [false, true].flatMap(vertical => [0, 1].flatMap(floor =>
    ['bridge-plank', 'bridge-teak'].flatMap(catalogId => [0, 0.5].map(offset => ({ vertical, floor, catalogId, offset })))));

  it.each(cases)('paints and repaints below $catalogId at floor $floor (vertical=$vertical, offset=$offset)', ({ vertical, floor, catalogId, offset }) => {
    const state = ravine(vertical, floor);
    const executor = makeExecutor(state);
    const anchor = vertical ? { x: 11 + offset, y: 11 } : { x: 11, y: 11 + offset };
    new ObjectPlacerTool().onPointerDown(anchor, anchor, makeToolCtx(state, executor, 1, 1, { armedItem: catalogId }));
    const [bridge] = objectsByCatalog(state, catalogId);
    expect(bridge).toBeDefined();
    expect(bridge.elevation).toBe(2);
    const original = structuredClone(bridge);
    const rect = objectRect(bridge);
    const cell = { x: 11, y: 11 };
    expect(cell.x + 1 > rect.x && cell.x < rect.x + rect.w && cell.y + 1 > rect.y && cell.y < rect.y + rect.h).toBe(true);

    const tool = new DrawingTool();
    tool.contentType = 'tile';
    for (const material of ['path-overgrown-dirt', 'path-cobblestone']) {
      const ctx = makeToolCtx(state, executor, 1, 1, { tileMaterial: material });
      expect(tool.canActAt(cell, ctx)).toBe(true);
      const start = executor.getUndoStackSize();
      expect(placeTileCell(cell, ctx, new Set())).toBe(true);
      expect(executor.commitStroke(start)).toEqual([]);
      expect(objectsByCatalog(state, material)).toHaveLength(1);
      expect(objectsByCatalog(state, material)[0].elevation).toBe(floor);
      expect(state.objects.get(bridge.id)).toEqual(original);
    }
    expect(objectsByCatalog(state, 'path-overgrown-dirt')).toHaveLength(0);
    expect(executor.undo()).toBe(true);
    expect(objectsByCatalog(state, 'path-overgrown-dirt')).toHaveLength(1);
    expect(objectsByCatalog(state, 'path-cobblestone')).toHaveLength(0);
    executor.redo();
    expect(objectsByCatalog(state, 'path-cobblestone')).toHaveLength(1);
    expect(state.objects.get(bridge.id)).toEqual(original);
  });

  it('keeps water, bridge supports and terrain edits blocked', () => {
    for (const water of [false, true]) {
      const state = ravine(false, 0, water);
      const executor = makeExecutor(state);
      const anchor = { x: 11, y: 11 };
      new ObjectPlacerTool().onPointerDown(anchor, anchor, makeToolCtx(state, executor, 1, 1, { armedItem: 'bridge-plank' }));
      expect(objectsByCatalog(state, 'bridge-plank')).toHaveLength(1);
      const support = placeCmd({ ...makeObject('path-cobblestone', 9, 11), elevation: 2 });
      expect(placementOverlapRule.validate(support, state).map(e => e.ruleId)).toContain('V-PLACE-OVERLAP');
      expect(executor.execute(paintCmd([anchor], TerrainType.Mountain, 1)).success).toBe(false);
      if (water) expect(placeTileCell(anchor, makeToolCtx(state, executor), new Set())).toBe(false);
    }
  });
});

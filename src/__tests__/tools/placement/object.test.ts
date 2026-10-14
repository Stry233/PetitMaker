import { describe, it, expect } from 'vitest';
import { makeState, setTerrain, makeExecutor } from '../../_support/map-state';
import { getCatalogByCategory } from '../../../state/catalog';
import { makeCtx, tryDecorate, tryPlace, probePlacement } from '../../../tools/placement/object';
import { TerrainType } from '../../../core/model/types';
import { networkCells } from '../../../tools/macros/roads/walkable';
import { readRoadStyle } from '../../../tools/macros/roads/road-style';
import { ItemCategory } from '../../../config/catalog/categories';

const floraId = getCatalogByCategory(ItemCategory.Flora)[0]!.id;
const roadId = getCatalogByCategory(ItemCategory.Road)[0]!.id;

function ctxFor(size = 12) {
  const state = makeState(size, size);
  const exec = makeExecutor(state);
  return { state, exec, ctx: makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), 42) };
}

describe('placement/object', () => {
  it('keeps surface prints out of pavement reuse, connectivity and style inference', () => {
    const { state, exec, ctx } = ctxFor();
    const style = readRoadStyle(state);
    expect(tryPlace(ctx, 'print-field-line', 4, 4)).not.toBeNull();
    expect(ctx.roads.size).toBe(0);
    expect(makeCtx(state, c => exec.execute(c), exec.getRegistry(), 42).roads.size).toBe(0);
    expect(networkCells(state, state.template.width, state.template.height).cells.size).toBe(0);
    expect(readRoadStyle(state)).toEqual(style);
    expect(tryPlace(ctx, roadId, 4, 4)).not.toBeNull();
    expect(ctx.roads.size).toBe(1);
    expect(networkCells(state, state.template.width, state.template.height).cells.size).toBe(1);
  });

  it.each([ItemCategory.Bridge, ItemCategory.Ramp])('probes snapped %s geometry without changing the map or history', kind => {
    const { state, exec, ctx } = ctxFor(20), bridge = kind === ItemCategory.Bridge;
    for (let y = 3; y < 18; y++) for (let x = bridge ? 7 : 10; x < (bridge ? 11 : 17); x++) setTerrain(
      state, x, y, bridge ? TerrainType.Water : TerrainType.Mountain, bridge ? 0 : 1,
    );
    const cells = JSON.stringify(state.cells), versions = [state.cellsVersion, state.objectsVersion];
    const id = getCatalogByCategory(kind)[0]!.id, x = bridge ? 8 : 9;
    const probe = probePlacement(ctx, id, x, 8.5);
    expect(probe).toMatchObject({ position: { x: bridge ? 6 : 8, y: 8.5 }, elevation: bridge ? 0 : 1, rotation: bridge ? 0 : 270 });
    expect(state.objects.size).toBe(0);
    expect(JSON.stringify(state.cells)).toBe(cells);
    expect([state.cellsVersion, state.objectsVersion]).toEqual(versions);
    expect(exec.historyDepth()).toBe(0);
    const placed = tryPlace(ctx, id, x, 8.5);
    expect(placed).toEqual({ ...probe, id: placed?.id });
  });

  it('places flora on flat grass and returns the object it put on the map', () => {
    const { state, ctx } = ctxFor();
    const placed = tryPlace(ctx, floraId, 5, 5);
    expect(state.objects.size).toBe(1);
    expect([...state.objects.values()][0]!.id).toBe(placed?.id);
  });
  it('returns null + places nothing when the rule rejects (water under a flat item)', () => {
    const { state, ctx } = ctxFor();
    state.cells[5]![5]!.terrain = { type: TerrainType.Water, elevation: 0 };
    expect(tryPlace(ctx, floraId, 5, 5)).toBeNull();
    expect(state.objects.size).toBe(0);
  });

  describe('a decoration never stands inside the street', () => {
    it('refuses a median cell between two parallel road strips (2 paved sides)', () => {
      const { state, ctx } = ctxFor();
      expect(tryPlace(ctx, roadId, 4, 5)).toBeTruthy();
      expect(tryPlace(ctx, roadId, 6, 5)).toBeTruthy();
      // (5,5) is bare ground with pavement on both its left and right edges — a median.
      expect(tryDecorate(ctx, floraId, 5, 5)).toBeNull();
      expect(state.objects.size).toBe(2);
    });

    it('refuses a pocket a looped road encloses on all four sides', () => {
      const { state, ctx } = ctxFor();
      for (const [x, y] of [[4, 4], [5, 4], [6, 4], [4, 5], [6, 5], [4, 6], [5, 6], [6, 6]] as const) {
        expect(tryPlace(ctx, roadId, x, y), `road@${x},${y}`).toBeTruthy();
      }
      expect(tryDecorate(ctx, floraId, 5, 5)).toBeNull();
      expect(state.objects.size).toBe(8);
    });

    it('still plants a curb-adjacent cell with exactly one paved side', () => {
      const { state, ctx } = ctxFor();
      expect(tryPlace(ctx, roadId, 5, 5)).toBeTruthy();
      // (5,4) touches pavement on one side only — beside the road, not inside it.
      expect(tryDecorate(ctx, floraId, 5, 4)).toBeTruthy();
      expect(state.objects.size).toBe(2);
    });
  });
});

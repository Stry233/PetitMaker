import { describe, expect, it } from 'vitest';
import { objectBlocksTerrainCell, objectBlocksTerrainRule } from '../../rules/object-blocks-terrain';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { getObjectIndex } from '../../state/object-index';
import { CommandType, TerrainType, type Command, type GridState, type PlacedObject } from '../../core/model/types';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { eraseCmd, makeState, paintCmd } from '../_support/map-state';

const at = (id: string, catalogId: string, x: number, y: number): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation: 0, elevation: 0 });

function withObjects(...objs: PlacedObject[]): GridState {
  const state = makeState(20, 20);
  for (const o of objs) state.objects.set(o.id, o);
  bumpObjectsVersion(state, { added: objs });
  return state;
}

const mountain = (x: number, y: number) => paintCmd([{ x, y }], TerrainType.Mountain, 1);
const water = (x: number, y: number) => paintCmd([{ x, y }], TerrainType.Water, 1);

describe('V-PLACE-BLOCK: terrain stays out from under objects', () => {
  // A 1x1 object at (5, 5) covers [5, 6) on the object grid; terrain cell (x, y) covers [x - 0.5, x + 0.5).
  const tree = at('tree', 'tree-apple', 5, 5);

  it.each([[5, 5], [6, 5], [5, 6], [6, 6]])('refuses a paint on terrain cell (%s, %s), which overlaps the tree', (x, y) => {
    const errors = objectBlocksTerrainRule.validate(mountain(x, y), withObjects(tree));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ ruleId: 'V-PLACE-BLOCK', message: 'error.object_blocks_terrain', grid: PLACEMENT_GRID });
    // The evidence is the tree's own drawn footprint, not the shifted terrain cell.
    expect(errors[0]!.rects).toEqual([{ x: 5, y: 5, w: 1, h: 1 }]);
  });

  it.each([[4, 5], [7, 5], [5, 4], [5, 7], [4, 4], [7, 7]])('allows terrain cell (%s, %s), which only touches or misses it', (x, y) => {
    expect(objectBlocksTerrainRule.validate(mountain(x, y), withObjects(tree))).toEqual([]);
    expect(objectBlocksTerrainRule.validate(eraseCmd([{ x, y }]), withObjects(tree))).toEqual([]);
  });

  it('reports each blocking object once however many cells of the command it covers', () => {
    const state = withObjects(tree, at('cabin', 'building-forest-cabin', 10, 10));
    const cmd = paintCmd([{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 11, y: 11 }, { x: 12, y: 12 }], TerrainType.Mountain, 1);
    const errors = objectBlocksTerrainRule.validate(cmd, state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rects).toEqual([{ x: 5, y: 5, w: 1, h: 1 }, { x: 10, y: 10, w: 5, h: 4 }]);
  });

  it('lets a mountain paint and an erase follow a road, but refuses water on it', () => {
    const state = withObjects(at('road', 'path-garden-stone', 5, 5));
    expect(objectBlocksTerrainRule.validate(mountain(5, 5), state)).toEqual([]);
    expect(objectBlocksTerrainRule.validate(eraseCmd([{ x: 5, y: 5 }]), state)).toEqual([]);
    expect(objectBlocksTerrainRule.validate(water(5, 5), state)).toHaveLength(1);
  });

  it('exempts a plain edge cut, which only removes terrain', () => {
    const cut: Command = {
      type: CommandType.TrimCorners, layer: 'terrain', x: 5, y: 5,
      afterCorners: ['fan', 'square', 'square', 'square'],
    } as Command;
    expect(objectBlocksTerrainRule.validate(cut, withObjects(tree))).toEqual([]);
  });

  it('answers planners with the same per-cell test', () => {
    const state = withObjects(tree, at('road', 'path-garden-stone', 10, 10));
    const index = getObjectIndex(state);
    for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) {
      for (const follows of [false, true]) {
        const cmd = follows ? mountain(x, y) : water(x, y);
        expect(objectBlocksTerrainCell(index, x, y, follows), `(${x}, ${y}) follows=${follows}`)
          .toBe(objectBlocksTerrainRule.validate(cmd, state).length > 0);
      }
    }
  });
});

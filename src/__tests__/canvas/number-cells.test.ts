/**
 * The per-chunk label plan for the layer-number overlay: object footprints and
 * ground-island cells mask their numbers, hidden layers drop theirs, and the
 * plan never leaves its chunk.
 */
import { describe, it, expect } from 'vitest';
import { chunkNumberCells } from '../../canvas/map2d/layers/number-cells';
import { ItemCategory, TerrainType } from '../../core/model/types';
import type { PlacedObject } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { registerCatalogItem } from '../../state/catalog';

registerCatalogItem({
  id: 'num-house', category: ItemCategory.Building, name: { en: 'Number House' },
  width: 2, height: 2, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [],
});

const find = (cells: { x: number; y: number; label: string }[], x: number, y: number) =>
  cells.find((c) => c.x === x && c.y === y);

describe('chunkNumberCells', () => {
  it('labels every cell with its elevation, staying inside the chunk and the map', () => {
    const state = makeState(20, 20);
    setTerrain(state, 3, 3, TerrainType.Mountain, 4);
    const cells = chunkNumberCells(state, 0, 0, new Set());
    expect(cells).toHaveLength(16 * 16);
    expect(find(cells, 3, 3)?.label).toBe('4');
    expect(find(cells, 0, 0)?.label).toBe('0');
    expect(cells.every((c) => c.x < 16 && c.y < 16)).toBe(true);
  });

  it('masks the cells under an object footprint', () => {
    const state = makeState(20, 20);
    const house: PlacedObject = {
      id: 'h', catalogId: 'num-house', position: { x: 4, y: 4 },
      rotation: 0, elevation: 0,
    };
    state.objects.set(house.id, house);
    const cells = chunkNumberCells(state, 0, 0, new Set());
    expect(find(cells, 4, 4)).toBeUndefined();
    expect(find(cells, 5, 5)).toBeUndefined();
    expect(find(cells, 6, 4)?.label).toBe('0'); // one past the footprint labels again
  });

  it('drops hidden layers and ground-island cells', () => {
    const state = makeState(20, 20);
    setTerrain(state, 2, 2, TerrainType.Mountain, 3);
    state.cells[6]![6]!.terrain = { type: TerrainType.None, elevation: 0, corners: ['fan', 'square', 'square', 'square'] };
    const cells = chunkNumberCells(state, 0, 0, new Set([3]));
    expect(find(cells, 2, 2)).toBeUndefined(); // its layer is hidden
    expect(find(cells, 6, 6)).toBeUndefined(); // island-cut cell carries no number
  });

  it('an edge chunk clips to the map', () => {
    const state = makeState(20, 20);
    const cells = chunkNumberCells(state, 1, 1, new Set());
    expect(cells).toHaveLength(4 * 4); // 20-16 = 4 cells remain each axis
  });
});

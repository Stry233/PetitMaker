// @vitest-environment jsdom
/**
 * The programmatic EditorAPI (window.__PETIT_API in dev builds): placements
 * must persist the catalog-derived category and the real standable surface,
 * exactly like the interactive placer.
 */
import { describe, it, expect } from 'vitest';
import { EditorAPI, installDevAPI } from '../../../editor/dev/editor-api';
import { TerrainType } from '../../../core/model/types';
import type { GridState } from '../../../core/model/types';
import { getCatalogItem, getPlaceableByCategory } from '../../../state/catalog';
import { makeState, setTerrain, makeExecutor } from '../../_support/map-state';
import { setStoreState } from '../../_support/store';
import { ItemCategory } from '../../../config/catalog/categories';

function world(): { state: GridState; api: EditorAPI } {
  const state = makeState(20, 20);
  const executor = makeExecutor(state);
  return { state, api: new EditorAPI(() => state, () => executor) };
}

describe('EditorAPI.placeObject', () => {
  it('persists the catalog-derived category, not a fixed one', () => {
    const { state, api } = world();
    const tree = getPlaceableByCategory(ItemCategory.Tree)[0]!;
    const res = api.placeObject(tree.id, 5, 5);
    expect(res.success).toBe(true);
    const placed = [...state.objects.values()].find((o) => o.catalogId === tree.id);
    expect(getCatalogItem(placed!.catalogId)?.category).toBe(ItemCategory.Tree);
  });

  it('records the structural surface elevation of the anchor cell', () => {
    const { state, api } = world();
    setTerrain(state, 8, 8, TerrainType.Mountain, 2);
    // A 3x3 flat top so the flat trait accepts the placement.
    for (let y = 7; y <= 10; y++) for (let x = 7; x <= 10; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    const tree = getPlaceableByCategory(ItemCategory.Tree)[0]!;
    const res = api.placeObject(tree.id, 8, 8);
    expect(res.success).toBe(true);
    const placed = [...state.objects.values()].find((o) => o.catalogId === tree.id);
    expect(placed?.elevation).toBe(2);
  });
});

describe('installDevAPI', () => {
  it('publishes the console API, which names the missing map before one is loaded', () => {
    setStoreState({ gridState: null });
    installDevAPI();
    const api = (window as unknown as { __PETIT_API: EditorAPI }).__PETIT_API;
    expect(() => api.getCell(0, 0)).toThrow('EditorAPI: no map is loaded');
    delete (window as unknown as { __PETIT_API?: EditorAPI }).__PETIT_API;
  });
});

describe('EditorAPI JSON round trip', () => {
  it('reads back the save it writes', () => {
    const state = makeState(20, 20);
    const api = new EditorAPI(() => state, () => makeExecutor(state));
    const back = api.importJSON(api.exportJSON());
    expect(back.template.width).toBe(state.template.width);
    expect(back.cells.length).toBe(state.cells.length);
  });
});

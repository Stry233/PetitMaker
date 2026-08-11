/**
 * The programmatic EditorAPI (window.__PETIT_API in dev builds): placements
 * must persist the catalog-derived category and the real standable surface,
 * exactly like the interactive placer.
 */
import { describe, it, expect } from 'vitest';
import { EditorAPI } from '../../api/editor-api';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { ItemCategory, TerrainType } from '../../core/model/types';
import type { EditorEvents, GridState } from '../../core/model/types';
import { getCatalogItem, getPlaceableByCategory } from '../../state/catalog';
import { makeState, setTerrain } from '../rules/_helpers';
import { roadLookup } from '../../state/object-index';

function world(): { state: GridState; api: EditorAPI } {
  const state = makeState(20, 20);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
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

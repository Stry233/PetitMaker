import { ItemCategory, TerrainType, type BlockRef, type GridState } from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { surfaceElevation } from '../core/edge-cut/terrain-silhouette';
import { getCatalogByCategory, getCatalogItem } from '../state/catalog';
import { singleSelection } from '../state/selection';
import { useEditorStore } from '../state/store';

type PickedMaterial =
  | { mode: 'mountain' | 'water'; elevation: number }
  | { mode: 'road'; itemId: string }
  | { mode: 'object'; itemId: string; rotation: 0 | 90 | 180 | 270 };

/** Sampling chooses a material; it never copies map geometry or bypasses placement limits. */
export function pickedMaterial(grid: GridState | null, selection: readonly BlockRef[]): PickedMaterial | null {
  const block = singleSelection(selection);
  if (!grid || !block) return null;
  if (block.kind === 'terrain') {
    const terrain = getCell(grid.cells, block.x, block.y)?.terrain;
    if (terrain?.type === TerrainType.Mountain) return { mode: 'mountain', elevation: Math.max(1, surfaceElevation(terrain)) };
    if (terrain?.type === TerrainType.Water) return { mode: 'water', elevation: terrain.elevation };
    return null;
  }
  const object = grid.objects.get(block.id);
  const item = object && getCatalogItem(object.catalogId);
  if (!object || !item || (item.maxCount ?? Infinity) < 2) return null;
  if (!getCatalogByCategory(item.category).some(entry => entry.id === item.id)) return null;
  return item.category === ItemCategory.Road
    ? { mode: 'road', itemId: item.id }
    : { mode: 'object', itemId: item.id, rotation: item.rotatable ? object.rotation : 0 };
}

export function pickSelection(): void {
  const state = useEditorStore.getState();
  const material = pickedMaterial(state.gridState, state.selection);
  if (!material) return;
  state.setSelection([]);
  state.setSelectingRegion(false);
  if (material.mode === 'object') {
    state.setEditMode({ mode: 'object', itemId: material.itemId });
    state.setPlacementRotation(material.rotation);
    state.eventBus.emit('catalog-reveal', { catalogId: material.itemId });
  } else {
    if (material.mode === 'road') state.setTileMaterial(material.itemId);
    else state.setActiveLayer(material.elevation);
    state.setEditMode({ mode: material.mode, tool: 'brush' });
  }
}

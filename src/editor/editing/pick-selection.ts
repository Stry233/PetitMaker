import { TerrainType, type GridState, type Rotation } from '../../core/model/types';
import { type BlockRef, singleSelection } from '../../state/selection';
import { getCell } from '../../core/model/grid-model';
import { surfaceElevation } from '../../core/domain/terrain/terrain-surface';
import { getOfferedItem } from '../../state/catalog';
import { batchStore, useEditorStore } from '../../state/store';
import { isCoating } from '../../core/model/traits';

type PickedMaterial =
  | { mode: 'mountain' | 'water'; elevation: number }
  | { mode: 'road'; itemId: string; rotation?: Rotation }
  | { mode: 'object'; itemId: string; rotation: Rotation };

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
  const item = object && getOfferedItem(object.catalogId);
  if (!object || !item || (item.maxCount ?? Infinity) < 2) return null;
  return isCoating(item)
    ? { mode: 'road', itemId: item.id, ...(item.rotatable ? { rotation: object.rotation } : {}) }
    : { mode: 'object', itemId: item.id, rotation: item.rotatable ? object.rotation : 0 };
}

/** Arms what the selection is made of, published as one update. The mode is armed first, since
 *  arming a different item resets `placementRotation`; the picked rotation is written after it. */
export function pickSelection(): void {
  const material = pickedMaterial(useEditorStore.getState().gridState, useEditorStore.getState().selection);
  if (!material) return;
  batchStore(() => {
    const state = useEditorStore.getState();
    state.setSelection([]);
    state.setSelectingRegion(false);
    if (material.mode === 'object') {
      state.setEditMode({ mode: 'object', arm: { kind: 'item', itemId: material.itemId } });
      state.setPlacementRotation(material.rotation);
      return;
    }
    if (material.mode !== 'road') state.setActiveLayer(material.elevation);
    state.setEditMode({ mode: material.mode, arm: { kind: 'brush' } });
    if (material.mode === 'road') {
      state.setTileMaterial(material.itemId);
      state.setPlacementRotation(material.rotation ?? 0);
    }
  });
  if (material.mode === 'object') useEditorStore.getState().eventBus.emit('catalog-reveal', { catalogId: material.itemId });
}

import { describe, it, expect, afterEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { pickSelection } from '../../../editor/editing/pick-selection';
import { getAllItems, getRoadMaterials } from '../../../state/catalog';
import { isCoating } from '../../../core/model/traits';
import { makeState } from '../../_support/map-state';
import { resetStore, setStoreState } from '../../_support/store';
import type { EditorStore } from '../../../state/store';

const rotatableRoad = () => [...getRoadMaterials(), ...getRoadMaterials(true)]
  .find((r) => r.rotatable && (r.maxCount ?? Infinity) >= 2)!;
const otherItem = () => getAllItems().find((i) => !isCoating(i) && (i.maxCount ?? Infinity) >= 2)!;

function seedRoad(): string {
  const grid = makeState();
  const road = rotatableRoad();
  grid.objects.set('r1', { id: 'r1', catalogId: road.id, position: { x: 1, y: 1 }, rotation: 90, elevation: 0 });
  setStoreState({ gridState: grid });
  return road.id;
}

describe('pickSelection', () => {
  afterEach(resetStore);

  it('keeps a picked road rotation when an item was armed', () => {
    const roadId = seedRoad();
    useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: otherItem().id } });
    useEditorStore.getState().setSelection([{ kind: 'object', id: 'r1' }]);
    pickSelection();
    const after = useEditorStore.getState();
    expect(after.editMode.mode).toBe('road');
    expect(after.tileMaterial).toBe(roadId);
    expect(after.placementRotation).toBe(90);
  });

  it('publishes the pick as one update', () => {
    seedRoad();
    useEditorStore.getState().setSelection([{ kind: 'object', id: 'r1' }]);
    const seen: EditorStore[] = [];
    const stop = useEditorStore.subscribe((s) => { seen.push(s); });
    pickSelection();
    stop();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.placementRotation).toBe(90);
  });
});

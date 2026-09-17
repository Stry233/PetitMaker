import { describe, expect, it } from 'vitest';
import { attributedNotes, captureImageAttribution, imageChangeRatio, protectedImageNotes } from '../../../core/provenance/image-attribution';
import { TerrainType } from '../../../core/model/types';
import { makeExecutor, makeObject, makeState, paintCmd, setTerrain } from '../../rules/_helpers';
import { useEditorStore } from '../../../state/store';

function importedMap() {
  const state = makeState();
  for (let x = 0; x < 10; x++) setTerrain(state, x, 2, TerrainType.Mountain, 1);
  state.notes = { title: 'Garden', description: 'A riverside walk' };
  state.imageAttribution = captureImageAttribution(state);
  return state;
}

describe('image attribution', () => {
  it('unlocks at thirty percent and relocks after undo', () => {
    const state = importedMap();
    const executor = makeExecutor(state);
    const start = executor.getUndoStackSize();
    expect(executor.execute(paintCmd([{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 }], TerrainType.Mountain, 2)).success).toBe(true);
    expect(executor.commitStroke(start)).toEqual([]);
    expect(imageChangeRatio(state)).toBe(0.3);
    expect(protectedImageNotes(state)).toBeUndefined();
    state.notes = { title: 'Revised garden' };
    executor.undo();
    expect(imageChangeRatio(state)).toBe(0);
    expect(attributedNotes(state)).toEqual(state.imageAttribution!.notes);
    executor.redo();
    expect(attributedNotes(state)).toEqual({ title: 'Revised garden' });
  });

  it('counts additions and removals against actual occupied content', () => {
    const state = importedMap();
    state.cells[2]![0]!.terrain = null;
    state.cells[2]![1]!.terrain = null;
    expect(imageChangeRatio(state)).toBe(0.2);
    for (let x = 0; x < 2; x++) setTerrain(state, x, 2, TerrainType.Mountain, 1);
    for (let x = 0; x < 5; x++) setTerrain(state, x, 3, TerrainType.Mountain, 1);
    expect(imageChangeRatio(state)).toBeCloseTo(5 / 15);
  });

  it('ignores object IDs, annotation edits and repeated edits restored to their original value', () => {
    const state = importedMap();
    const obj = makeObject('flower', 4, 4);
    state.objects.set(obj.id, obj);
    state.imageAttribution = captureImageAttribution(state);
    state.objects.clear();
    state.objects.set('new-id', { ...obj, id: 'new-id' });
    state.annotations = { visible: true, locked: false, items: [{ kind: 'chip', id: 'note', tag: 'garden', x: 1, y: 1, color: '#abc', size: 'm' }] };
    for (let i = 0; i < 20; i++) {
      setTerrain(state, 0, 2, TerrainType.Mountain, 2);
      setTerrain(state, 0, 2, TerrainType.Mountain, 1);
    }
    expect(imageChangeRatio(state)).toBe(0);
    state.objects.get('new-id')!.rotation = 90;
    expect(imageChangeRatio(state)).toBeCloseTo(1 / 11);
  });

  it('preserves only nonempty original fields through the store setter', () => {
    const state = importedMap();
    state.notes = { title: 'Garden' };
    state.imageAttribution = captureImageAttribution(state);
    useEditorStore.setState({ gridState: state });
    useEditorStore.getState().setMapNotes({ title: 'Other title', description: 'New description' });
    expect(state.notes).toEqual({ title: 'Garden', description: 'New description' });
  });

  it('leaves maps without image attribution editable and preserves an empty-map title', () => {
    const state = makeState();
    state.notes = { title: 'Blank plan' };
    expect(protectedImageNotes(state)).toBeUndefined();
    state.imageAttribution = captureImageAttribution(state);
    expect(protectedImageNotes(state)).toEqual(state.notes);
    state.notes = {};
    expect(captureImageAttribution(state)).toBeUndefined();
  });
});

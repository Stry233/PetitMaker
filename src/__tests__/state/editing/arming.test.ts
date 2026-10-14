import { describe, it, expect, beforeEach } from 'vitest';
import { armingOf, sameArming } from '../../../state/editing/arming';
import { ToolType } from '../../../state/editing/vocabulary';
import { useEditorStore } from '../../../state/store';
import { buildShapeOf } from '../../../state/editing/edit-mode';
import { resetStore, setStoreState } from '../../_support/store';

beforeEach(resetStore);

describe('armingOf', () => {
  it('reads what the bar resolved, under the names the tools use', () => {
    useEditorStore.getState().setEditMode({ mode: 'water', arm: { kind: 'shape', shape: 'circle' } });
    setStoreState({ activeLayer: 2, layerPinned: true, drawingBrushSize: 3 });
    const arming = armingOf(useEditorStore.getState());
    expect(arming).toMatchObject({
      tool: ToolType.TerrainBrush, shape: 'circle', contentType: 'water', floor: 2, layerPinned: true, brushSize: 3,
      groundEditable: false,
    });
  });

  it('gives the brush shape while another tool is up, and the remembered figure on the way back', () => {
    const s = useEditorStore.getState();
    s.setEditMode({ mode: 'mountain', arm: { kind: 'shape', shape: 'line' } });
    s.setEditMode({ mode: 'mountain', arm: { kind: 'erase' } });
    expect(armingOf(useEditorStore.getState())).toMatchObject({ tool: ToolType.Eraser, shape: 'free' });
    s.setEditMode({ mode: 'mountain', arm: { kind: 'shape', shape: buildShapeOf(useEditorStore.getState()) } });
    expect(armingOf(useEditorStore.getState()).shape).toBe('line');
  });

  it('is one snapshot per store state, and a new one after any change', () => {
    const before = armingOf(useEditorStore.getState());
    expect(armingOf(useEditorStore.getState())).toBe(before);
    setStoreState({ drawingBrushSize: 4 });
    const after = armingOf(useEditorStore.getState());
    expect(after).not.toBe(before);
    expect(after.brushSize).toBe(4);
    expect(before.brushSize).toBe(1);
  });

  it('keeps the notes document apart from the bar, and still answers alike only when both agree', () => {
    const before = armingOf(useEditorStore.getState());
    expect(before.notes).toEqual({ selection: [], draft: null, historyEpoch: 0, discardPending: false });
    setStoreState({ viewMode: '3d' });
    expect(sameArming(armingOf(useEditorStore.getState()), before)).toBe(true);
    setStoreState({ annotationSelection: ['n1'] });
    const selected = armingOf(useEditorStore.getState());
    expect(selected.notes.selection).toEqual(['n1']);
    expect(sameArming(selected, before)).toBe(false);
  });
});

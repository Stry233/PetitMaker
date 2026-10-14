import { describe, it, expect, beforeEach } from 'vitest';
import { ToolType } from '../../../../state/editing/vocabulary';
import { DrawingTool } from '../../../../tools/pointer/paint/drawing-tool';
import { useEditorStore } from '../../../../state/store';
import { buildShapeOf } from '../../../../state/editing/edit-mode';
import { resetStore, setStoreState } from '../../../_support/store';
import { makeTestToolManager } from '../../../_support/tool-manager';

beforeEach(resetStore);

describe('a tool manager built for a map that arrives mid-session', () => {
  it('draws with the shape, content, layer and size the shell already shows', () => {
    useEditorStore.getState().setEditMode({ mode: 'water', arm: { kind: 'shape', shape: 'line' } });
    setStoreState({ activeLayer: 2, drawingBrushSize: 3 });

    const tm = makeTestToolManager();
    tm.syncArming();

    const dt = tm.getToolById(ToolType.TerrainBrush);
    expect(dt).toBeInstanceOf(DrawingTool);
    expect(tm.getActiveTool()).toBe(dt);
    const { arming } = tm.getContext();
    expect(arming.shape).toBe('line');
    expect(arming.contentType).toBe('water');
    expect(arming.floor).toBe(2);
    expect(arming.brushSize).toBe(3);
  });

  it('draws the remembered shape again when the shell comes back from a mode another tool owns', () => {
    const s = useEditorStore.getState();
    s.setEditMode({ mode: 'water', arm: { kind: 'shape', shape: 'curve' } });
    const tm = makeTestToolManager();
    tm.syncArming();
    s.setEditMode({ mode: 'water', arm: { kind: 'erase' } });
    tm.syncArming();
    expect(tm.getActiveTool().id).toBe(ToolType.Eraser);

    s.setEditMode({ mode: 'water', arm: { kind: 'shape', shape: buildShapeOf(useEditorStore.getState()) } });
    tm.syncArming();
    expect(tm.getActiveTool().id).toBe(ToolType.TerrainBrush);
    expect(tm.getContext().arming.shape).toBe('curve');
  });
});

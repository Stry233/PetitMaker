// @vitest-environment jsdom
/** The map revision moves with every edit and its undo, at once or once a frame, and stands still while not listening. */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { CommandType, TerrainType } from '../../../core/model/types';
import { useMapRevision } from '../../../ui/session/use-map-revision';

function paint(): void {
  const executor = useEditorStore.getState().commandExecutor!;
  const start = executor.beginStroke();
  executor.execute({ type: CommandType.PaintTerrain, cells: [{ x: 60, y: 60 }], terrainType: TerrainType.Mountain, elevation: 1 });
  start.commit();
}

describe('useMapRevision', () => {
  beforeEach(() => { localStorage.clear(); newMap(editorPort, 'hexia'); });

  it('re-reads after an edit and after its undo', () => {
    const { result } = renderHook(() => useMapRevision());
    const before = result.current;
    act(() => { paint(); });
    const edited = result.current;
    expect(edited).not.toBe(before);
    act(() => { useEditorStore.getState().commandExecutor!.undo(); });
    expect(result.current).not.toBe(edited);
  });

  it('re-renders once in the frame after a run of edits when frame-timed', async () => {
    let renders = 0;
    const { result } = renderHook(() => { renders++; return useMapRevision(true, 'frame'); });
    const before = result.current;
    const settled = renders;
    act(() => { paint(); paint(); paint(); });
    expect(renders).toBe(settled);
    await act(async () => { await new Promise<void>((frame) => requestAnimationFrame(() => frame())); });
    expect(renders).toBe(settled + 1);
    expect(result.current).not.toBe(before);
  });

  it('keeps its reading through edits while not listening', () => {
    const { result } = renderHook(() => useMapRevision(false));
    const before = result.current;
    act(() => { paint(); });
    expect(result.current).toBe(before);
  });
});

/** The map revision moves with every edit and its undo, and stands still while not listening. */
import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { newMap } from '../../../kit/operations/map';
import { CommandType, TerrainType } from '../../../core/model/types';
import { useMapRevision } from '../../../ui/hooks/use-map-revision';

function paint(): void {
  const executor = useEditorStore.getState().commandExecutor!;
  const start = executor.getUndoStackSize();
  executor.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 60, y: 60 }], terrainType: TerrainType.Mountain, elevation: 1 });
  executor.commitStroke(start);
}

describe('useMapRevision', () => {
  beforeEach(() => { localStorage.clear(); newMap('hexia'); });

  it('re-reads after an edit and after its undo', () => {
    const { result } = renderHook(() => useMapRevision());
    const before = result.current;
    act(() => { paint(); });
    const edited = result.current;
    expect(edited).not.toBe(before);
    act(() => { useEditorStore.getState().commandExecutor!.undo(); });
    expect(result.current).not.toBe(edited);
  });

  it('keeps its reading through edits while not listening', () => {
    const { result } = renderHook(() => useMapRevision(false));
    const before = result.current;
    act(() => { paint(); });
    expect(result.current).toBe(before);
  });
});

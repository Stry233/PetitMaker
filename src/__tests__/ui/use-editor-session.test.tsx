import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useEditorStore } from '../../state/store';
import { makeState } from '../rules/_helpers';
import { useEditorSession } from '../../ui/hooks/use-editor-session';
import { scheduleAutosave } from '../../io/autosave';
import { host } from '../../kit/host';

vi.mock('../../io/autosave', () => ({ scheduleAutosave: vi.fn() }));
vi.mock('../../canvas/interaction/selection-view-sync', () => ({ installSelectionViewSync: () => () => {} }));
vi.mock('../../canvas/interaction/region-view-sync', () => ({ installRegionViewSync: () => () => {} }));
vi.mock('../../kit/operations/map', () => ({ loadMap: (state: ReturnType<typeof makeState>) => useEditorStore.setState({ gridState: state }) }));
vi.mock('../../kit/host', () => ({ host: { camera: { set2d: vi.fn(), set3d: vi.fn() } } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('shared editor session', () => {
  it('persists captions as well as annotations when the map reference stays the same', () => {
    const map = makeState();
    useEditorStore.setState({ gridState: map, notesEpoch: 0, annotationsEpoch: 0 });
    renderHook(() => useEditorSession());
    vi.mocked(scheduleAutosave).mockClear();
    act(() => useEditorStore.setState({ notesEpoch: 1 }));
    expect(scheduleAutosave).toHaveBeenLastCalledWith(map);
    vi.mocked(scheduleAutosave).mockClear();
    act(() => useEditorStore.setState({ annotationsEpoch: 1 }));
    expect(scheduleAutosave).toHaveBeenLastCalledWith(map);
  });
  it('applies a restored camera after committing the map and before settling its view', () => {
    useEditorStore.setState({ gridState: makeState() });
    const settle = vi.fn();
    const before = vi.fn();
    const after = vi.fn();
    const { result } = renderHook(() => useEditorSession({ beforeRestore: before, afterRestore: after, settleRestore: settle }));
    settle.mockClear();
    const map = makeState();
    const camera = { view2d: { zoom: 2, x: 40, y: 30 } };
    act(() => result.current({ state: map, camera }));
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    expect(useEditorStore.getState().gridState).toBe(map);
    expect(host.camera.set2d).toHaveBeenCalledWith(camera.view2d);
    expect(settle).toHaveBeenCalledWith(map);
    expect(vi.mocked(host.camera.set2d).mock.invocationCallOrder[0]).toBeLessThan(settle.mock.invocationCallOrder[0]!);
  });
});

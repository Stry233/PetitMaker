// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../_support/map-state';
import { useEditorSession } from '../../../ui/app/use-editor-session';
import { restoreSession } from '../../../editor/session/restore';

vi.mock('../../../editor/session/restore', () => ({
  restoreSession: vi.fn((save: { state: ReturnType<typeof makeState> }, onInstalled?: () => void) => {
    useEditorStore.setState({ gridState: save.state });
    onInstalled?.();
  }),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('useEditorSession', () => {
  it('restores between the fade callbacks, the rest following the map in, then settles on the committed map', () => {
    useEditorStore.setState({ gridState: makeState() });
    const settle = vi.fn();
    const before = vi.fn();
    const after = vi.fn();
    const { result } = renderHook(() => useEditorSession({ beforeRestore: before, afterRestore: after, settleRestore: settle }));
    settle.mockClear();
    const map = makeState();
    act(() => result.current({ state: map }));
    expect(restoreSession).toHaveBeenCalledWith({ state: map }, after);
    expect(before.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(restoreSession).mock.invocationCallOrder[0]!);
    expect(vi.mocked(restoreSession).mock.invocationCallOrder[0]).toBeLessThan(after.mock.invocationCallOrder[0]!);
    expect(settle).toHaveBeenCalledWith(map);
    expect(after.mock.invocationCallOrder[0]).toBeLessThan(settle.mock.invocationCallOrder[0]!);
  });
});

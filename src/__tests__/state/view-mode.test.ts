/**
 * The 2D/3D view mode: a store field persisted in localStorage so the editor
 * reopens in the mode the user last chose. '2d' is the default and the
 * fallback for any unrecognized stored value.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore, VIEW_MODE_STORAGE_KEY, detectViewMode } from '../../state/store';

describe('viewMode', () => {
  beforeEach(() => {
    localStorage.removeItem(VIEW_MODE_STORAGE_KEY);
    useEditorStore.setState({ viewMode: '2d' });
  });

  it('defaults to 2d and persists changes', () => {
    expect(useEditorStore.getState().viewMode).toBe('2d');
    useEditorStore.getState().setViewMode('3d');
    expect(useEditorStore.getState().viewMode).toBe('3d');
    expect(localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe('3d');
    useEditorStore.getState().setViewMode('2d');
    expect(localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe('2d');
  });

  it('detects only valid stored values', () => {
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, '3d');
    expect(detectViewMode()).toBe('3d');
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, 'weird');
    expect(detectViewMode()).toBe('2d');
  });
});

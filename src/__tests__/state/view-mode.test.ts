/**
 * The 2D/3D view mode: a store field persisted in localStorage so the editor
 * reopens in the mode the user last chose. '2d' is the default and the
 * fallback for any unrecognized stored value.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { PREFS, readPref } from '../../core/runtime/prefs';

describe('viewMode', () => {
  beforeEach(() => {
    localStorage.removeItem(PREFS.viewMode.key);
    useEditorStore.setState({ viewMode: '2d' });
  });

  it('defaults to 2d and persists changes', () => {
    expect(useEditorStore.getState().viewMode).toBe('2d');
    useEditorStore.getState().setViewMode('3d');
    expect(useEditorStore.getState().viewMode).toBe('3d');
    expect(localStorage.getItem(PREFS.viewMode.key)).toBe('3d');
    useEditorStore.getState().setViewMode('2d');
    expect(localStorage.getItem(PREFS.viewMode.key)).toBe('2d');
  });

  it('detects only valid stored values', () => {
    localStorage.setItem(PREFS.viewMode.key, '3d');
    expect(readPref('viewMode')).toBe('3d');
    localStorage.setItem(PREFS.viewMode.key, 'weird');
    expect(readPref('viewMode')).toBe('2d');
  });
});

import { describe, it, expect } from 'vitest';
import { useEditorStore } from '../../state/store';

describe('store: preview3DOpen flag', () => {
  it('defaults closed and toggles via setPreview3DOpen', () => {
    expect(useEditorStore.getState().preview3DOpen).toBe(false);
    useEditorStore.getState().setPreview3DOpen(true);
    expect(useEditorStore.getState().preview3DOpen).toBe(true);
    useEditorStore.getState().setPreview3DOpen(false);
    expect(useEditorStore.getState().preview3DOpen).toBe(false);
  });
});

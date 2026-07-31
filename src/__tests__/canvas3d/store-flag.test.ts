import { describe, it, expect } from 'vitest';
import { useEditorStore } from '../../state/store';

describe('store: preview3DOpen flag', () => {
  it('defaults closed and toggles via setPreview3DOpen', () => {
    expect(useEditorStore.getState().modals.preview3d).toBe(false);
    useEditorStore.getState().setModal('preview3d', true);
    expect(useEditorStore.getState().modals.preview3d).toBe(true);
    useEditorStore.getState().setModal('preview3d', false);
    expect(useEditorStore.getState().modals.preview3d).toBe(false);
  });
});

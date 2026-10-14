import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { showNotesForEditing } from '../../../editor/editing/annotation-edit';
import { makeTemplate } from '../../_support/map-state';
import { resetStore, setStoreModal } from '../../_support/store';

const s = () => useEditorStore.getState();

describe('showNotesForEditing', () => {
  beforeEach(() => {
    resetStore();
    s().initMap(makeTemplate(10, 10), createDefaultRegistry());
  });

  it('shows hidden notes and arms annotate', () => {
    s().setAnnotationsVisible(false);
    showNotesForEditing();
    expect(s().gridState!.annotations!.visible).toBe(true);
    expect(s().editMode.mode).toBe('annotate');
  });

  it('closes the window it is asked to close first', () => {
    setStoreModal('share');
    showNotesForEditing({ close: 'share' });
    expect(s().modals.share).toBe(false);
    expect(s().editMode.mode).toBe('annotate');
  });
});

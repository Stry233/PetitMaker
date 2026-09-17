/** The map's title and description live on `gridState.notes`; the slice verb clamps them and announces the change by epoch. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { createDefaultRegistry } from '../../rules/index';
import { makeTemplate } from '../rules/_helpers';

describe('map notes slice', () => {
  beforeEach(() => { useEditorStore.getState().initMap(makeTemplate(8, 8), createDefaultRegistry()); });

  it('setMapNotes writes the record as typed within the limits onto the grid state and bumps the epoch', () => {
    const s = useEditorStore.getState();
    const before = s.notesEpoch;
    s.setMapNotes({ title: 'River garden ', description: 'D'.repeat(260) });
    expect(useEditorStore.getState().gridState!.notes).toEqual({ title: 'River garden ', description: 'D'.repeat(200) });
    expect(useEditorStore.getState().notesEpoch).toBe(before + 1);
    s.setMapNotes({ title: '', description: '' });
    expect(useEditorStore.getState().gridState!.notes).toBeUndefined();
  });

  it('a new map starts without notes and announces the swap', () => {
    useEditorStore.getState().setMapNotes({ title: 'Old' });
    const before = useEditorStore.getState().notesEpoch;
    useEditorStore.getState().initMap(makeTemplate(8, 8), createDefaultRegistry());
    expect(useEditorStore.getState().gridState!.notes).toBeUndefined();
    expect(useEditorStore.getState().notesEpoch).toBeGreaterThan(before);
  });
});

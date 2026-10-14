/** The map's title and description live on `gridState.notes`; the slice verb clamps them and replaces the record, so a selector over it sees the change. */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../state/store';
import { createDefaultRegistry } from '../../rules/index';
import { makeTemplate } from '../_support/map-state';

describe('map notes slice', () => {
  beforeEach(() => { useEditorStore.getState().initMap(makeTemplate(8, 8), createDefaultRegistry()); });

  it('setMapNotes writes a new record as typed within the limits onto the grid state and publishes it', () => {
    const s = useEditorStore.getState();
    const seen: unknown[] = [];
    const off = useEditorStore.subscribe((next) => seen.push(next.gridState?.notes));
    s.setMapNotes({ title: 'River garden ', description: 'D'.repeat(260) });
    const first = useEditorStore.getState().gridState!.notes;
    expect(first).toEqual({ title: 'River garden ', description: 'D'.repeat(200) });
    s.setMapNotes({ title: 'River garden' });
    off();
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(first);
    s.setMapNotes({ title: '', description: '' });
    expect(useEditorStore.getState().gridState!.notes).toBeUndefined();
  });

  it('a new map starts without notes', () => {
    useEditorStore.getState().setMapNotes({ title: 'Old' });
    useEditorStore.getState().initMap(makeTemplate(8, 8), createDefaultRegistry());
    expect(useEditorStore.getState().gridState!.notes).toBeUndefined();
  });
});

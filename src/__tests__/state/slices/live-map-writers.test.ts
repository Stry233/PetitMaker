/**
 * The store writers that change the live map outside the executor (`setLayerLocked`, `setMapNotes`,
 * `setLoadEnforced`) keep the `gridState` reference, because the executor owns that object, and so a
 * reader selects the field itself. This pins the half of the contract each writer owes such a
 * reader: the field it writes changes by value, so a selector over it fires.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules';
import { makeState } from '../../_support/map-state';
import { resetStore } from '../../_support/store';

const store = () => useEditorStore.getState();

/** Runs `write` and reports whether a subscriber to `select` saw a new value, and whether the map
 *  object stayed the same. */
function observe<T>(select: (s: ReturnType<typeof store>) => T, write: () => void): { fired: boolean; sameMap: boolean } {
  const map = store().gridState;
  let fired = false;
  const before = select(store());
  const unsubscribe = useEditorStore.subscribe((s) => { if (select(s) !== before) fired = true; });
  write();
  unsubscribe();
  return { fired, sameMap: store().gridState === map };
}

beforeEach(() => {
  resetStore();
  store().loadMap(makeState(), createDefaultRegistry());
});

describe('live map writers outside the executor', () => {
  it('setLayerLocked replaces the lock set', () => {
    expect(observe((s) => s.gridState?.lockedLayers, () => store().setLayerLocked(1, true))).toEqual({ fired: true, sameMap: true });
    expect(store().gridState?.lockedLayers.has(1)).toBe(true);
  });

  it('setMapNotes replaces the notes', () => {
    expect(observe((s) => s.gridState?.notes, () => store().setMapNotes({ title: 'Garden' }))).toEqual({ fired: true, sameMap: true });
    expect(store().gridState?.notes?.title).toBe('Garden');
  });

  it('setLoadEnforced writes the flag a selector reads', () => {
    const enforced = !store().gridState!.ignoreChunkLoad;
    expect(observe((s) => s.gridState?.ignoreChunkLoad, () => store().setLoadEnforced(!enforced))).toEqual({ fired: true, sameMap: true });
  });
});

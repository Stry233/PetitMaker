import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { TOUR_SEEN_KEY, useFirstLaunchTour } from '../../ui/chrome/tour/use-tour';
import { useEditorStore } from '../../state/store';
import { serialize } from '../../io/json-codec';
import { readRestorableAutosave } from '../../io/autosave';
import { DEFAULT_MAP } from '../../config/maps';
import { createGrid } from '../../core/model/grid-model';
import { CellZone, TerrainType, type GridState } from '../../core/model/types';

const AUTOSAVE_STORAGE_KEY = 'petit-planet-autosave';

/** A real working map (DEFAULT_MAP so its templateId resolves on restore), with a mountain painted
 *  on the first Grass cell so the round-trip carries content — same fixture as io/autosave.test.ts. */
function makeWorkingMap(): GridState {
  const cells = createGrid(DEFAULT_MAP);
  for (let y = 0; y < DEFAULT_MAP.height; y++) {
    for (let x = 0; x < DEFAULT_MAP.width; x++) {
      if (DEFAULT_MAP.zones[y]?.[x] === CellZone.Grass) {
        cells[y]![x] = { zone: CellZone.Grass, terrain: { type: TerrainType.Mountain, elevation: 3 } };
        return { template: DEFAULT_MAP, cells, objects: new Map(), lockedLayers: new Set() };
      }
    }
  }
  throw new Error('no Grass cell in DEFAULT_MAP');
}

describe('first launch', () => {
  beforeEach(() => {
    localStorage.removeItem(TOUR_SEEN_KEY);
    localStorage.removeItem(AUTOSAVE_STORAGE_KEY);
    useEditorStore.getState().setTourRunning(false);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('starts the tour on a clean browser', () => {
    renderHook(() => useFirstLaunchTour(false, false));
    expect(useEditorStore.getState().tourRunning).toBe(true);
  });

  it('stays quiet on a second visit', () => {
    localStorage.setItem(TOUR_SEEN_KEY, '1');
    renderHook(() => useFirstLaunchTour(false, false));
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  it('does not replay after a reload part-way through', () => {
    renderHook(() => useFirstLaunchTour(false, false));
    expect(useEditorStore.getState().tourRunning).toBe(true);
    // A reload: the store is rebuilt, the tour is not running, and only localStorage carries over.
    cleanup();
    act(() => { useEditorStore.getState().setTourRunning(false); });
    renderHook(() => useFirstLaunchTour(false, false));
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  it('waits while something else owns the screen', () => {
    const { rerender } = renderHook(({ blocked }) => useFirstLaunchTour(blocked, false), { initialProps: { blocked: true } });
    expect(useEditorStore.getState().tourRunning).toBe(false);
    rerender({ blocked: false });
    expect(useEditorStore.getState().tourRunning).toBe(true);
  });

  it('runs its check exactly once, so a re-render cannot restart a skipped tour', () => {
    const { rerender } = renderHook(() => useFirstLaunchTour(false, false));
    act(() => { useEditorStore.getState().setTourRunning(false); });
    rerender();
    expect(useEditorStore.getState().tourRunning).toBe(false);
  });

  it('a content-ful autosave reads as "not a first-time visitor": no tour, and the seen flag is set', () => {
    // App reads the autosave once at startup and passes the answer down, so the hook is told
    // rather than asking. `readRestorableAutosave` is the shared definition of the question.
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, serialize(makeWorkingMap()));
    expect(readRestorableAutosave()).not.toBeNull();
    renderHook(() => useFirstLaunchTour(false, readRestorableAutosave() !== null));
    expect(useEditorStore.getState().tourRunning).toBe(false);
    expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe('1');
  });

  it('an empty autosave is not a previous visit: readRestorableAutosave reports none and the tour runs', () => {
    localStorage.setItem(AUTOSAVE_STORAGE_KEY, serialize({
      template: DEFAULT_MAP, cells: createGrid(DEFAULT_MAP), objects: new Map(), lockedLayers: new Set(),
    }));
    expect(readRestorableAutosave()).toBeNull();
    renderHook(() => useFirstLaunchTour(false, readRestorableAutosave() !== null));
    expect(useEditorStore.getState().tourRunning).toBe(true);
  });
});

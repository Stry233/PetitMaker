/**
 * The active-view SIGNAL and the selection sync that rides it.
 *
 * A 2D↔3D switch used to be an implicit consequence of a setter: `setActiveView` re-pointed the
 * ToolManager and told nobody, so the selection ring stayed in the overlay of the view that just
 * went hidden (the visible one showed none) and anything that had to follow the projection guessed
 * at the moment of the swap from `viewMode` instead. These pin the signal and its listener: it fires
 * in BOTH directions, it fires when the lazily-built 3D scene registers itself (after the store flip,
 * so `viewMode` cannot stand in for it), the newly active overlay gets the rings, and the outgoing
 * one keeps none.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActiveView, getActiveView, onActiveViewChange } from '../../canvas/active-view';
import { installSelectionViewSync } from '../../canvas/interaction/selection-view-sync';
import type { ActiveView, ToolOverlay } from '../../canvas/view-projection';
import { ObjectCategory, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';

interface Fake { view: ActiveView; overlay: ToolOverlay }

/** A view double carrying only what the sync touches: its overlay. */
function makeFakeView(objectBox = false): Fake {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    ...(objectBox ? { showObjectSelection: vi.fn() } : {}),
  } as unknown as ToolOverlay;
  return { overlay, view: { overlay } as unknown as ActiveView };
}

function mapWithObject(id: string): GridState {
  const gs = makeState(20, 20);
  const obj: PlacedObject = {
    id, catalogId: 'tree-apple', position: { x: 4, y: 5 },
    rotation: 0, category: ObjectCategory.Tree, elevation: 0,
  };
  gs.objects.set(id, obj);
  bumpObjectsVersion(gs, { added: [obj] });
  return gs;
}

let uninstall: (() => void) | null = null;

beforeEach(() => {
  setActiveView(null);
  setStoreState({ gridState: null, selection: [], showLayerNumbers: false, viewMode: '2d' });
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  setActiveView(null);
  setStoreState({ gridState: null, selection: [], viewMode: '2d' });
});

describe('active-view: the change signal', () => {
  it('fires in both directions, carrying the new view and the outgoing one', () => {
    const two = makeFakeView(), three = makeFakeView(true);
    const seen: Array<[ActiveView | null, ActiveView | null]> = [];
    const off = onActiveViewChange((v, prev) => seen.push([v, prev]));
    setActiveView(two.view);   // startup: 2D registers
    setActiveView(three.view); // 2D → 3D
    setActiveView(two.view);   // 3D → 2D
    off();
    setActiveView(three.view); // after unsubscribe: not seen
    expect(seen).toEqual([
      [two.view, null],
      [three.view, two.view],
      [two.view, three.view],
    ]);
    expect(getActiveView()).toBe(three.view);
  });

  it('fires when the lazily-built 3D scene registers, AFTER the store already flipped to 3d', () => {
    // The cold switch: viewMode goes '3d' first (the store flip), and the scene registers a lazy
    // import later. A listener keyed on viewMode would have run against the 2D view; the signal is
    // what tells it the projection is actually 3D's now.
    const two = makeFakeView(), three = makeFakeView(true);
    setActiveView(two.view);
    const seen: ActiveView[] = [];
    const off = onActiveViewChange((v) => { if (v) seen.push(v); });
    setStoreState({ viewMode: '3d' });
    expect(seen).toEqual([]);          // the flip alone is not the swap
    setActiveView(three.view);         // the scene, once built
    expect(seen).toEqual([three.view]);
    off();
  });
});

describe('selection-view-sync: the ring follows the active view', () => {
  it('paints the selection into the newly active overlay and clears the outgoing one', () => {
    const gs = mapWithObject('a');
    setStoreState({ gridState: gs, selection: [{ kind: 'object', id: 'a' }] });
    const two = makeFakeView(), three = makeFakeView(true);
    uninstall = installSelectionViewSync();

    setActiveView(two.view);
    expect(two.overlay.showSelection).toHaveBeenCalledTimes(1); // footprint ring (2D idiom)

    setActiveView(three.view);
    // Outgoing 2D drops its ring; the now-visible 3D overlay draws the body box.
    expect(two.overlay.clearSelection).toHaveBeenCalled();
    expect(three.overlay.showObjectSelection).toHaveBeenCalledWith('a', false);

    setActiveView(two.view);
    expect(three.overlay.clearSelection).toHaveBeenCalled();
    expect(two.overlay.showSelection).toHaveBeenCalledTimes(2);
  });

  it('leaves no ring in either view when the selection is empty', () => {
    setStoreState({ gridState: mapWithObject('a'), selection: [] });
    const two = makeFakeView(), three = makeFakeView(true);
    uninstall = installSelectionViewSync();
    setActiveView(two.view);
    setActiveView(three.view);
    expect(two.overlay.showSelection).not.toHaveBeenCalled();
    expect(three.overlay.showObjectSelection).not.toHaveBeenCalled();
    expect(two.overlay.clearSelection).toHaveBeenCalled();
    expect(three.overlay.clearSelection).toHaveBeenCalled();
  });

  it('is a no-op without a map, and never re-clears the same overlay it is about to repaint', () => {
    const two = makeFakeView();
    uninstall = installSelectionViewSync();
    setActiveView(two.view);
    expect(two.overlay.showSelection).not.toHaveBeenCalled();

    // A re-registration of the SAME view (2D hands out a fresh view object per call) must not clear
    // the overlay it is repainting — the repaint owns that.
    setStoreState({ gridState: mapWithObject('a'), selection: [{ kind: 'object', id: 'a' }] });
    const again = { overlay: two.overlay } as unknown as ActiveView;
    setActiveView(again);
    expect(two.overlay.clearSelection).not.toHaveBeenCalled();
    expect(two.overlay.showSelection).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().selection).toHaveLength(1);
  });
});

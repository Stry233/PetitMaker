/**
 * A 2D/3D switch is an explicit signal, so the selection ring moves to the visible view's overlay.
 * The lazily built 3D scene registers after the store flips `viewMode`, so `viewMode` cannot stand in
 * for the signal. The same listener repaints the ring on any selection change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActiveView, getActiveView, onActiveViewChange } from '../../../view/active-view';
import { installSelectionViewSync } from '../../../view/shared/overlay/selection-view-sync';
import type { ActiveView, ToolOverlay } from '../../../tools/pointer/runtime';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../_support/map-state';
import { setStoreState } from '../../_support/store';

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
    rotation: 0, elevation: 0,
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
    const two = makeFakeView(), three = makeFakeView(true);
    setActiveView(two.view);
    const seen: ActiveView[] = [];
    const off = onActiveViewChange((v) => { if (v) seen.push(v); });
    setStoreState({ viewMode: '3d' });
    expect(seen).toEqual([]);
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

    // 2D hands out a fresh view object per call over the same overlay, which the repaint owns.
    setStoreState({ gridState: mapWithObject('a'), selection: [{ kind: 'object', id: 'a' }] });
    const again = { overlay: two.overlay } as unknown as ActiveView;
    setActiveView(again);
    expect(two.overlay.clearSelection).not.toHaveBeenCalled();
    expect(two.overlay.showSelection).toHaveBeenCalled();
    expect(useEditorStore.getState().selection).toHaveLength(1);
  });

  it('paints a selection CHANGE without the caller asking', () => {
    const two = makeFakeView();
    setStoreState({ gridState: mapWithObject('a'), selection: [] });
    uninstall = installSelectionViewSync();
    setActiveView(two.view);
    (two.overlay.showSelection as ReturnType<typeof vi.fn>).mockClear();

    useEditorStore.getState().setSelection([{ kind: 'object', id: 'a' }]);
    expect(two.overlay.showSelection).toHaveBeenCalledTimes(1);

    useEditorStore.getState().clearSelection();
    expect(two.overlay.clearSelection).toHaveBeenCalled();
  });

  it('repaints the active view on objects-changed while an object is selected, and only then', () => {
    const two = makeFakeView(), three = makeFakeView(true);
    setStoreState({ gridState: mapWithObject('a'), selection: [{ kind: 'terrain', x: 1, y: 1 }] });
    uninstall = installSelectionViewSync();
    setActiveView(two.view);
    setActiveView(three.view);
    const bus = useEditorStore.getState().eventBus;
    (two.overlay.showSelection as ReturnType<typeof vi.fn>).mockClear();
    (three.overlay.showSelection as ReturnType<typeof vi.fn>).mockClear();

    bus.emit('objects-changed', {});
    expect(three.overlay.showSelection).not.toHaveBeenCalled(); // terrain only

    setStoreState({ selection: [{ kind: 'object', id: 'a' }] });
    (three.overlay.showObjectSelection as ReturnType<typeof vi.fn>).mockClear();
    bus.emit('objects-changed', {});
    expect(three.overlay.showObjectSelection).toHaveBeenCalledWith('a', false);
    expect(two.overlay.showSelection).not.toHaveBeenCalled();

    uninstall();
    uninstall = null;
    (three.overlay.showObjectSelection as ReturnType<typeof vi.fn>).mockClear();
    bus.emit('objects-changed', {});
    expect(three.overlay.showObjectSelection).not.toHaveBeenCalled();
  });

  it('clears the ring when arming a brush drops the selection', () => {
    const two = makeFakeView();
    setStoreState({ gridState: mapWithObject('a'), selection: [{ kind: 'object', id: 'a' }] });
    uninstall = installSelectionViewSync();
    setActiveView(two.view);

    useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    expect(useEditorStore.getState().selection).toEqual([]);
    expect(two.overlay.clearSelection).toHaveBeenCalled();
  });
});

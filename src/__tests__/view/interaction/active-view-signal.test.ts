/**
 * A 2D/3D switch is an explicit signal, so the selection ring moves to the visible view's overlay.
 * The lazily built 3D scene registers after the store flips `viewMode`, so `viewMode` cannot stand in
 * for the signal. The same listener repaints the ring on any selection change.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setActiveView, getActiveView, onActiveViewChange } from '../../../view/active-view';
import { installSelectionViewSync } from '../../../view/shared/overlay/selection-view-sync';
import type { ActiveView, ToolOverlay } from '../../../tools/pointer/runtime';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { useEditorStore } from '../../../state/store';
import { makeState } from '../../_support/map-state';
import { setStoreState } from '../../_support/store';

/** A view whose overlay holds the rings on screen, as the port's contract describes them: a 2D
 *  footprint ring at its rect, or a 3D body box named by object id. */
interface Fake { view: ActiveView; rings: string[] }

function makeFakeView(objectBox = false): Fake {
  const rings: string[] = [];
  const draw = (ring: string, append?: boolean) => { if (!append) rings.length = 0; rings.push(ring); };
  const noop = () => {};
  const overlay = {
    showGhost: noop, showGhostSpans: noop, clearGhost: noop, showHover: noop, clearHover: noop, flashCommit: noop,
    showSelection: (r: { x: number; y: number }, _grid: unknown, opts?: { append?: boolean }) => draw(`ring@${r.x},${r.y}`, opts?.append),
    clearSelection: () => { rings.length = 0; },
    ...(objectBox ? { showObjectSelection: (id: string, append?: boolean) => draw(`box:${id}`, append) } : {}),
  } as unknown as ToolOverlay;
  return { rings, view: { overlay } as unknown as ActiveView };
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
  it('draws the selection in the visible view only, in that view\'s idiom', () => {
    setStoreState({ gridState: mapWithObject('a'), selection: [{ kind: 'object', id: 'a' }] });
    const two = makeFakeView(), three = makeFakeView(true);
    uninstall = installSelectionViewSync();

    setActiveView(two.view);
    expect(two.rings).toEqual(['ring@4,5']);

    setActiveView(three.view);
    expect(two.rings).toEqual([]);
    expect(three.rings).toEqual(['box:a']);

    setActiveView(two.view);
    expect(three.rings).toEqual([]);
    expect(two.rings).toEqual(['ring@4,5']);
  });

  it('leaves no ring in either view when the selection is empty or there is no map', () => {
    setStoreState({ gridState: mapWithObject('a'), selection: [] });
    const two = makeFakeView(), three = makeFakeView(true);
    uninstall = installSelectionViewSync();
    setActiveView(two.view);
    setActiveView(three.view);
    expect(two.rings).toEqual([]);
    expect(three.rings).toEqual([]);

    setStoreState({ gridState: null, selection: [{ kind: 'object', id: 'a' }] });
    setActiveView(two.view);
    expect(two.rings).toEqual([]);
  });

  it('keeps the ring when the same overlay registers again under a fresh view object', () => {
    const two = makeFakeView();
    setStoreState({ gridState: mapWithObject('a'), selection: [{ kind: 'object', id: 'a' }] });
    uninstall = installSelectionViewSync();
    setActiveView(two.view);
    setActiveView({ overlay: two.view.overlay } as unknown as ActiveView);
    expect(two.rings).toEqual(['ring@4,5']);
  });

  it('follows a selection change and a cleared selection without the caller asking', () => {
    const two = makeFakeView();
    setStoreState({ gridState: mapWithObject('a'), selection: [] });
    uninstall = installSelectionViewSync();
    setActiveView(two.view);

    useEditorStore.getState().setSelection([{ kind: 'object', id: 'a' }]);
    expect(two.rings).toEqual(['ring@4,5']);

    useEditorStore.getState().clearSelection();
    expect(two.rings).toEqual([]);
  });

  it('moves the ring with a selected object that moves under it, until uninstalled', () => {
    const gs = mapWithObject('a');
    const two = makeFakeView();
    setStoreState({ gridState: gs, selection: [{ kind: 'object', id: 'a' }] });
    uninstall = installSelectionViewSync();
    setActiveView(two.view);
    const bus = useEditorStore.getState().eventBus;

    gs.objects.get('a')!.position = { x: 7, y: 8 };
    bus.emit('objects-changed', {});
    expect(two.rings).toEqual(['ring@7,8']);

    uninstall();
    uninstall = null;
    gs.objects.get('a')!.position = { x: 9, y: 9 };
    bus.emit('objects-changed', {});
    expect(two.rings).toEqual(['ring@7,8']);
  });

  it('clears the ring when arming a brush drops the selection', () => {
    const two = makeFakeView();
    setStoreState({ gridState: mapWithObject('a'), selection: [{ kind: 'object', id: 'a' }] });
    uninstall = installSelectionViewSync();
    setActiveView(two.view);

    useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    expect(useEditorStore.getState().selection).toEqual([]);
    expect(two.rings).toEqual([]);
  });
});

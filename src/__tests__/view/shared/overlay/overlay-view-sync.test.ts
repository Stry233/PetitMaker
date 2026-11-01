/**
 * The generate region's highlight follows the active view.
 *
 * The highlight is imperative: whoever edits the region tells the active overlay to show it. A 2D↔3D
 * swap registers a different overlay, so without a sync the region painted in one view would be
 * absent from the other until something shows it again. The last shown region moves with the
 * registration, a clear stays cleared, and a region shown before any view registers lands on the
 * first one that does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setActiveView } from '../../../../view/active-view';
import { installOverlayViewSync, showBuildableRegion, clearBuildableRegion, showPath, clearPath } from '../../../../view/shared/overlay/overlay-view-sync';
import type { ActiveView, ToolOverlay } from '../../../../tools/pointer/runtime';
import { cellSet } from '../../../../core/grid/grids';
import { TERRAIN_GRID } from '../../../../core/game/profile';

/** What one view's overlay shows: the fake keeps the region and the path drape as a view would draw them. */
interface Shown { region: { cells: unknown; dims: number | undefined } | null; path: unknown }
interface Fake { view: ActiveView; shown: Shown }

function makeFakeView(): Fake {
  const shown: Shown = { region: null, path: null };
  const overlay = {
    showBuildableRegion: (scope: { cells: unknown }, dims?: number) => { shown.region = { cells: scope.cells, dims }; },
    clearBuildableRegion: () => { shown.region = null; },
    showPath: (way: unknown) => { shown.path = way; },
    clearPath: () => { shown.path = null; },
  } as unknown as ToolOverlay;
  return { shown, view: { overlay } as unknown as ActiveView };
}

const CELLS = [{ x: 3, y: 4 }, { x: 4, y: 4 }];
let uninstall: (() => void) | null = null;

beforeEach(() => { setActiveView(null); clearBuildableRegion(); clearPath(); });
afterEach(() => { uninstall?.(); uninstall = null; setActiveView(null); });

describe('overlay-view-sync', () => {
  it('shows the standing region in the newly active view and takes it off the outgoing one', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(three.view);
    showBuildableRegion(CELLS);
    expect(three.shown.region?.cells).toEqual(CELLS);

    setActiveView(two.view);
    expect(three.shown.region).toBeNull();
    expect(two.shown.region?.cells).toEqual(CELLS);

    setActiveView(three.view);
    expect(two.shown.region).toBeNull();
    expect(three.shown.region?.cells).toEqual(CELLS);
  });

  it('carries editing dimensions into the next view and removes them independently of the scope', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showBuildableRegion(CELLS, 0.8);
    setActiveView(three.view);
    expect(three.shown.region).toEqual({ cells: CELLS, dims: 0.8 });
    showBuildableRegion(CELLS);
    expect(three.shown.region).toEqual({ cells: CELLS, dims: undefined });
  });

  it('keeps a cleared region cleared across the swap, and treats an empty show as a clear', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showBuildableRegion(CELLS);
    clearBuildableRegion();
    setActiveView(three.view);
    expect(three.shown.region).toBeNull();

    showBuildableRegion(CELLS);
    showBuildableRegion([]);
    setActiveView(two.view);
    expect(two.shown.region).toBeNull();
  });

  it('lands a region shown before any view registered on the first registration', () => {
    const two = makeFakeView();
    uninstall = installOverlayViewSync();
    showBuildableRegion(CELLS);
    setActiveView(two.view);
    expect(two.shown.region?.cells).toEqual(CELLS);
  });

  it('still shows the region after the same overlay registers again', () => {
    const two = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showBuildableRegion(CELLS);
    setActiveView({ ...two.view });
    expect(two.shown.region?.cells).toEqual(CELLS);
  });
});

describe('the path drape follows the view', () => {
  const WAY = cellSet(TERRAIN_GRID, CELLS);

  it('moves the standing drape to the newly active view and takes it off the outgoing one', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showPath(WAY);
    expect(two.shown.path).toBe(WAY);
    setActiveView(three.view);
    expect(two.shown.path).toBeNull();
    expect(three.shown.path).toBe(WAY);
  });

  it('keeps a drape cleared off screen cleared when its view comes back', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showPath(WAY);
    setActiveView(three.view);
    clearPath();
    setActiveView(two.view);
    expect(two.shown.path).toBeNull();
  });
});

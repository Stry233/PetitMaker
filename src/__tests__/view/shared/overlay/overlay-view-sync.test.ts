/**
 * The generate region's highlight follows the active view.
 *
 * The highlight is imperative: whoever edits the region tells the active overlay to show it. A 2D↔3D
 * swap registers a different overlay, so without a sync the region a person painted in one view is
 * simply absent from the other until something shows it again. These pin that the last shown region
 * moves with the registration, that a clear stays cleared, and that a region shown before any view
 * has registered lands on the first one that does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActiveView } from '../../../../view/active-view';
import { installOverlayViewSync, showBuildableRegion, clearBuildableRegion, showPath, clearPath } from '../../../../view/shared/overlay/overlay-view-sync';
import type { ActiveView, ToolOverlay } from '../../../../tools/pointer/runtime';
import { cellSet } from '../../../../core/grid/grids';
import { TERRAIN_GRID } from '../../../../core/game/profile';

interface Fake { view: ActiveView; overlay: ToolOverlay }

function makeFakeView(): Fake {
  const overlay = { showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(), showPath: vi.fn(), clearPath: vi.fn() } as unknown as ToolOverlay;
  return { overlay, view: { overlay } as unknown as ActiveView };
}

const CELLS = [{ x: 3, y: 4 }, { x: 4, y: 4 }];
let uninstall: (() => void) | null = null;

beforeEach(() => { setActiveView(null); clearBuildableRegion(); clearPath(); });
afterEach(() => { uninstall?.(); uninstall = null; setActiveView(null); });

describe('overlay-view-sync', () => {
  it('shows the standing region in the newly active overlay and clears the outgoing one', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(three.view);
    showBuildableRegion(CELLS);
    expect(three.overlay.showBuildableRegion).toHaveBeenCalledWith({ grid: 'terrain', cells: CELLS }, undefined);

    setActiveView(two.view);
    expect(three.overlay.clearBuildableRegion).toHaveBeenCalled();
    expect(two.overlay.showBuildableRegion).toHaveBeenCalledWith({ grid: 'terrain', cells: CELLS }, undefined);

    setActiveView(three.view);
    expect(two.overlay.clearBuildableRegion).toHaveBeenCalled();
    expect(three.overlay.showBuildableRegion).toHaveBeenCalledTimes(2);
  });

  it('carries editing dimensions into the next view and removes them independently of the scope', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showBuildableRegion(CELLS, 0.8);
    setActiveView(three.view);
    expect(three.overlay.showBuildableRegion).toHaveBeenLastCalledWith({ grid: 'terrain', cells: CELLS }, 0.8);
    showBuildableRegion(CELLS);
    expect(three.overlay.showBuildableRegion).toHaveBeenLastCalledWith({ grid: 'terrain', cells: CELLS }, undefined);
  });

  it('keeps a cleared region cleared across the swap, and treats an empty show as a clear', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showBuildableRegion(CELLS);
    clearBuildableRegion();
    setActiveView(three.view);
    expect(three.overlay.showBuildableRegion).not.toHaveBeenCalled();

    showBuildableRegion(CELLS);
    showBuildableRegion([]);
    setActiveView(two.view);
    expect(two.overlay.showBuildableRegion).toHaveBeenCalledTimes(1); // the first show only
  });

  it('lands a region shown before any view registered on the first registration', () => {
    const two = makeFakeView();
    uninstall = installOverlayViewSync();
    showBuildableRegion(CELLS);
    setActiveView(two.view);
    expect(two.overlay.showBuildableRegion).toHaveBeenCalledWith({ grid: 'terrain', cells: CELLS }, undefined);
  });

  it('does not clear an overlay it is about to repaint on a re-registration of the same view', () => {
    const two = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showBuildableRegion(CELLS);
    setActiveView({ overlay: two.overlay } as unknown as ActiveView);
    expect(two.overlay.clearBuildableRegion).not.toHaveBeenCalled();
    expect(two.overlay.showBuildableRegion).toHaveBeenCalledTimes(2);
  });
});

describe('the path drape follows the view', () => {
  const WAY = cellSet(TERRAIN_GRID, CELLS);

  it('moves the standing drape to the newly active overlay and takes it off the outgoing one', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showPath(WAY);
    expect(two.overlay.showPath).toHaveBeenCalledWith(WAY);
    setActiveView(three.view);
    expect(two.overlay.clearPath).toHaveBeenCalled();
    expect(three.overlay.showPath).toHaveBeenCalledWith(WAY);
  });

  it('keeps a drape cleared off screen cleared when its view comes back', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installOverlayViewSync();
    setActiveView(two.view);
    showPath(WAY);
    setActiveView(three.view);
    clearPath();
    setActiveView(two.view);
    expect(two.overlay.showPath).toHaveBeenCalledTimes(1);
  });
});

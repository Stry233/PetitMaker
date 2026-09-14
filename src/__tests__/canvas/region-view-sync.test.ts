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
import { setActiveView } from '../../canvas/active-view';
import { installRegionViewSync, showBuildableRegion, clearBuildableRegion } from '../../canvas/interaction/region-view-sync';
import type { ActiveView, ToolOverlay } from '../../canvas/view-projection';

interface Fake { view: ActiveView; overlay: ToolOverlay }

function makeFakeView(): Fake {
  const overlay = { showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn() } as unknown as ToolOverlay;
  return { overlay, view: { overlay } as unknown as ActiveView };
}

const CELLS = [{ x: 3, y: 4 }, { x: 4, y: 4 }];
let uninstall: (() => void) | null = null;

beforeEach(() => { setActiveView(null); clearBuildableRegion(); });
afterEach(() => { uninstall?.(); uninstall = null; setActiveView(null); });

describe('region-view-sync', () => {
  it('shows the standing region in the newly active overlay and clears the outgoing one', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installRegionViewSync();
    setActiveView(three.view);
    showBuildableRegion(CELLS);
    expect(three.overlay.showBuildableRegion).toHaveBeenCalledWith(CELLS, true);

    setActiveView(two.view);
    expect(three.overlay.clearBuildableRegion).toHaveBeenCalled();
    expect(two.overlay.showBuildableRegion).toHaveBeenCalledWith(CELLS, true);

    setActiveView(three.view);
    expect(two.overlay.clearBuildableRegion).toHaveBeenCalled();
    expect(three.overlay.showBuildableRegion).toHaveBeenCalledTimes(2);
  });

  it('keeps a cleared region cleared across the swap, and treats an empty show as a clear', () => {
    const two = makeFakeView(), three = makeFakeView();
    uninstall = installRegionViewSync();
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
    uninstall = installRegionViewSync();
    showBuildableRegion(CELLS);
    setActiveView(two.view);
    expect(two.overlay.showBuildableRegion).toHaveBeenCalledWith(CELLS, true);
  });

  it('does not clear an overlay it is about to repaint on a re-registration of the same view', () => {
    const two = makeFakeView();
    uninstall = installRegionViewSync();
    setActiveView(two.view);
    showBuildableRegion(CELLS);
    setActiveView({ overlay: two.overlay } as unknown as ActiveView);
    expect(two.overlay.clearBuildableRegion).not.toHaveBeenCalled();
    expect(two.overlay.showBuildableRegion).toHaveBeenCalledTimes(2);
  });
});

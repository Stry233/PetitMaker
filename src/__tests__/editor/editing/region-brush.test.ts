/**
 * The region brush keeps its own history in the store's region lane, apart from the map's command
 * history: a painted region is a scope for a future generate, not a map edit. Drives the
 * region-brush channel the pointer machine reports through.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { startRegionBrush } from '../../../editor/editing/region-brush';
import { useEditorStore } from '../../../state/store';
import { paintRegionCell, previewRegionCell, cancelRegionStroke, finishRegionStroke, clearRegionSelection, cancelPendingRegion, undoPendingRegionStep } from '../../../tools/pointer/region';
import { DEFAULT_REGION_REQUEST } from '../../../state/editing/vocabulary';
import { setActiveView } from '../../../view/active-view';
import type { MacroCoord } from '../../../core/model/types';
import { splineCells } from '../../../core/grid/shapes';

let stop: (() => void) | null = null;
/** Turns region selection on or off and mounts the brush as the shell does. */
function selecting(on: boolean): void {
  act(() => { useEditorStore.getState().setSelectingRegion(on); });
  stop?.();
  stop = on ? startRegionBrush() : null;
}
const region = () => useEditorStore.getState().region;
const undo = () => { let ok = false; act(() => { ok = useEditorStore.getState().undoRegion(); }); return ok; };
const redo = () => { let ok = false; act(() => { ok = useEditorStore.getState().redoRegion(); }); return ok; };
afterEach(() => { stop?.(); stop = null; useEditorStore.setState({ selectingRegion: false, regionUndoLane: [], regionRedoLane: [] }); });

const move = (c: MacroCoord) => act(() => paintRegionCell(c));
const done = () => act(() => finishRegionStroke());

describe('region brush history (separate from map history)', () => {
  beforeEach(() => {
    useEditorStore.setState({ regionTool: 'free', regionBrushSize: 1, region: [] });
  });

  it('a whole brush drag (many moves) undoes as ONE unit, not one cell', () => {
    selecting(true);

    // Drag across several cells — several move callbacks, one pointer-up.
    move({ x: 0, y: 0 });
    move({ x: 1, y: 0 });
    move({ x: 2, y: 0 });
    done();
    expect(region().length).toBe(3); // the stroke committed

    undo();
    expect(region()).toEqual([]); // the whole drag undone, not one cell
  });

  it('a shape commit (rect drag) undoes as one unit', () => {
    useEditorStore.setState({ regionTool: 'rect' });
    selecting(true);

    move({ x: 0, y: 0 }); // sets the anchor
    move({ x: 2, y: 2 }); // drags the preview
    done();               // commits the rect
    expect(region().length).toBe(9); // 3x3 rect

    undo();
    expect(region()).toEqual([]);
  });

  it('a curve, clicked anchor by anchor and finished on a double-click, undoes as ONE unit', () => {
    useEditorStore.setState({ regionTool: 'curve' });
    selecting(true);

    move({ x: 0, y: 0 }); done();
    move({ x: 4, y: 0 }); done();
    move({ x: 6, y: 3 }); done();
    expect(region(), 'the chain stands until it is finished').toEqual([]);
    move({ x: 6, y: 3 }); done(); // the second click on the last anchor finishes
    expect(region()).toEqual(splineCells([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 3 }], 1));

    undo();
    expect(region()).toEqual([]); // the whole curve, not one click
  });

  it('moves a curve anchor by dragging it before the chain is finished', () => {
    useEditorStore.setState({ regionTool: 'curve' });
    selecting(true);

    move({ x: 0, y: 0 }); done();
    move({ x: 4, y: 0 }); done();
    move({ x: 4, y: 0 }); move({ x: 4, y: 3 }); done(); // a press on the anchor drags it
    move({ x: 4, y: 3 }); done();
    move({ x: 4, y: 3 }); done();
    expect(region()).toEqual(splineCells([{ x: 0, y: 0 }, { x: 4, y: 3 }], 1));
  });

  it('a cancelled press takes back only its own curve anchor, as a second finger does', () => {
    useEditorStore.setState({ regionTool: 'curve' });
    selecting(true);

    move({ x: 0, y: 0 }); done();
    move({ x: 4, y: 0 }); done();
    move({ x: 6, y: 3 });
    act(() => cancelRegionStroke());
    move({ x: 8, y: 0 }); done();
    move({ x: 8, y: 0 }); done();
    expect(region()).toEqual(splineCells([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }], 1));
    expect(undo()).toBe(true);
    expect(region()).toEqual([]);
  });

  it('Escape abandons a standing curve and Delete takes back its newest anchor', () => {
    useEditorStore.setState({ regionTool: 'curve' });
    selecting(true);
    expect(cancelPendingRegion(), 'nothing stands yet').toBe(false);

    move({ x: 0, y: 0 }); done();
    move({ x: 4, y: 0 }); done();
    move({ x: 6, y: 3 }); done();
    let took = false;
    act(() => { took = undoPendingRegionStep(); });
    expect(took).toBe(true);
    move({ x: 4, y: 0 }); done();
    move({ x: 4, y: 0 }); done(); // a double-click on the anchor now newest finishes
    expect(region()).toEqual(splineCells([{ x: 0, y: 0 }, { x: 4, y: 0 }], 1));

    move({ x: 0, y: 5 }); done();
    move({ x: 4, y: 5 }); done();
    let cancelled = false;
    act(() => { cancelled = cancelPendingRegion(); });
    expect(cancelled).toBe(true);
    move({ x: 4, y: 5 }); done();
    move({ x: 4, y: 5 }); done(); // one anchor of a fresh chain: a double-click cannot finish it
    expect(region()).toEqual(splineCells([{ x: 0, y: 0 }, { x: 4, y: 0 }], 1));
    expect(cancelPendingRegion()).toBe(true);
    expect(cancelPendingRegion()).toBe(false);
  });

  it('Clear is itself undoable', () => {
    selecting(true);

    move({ x: 5, y: 5 });
    done();
    const painted = region();
    expect(painted.length).toBeGreaterThan(0);

    act(() => clearRegionSelection());
    expect(region()).toEqual([]);

    undo();
    expect(region()).toEqual(painted); // the misclick is recoverable
  });

  it('redo mirrors undo', () => {
    selecting(true);

    move({ x: 3, y: 3 });
    done();
    const painted = region();

    undo();
    expect(region()).toEqual([]);

    redo();
    expect(region()).toEqual(painted);
  });

  it('an empty region lane no-ops and leaves the region untouched', () => {
    selecting(true);

    let ok = true;
    ok = undo();
    expect(ok).toBe(false);
    expect(region()).toEqual([]);
  });

  it('leaving region selection empties the lane, so re-entering cannot undo past it', () => {
    selecting(true);

    move({ x: 7, y: 7 });
    done();
    expect(region().length).toBeGreaterThan(0);

    // Leave region-select mode (mirrors the scope screen's Done / navigating away), then
    // come back — a fresh session must not inherit a stale undo entry from before.
    selecting(false);
    selecting(true);

    let ok = true;
    ok = undo();
    expect(ok).toBe(false); // nothing to undo — the earlier stroke's history is gone
  });
});


describe('region previews', () => {
  const showGhost = vi.fn();
  const clearGhost = vi.fn();
  beforeEach(() => {
    showGhost.mockClear(); clearGhost.mockClear();
    useEditorStore.setState({ gridState: null, regionTool: 'free', regionBrushSize: 3, region: [] });
    setActiveView({ overlay: { showGhost, clearGhost, showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn() } } as never);
  });
  afterEach(() => { setActiveView(null); useEditorStore.setState({ regionRequest: DEFAULT_REGION_REQUEST }); });

  it.each(['free', 'line', 'rect', 'circle'] as const)('%s hover matches the first painted footprint without adding history', tool => {
    useEditorStore.setState({ regionTool: tool });
    selecting(true);
    act(() => previewRegionCell({ x: 10, y: 10 }));
    const cells = showGhost.mock.calls[showGhost.mock.calls.length - 1]![0].cells;
    expect(cells.length).toBeGreaterThan(0);
    expect(region()).toEqual([]);
    expect(undo()).toBe(false);
    move({ x: 10, y: 10 }); done();
    expect(region()).toEqual(cells);
  });

  it('previews the clamped minimum rectangle before pressing', () => {
    useEditorStore.getState().claimRegionRequest({ ...DEFAULT_REGION_REQUEST, single: true, minSide: 20 });
    useEditorStore.setState({ regionTool: 'rect' });
    selecting(true);
    act(() => previewRegionCell({ x: 10, y: 10 }));
    const cells = showGhost.mock.calls[showGhost.mock.calls.length - 1]![0].cells;
    expect(cells).toHaveLength(400);
    move({ x: 10, y: 10 }); done();
    expect(region()).toEqual(cells);
  });

  it('cancels a stroke without committing its preview or leaving an undo entry', () => {
    selecting(true);
    move({ x: 10, y: 10 });
    act(() => cancelRegionStroke());
    done();
    expect(region()).toEqual([]);
    expect(undo()).toBe(false);
    expect(clearGhost).toHaveBeenCalled();
  });
});

describe('region brush pointer preview', () => {
  it('asks for a fresh preview without announcing a tool change', () => {
    const bus = useEditorStore.getState().eventBus;
    const resampled = vi.fn();
    const synced = vi.fn();
    bus.on('pointer-resample', resampled);
    bus.on('tool-synced', synced);
    selecting(true);
    act(() => { useEditorStore.getState().setRegionTool('rect'); });
    bus.off('pointer-resample', resampled);
    bus.off('tool-synced', synced);
    expect(resampled).toHaveBeenCalledTimes(2);
    expect(synced).not.toHaveBeenCalled();
  });
});

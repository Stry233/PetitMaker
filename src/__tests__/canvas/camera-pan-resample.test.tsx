/**
 * A brush (or the idle hover/placement ghost) reads the CELL under the pointer from the viewport's
 * projection at the moment it acts — but nothing about a stationary pointer changes when the CAMERA
 * moves under it (WASD pan is the motivating case), so without a re-sample the brush freezes and the
 * hover/ghost sit on a cell a click would no longer land on. `usePointerInteraction` re-samples the
 * last known screen position on every 'viewport-changed' emission; these tests drive that resampler
 * directly through the real handlers, a real ToolManager + executor, and a fake projection whose
 * screenToMacro answer is deliberately made to depend on a mutable "camera" offset — mimicking a
 * real pan without needing the actual 2D/3D renderers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { ToolType, TerrainType, type GridState } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolManager } from '../../tools/tool-manager';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';

const ARMED = 'tree-apple';

/** Whole macro cells the fake camera has slid right by — mutated by `panCamera` to fake a WASD pan
 *  without a real renderer. screenToMacro reads it live, exactly like a real viewport answers
 *  differently for the same screen point once its offset changes. */
let panOffsetCells = 0;

function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(),
  };
  const camera = { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() };
  const view = {
    projection: {
      screenToMacro: (sx: number, sy: number) => ({ x: Math.floor(sx / 10) + panOffsetCells, y: Math.floor(sy / 10) }),
      screenToMicro: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
      pan: vi.fn(),
    },
    overlay, camera, applyCameraTransform: vi.fn(), leftDragPans: true,
  } as unknown as ActiveView;
  return { view, overlay, camera };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. */
function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

/** Slide the fake camera and emit the same signal a real pan does — the resampler's only trigger. */
function panCamera(dCells: number): void {
  panOffsetCells += dCells;
  useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
}

let el: HTMLElement;
let gs: GridState;
let executor: CommandExecutor;
let tm: ToolManager;
let overlay: ReturnType<typeof makeView>['overlay'];
let camera: ReturnType<typeof makeView>['camera'];
let view: ReturnType<typeof makeView>['view'];

/** The app's own wiring: a real ToolManager over a fresh grid, pointed at the test view. */
function activate(tool: ToolType, itemId: string | null = null): void {
  gs = makeState(20, 20);
  executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry());
  tm = new ToolManager(makeStubRenderer(), executor, gs);
  const made = makeView();
  overlay = made.overlay;
  camera = made.camera;
  view = made.view;
  setActiveView(made.view); // re-points the manager's ctx at the test view's projection/overlay
  registerToolManager(tm);
  tm.setActiveTool(tool);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: tool,
    selectedItemId: itemId, selection: [], selectingRegion: false, contextMenu: null,
  });
}

beforeEach(() => {
  panOffsetCells = 0;
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
});

describe('a camera pan under a stationary pointer', () => {
  it('feeds a live brush stroke a move at the last screen position, painting the cell that slid under it', () => {
    activate(ToolType.TerrainBrush);
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    expect(getCell(gs.cells, 5, 5)?.terrain?.type).toBe(TerrainType.Mountain);
    expect(getCell(gs.cells, 6, 5)?.terrain).toBeFalsy();

    panCamera(1); // same screen point now resolves one cell further right — the pointer never moved

    expect(getCell(gs.cells, 6, 5)?.terrain?.type).toBe(TerrainType.Mountain);

    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 55, clientY: 55 }));
  });

  it('re-tracks the idle placement ghost with no stroke active', () => {
    activate(ToolType.ObjectPlacer, ARMED);
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    overlay.showGhost.mockClear();

    panCamera(1);

    const calls = overlay.showGhost.mock.calls;
    const lastCells = calls[calls.length - 1]?.[0] as Array<{ x: number; y: number }>;
    expect(lastCells.some((c) => c.x === 6 && c.y === 5)).toBe(true);
  });

  it('stops resampling once the pointer has left the canvas', () => {
    activate(ToolType.ObjectPlacer, ARMED);
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    overlay.showGhost.mockClear();
    panCamera(1); // control: resampling is live while hovering
    expect(overlay.showGhost).toHaveBeenCalled();

    overlay.showGhost.mockClear();
    el.dispatchEvent(pointer('pointerleave', { clientX: 55, clientY: 55 }));
    panCamera(1);

    expect(overlay.showGhost).not.toHaveBeenCalled();
  });

  it('does not feed the tool during a right-drag pan even though panning itself emits viewport-changed', () => {
    activate(ToolType.TerrainBrush);
    const moveSpy = vi.spyOn(tm, 'handlePointerMove');
    // Mirrors the real 2D renderer: camera.pan synchronously re-emits viewport-changed on every
    // frame of the drag — a right-drag pan already "covers" the camera move through its own live
    // pointermove, so the resampler must not sneak a duplicate tool feed in on the same tick.
    camera.pan.mockImplementation(() => {
      useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
    });

    el.dispatchEvent(pointer('pointerdown', { button: 2, buttons: 2, clientX: 200, clientY: 200 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 2, clientX: 230, clientY: 200 }));
    window.dispatchEvent(pointer('pointerup', { button: 2, buttons: 0, clientX: 230, clientY: 200 }));

    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('bounds a 2D Hand-tool left-drag pan instead of recursing, even though ToolManager itself emits viewport-changed', () => {
    activate(ToolType.Hand);
    // Mirrors the real 2D renderer: ToolManager.handlePointerMove pans HandTool and then calls
    // applyCameraTransform, which the real MapRenderer answers by emitting 'viewport-changed' —
    // unlike the right-drag case above, the 2D Hand drag sets NONE of the resampler's gesture
    // flags (leftPanning stays false; 2D pans left-drag through ToolManager, not the pointer
    // machine), so only the re-entrancy latch stops this from recursing. The latch still lets the
    // resampler run once (same as any other idle re-sample): by then ToolManager has already
    // recorded the new screen position, so that one extra pass computes a zero delta and pans by
    // nothing — two calls, one real 10px pan and one no-op, never the unbounded recursion.
    vi.mocked(view.applyCameraTransform).mockImplementation(() => {
      useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
    });
    const panSpy = vi.mocked(view.projection.pan);

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 200, clientY: 150 }));
    panSpy.mockClear();

    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 190, clientY: 150 }));
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 190, clientY: 150 }));

    const totalDx = panSpy.mock.calls.reduce((sum, [dx]) => sum + (dx as number), 0);
    expect({ calls: panSpy.mock.calls.length, totalDx }).toEqual({ calls: 2, totalDx: 10 });
  });
});

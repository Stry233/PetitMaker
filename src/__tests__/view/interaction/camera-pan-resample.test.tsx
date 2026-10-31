// @vitest-environment jsdom
/**
 * A stationary pointer fires no events when the camera moves under it (a WASD pan), so
 * `usePointerInteraction` re-samples the last screen position on every 'viewport-changed'; otherwise
 * the brush freezes and the ghost sits on a cell a click would miss. Driven through the real handlers
 * and `ToolManager` over a fake projection that reads a mutable camera offset.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { TerrainType, type GridState } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { getCell } from '../../../core/model/grid-model';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeStubView } from '../../_support/tool-manager';
import { makeState } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

const ARMED = 'tree-apple';

/** Whole cells the fake camera has slid right by, read live by `screenToPoint`. */
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
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10 + panOffsetCells, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay, camera,
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

/** Slides the fake camera and emits 'viewport-changed', the resampler's only trigger. */
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

/** A real `ToolManager` over a fresh grid, pointed at the test view. */
function activate(tool: ToolType, itemId: string | null = null): void {
  gs = makeState(20, 20);
  executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const made = makeView();
  overlay = made.overlay;
  camera = made.camera;
  setActiveView(made.view); // re-points the manager's ctx at the test view's projection/overlay
  registerToolManager(tm);
  tm.setActiveTool(tool);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [], selectingRegion: false, contextMenu: null,
    ...armedEditMode({ tool, item: itemId }),
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
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 52, clientY: 52 }));
    expect(getCell(gs.cells, 5, 5)?.terrain?.type).toBe(TerrainType.Mountain);
    expect(getCell(gs.cells, 6, 5)?.terrain).toBeFalsy();

    panCamera(1); // same screen point now resolves one cell further right; the pointer never moved

    expect(getCell(gs.cells, 6, 5)?.terrain?.type).toBe(TerrainType.Mountain);

    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 52, clientY: 52 }));
  });

  it('re-tracks the idle placement ghost with no stroke active', () => {
    activate(ToolType.ObjectPlacer, ARMED);
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    overlay.showGhost.mockClear();

    panCamera(1);

    const calls = overlay.showGhost.mock.calls;
    const lastCells = (calls[calls.length - 1]?.[0] as { cells: Array<{ x: number; y: number }> }).cells;
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
    // As in the real 2D renderer, `camera.pan` re-emits viewport-changed synchronously during the drag.
    camera.pan.mockImplementation(() => {
      useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
    });

    el.dispatchEvent(pointer('pointerdown', { button: 2, buttons: 2, clientX: 200, clientY: 200 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 2, clientX: 230, clientY: 200 }));
    window.dispatchEvent(pointer('pointerup', { button: 2, buttons: 0, clientX: 230, clientY: 200 }));

    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('pans a Hand-tool left drag through the camera once and feeds the tool nothing mid-drag', () => {
    activate(ToolType.Hand);
    const moveSpy = vi.spyOn(tm, 'handlePointerMove');
    // The pan emits viewport-changed; the pan flag keeps the resampler from answering, so no recursion.
    camera.pan.mockImplementation(() => {
      useEditorStore.getState().eventBus.emit('viewport-changed', { zoom: 1 });
    });

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 200, clientY: 150 }));
    moveSpy.mockClear();
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 190, clientY: 150 }));

    expect(camera.pan.mock.calls).toEqual([[10, 0]]);
    expect(moveSpy).not.toHaveBeenCalled();
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 190, clientY: 150 }));
  });
});

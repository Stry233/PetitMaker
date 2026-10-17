/** The editor's tool layer lives with the editor: built per live map from the store, drawn on
 *  whichever view is attached, and retired in order when the map is swapped. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startEditorTools } from '../../../editor/session/editor-tools';
import { getActiveToolManager, releaseActiveView, setActiveView } from '../../../view/active-view';
import type { ActiveView, ToolOverlay } from '../../../tools/pointer/runtime';
import { createDefaultRegistry } from '../../../rules/index';
import { createExecutor } from '../../../state/executor';
import { useEditorStore } from '../../../state/store';
import { ToolType } from '../../../state/editing/vocabulary';
import { getCell } from '../../../core/model/grid-model';
import { TerrainType, type GridState } from '../../../core/model/types';
import { newMap } from '../../../editor/operations/map';
import { editorPort } from '../../../editor/session/context';
import { enterPlanetSession, leavePlanetSession } from '../../../editor/operations/planet-session';
import { host } from '../../../editor/host/host';
import { makeState } from '../../_support/map-state';
import { planetFixture } from '../../_support/planet';
import { activeToolOf } from '../../../state/editing/edit-mode';
import { armedEditMode } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';

const store = () => useEditorStore.getState();

const ITEM = 'tree-apple';

/** A view whose overlay records whether a tool ghost stands on it. `px` screen pixels make one cell. */
function stubView(px: number): ActiveView & { ghost: () => boolean } {
  let ghost = false;
  const on = () => { ghost = true; };
  const overlay = {
    showGhost: on, showGhostSpans: on, showPlacementGhost: on, showObjectMove: on, showGroupPlacementGhost: on, showNoteGhost: on,
    clearGhost: () => { ghost = false; },
    showHover: vi.fn(), clearHover: vi.fn(), showSelection: vi.fn(), clearSelection: vi.fn(), flashCommit: vi.fn(),
    showCurveFootprint: vi.fn(), clearCurveFootprint: vi.fn(), showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(), pulseBuildableRegion: vi.fn(),
    showPath: vi.fn(), clearPath: vi.fn(), showBand: vi.fn(), clearBand: vi.fn(),
  } satisfies ToolOverlay;
  return {
    projection: {
      screenToPoint: (x: number, y: number) => ({ x: x / px, y: y / px }),
      cellToScreen: (x: number, y: number) => ({ x: x * px, y: y * px, scale: px }),
    } as unknown as ActiveView['projection'],
    overlay,
    camera: { pan: vi.fn(), zoomBy: vi.fn() } as unknown as ActiveView['camera'],
    ...headlessViewVerbs(),
    ghost: () => ghost,
  };
}

const tools = () => getActiveToolManager()!;
/** The pointer at the centre of terrain cell (x, y), whose grid sits half a cell off the map points,
 *  in a view drawing `px` pixels per cell. */
const at = (x: number, y: number, px = 10): [number, number] => [x * px, y * px];

function loadBlank(): GridState {
  const state = makeState(24, 24);
  store().loadMap(state, createDefaultRegistry());
  return state;
}

function armBrush(): void {
  store().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
  useEditorStore.setState({ activeLayer: 1, layerPinned: true, autoEdgeCut: 'off', drawingBrushSize: 1 });
  expect(activeToolOf(store())).toBe(ToolType.TerrainBrush);
}

function armPlacer(): void {
  store().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: ITEM } });
  expect(activeToolOf(store())).toBe(ToolType.ObjectPlacer);
}

let stop: () => void = () => {};

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState({
    gridState: null, commandExecutor: null, viewMode: '3d',
    ...armedEditMode({ tool: ToolType.Hand, item: null }),
  });
  stop = startEditorTools();
});

afterEach(() => {
  leavePlanetSession(editorPort);
  host.camera.takeQueued();
  stop();
  setActiveView(null);
  useEditorStore.setState({ gridState: null, commandExecutor: null, viewMode: '2d' });
});

describe('the editor tools without a 2D view', () => {
  it('builds nothing before a map and an executor exist', () => {
    expect(getActiveToolManager()).toBeNull();
    useEditorStore.setState({ gridState: makeState(8, 8), commandExecutor: null });
    expect(getActiveToolManager()).toBeNull();
  });

  it('opening straight into 3D edits, enforces locks and draws ghosts on the only view', () => {
    const view3d = stubView(10);
    setActiveView(view3d);
    const state = loadBlank();
    armPlacer();
    tools().handlePointerMove(...at(5, 5));
    expect(view3d.ghost()).toBe(true);

    armBrush();
    expect(view3d.ghost()).toBe(false);
    const exec = store().commandExecutor!;
    tools().handlePointerDown(...at(4, 4));
    tools().handlePointerUp(...at(4, 4));
    expect(exec.historyDepth()).toBe(1);
    expect(getCell(state.cells, 4, 4)?.terrain?.type).toBe(TerrainType.Mountain);

    store().setLayerLocked(1, true);
    tools().handlePointerDown(...at(10, 10));
    tools().handlePointerUp(...at(10, 10));
    expect(exec.historyDepth()).toBe(1);
    expect(getCell(state.cells, 10, 10)?.terrain?.type).not.toBe(TerrainType.Mountain);
  });

  it('activates the armed tool and announces it once the arming changes', () => {
    setActiveView(stubView(10));
    loadBlank();
    const synced = vi.fn();
    store().eventBus.on('tool-synced', synced);
    useEditorStore.setState({ ...armedEditMode({ tool: ToolType.Eraser }) });
    expect(tools().getActiveTool().id).toBe(ToolType.Eraser);
    expect(synced).toHaveBeenCalledWith({ tool: ToolType.Eraser });
    store().eventBus.off('tool-synced', synced);
  });

  it('keeps the tools while no view is attached and draws on the next view to attach', () => {
    const first = stubView(10);
    setActiveView(first);
    loadBlank();
    armPlacer();
    const manager = tools();
    releaseActiveView(first);
    tools().handlePointerMove(...at(5, 5));
    expect(first.ghost()).toBe(false);
    const next = stubView(10);
    setActiveView(next);
    expect(tools()).toBe(manager);
    tools().handlePointerMove(...at(5, 5));
    expect(next.ghost()).toBe(true);
  });

  it('stopping retires the manager and takes its ghost down', () => {
    const view = stubView(10);
    setActiveView(view);
    loadBlank();
    armPlacer();
    tools().handlePointerMove(...at(5, 5));
    stop();
    stop = () => {};
    expect(getActiveToolManager()).toBeNull();
    expect(view.ghost()).toBe(false);
  });
});

describe('switching views mid-stroke', () => {
  it('continues the stroke in the view on screen as one undo step, leaving no ghost on the view left', () => {
    const view2d = stubView(10);
    const view3d = stubView(20);
    useEditorStore.setState({ viewMode: '2d' });
    setActiveView(view2d);
    const state = loadBlank();
    armBrush();
    const exec = store().commandExecutor!;
    tools().handlePointerDown(...at(4, 8));
    tools().handlePointerMove(...at(6, 8));
    expect(view2d.ghost()).toBe(true);

    useEditorStore.setState({ viewMode: '3d' });
    setActiveView(view3d);
    expect(view2d.ghost()).toBe(false);
    // The 3D view draws twice the pixels per cell: its own projection resolves the pointer.
    tools().handlePointerMove(...at(10, 8, 20));
    tools().handlePointerUp(...at(10, 8, 20));
    expect(exec.historyDepth()).toBe(1);
    for (const x of [4, 6, 8, 10]) expect(getCell(state.cells, x, 8)?.terrain?.type).toBe(TerrainType.Mountain);
    expect(getCell(state.cells, 12, 8)?.terrain?.type).not.toBe(TerrainType.Mountain);

    useEditorStore.setState({ viewMode: '2d' });
    setActiveView(view2d);
    tools().handlePointerMove(...at(14, 14));
    expect(view2d.ghost()).toBe(true);
    expect(view3d.ghost()).toBe(false);
  });
});

describe('a map swap with a tool armed', () => {
  it('New and Load retire the old map\'s tools before the new map\'s tools arm, leaving no stale ghost', () => {
    const view = stubView(10);
    setActiveView(view);
    newMap(editorPort, 'hexia');
    armPlacer();
    const before = tools();
    const [hx, hy] = [80, 80];
    tools().handlePointerMove(...at(hx, hy));
    expect(view.ghost()).toBe(true);

    const loaded = makeState(24, 24);
    store().loadMap(loaded, createDefaultRegistry());
    expect(view.ghost()).toBe(false);
    expect(tools()).not.toBe(before);
    expect(tools().getContext().state).toBe(loaded);
    expect(tools().getActiveTool().id).toBe(ToolType.ObjectPlacer);
    tools().handlePointerMove(...at(5, 5));
    expect(view.ghost()).toBe(true);

    newMap(editorPort, 'hexia');
    expect(view.ghost()).toBe(false);
    expect(tools().getContext().state).toBe(store().gridState);
  });

  it('a commit that swaps the map and the arming at once takes the old tool\'s ghost down', () => {
    const view = stubView(10);
    setActiveView(view);
    loadBlank();
    armBrush();
    tools().handlePointerMove(...at(6, 6));
    expect(view.ghost()).toBe(true);

    const next = makeState(24, 24);
    const executor = createExecutor(next, createDefaultRegistry(), store().eventBus);
    useEditorStore.setState({
      gridState: next, commandExecutor: executor,
      ...armedEditMode({ tool: ToolType.ObjectPlacer, item: ITEM }),
    });
    expect(view.ghost()).toBe(false);
    expect(tools().getContext().state).toBe(next);
    expect(tools().getActiveTool().id).toBe(ToolType.ObjectPlacer);
  });

  it('entering and leaving a planet session swaps the tools with the map and arming in one step', () => {
    const view = stubView(10);
    setActiveView(view);
    newMap(editorPort, 'hexia');
    const parked = store().gridState;
    armPlacer();
    tools().handlePointerMove(...at(80, 80));
    expect(view.ghost()).toBe(true);

    enterPlanetSession(editorPort, { template: planetFixture() });
    expect(view.ghost()).toBe(false);
    expect(tools().getContext().state).toBe(store().gridState);
    expect(tools().getActiveTool().id).toBe(ToolType.TerrainBrush);
    tools().handlePointerMove(...at(10, 10));
    expect(view.ghost()).toBe(true);

    leavePlanetSession(editorPort);
    expect(view.ghost()).toBe(false);
    expect(tools().getContext().state).toBe(parked);
    expect(tools().getActiveTool().id).toBe(ToolType.ObjectPlacer);
  });
});

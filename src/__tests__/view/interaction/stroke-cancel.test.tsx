// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { CommandType, TerrainType } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { getAllItems } from '../../../state/catalog';
import { useEditorStore } from '../../../state/store';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeExecutor, makeState, setTerrain } from '../../_support/map-state';
import { headlessViewVerbs, makeStubView } from '../../_support/tool-manager';
import { armedEditMode } from '../../_support/store';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

/** Screen pixels are tenths of a map cell, so (80, 80) is map point (8, 8). */
function pointer(target: EventTarget, type: string, pointerType: string, at: [number, number], id = 1): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: at[0], clientY: at[1] });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: id } });
  act(() => { target.dispatchEvent(event); });
}

afterEach(() => { cleanup(); registerToolManager(null); setActiveView(null); });

/** A one-cell item placed by a click. */
const ITEM = getAllItems().find((i) => i.placementMode === 'point' && i.width === 1 && i.height === 1)!.id;

function setup(tool: ToolType) {
  const state = makeState(20, 20), executor = makeExecutor(state);
  if (tool === ToolType.Eraser) for (let x = 4; x < 16; x++) setTerrain(state, x, 8, TerrainType.Mountain, 1);
  // A block whose outer corner the edge cut can round: its NW corner is intersection (5, 5).
  if (tool === ToolType.EdgeCut) for (let y = 6; y < 9; y++) for (let x = 6; x < 9; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  useEditorStore.setState({
    gridState: state, commandExecutor: executor, region: [], selectingRegion: false, selection: [],
    layerPinned: false, activeLayer: 1, autoEdgeCut: 'off', eraserShape: 'free',
    ...armedEditMode({ tool, macro: null, item: tool === ToolType.ObjectPlacer ? ITEM : null, content: 'mountain' }),
  });
  const manager = new ToolManager(makeStubView(), executor, state, editorToolWiring());
  const view = {
    projection: { screenToPoint: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }) },
    overlay: { showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(), clearHover: vi.fn(), showHover: vi.fn(),
      clearSelection: vi.fn(), showSelection: vi.fn(), flashCommit: vi.fn(), showPlacementGhost: vi.fn() },
    camera: { pan: vi.fn(), zoomBy: vi.fn() },
    ...headlessViewVerbs(),
  } as unknown as ActiveView;
  manager.setActiveTool(tool); useEditorStore.setState({ activeLayer: 1 });
  registerToolManager(manager); setActiveView(view);
  const canvas = render(<Host />).getByTestId('canvas');
  const snapshot = () => JSON.stringify([state.cells, [...state.objects.keys()]]);
  const before = snapshot();
  return { state, executor, canvas, unchanged: () => snapshot() === before };
}

/** Press at (8, 8) and drag to (12, 8), leaving the stroke open. */
function openStroke(canvas: HTMLElement, pointerType: string): void {
  pointer(canvas, 'pointerdown', pointerType, [80, 80]);
  for (const x of [90, 100, 110, 120]) pointer(window, 'pointermove', pointerType, [x, 80]);
}

describe('a cancelled stroke leaves the map as it was', () => {
  it.each([ToolType.TerrainBrush, ToolType.Eraser])('%s: a release commits the stroke (control)', (tool) => {
    const s = setup(tool);
    openStroke(s.canvas, 'mouse');
    pointer(window, 'pointerup', 'mouse', [120, 80]);
    expect(s.unchanged()).toBe(false);
    expect(s.executor.historyDepth()).toBe(1);
  });

  it.each([
    [ToolType.TerrainBrush, 'mouse'], [ToolType.TerrainBrush, 'pen'], [ToolType.TerrainBrush, 'touch'],
    [ToolType.Eraser, 'mouse'], [ToolType.Eraser, 'pen'], [ToolType.Eraser, 'touch'],
  ])('%s: the browser cancelling a %s stroke rolls it back', (tool, pointerType) => {
    const s = setup(tool);
    openStroke(s.canvas, pointerType);
    expect(s.unchanged()).toBe(false);
    pointer(window, 'pointercancel', pointerType, [120, 80]);
    expect(s.unchanged()).toBe(true);
    expect(s.executor.canUndo()).toBe(false);
    expect(s.executor.canRedo()).toBe(false);
    // The canvas is ready for the next stroke.
    openStroke(s.canvas, pointerType);
    pointer(window, 'pointerup', pointerType, [120, 80]);
    expect(s.executor.historyDepth()).toBe(1);
  });

  it.each([ToolType.TerrainBrush, ToolType.Eraser])('%s: a second finger turns the stroke into navigation and takes it back', (tool) => {
    const s = setup(tool);
    openStroke(s.canvas, 'touch');
    pointer(s.canvas, 'pointerdown', 'touch', [150, 150], 2);
    expect(s.unchanged()).toBe(true);
    expect(s.executor.canUndo()).toBe(false);
    for (const id of [1, 2]) pointer(window, 'pointerup', 'touch', [150, 150], id);
    expect(s.unchanged()).toBe(true);
  });
});

describe('a cancelled click leaves the map as it was', () => {
  /** Press at map point (5.2, 5.2): an empty cell for the item, the block's corner for the edge cut. */
  const press = (canvas: HTMLElement, pointerType: string): void => pointer(canvas, 'pointerdown', pointerType, [52, 52]);

  it.each([ToolType.ObjectPlacer, ToolType.EdgeCut])('%s: a release keeps the click (control)', (tool) => {
    const s = setup(tool);
    press(s.canvas, 'mouse');
    pointer(window, 'pointerup', 'mouse', [52, 52]);
    expect(s.unchanged()).toBe(false);
    expect(s.executor.historyDepth()).toBe(1);
  });

  it.each([
    [ToolType.ObjectPlacer, 'mouse'], [ToolType.ObjectPlacer, 'touch'],
    [ToolType.EdgeCut, 'mouse'], [ToolType.EdgeCut, 'touch'],
  ])('%s: the browser cancelling a %s press rolls it back', (tool, pointerType) => {
    const s = setup(tool);
    press(s.canvas, pointerType);
    expect(s.unchanged()).toBe(false);
    pointer(window, 'pointercancel', pointerType, [52, 52]);
    expect(s.unchanged()).toBe(true);
    expect(s.executor.canUndo()).toBe(false);
    expect(s.executor.canRedo()).toBe(false);
  });

  it.each([ToolType.ObjectPlacer, ToolType.EdgeCut])('%s: a second finger takes the click back without a redo step', (tool) => {
    const s = setup(tool);
    press(s.canvas, 'touch');
    pointer(s.canvas, 'pointerdown', 'touch', [150, 150], 2);
    expect(s.unchanged()).toBe(true);
    expect(s.executor.canUndo()).toBe(false);
    expect(s.executor.canRedo()).toBe(false);
    for (const id of [1, 2]) pointer(window, 'pointerup', 'touch', [150, 150], id);
    expect(s.unchanged()).toBe(true);
  });

  it('a second finger on a map that already breaks a rule takes back only this touch', () => {
    const s = setup(ToolType.ObjectPlacer);
    // A lone layer-4 column written straight into the grid, as a loaded save can hold, and one
    // earlier legal edit on the stack.
    setTerrain(s.state, 16, 16, TerrainType.Mountain, 4);
    s.executor.execute({ type: CommandType.PlaceObject, object: { id: 'earlier', catalogId: ITEM, position: { x: 2, y: 2 }, rotation: 0, elevation: 0 } });
    expect(s.executor.historyDepth()).toBe(1);
    press(s.canvas, 'touch');
    expect(s.executor.historyDepth()).toBe(2);
    pointer(s.canvas, 'pointerdown', 'touch', [150, 150], 2);
    for (const id of [1, 2]) pointer(window, 'pointerup', 'touch', [150, 150], id);
    expect(s.executor.historyDepth()).toBe(1);
    expect(s.state.objects.has('earlier')).toBe(true);
    expect(s.executor.canRedo()).toBe(false);
  });
});

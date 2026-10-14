// @vitest-environment jsdom
/**
 * A cancelled touch has one rollback owner: the tool takes back what its press committed, and the
 * touch gesture keeps no stroke of its own to roll back after it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../../view/active-view';
import type { ActiveView } from '../../../../tools/pointer/runtime';
import type { PlacedObject } from '../../../../core/model/types';
import { bumpObjectsVersion } from '../../../../core/model/grid-model';
import { ToolType } from '../../../../state/editing/vocabulary';
import { useEditorStore } from '../../../../state/store';
import { ToolManager } from '../../../../tools/pointer/runtime/tool-manager';
import { makeExecutor, makeState } from '../../../_support/map-state';
import { makeStubView } from '../../../_support/tool-manager';
import { armedEditMode } from '../../../_support/store';
import { editorToolWiring } from '../../../../editor/session/tool-wiring';

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

/** Screen pixels are tenths of a map cell. */
function touch(target: EventTarget, type: string, at: [number, number], id = 1): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: at[0], clientY: at[1] });
  Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: id } });
  act(() => { target.dispatchEvent(event); });
}

afterEach(() => { cleanup(); registerToolManager(null); setActiveView(null); vi.restoreAllMocks(); });

function setup(tool: ToolType, objects: PlacedObject[] = []) {
  const state = makeState(20, 20), executor = makeExecutor(state);
  for (const obj of objects) state.objects.set(obj.id, { ...obj });
  bumpObjectsVersion(state, { added: objects });
  useEditorStore.setState({
    gridState: state, commandExecutor: executor, region: [], selectingRegion: false,
    selection: objects.map((o) => ({ kind: 'object', id: o.id }) as const), layerPinned: false,
    activeLayer: 1, autoEdgeCut: 'off',
    ...armedEditMode({ tool, macro: null, item: null, content: 'mountain' }),
  });
  const manager = new ToolManager(makeStubView(), executor, state, editorToolWiring());
  const view = {
    projection: { screenToPoint: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }) },
    overlay: { showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(), clearHover: vi.fn(), showHover: vi.fn(),
      clearSelection: vi.fn(), showSelection: vi.fn(), flashCommit: vi.fn(), showObjectMove: vi.fn() },
    camera: { pan: vi.fn(), zoomBy: vi.fn() }, 
  } as unknown as ActiveView;
  manager.setActiveTool(tool); useEditorStore.setState({ activeLayer: 1 });
  registerToolManager(manager); setActiveView(view);
  const rollbacks = vi.spyOn(executor as unknown as { rollbackTo(watermark: number): void }, 'rollbackTo');
  const canvas = render(<Host />).getByTestId('canvas');
  const snapshot = () => JSON.stringify([state.cells, [...state.objects.values()]]);
  const before = snapshot();
  return { state, executor, canvas, rollbacks, unchanged: () => snapshot() === before };
}

/** One finger presses at (8, 8) and drags to (12, 8). */
function drag(canvas: HTMLElement, from: [number, number] = [80, 80], to: [number, number] = [120, 80]): void {
  touch(canvas, 'pointerdown', from);
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    touch(window, 'pointermove', [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]);
  }
}

describe('a cancelled touch drag', () => {
  it('rolls the brush stroke back exactly once when the browser cancels it', () => {
    const s = setup(ToolType.TerrainBrush);
    drag(s.canvas);
    expect(s.unchanged()).toBe(false);
    touch(window, 'pointercancel', [120, 80]);
    expect(s.unchanged()).toBe(true);
    expect(s.rollbacks).toHaveBeenCalledTimes(1);
    expect(s.executor.canUndo()).toBe(false);
  });

  it('rolls the brush stroke back exactly once when a second finger lands', () => {
    const s = setup(ToolType.TerrainBrush);
    drag(s.canvas);
    touch(s.canvas, 'pointerdown', [150, 150], 2);
    expect(s.unchanged()).toBe(true);
    expect(s.rollbacks).toHaveBeenCalledTimes(1);
    for (const id of [1, 2]) touch(window, 'pointerup', [150, 150], id);
    expect(s.unchanged()).toBe(true);
    expect(s.executor.canUndo()).toBe(false);
  });

  it('leaves a dragged object where it stood, with nothing to roll back', () => {
    const tree: PlacedObject = { id: 't', catalogId: 'tree-apple', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 };
    const s = setup(ToolType.ObjectPlacer, [tree]);
    drag(s.canvas, [55, 55], [85, 85]);
    touch(window, 'pointercancel', [85, 85]);
    touch(window, 'pointerup', [85, 85]);
    expect(s.unchanged()).toBe(true);
    expect(s.rollbacks).not.toHaveBeenCalled();
    expect(s.executor.historyDepth()).toBe(0);
  });
});

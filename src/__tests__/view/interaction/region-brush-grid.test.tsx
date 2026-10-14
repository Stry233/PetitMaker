// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { type MacroCoord } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { GRIDS, TERRAIN_GRID } from '../../../core/game/profile';
import { gridCellRect } from '../../../core/grid/grids';
import { setRegionBrushHandler } from '../../../tools/pointer/region';
import { useEditorStore } from '../../../state/store';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeExecutor, makeState } from '../../_support/map-state';
import { makeStubView } from '../../_support/tool-manager';
import { armedEditMode } from '../../_support/store';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

/** Screen pixels are tenths of a map cell, so (158, 102) is map point (15.8, 10.2). */
function pointer(target: EventTarget, type: string, at: [number, number]): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' || type === 'pointermove' ? 0 : 1, clientX: at[0], clientY: at[1] });
  Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } });
  act(() => { target.dispatchEvent(event); });
}

let unregister: () => void = () => {};
afterEach(() => { unregister(); cleanup(); registerToolManager(null); setActiveView(null); });

function setup() {
  const state = makeState(30, 30), executor = makeExecutor(state);
  useEditorStore.setState({
    gridState: state, commandExecutor: executor, region: [], selectingRegion: true, selection: [],
    ...armedEditMode({ tool: ToolType.Hand, macro: null, item: null }),
  });
  const manager = new ToolManager(makeStubView(), executor, state, editorToolWiring());
  const view = {
    projection: { screenToPoint: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }) },
    overlay: { showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(), clearHover: vi.fn(), showHover: vi.fn(),
      clearSelection: vi.fn(), showSelection: vi.fn(), flashCommit: vi.fn() },
    camera: { pan: vi.fn(), zoomBy: vi.fn() }, 
  } as unknown as ActiveView;
  registerToolManager(manager); setActiveView(view);
  const brush = { paint: vi.fn<(c: MacroCoord) => void>(), preview: vi.fn<(c: MacroCoord) => void>(), done: vi.fn(), clear: vi.fn(), cancel: vi.fn() };
  unregister = setRegionBrushHandler(brush);
  const canvas = render(<Host />).getByTestId('canvas');
  return { canvas, brush };
}

/** Whether terrain cell `c` covers map point `p`. */
function covers(c: MacroCoord, p: { x: number; y: number }): boolean {
  const r = gridCellRect(GRIDS[TERRAIN_GRID], c);
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

describe('the region brush', () => {
  it.each([[15.2, 10.2], [15.8, 10.8], [15.8, 10.2]])('paints the terrain cell under a press at (%s, %s)', (x, y) => {
    const { canvas, brush } = setup();
    pointer(canvas, 'pointerdown', [x * 10, y * 10]);
    pointer(window, 'pointerup', [x * 10, y * 10]);
    expect(brush.paint).toHaveBeenCalled();
    expect(covers(brush.paint.mock.calls[0]![0], { x, y })).toBe(true);
  });

  it('previews the terrain cell under a hover', () => {
    const { canvas, brush } = setup();
    pointer(canvas, 'pointermove', [158, 108]);
    expect(brush.preview).toHaveBeenCalled();
    expect(covers(brush.preview.mock.calls[brush.preview.mock.calls.length - 1]![0], { x: 15.8, y: 10.8 })).toBe(true);
  });

  it('owns the pointer from press to release: a drag keeps painting and the release closes the stroke once', () => {
    const { canvas, brush } = setup();
    pointer(canvas, 'pointerdown', [52, 52]);
    const drag = new MouseEvent('pointermove', { bubbles: true, buttons: 1, clientX: 92, clientY: 52 });
    Object.defineProperties(drag, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } });
    act(() => { window.dispatchEvent(drag); });
    expect(brush.paint).toHaveBeenCalledTimes(2);
    expect(brush.preview).not.toHaveBeenCalled();
    pointer(window, 'pointerup', [92, 52]);
    pointer(window, 'pointerup', [92, 52]);
    expect(brush.done).toHaveBeenCalledOnce();
    expect(brush.cancel).not.toHaveBeenCalled();
  });

  it('drops an open stroke when the browser cancels the pointer', () => {
    const { canvas, brush } = setup();
    pointer(canvas, 'pointerdown', [52, 52]);
    pointer(window, 'pointercancel', [52, 52]);
    expect(brush.cancel).toHaveBeenCalledOnce();
    expect(brush.done).not.toHaveBeenCalled();
  });
});

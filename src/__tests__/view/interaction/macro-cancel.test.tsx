// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { ToolType } from '../../../state/editing/vocabulary';
import { useEditorStore } from '../../../state/store';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { buildMacroRun, type MacroBuild } from '../../../tools/macros/run';
import { makeExecutor, makeState } from '../../_support/map-state';
import { makeStubView } from '../../_support/tool-manager';
import { armedEditMode } from '../../_support/store';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}
function pointer(target: EventTarget, type: string, pointerType: string, id = 1): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: 1, clientX: 80, clientY: 80 });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: id } });
  act(() => { target.dispatchEvent(event); });
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => {
  cleanup(); registerToolManager(null); setActiveView(null);
});

function setup() {
  const state = makeState(20, 20), executor = makeExecutor(state);
  useEditorStore.setState({
    gridState: state, commandExecutor: executor, armingEpoch: 1, region: [], selectingRegion: false,
    selection: [], layerPinned: false, activeLayer: 1, autoEdgeCut: 'off',
    ...armedEditMode({ tool: ToolType.Macro, macro: 'raise', item: null, content: 'mountain' }),
  });
  const manager = new ToolManager(makeStubView(), executor, state, editorToolWiring());
  const view = {
    projection: { screenToPoint: (x: number, y: number) => ({ x: x / 10, y: y / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }) },
    overlay: { showGhost: vi.fn(), clearGhost: vi.fn(), clearHover: vi.fn(), showHover: vi.fn(),
      clearSelection: vi.fn(), showSelection: vi.fn(), flashCommit: vi.fn() },
    camera: { pan: vi.fn(), zoomBy: vi.fn() }, 
  } as unknown as ActiveView;
  manager.setActiveTool(ToolType.Macro); useEditorStore.setState({ activeLayer: 1 });
  registerToolManager(manager); setActiveView(view);
  const answers: Array<() => void> = [];
  manager.getContext().macroContext.offThread = { preview: null, build: (snapshot, id, opts) => {
    const built = buildMacroRun({ state: snapshot, executor, registry: executor.getRegistry() }, id, opts);
    return new Promise<MacroBuild | null>(resolve => answers.push(() => resolve(built)));
  } };
  const canvas = render(<Host />).getByTestId('canvas');
  return { state, executor, manager, canvas, answers };
}

describe('Smart Build input cancellation', () => {
  it.each(['mouse', 'touch'])('drops a pending spray after %s pointer cancellation', async pointerType => {
    const s = setup();
    pointer(s.canvas, 'pointerdown', pointerType);
    expect(s.answers).toHaveLength(1);
    pointer(window, 'pointercancel', pointerType);
    await act(async () => { s.answers[0]!(); await flush(); });
    expect(s.executor.historyDepth()).toBe(0);
    expect(s.state.cells[8]![8]!.terrain).toBeNull();
    expect(s.manager.getActiveTool().hasPending?.(s.manager.getContext())).toBe(false);
  });

  it.each([false, true])('a second touch cancels the spray, including completed work (landed=%s)', async landed => {
    const s = setup();
    pointer(s.canvas, 'pointerdown', 'touch');
    if (landed) {
      await act(async () => { s.answers[0]!(); await flush(); });
      expect(s.executor.historyDepth()).toBe(1);
    }
    pointer(s.canvas, 'pointerdown', 'touch', 2);
    if (!landed) await act(async () => { s.answers[0]!(); await flush(); });
    expect(s.executor.historyDepth()).toBe(0);
    expect(s.state.cells[8]![8]!.terrain).toBeNull();
    expect(s.manager.getActiveTool().hasPending?.(s.manager.getContext())).toBe(false);
  });
});

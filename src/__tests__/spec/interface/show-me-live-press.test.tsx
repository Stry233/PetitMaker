// @vitest-environment jsdom
/**
 * A Show me's give-back against a press still live on the map: the brush drag the visitor is still
 * making when the Show me ends, and Escape pressed in the middle of one.
 */
import { afterEach, describe, expect, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { ToolType } from '../../../state/editing/vocabulary';
import { useEditorStore } from '../../../state/store';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { escapeOnMap } from '../../../editor/commands/commands';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { tourCards } from '../../../ui/chrome/tour/deck';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { makeExecutor, makeState } from '../../_support/map-state';
import { headlessViewVerbs, makeStubView } from '../../_support/tool-manager';
import { armedEditMode, setStoreState } from '../../_support/store';
import { spec } from '../../_support/spec';

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

/** Screen pixels are tenths of a map cell. */
function pointer(target: EventTarget, type: string, at: [number, number]): void {
  const event = new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: at[0], clientY: at[1] });
  Object.defineProperties(event, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } });
  act(() => { target.dispatchEvent(event); });
}

afterEach(() => {
  cleanup();
  act(() => { useEditorStore.getState().finishTour(); });
  registerToolManager(null);
  setActiveView(null);
});

/** The live map under a brush, a Show me standing at a step on the map, and a drag begun on it. */
function dragDuringShowMe() {
  const state = makeState(20, 20), executor = makeExecutor(state);
  setStoreState({
    gridState: state, commandExecutor: executor, region: [], selectingRegion: false, selection: [],
    layerPinned: false, activeLayer: 1, autoEdgeCut: 'off', tourRunning: false,
    ...armedEditMode({ tool: ToolType.TerrainBrush, content: 'mountain' }),
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
  manager.setActiveTool(ToolType.TerrainBrush);
  registerToolManager(manager);
  setActiveView(view);
  const canvas = render(<Host />).getByTestId('canvas');
  const card = tourCards(true).findIndex((c) => c.kind === 'shape');
  act(() => {
    const s = useEditorStore.getState();
    s.setTourRunning(true);
    s.setTourPhase({ kind: 'show', card, step: 1 });
    useEditorStore.getState().poseTour({ mode: 'mountain' });
  });
  const before = mapFingerprint(state);
  pointer(canvas, 'pointerdown', [80, 80]);
  for (const x of [90, 100, 110]) pointer(window, 'pointermove', [x, 80]);
  expect(mapFingerprint(state)).not.toBe(before);
  return { state, executor, before };
}

describe('a press still live when a Show me ends', () => {
  spec('UI-47', 'a drag still being made as the Show me ends paints nothing more, its release included', () => {
    const { state, executor, before } = dragDuringShowMe();
    act(() => { useEditorStore.getState().leaveShowMe(); });
    expect(mapFingerprint(state)).toBe(before);
    for (const x of [120, 130, 140]) pointer(window, 'pointermove', [x, 80]);
    pointer(window, 'pointerup', [140, 80]);
    expect(mapFingerprint(state)).toBe(before);
    expect(executor.historyDepth()).toBe(0);
  });

  spec('UI-47', 'Escape in the middle of a drag during a try takes the drag back and keeps the Show me standing', () => {
    const { state, executor, before } = dragDuringShowMe();
    let put = false;
    act(() => { put = escapeOnMap(); });
    expect(put).toBe(true);
    expect(mapFingerprint(state)).toBe(before);
    expect(useEditorStore.getState().tourPhase.kind).toBe('show');
    pointer(window, 'pointermove', [130, 80]);
    pointer(window, 'pointerup', [130, 80]);
    expect(mapFingerprint(state)).toBe(before);
    expect(executor.historyDepth()).toBe(0);
  });
});

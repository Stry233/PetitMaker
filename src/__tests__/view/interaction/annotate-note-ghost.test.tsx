// @vitest-environment jsdom
/** The note ghost through the pointer machine: a hover over the map shows where the press lands,
 *  and leaving the map takes it down, through the overlay call every ghost goes by. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import type { RouteNote } from '../../../core/model/annotations';
import { ToolType } from '../../../state/editing/vocabulary';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeStubView } from '../../_support/tool-manager';
import { makeState } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

const overlay = {
  showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(), showNoteGhost: vi.fn(),
  showSelection: vi.fn(), clearSelection: vi.fn(), showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
  showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(), showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(),
};

function makeView(): ActiveView {
  return {
    projection: {
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay,
    camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
  } as unknown as ActiveView;
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. */
const pointer = (type: string, init: MouseEventInit): MouseEvent => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

let el: HTMLElement;

beforeEach(() => {
  for (const fn of Object.values(overlay)) fn.mockClear();
  const gs = makeState(20, 20);
  const executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  setActiveView(makeView());
  registerToolManager(tm);
  tm.setActiveTool(ToolType.Annotate);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [], selectingRegion: false, contextMenu: null,
    annotationTool: 'route', annotationDraft: null, annotationSelection: [],
    ...armedEditMode({ tool: ToolType.Annotate }),
  });
  el = render(<Host />).getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
});

describe('the note ghost under the pointer machine', () => {
  it('follows a hover on the half-cell lattice and goes when the pointer leaves the map', () => {
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 33, clientY: 42 }));
    const ghost = overlay.showNoteGhost.mock.calls.at(-1)![0] as RouteNote;
    expect(ghost.points).toEqual([{ x: 3.5, y: 4 }]);
    expect(useEditorStore.getState().annotationDraft).toBeNull();
    overlay.clearGhost.mockClear();
    el.dispatchEvent(pointer('pointerleave', { clientX: 33, clientY: 42 }));
    expect(overlay.clearGhost).toHaveBeenCalled();
  });
});

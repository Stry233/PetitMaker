// @vitest-environment jsdom
/**
 * A notes drag writes the store on every move (the draft, or the moved note), and those writes are
 * inputs the pointer machine's resampler watches. The resampler must not feed the tool again from
 * inside its own re-sample: that recursed until the stack overflowed, and the overflow cut the store's
 * listener list short, so the views' redraw never heard the move until the next press.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import type { GridState } from '../../../core/model/types';
import type { ZoneNote } from '../../../core/model/annotations';
import { ToolType } from '../../../state/editing/vocabulary';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeStubView } from '../../_support/tool-manager';
import { makeState } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

function makeView(): ActiveView {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(), showNoteGhost: vi.fn(),
  };
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
function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

let el: HTMLElement;
let gs: GridState;
let tm: ToolManager;
/** Stands in for the views' redraw: a store listener subscribed after the pointer machine's. */
let heard: number;
let unsubscribe: () => void;
let errors: unknown[];
const onError = (e: ErrorEvent) => { errors.push(e.error); e.preventDefault(); };

function arm(annotationTool: 'zone' | 'none', items: GridState['annotations'] = undefined): void {
  gs = makeState(20, 20);
  if (items) gs.annotations = items;
  const executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  setActiveView(makeView());
  registerToolManager(tm);
  tm.setActiveTool(ToolType.Annotate);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [], selectingRegion: false, contextMenu: null,
    annotationTool, annotationZoneShape: 'free', annotationDraft: null, annotationSelection: [],
    ...armedEditMode({ tool: ToolType.Annotate }),
  });
  heard = 0;
  unsubscribe = useEditorStore.subscribe(() => { heard++; });
}

beforeEach(() => {
  errors = [];
  window.addEventListener('error', onError);
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  unsubscribe?.();
  window.removeEventListener('error', onError);
  cleanup();
  setActiveView(null);
  registerToolManager(null);
});

describe('a notes drag through the pointer machine', () => {
  it('lays a brush stroke on each move, and every store listener hears it', () => {
    arm('zone');
    // Cell centres, so the half-cell brush lands on whole cells.
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    heard = 0;
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 95, clientY: 55 }));

    expect(errors).toEqual([]);
    const draft = useEditorStore.getState().annotationDraft as ZoneNote | null;
    expect(draft?.kind).toBe('zone');
    expect(draft!.cells.some((c) => c.x === 9 && c.y === 5)).toBe(true);
    expect(heard).toBeGreaterThan(0);
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 95, clientY: 55 }));
  });

  it('moves a selected note with the pointer, and every store listener hears it', () => {
    const zone: ZoneNote = { kind: 'zone', id: 'z1', cells: [{ x: 5, y: 5 }, { x: 6, y: 5 }], color: '#d97706', tag: null, size: 'm' } as unknown as ZoneNote;
    arm('none', { items: [zone], visible: true, locked: false });
    setStoreState({ annotationSelection: ['z1'] });
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    heard = 0;
    for (let x = 60; x <= 85; x += 5) window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: x, clientY: 55 }));

    expect(errors).toEqual([]);
    const moved = useEditorStore.getState().gridState!.annotations!.items[0] as ZoneNote;
    expect(moved.cells.some((c) => c.x === 8 && c.y === 5)).toBe(true);
    expect(heard).toBeGreaterThan(0);
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 85, clientY: 55 }));
  });
});

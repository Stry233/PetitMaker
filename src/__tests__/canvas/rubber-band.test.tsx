/**
 * The pointer-machine half of the Ctrl+drag rubber band: a drag that begins
 * under the multi-select modifier bands instead of panning, moving, or
 * starting a tool stroke, even when it starts ON the already-selected object: Ctrl never arms a
 * move.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolType, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { selectedObjectIds } from '../../state/selection';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';
import { roadLookup } from '../../state/object-index';

function makeView(): { view: ActiveView; overlay: Record<string, ReturnType<typeof vi.fn>> } {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(),
    showPlacementGhost: vi.fn(),
  };
  const view = {
    projection: {
      screenToMacro: (sx: number, sy: number) => ({ x: Math.floor(sx / 10), y: Math.floor(sy / 10) }),
      screenToMicro: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
      pan: vi.fn(),
    },
    overlay,
    camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    applyCameraTransform: vi.fn(),
  } as unknown as ActiveView;
  return { view, overlay };
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

function mapWithOneObject(): GridState {
  const gs = makeState(20, 20);
  const obj: PlacedObject = {
    id: 'a', catalogId: 'tree-apple', position: { x: 5, y: 5 },
    rotation: 0, elevation: 0,
  };
  gs.objects.set(obj.id, obj);
  bumpObjectsVersion(gs, { added: [obj] });
  return gs;
}

/** Simulates the physical modifier key: `installModifierTracking` (mounted by the pointer
 *  machine) reads live keydown/keyup, not per-event flags, so a held Ctrl outlives one click. */
function setHeld(held: boolean): void {
  window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { ctrlKey: held, key: 'Control' }));
}

let el: HTMLElement;

beforeEach(() => {
  setStoreState({
    activeTool: ToolType.Hand, selectedItemId: null, contextMenu: null,
    selection: [], selectingRegion: false, commandExecutor: null,
  });
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  setHeld(false); // a stuck modifier would leak into the next test's clicks
});

describe('Ctrl+drag over an already-selected object', () => {
  it('bands instead of arming a move: the object never relocates', () => {
    const gs = mapWithOneObject();
    const executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(gs));
    setStoreState({ gridState: gs, commandExecutor: executor });
    const { view, overlay } = makeView();
    setActiveView(view);

    // Select 'a' first with a plain click, matching the ordinary path to "already selected".
    setHeld(false);
    const ox = 5 * 10 + 5, oy = 5 * 10 + 5;
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: ox, clientY: oy }));
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: ox, clientY: oy }));
    expect(selectedObjectIds(useEditorStore.getState().selection)).toEqual(['a']);

    const undoSizeBefore = executor.getUndoStackSize();

    // Ctrl-held press on the SAME (already-selected) object, then a real drag.
    setHeld(true);
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: ox, clientY: oy }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: ox + 40, clientY: oy + 40 }));
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: ox + 40, clientY: oy + 40 }));

    expect(executor.getUndoStackSize()).toBe(undoSizeBefore);
    expect(gs.objects.get('a')!.position).toEqual({ x: 5, y: 5 });
    expect(overlay.showPlacementGhost).not.toHaveBeenCalled();

    expect(overlay.showBand).toHaveBeenCalled();
    expect(overlay.clearBand).toHaveBeenCalled();
  });
});

describe('Ctrl pressed mid-drag of an unmodified move', () => {
  it('still moves the object AND leaves it selected (does not toggle it off)', () => {
    const gs = mapWithOneObject();
    const executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(gs));
    setStoreState({ gridState: gs, commandExecutor: executor });
    const { view } = makeView();
    setActiveView(view);

    // Select 'a', then press it again (no Ctrl) to arm a real drag-to-move.
    setHeld(false);
    const ox = 5 * 10 + 5, oy = 5 * 10 + 5;
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: ox, clientY: oy }));
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: ox, clientY: oy }));
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: ox, clientY: oy }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 70, clientY: 70 })); // clears DRAG_THRESHOLD, arms dragging

    // Ctrl gets pressed WHILE the move is already in flight.
    setHeld(true);
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 85, clientY: 85 })); // macro (8, 8)

    expect(gs.objects.get('a')!.position).toEqual({ x: 8, y: 8 }); // the move committed
    expect(selectedObjectIds(useEditorStore.getState().selection)).toEqual(['a']); // and stayed selected
  });
});

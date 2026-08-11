/**
 * What a click means while the object placer has an ITEM ARMED.
 *
 * Two behaviours meet at that one decision point:
 *  - Ctrl reaches the selection path (toggle / rubber band) instead of placing, and a gesture that
 *    ends with something selected DISARMS the item, so the user lands in the ordinary select/drag
 *    mode. A gesture that selected nothing keeps the item armed.
 *  - A plain press on an EXISTING object the placement cannot displace selects that object (for an
 *    ad-hoc rotate/delete) and leaves the item armed. Empty ground still places.
 *
 * Driven through the real handlers over a real container, with a real ToolManager + executor, so
 * the placement path, the validation probe and the cursor facts are the app's own.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import {
  __resetCursorController, registerCursorSurface, setToolCursor,
} from '../../canvas/interaction/cursor-controller';
import { cursorCss } from '../../assets/cursors/cursor-css';
import type { ActiveView } from '../../canvas/view-projection';
import { ToolType, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { getCatalogItem } from '../../state/catalog';
import { ToolManager } from '../../tools/tool-manager';
import { selectedObjectIds } from '../../state/selection';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';
import { roadLookup } from '../../state/object-index';

const ARMED = 'tree-apple';

function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(),
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
    leftDragPans: true,
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

/** Simulates the physical modifier key: the machine reads live keydown/keyup, not per-event flags. */
function setHeld(held: boolean): void {
  window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { ctrlKey: held, key: 'Control' }));
}

function tree(id: string, x: number, y: number): PlacedObject {
  return {
    id, catalogId: ARMED, position: { x, y },
    rotation: 0, elevation: 0,
  };
}

let el: HTMLElement;
let gs: GridState;
let executor: CommandExecutor;

/** The app's own wiring: a real ToolManager over the same grid, pointed at the test view, with the
 *  object placer active and `item` armed. */
function arm(item: string | null, ...objects: PlacedObject[]): void {
  gs = makeState(20, 20);
  for (const obj of objects) gs.objects.set(obj.id, obj);
  if (objects.length > 0) bumpObjectsVersion(gs, { added: objects });
  executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(gs));
  const tm = new ToolManager(makeStubRenderer(), executor, gs);
  const { view } = makeView();
  setActiveView(view); // re-points the manager's ctx at the test view's projection/overlay
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: ToolType.ObjectPlacer,
    selectedItemId: item, selection: [], selectingRegion: false, contextMenu: null,
  });
}

/** Press, optionally drag, release — screen coords are macro cells × 10 (+5 to land mid-cell). */
function gesture(from: { x: number; y: number }, to = from): void {
  const sx = from.x * 10 + 5, sy = from.y * 10 + 5;
  const ex = to.x * 10 + 5, ey = to.y * 10 + 5;
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy }));
  if (ex !== sx || ey !== sy) window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: ex, clientY: ey }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: ex, clientY: ey }));
}

function hover(at: { x: number; y: number }): void {
  el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: at.x * 10 + 5, clientY: at.y * 10 + 5 }));
}

function ids(): string[] {
  return selectedObjectIds(useEditorStore.getState().selection);
}
function armedItem(): string | null {
  return useEditorStore.getState().selectedItemId;
}

beforeEach(() => {
  __resetCursorController();
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
  setHeld(false); // a stuck modifier would leak into the next test's clicks
});

describe('Ctrl while an item is armed', () => {
  it('selects the object instead of placing, then disarms the item', () => {
    arm(ARMED, tree('a', 5, 5));
    const objectsBefore = gs.objects.size;
    setHeld(true);

    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual(['a']);
    expect(gs.objects.size).toBe(objectsBefore); // nothing was placed
    expect(armedItem()).toBeNull();              // reaching for Ctrl ended the placement session
  });

  it('bands over several objects, then disarms', () => {
    arm(ARMED, tree('a', 3, 3), tree('b', 6, 3));
    setHeld(true);

    gesture({ x: 2, y: 2 }, { x: 8, y: 6 });

    expect(ids()).toEqual(['a', 'b']);
    expect(armedItem()).toBeNull();
  });

  it('keeps the item armed when the band caught nothing', () => {
    // An empty band changed nothing, so there is nothing to edit and no reason to drop the item
    // the user picked in the panel — an accidental Ctrl-drag must not cost them their selection.
    arm(ARMED, tree('a', 3, 3));
    setHeld(true);

    gesture({ x: 12, y: 12 }, { x: 16, y: 16 });

    expect(ids()).toEqual([]);
    expect(armedItem()).toBe(ARMED);
    expect(gs.objects.size).toBe(1); // and the band never placed anything either
  });

  it('keeps the item armed when a toggle empties the selection', () => {
    arm(ARMED, tree('a', 5, 5));
    setHeld(true);
    gesture({ x: 5, y: 5 });
    expect(armedItem()).toBeNull();

    // Re-arm, then Ctrl-click the same object: the toggle takes it back out.
    setStoreState({ selectedItemId: ARMED });
    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual([]);
    expect(armedItem()).toBe(ARMED);
  });
});

describe('a plain click while an item is armed', () => {
  it('selects an existing object and stays armed', () => {
    arm(ARMED, tree('a', 5, 5));
    setHeld(false);

    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual(['a']);           // ad-hoc edit target, ready for the handles
    expect(armedItem()).toBe(ARMED);        // and placement carries on afterwards
    expect(gs.objects.size).toBe(1);        // the refused placement never ran
    expect(executor.getUndoStackSize()).toBe(0);
  });

  it('attempts on a LOCKED object, so the refusal reaches the toast', () => {
    // The user-visible symptom: a click on the central plaza did nothing and said nothing. The
    // press has to reach the placer for the placement to be attempted, refused, and REPORTED —
    // Toast listens for `validation-failed`, and no command means no event.
    arm(ARMED, { ...tree('plaza', 5, 5), locked: true });
    setHeld(false);
    const failures: unknown[] = [];
    const onFail = (e: unknown): void => { failures.push(e); };
    const bus = useEditorStore.getState().eventBus;
    bus.on('validation-failed', onFail as never);

    gesture({ x: 5, y: 5 });
    bus.off('validation-failed', onFail as never);

    expect(failures).toHaveLength(1);       // the user is told why
    expect(ids()).toEqual([]);              // and the locked object was NOT selected instead
    expect(gs.objects.size).toBe(1);        // nothing was placed
    expect(armedItem()).toBe(ARMED);        // the item stays armed to try elsewhere
  });

  it('still places on empty ground', () => {
    arm(ARMED, tree('a', 5, 5));
    setHeld(false);

    gesture({ x: 12, y: 12 });

    expect(gs.objects.size).toBe(2);
    expect([...gs.objects.values()].some((o) => o.position.x === 12 && o.position.y === 12)).toBe(true);
    expect(ids()).toEqual([]); // placing selects nothing
    expect(armedItem()).toBe(ARMED);
  });

  it('leaves the armed item alone when the selection is cleared afterwards', () => {
    arm(ARMED, tree('a', 5, 5));
    gesture({ x: 5, y: 5 });
    expect(ids()).toEqual(['a']);

    useEditorStore.getState().clearSelection();

    expect(ids()).toEqual([]);
    expect(armedItem()).toBe(ARMED); // clearing a selection is not a mode change
  });
});

describe('the cursor says which of the two a click would do', () => {
  it('reads select over an object and place over open ground', () => {
    arm(ARMED, tree('a', 5, 5));
    registerCursorSurface(el);
    setToolCursor('place'); // what the armed placer's own getter reports

    hover({ x: 12, y: 12 });
    expect(el.style.cursor).toBe(cursorCss('place'));

    hover({ x: 5, y: 5 });
    expect(el.style.cursor).toBe(cursorCss('select'));

    // Ctrl outranks both: the hint names its own gesture.
    setHeld(true);
    hover({ x: 6, y: 6 });   // a new cell, so the probe re-runs
    hover({ x: 5, y: 5 });
    expect(el.style.cursor).toBe(cursorCss('select-add'));
  });

  it('drops the fact when the pointer leaves the canvas', () => {
    arm(ARMED, tree('a', 5, 5));
    registerCursorSurface(el);
    setToolCursor('place');

    hover({ x: 5, y: 5 });
    expect(el.style.cursor).toBe(cursorCss('select'));
    el.dispatchEvent(pointer('pointerleave', { buttons: 0, clientX: 0, clientY: 0 }));
    expect(el.style.cursor).toBe(cursorCss('place'));
  });
});

describe('a coating armed', () => {
  it('never reaches this decision: every coating is brush-mode, which the placer refuses', () => {
    // The Build panel paints roads; no placement-category tile offers them, and
    // `ObjectPlacerTool.onPointerDown` returns on a non-point item. The rule would not misfire
    // anyway: a coating over an existing coating is LEGAL (the overlap rule exempts the covered
    // one), so it places and strips rather than selecting.
    for (const id of ['road-dirt', 'road-stone']) {
      const item = getCatalogItem(id);
      expect(item?.traits.some((tr) => tr.type === 'surfaceCoating')).toBe(true);
      expect(item?.placementMode).toBe('brush');
    }
  });
});

/**
 * Dragging a halfStep object through the real pointer path must step in half cells, not
 * whole ones. The failure mode: a drag site that computes `screenToMacro(...) + grabOffset` —
 * `screenToMacro` floors, and the offset is fixed at press time, so the raw value is ALREADY
 * whole-stepped before any snap runs, which makes the snap a no-op. With `screenToHalf` never
 * consulted on the drag path, a halfStep object can only START on the half grid and can never
 * REACH it by dragging. `object-drag-move.test.ts` calls `planObjectMove` directly with a
 * hand-picked x.5, so it never exercises the pointer machine's own grab-offset arithmetic.
 *
 * This drives the real `usePointerInteraction` over a mocked view whose `screenToHalf` returns a
 * genuine half-cell reading (not derived from `screenToMacro`), so a drag that never leaves the
 * SAME whole macro cell (`screenToMacro` unchanged throughout) must still move a halfStep object
 * by half a cell — the one signature `macro + fixed offset` arithmetic cannot produce, whichever
 * way the offset is computed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import { __resetCursorController } from '../../canvas/interaction/cursor-controller';
import type { ActiveView } from '../../canvas/view-projection';
import { ItemCategory, TerrainType, ToolType, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolManager } from '../../tools/runtime/tool-manager';
import { registerCatalogItem } from '../../state/catalog';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState, setTerrain } from '../rules/_helpers';
import { setStoreState } from '../_store';
import { roadLookup } from '../../state/object-index';

registerCatalogItem({
  id: 'hs-drag-slab', category: ItemCategory.Facility, name: { en: 'HalfStep Drag Slab' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'halfStep' }],
});

/** 1 macro cell = 10 screen px (half cell = 5px). `screenToHalf` is a GENUINE half-grid read
 *  (round(2·world)/2), computed independently of `screenToMacro`, not derived from its floor —
 *  exactly what the real 2D/3D projections do, and what a floor-derived drag path never reads. */
function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(), showGroupPlacementGhost: vi.fn(),
  };
  const view = {
    projection: {
      screenToMacro: (sx: number, sy: number) => ({ x: Math.floor(sx / 10), y: Math.floor(sy / 10) }),
      screenToMicro: (sx: number, sy: number) => ({ x: sx / 5, y: sy / 5 }),
      screenToHalf: (sx: number, sy: number) => ({ x: Math.round((sx / 10) * 2) / 2, y: Math.round((sy / 10) * 2) / 2 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
      pan: vi.fn(),
    },
    overlay,
    camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    applyCameraTransform: vi.fn(),
    plopObject: vi.fn(),
    leftDragPans: true,
  } as unknown as ActiveView;
  return { view, overlay };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

let el: HTMLElement;
let gs: GridState;
let executor: CommandExecutor;

/** A real ToolManager over the given objects, HAND mode (no item armed), the given object
 *  pre-selected so a press on it arms drag-to-move. Returns the mocked overlay so a test can
 *  inspect the live ghost mid-drag (before any drop). */
function arm(objects: PlacedObject[], size = 20): { overlay: ReturnType<typeof makeView>['overlay'] } {
  gs = makeState(size, size);
  for (const obj of objects) gs.objects.set(obj.id, obj);
  bumpObjectsVersion(gs, { added: objects });
  executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(gs));
  const tm = new ToolManager(makeStubRenderer(), executor, gs);
  const { view, overlay } = makeView();
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: ToolType.ObjectPlacer,
    selectedItemId: null, selection: objects.map((o) => ({ kind: 'object', id: o.id }) as const),
    selectingRegion: false, contextMenu: null,
  });
  return { overlay };
}

/** Press at `from`, drag to `to`, release — raw screen px, not macro cells (the whole point here
 *  is picking pixels that straddle a HALF boundary without crossing a WHOLE one). */
function drag(from: { x: number; y: number }, to: { x: number; y: number }): void {
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: from.x, clientY: from.y }));
  window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: to.x, clientY: to.y }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: to.x, clientY: to.y }));
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
});

describe('dragging a halfStep object through the real pointer path', () => {
  it('steps in HALF cells, never getting stuck at the offset it started with', () => {
    // The slab sits at (4.5, 5); its footprint is [4.5, 5.5) x [5, 6). objectAt hit-tests a POINT
    // (the macro cell under the pointer), so the press must land on macro cell (5, 5) — (4, 5)'s
    // own point (4, 5) falls just short of the object's left edge (4.5) and would miss it.
    const slab: PlacedObject = { id: 'r', catalogId: 'hs-drag-slab', position: { x: 4.5, y: 5 }, rotation: 0, elevation: 0 };
    arm([slab]);

    // Press at (55, 55): screenToMacro (5, 5) [hits the slab], screenToHalf (5.5, 5.5) →
    // grabOffset = (4.5 - 5.5, 5 - 5.5) = (-1, -0.5).
    // Drag to (51, 55): screenToMacro is STILL (5, 5) — the SAME whole macro cell as the press,
    // never crossing a whole-cell boundary — but screenToHalf is now (5.0, 5.5). Only a drag that
    // actually reads screenToHalf can move the slab at all here: anchor = half + grabOffset =
    // (5.0 - 1, 5.5 - 0.5) = (4.0, 5.0).
    drag({ x: 55, y: 55 }, { x: 51, y: 55 });

    const moved = gs.objects.get('r');
    expect(moved, 'the slab survived the drag').toBeTruthy();
    expect(moved!.position).toEqual({ x: 4, y: 5 });
  });

  it('a NON-halfStep object dragged the same way stays whole-cell (byte-identical pin)', () => {
    const tree: PlacedObject = { id: 't', catalogId: 'tree-apple', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 };
    arm([tree]);

    // A real whole-cell drag: press mid-cell (5,5), drag to mid-cell (8,8).
    drag({ x: 55, y: 55 }, { x: 85, y: 85 });

    const moved = gs.objects.get('t');
    expect(moved, 'the tree survived the drag').toBeTruthy();
    expect(moved!.position).toEqual({ x: 8, y: 8 });
    expect(Number.isInteger(moved!.position.x)).toBe(true);
    expect(Number.isInteger(moved!.position.y)).toBe(true);
  });

  it('the live drag ghost of a half-anchored ramp reads its OWN planned elevation, not the ground under a half index', () => {
    // `gs.cells[y]?.[x]` with a fractional x is undefined, so an inline whole-cell lookup always
    // reads elevation 0 — the ghost "sinks to ground" for exactly the decks the half grid exists
    // for. Same cliff shape as
    // object-drag-move.test.ts's half-anchor case: a mountain band at y <= 9, a shoulder at
    // x = 7 and a water bank at x = 4 for y in [10, 14] leave a lane only the HALF anchor at
    // x = 4.5 clears, so the heightDrop trait re-detects there and stamps elevation 1 (the
    // mountain's own height) on the validated candidate — the value the ghost must read.
    const S = 24;
    const ramp: PlacedObject = { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 15, y: 9 }, rotation: 0, elevation: 1 };
    const { overlay } = arm([ramp], S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (y <= 9) setTerrain(gs, x, y, TerrainType.Mountain, 1);
    for (let y = 10; y <= 14; y++) {
      setTerrain(gs, 7, y, TerrainType.Mountain, 1);
      setTerrain(gs, 4, y, TerrainType.Water, 0);
    }

    // Press exactly on the ramp's own anchor (15, 9): grabOffset {0, 0}. Drag to screen (45, 100)
    // — screenToHalf reads (4.5, 10) — so the drop anchor is the half-anchored lane at x = 4.5.
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 150, clientY: 90 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 45, clientY: 100 }));

    expect(overlay.showPlacementGhost).toHaveBeenCalled();
    const calls = (overlay.showPlacementGhost as ReturnType<typeof vi.fn>).mock.calls;
    const [, gx, gy, , valid, elevation] = calls[calls.length - 1]!;
    expect(valid, 'the half anchor re-detects a legal ramp').toBe(true);
    expect({ x: gx, y: gy }).toEqual({ x: 4.5, y: 9 });
    expect(elevation, 'the deck elevation, not the ground under a half index').toBe(1);

    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 45, clientY: 100 }));
  });
});

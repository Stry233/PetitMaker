/**
 * final-review.md finding 1: `usePointerInteraction`'s press path builds `PressFacts` from
 * `ToolManager.getContext()`. A plain getter would be fine for a mouse click,
 * which is almost always preceded by a `pointermove` that refreshes the mirror via
 * `handlePointerMove`, but NOT for a touch tap: `onPointerDown` deliberately never sets
 * `pointerKnown` for a touch pointer (a finger has no meaningful "position" once it lifts), so
 * `resamplePointer` early-returns and no move ever precedes the tap.
 *
 * This drives the real handlers over a real container, with a real ToolManager + executor — the
 * same harness `placement-select.test.tsx` uses — but re-arms the placer through the STORE ALONE,
 * with no pointer event in between, then taps with `pointerType: 'touch'`. The press must decide
 * from the arming as it stands at tap time, not as it stood at the last refresh.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import { __resetCursorController } from '../../canvas/interaction/cursor-controller';
import type { ActiveView } from '../../canvas/view-projection';
import { ToolType, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolManager } from '../../tools/tool-manager';
import { selectedObjectIds } from '../../state/selection';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';
import { roadLookup } from '../../state/object-index';

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
  return { view };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. `pointerType` and
 *  `pointerId` are not MouseEvent fields, so they are defined on the instance directly. */
function pointer(type: string, init: MouseEventInit & { pointerType?: string; pointerId?: number }): MouseEvent {
  const { pointerType, pointerId, ...rest } = init;
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...rest });
  if (pointerType) Object.defineProperty(e, 'pointerType', { value: pointerType });
  if (pointerId !== undefined) Object.defineProperty(e, 'pointerId', { value: pointerId });
  return e;
}

function road(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: 'road-dirt', position: { x, y }, rotation: 0, elevation: 0 };
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
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: ToolType.ObjectPlacer,
    selectedItemId: item, selection: [], selectingRegion: false, contextMenu: null,
  });
}

/** A touch tap at a cell: pointerdown then pointerup, `pointerType: 'touch'` throughout and NO
 *  pointermove in between — the one shape a mouse gesture can always avoid (a real finger has
 *  nothing to hover with) and the one this finding is about. */
function touchTap(at: { x: number; y: number }): void {
  const sx = at.x * 10 + 5, sy = at.y * 10 + 5;
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy, pointerType: 'touch', pointerId: 1 }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: sx, clientY: sy, pointerType: 'touch', pointerId: 1 }));
}

function ids(): string[] {
  return selectedObjectIds(useEditorStore.getState().selection);
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

describe('a touch tap decides from the arming as it stands, not as it stood', () => {
  it('selects the road under a fresh, unspannable bridge arming — even though the ctx last settled on a tree', () => {
    // A road tile is a COATING: V-PLACE-OVERLAP exempts it, so a point item that is otherwise legal
    // here (a tree, on flat open grass) reads `placementAllowed: true` over it — that is the ctx
    // this test deliberately settles on FIRST, with a real (non-touch) tap elsewhere, exactly the
    // kind of press that already refreshes the mirror on its own.
    arm('tree-apple', road('r1', 5, 5));
    touchTap({ x: 15, y: 15 }); // settles ctx on 'tree-apple' via a real press (harmless empty cell)
    expect(ids()).toEqual([]);

    // Re-arm through the STORE ALONE — the shelf picking a new card, with no pointer event
    // following it. `bridge-plank` cannot span flat ground with no gap (already established by
    // `tool-cursors.test.ts`'s "refuses a bridge where no legal span exists"), so its
    // `placementAllowed` at this same cell is FALSE — the opposite of the tree's.
    setStoreState({ selectedItemId: 'bridge-plank' });

    // The touch-tap shape: no move precedes it, so nothing but `getContext()` itself can hand the
    // press a fresh mirror. Stale (pre-fix): `placementAllowed` still reads the TREE's `true`, so
    // `armedPressSelects` is false, the press falls through to a refused tool-stroke, and the road
    // is never selected. Fresh (post-fix): `placementAllowed` reads the BRIDGE's `false`, so the
    // press selects the unlocked road instead.
    touchTap({ x: 5, y: 5 });

    expect(ids(), 'the press acted on the NEW (bridge) arming, not the one the mirror last held').toEqual(['r1']);
    expect(gs.objects.has('r1'), 'the road was selected, not consumed by a placement attempt').toBe(true);
  });
});

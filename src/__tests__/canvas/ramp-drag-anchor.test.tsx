/**
 * A SNAPPING item's drag: the ghost and the judge must read ONE anchor.
 *
 * A ramp (heightDrop) and a bridge (waterSpan) do not land where they are dropped — the trait
 * DETECTS the cliff/gap near the position it is handed and snaps position, rotation and elevation
 * onto it. So the `position` a caller supplies is a PROBE ANCHOR, while the `position` an
 * already-placed one CARRIES is the snapped footprint's top-left. For a ramp the trait attaches the
 * LOW END of the deck to the high ground, so those two sit a span apart wherever it subtracts one
 * (rot 270: `px = highX − spanLen`); for a bridge the anchor is a cell in the GAP and the position
 * is the near end, which is never a legal anchor at all.
 *
 * Feeding the second where the trait wants the first is what breaks: `grabOffset = position −
 * pressAnchor` tracks the footprint rigidly, so the anchor handed to validation trails the cliff
 * by the ramp's own length. The preview drawn there sits exactly where the ramp belongs and is
 * refused; the user has to push the cursor a further two cells east, at which point the placement
 * snaps back onto where the preview already was. The pin below is the property that rules that
 * out: the pointer anywhere in the region whose snap resolves to position P draws the ghost at P
 * and accepts at P.
 *
 * Terrain: ground (elev 0) west of x = 12, a mountain wall (elev 1) from x = 12 east. Every ramp
 * on it faces west — rotation 270, `position.x = 8`, cliff cell x = 12.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import { __resetCursorController } from '../../canvas/interaction/cursor-controller';
import type { ActiveView } from '../../canvas/view-projection';
import { TerrainType, ToolType, type GridState, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolManager } from '../../tools/runtime/tool-manager';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState, setTerrain } from '../rules/_helpers';
import { setStoreState } from '../_store';
import { roadLookup } from '../../state/object-index';

const S = 24;
const WALL_X = 12;      // the ramp map's mountain, from here east
const RAMP: PlacedObject = { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 8, y: 10 }, rotation: 270, elevation: 1 };
const BRIDGE: PlacedObject = {
  id: 'r', catalogId: 'bridge-plank', position: { x: 11, y: 10 }, rotation: 0, spanLength: 5, elevation: 0,
};

/** 1 macro cell = 10 screen px, same conventions as halfstep-object-drag: `screenToHalf` is a
 *  genuine half-grid read, not `screenToMacro`'s floor. */
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

/** The map, plus `obj` already standing on it and selected so a press arms drag-to-move. */
function arm(obj: PlacedObject, terrain: (g: GridState) => void): ReturnType<typeof makeView>['overlay'] {
  gs = makeState(S, S);
  terrain(gs);
  gs.objects.set(obj.id, { ...obj });
  bumpObjectsVersion(gs, { added: [obj] });
  const executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(gs));
  const tm = new ToolManager(makeStubRenderer(), executor, gs);
  const { view, overlay } = makeView();
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: ToolType.ObjectPlacer,
    selectedItemId: null, selection: [{ kind: 'object', id: obj.id }],
    selectingRegion: false, contextMenu: null,
  });
  return overlay;
}

const wall = (g: GridState): void => {
  for (let y = 0; y < S; y++) for (let x = WALL_X; x < S; x++) setTerrain(g, x, y, TerrainType.Mountain, 1);
};
/** The same wall turned a quarter: mountain from y = 12 south, for the north-facing (rot 180)
 *  ramp — the OTHER span-subtracting case of the anchor fix. */
const WALL_Y = WALL_X; // the turned map keeps the wall at the same line, on the other axis
const wallSouth = (g: GridState): void => {
  for (let y = WALL_Y; y < S; y++) for (let x = 0; x < S; x++) setTerrain(g, x, y, TerrainType.Mountain, 1);
};
const RAMP_N: PlacedObject = { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 10, y: 8 }, rotation: 180, elevation: 1 };
/** A ground map cut by a 4-wide water channel — the gap a bridge spans. Held off the map border
 *  on both ends so the water is a contained body and no post-stroke rule reverts the drop. */
const channel = (g: GridState): void => {
  for (let y = 2; y <= S - 3; y++) for (let x = 12; x <= 15; x++) setTerrain(g, x, y, TerrainType.Water, 0);
};

const armRamp = (): ReturnType<typeof makeView>['overlay'] => arm(RAMP, wall);

/** Press inside the object's footprint at `from` (screen px), then move the pointer to `to`.
 *  Leaves the button DOWN so the live ghost can be read. */
function pressAndMoveTo(from: { x: number; y: number }, to: { x: number; y: number }): void {
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: from.x, clientY: from.y }));
  window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: to.x, clientY: to.y }));
}

function release(to: { x: number; y: number }): void {
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: to.x, clientY: to.y }));
}

/** The press point used throughout: macro cell (10, 10), the ramp's own middle. */
const GRAB = { x: 100, y: 105 };

function lastGhost(overlay: ReturnType<typeof makeView>['overlay']): { cells: MacroCoord[]; color: number } | null {
  const calls = (overlay.showGhost as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls[calls.length - 1];
  return last ? { cells: last[0] as MacroCoord[], color: last[1] as number } : null;
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

describe('dragging a snapping item', () => {
  it('lands the ramp on the cliff the POINTER names, not one a span further on', () => {
    armRamp();
    // Pointer on the wall at row 14 — the cliff the user is aiming the ramp at. The ramp's own
    // anchor is 4 cells west of the wall, so a rigid grab-offset drag reads (10, 13.5) here: flat
    // ground, no cliff, refused.
    pressAndMoveTo(GRAB, { x: 120, y: 140 });
    release({ x: 120, y: 140 });

    const moved = gs.objects.get(RAMP.id)!;
    expect(moved.position).toEqual({ x: 8, y: 14 });
    expect(moved.rotation).toBe(270);
    expect(moved.elevation).toBe(1);
  });

  it('draws the ghost exactly where the drop lands, at every pointer position it accepts', () => {
    // Walk the pointer east across the cliff line, half a cell at a time, and pair what the ghost
    // DRAWS with what the drop ACCEPTS. A green ghost is a promise: the cells it outlines are the
    // cells the release must produce.
    const seen: Array<{ px: number; green: boolean; ghostX: number }> = [];
    for (const px of [100, 105, 110, 115, 120, 125]) {
      const o = armRamp();
      pressAndMoveTo(GRAB, { x: px, y: 140 });
      const ghost = lastGhost(o);
      expect(ghost, `a ghost is drawn at screen x=${px}`).toBeTruthy();
      const green = ghost!.color === 0x22c55e;
      const ghostX = Math.min(...ghost!.cells.map((c) => c.x));
      release({ x: px, y: 140 });
      if (green) {
        expect(gs.objects.get(RAMP.id)!.position, `screen x=${px}: the green ghost's own cells`)
          .toEqual({ x: ghostX, y: 14 });
      }
      seen.push({ px, green, ghostX });
    }
    // The accepting window is the cliff's own neighbourhood — the snap RANGE, not one exact cell.
    // It reaches a whole cell onto the plateau, the same depth the east side accepts.
    expect(seen.filter((s) => s.green).map((s) => s.px)).toEqual([110, 115, 120, 125]);
    // and every accepted drop is the same placement, whichever cell of the range named it.
    expect(new Set(seen.filter((s) => s.green).map((s) => s.ghostX))).toEqual(new Set([8]));
  });

  it('lands a north-facing ramp the same way — the other axis that subtracts the span', () => {
    arm(RAMP_N, wallSouth);
    // Grab the deck's middle (macro (10, 10)) and aim at the wall four columns east: the pointer
    // names cliff cell (14, 12), so the drop must land the ramp's column there, span subtracted on
    // y exactly as the west case subtracts on x. (Screen 140 is the whole cell 14 on the half grid;
    // 145 would name the legal half-step landing 14.5.)
    pressAndMoveTo({ x: 105, y: 100 }, { x: 140, y: 120 });
    release({ x: 140, y: 120 });

    const moved = gs.objects.get(RAMP_N.id)!;
    expect(moved.position).toEqual({ x: 14, y: 8 });
    expect(moved.rotation).toBe(180);
    expect(moved.elevation).toBe(1);
  });

  it('lands a bridge on the gap the pointer names — its own position never being a legal anchor', () => {
    arm(BRIDGE, channel);
    // Press mid-deck (macro (13, 10), over the channel), drag four rows down and drop on the
    // channel again. The near end the bridge stores is dry ground: handed back to the detector it
    // finds no gap to walk out of, so a rigidly tracked drag could never move a bridge at all.
    pressAndMoveTo({ x: 130, y: 105 }, { x: 130, y: 140 });
    release({ x: 130, y: 140 });

    const moved = gs.objects.get(BRIDGE.id)!;
    expect(moved.position).toEqual({ x: 11, y: 14 });
    expect(moved.spanLength).toBe(5);
  });

  it('the refused ghost still stands ON the surface under the pointer, never sunk into it', () => {
    const overlay = armRamp();
    // Pointer deep inside the mountain wall (x = 15.5, a HALF anchor): no cliff within reach, so
    // the placement is refused — and the body ghost must still ride the wall's own surface. A
    // whole-cell `cells[y][x]` read at a fractional index is `undefined`, which sinks the ghost to
    // elevation 0, i.e. inside the mountain it is hovering over.
    pressAndMoveTo(GRAB, { x: 155, y: 140 });

    const calls = (overlay.showPlacementGhost as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length, 'the body ghost is drawn while refused').toBeGreaterThan(0);
    const [, gx, , , valid, elevation] = calls[calls.length - 1]!;
    expect(valid).toBe(false);
    expect(gx).toBe(15.5);
    expect(elevation, "the hovered wall's surface, not the ground under a fractional index").toBe(1);

    release({ x: 155, y: 140 });
  });
});

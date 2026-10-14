// @vitest-environment jsdom
/**
 * A snapping item's drag: the ghost and the judge read one anchor. A ramp or bridge trait snaps onto
 * the cliff or gap near the position it is handed, so a supplied `position` is a probe anchor while
 * a placed one carries the snapped top-left, a span apart for a ramp (rot 270: `px = highX −
 * spanLen`). Feeding the second where the trait wants the first makes validation trail the cliff
 * and refuse a correct preview. The pin: anywhere the snap resolves to P draws and accepts at P.
 *
 * Terrain: ground (elev 0) west of x = 12, a mountain wall (elev 1) from x = 12 east. Every ramp
 * on it faces west: rotation 270, `position.x = 10`, cliff cell x = 12.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeStubView } from '../../_support/tool-manager';
import { makeState, setTerrain } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { headlessViewVerbs } from '../../_support/tool-manager';

const S = 24;
const WALL_X = 12;      // the ramp map's mountain, from here east
const RAMP: PlacedObject = { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 10, y: 10 }, rotation: 270, elevation: 1 };
const BRIDGE: PlacedObject = {
  id: 'r', catalogId: 'bridge-plank', position: { x: 11, y: 10 }, rotation: 0, spanLength: 5, elevation: 0,
};

/** 1 cell = 10 screen px, same conventions as halfstep-object-drag: the view reports the
 *  continuous point, whose half-cell point is not the placement cell's floor. */
function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(), showGroupPlacementGhost: vi.fn(),
    showObjectMove: vi.fn(),
  };
  const view = {
    projection: {
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
            cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay,
    camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    ...headlessViewVerbs(),
    plopObject: vi.fn(),
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
  const executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const { view, overlay } = makeView();
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [{ kind: 'object', id: obj.id }],
    selectingRegion: false, contextMenu: null, ...armedEditMode({ tool: ToolType.ObjectPlacer, item: null }),
  });
  return overlay;
}

const wall = (g: GridState): void => {
  for (let y = 0; y < S; y++) for (let x = WALL_X; x < S; x++) setTerrain(g, x, y, TerrainType.Mountain, 1);
};
/** The same wall turned a quarter: mountain from y = 12 south, for the north-facing (rot 180)
 *  ramp — the other span-subtracting case of the anchor fix. */
const WALL_Y = WALL_X; // the turned map keeps the wall at the same line, on the other axis
const wallSouth = (g: GridState): void => {
  for (let y = WALL_Y; y < S; y++) for (let x = 0; x < S; x++) setTerrain(g, x, y, TerrainType.Mountain, 1);
};
const RAMP_N: PlacedObject = { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 10, y: 10 }, rotation: 180, elevation: 1 };
/** A ground map cut by a 4-wide water channel — the gap a bridge spans. Held off the map border
 *  on both ends so the water is a contained body and no post-stroke rule reverts the drop. */
const channel = (g: GridState): void => {
  for (let y = 2; y <= S - 3; y++) for (let x = 12; x <= 15; x++) setTerrain(g, x, y, TerrainType.Water, 0);
};

const armRamp = (): ReturnType<typeof makeView>['overlay'] => arm(RAMP, wall);

/** Press inside the object's footprint at `from` (screen px), then move the pointer to `to`.
 *  Leaves the button down so the live ghost can be read. */
function pressAndMoveTo(from: { x: number; y: number }, to: { x: number; y: number }): void {
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: from.x, clientY: from.y }));
  window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: to.x, clientY: to.y }));
}

function release(to: { x: number; y: number }): void {
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: to.x, clientY: to.y }));
}

/** The press point used throughout: macro cell (10, 10), the ramp's own middle. */
const GRAB = { x: 100, y: 105 };

function lastGhost(overlay: ReturnType<typeof makeView>['overlay']): { cells: MacroCoord[]; valid: boolean } | null {
  const calls = (overlay.showGhost as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls[calls.length - 1];
  return last ? { cells: (last[0] as { cells: MacroCoord[] }).cells, valid: (last[1] as { valid: boolean }).valid } : null;
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
    // anchor is 2 cells west of the wall, so a rigid grab-offset drag reads (10, 13.5) here: flat
    // ground, no cliff, refused.
    pressAndMoveTo(GRAB, { x: 120, y: 140 });
    release({ x: 120, y: 140 });

    const moved = gs.objects.get(RAMP.id)!;
    expect(moved.position).toEqual({ x: 10, y: 14 });
    expect(moved.rotation).toBe(270);
    expect(moved.elevation).toBe(1);
  });

  it('draws the ghost exactly where the drop lands, at every pointer position it accepts', () => {
    // Walk the pointer east across the cliff line, half a cell at a time, and pair what the ghost
    // Draws with what the drop accepts. A green ghost is a promise: the cells it outlines are the
    // cells the release must produce.
    const seen: Array<{ px: number; green: boolean; ghostX: number }> = [];
    for (const px of [100, 105, 110, 115, 120, 125]) {
      const o = armRamp();
      pressAndMoveTo(GRAB, { x: px, y: 140 });
      const ghost = lastGhost(o);
      expect(ghost, `a ghost is drawn at screen x=${px}`).toBeTruthy();
      const green = ghost!.valid;
      const ghostX = Math.min(...ghost!.cells.map((c) => c.x));
      release({ x: px, y: 140 });
      if (green) {
        expect(gs.objects.get(RAMP.id)!.position, `screen x=${px}: the green ghost's own cells`)
          .toEqual({ x: ghostX, y: 14 });
      }
      seen.push({ px, green, ghostX });
    }
    // The accepting window is the cliff's own neighbourhood — the snap range, not one exact cell.
    // It reaches a whole cell onto the plateau, the same depth the east side accepts.
    expect(seen.filter((s) => s.green).map((s) => s.px)).toEqual([110, 115, 120, 125]);
    // and every accepted drop is the same placement, whichever cell of the range named it.
    expect(new Set(seen.filter((s) => s.green).map((s) => s.ghostX))).toEqual(new Set([10]));
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
    expect(moved.position).toEqual({ x: 14, y: 10 });
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
    // Pointer deep inside the mountain wall (x = 15.5, a half anchor): no cliff within reach, so
    // the placement is refused — and the body ghost must still ride the wall's own surface. A
    // whole-cell `cells[y][x]` read at a fractional index is `undefined`, which sinks the ghost to
    // elevation 0, i.e. inside the mountain it is hovering over.
    pressAndMoveTo(GRAB, { x: 155, y: 140 });

    const calls = (overlay.showObjectMove as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length, 'the body ghost is drawn while refused').toBeGreaterThan(0);
    const [[{ position, elevation }], valid] = calls[calls.length - 1]!;
    expect(valid).toBe(false);
    expect(position.x).toBe(15.5);
    expect(elevation, "the hovered wall's surface, not the ground under a fractional index").toBe(1);

    release({ x: 155, y: 140 });
  });
});

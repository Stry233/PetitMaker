/**
 * The marks a committed route leaves behind: where they stand, what a drag on one does, and the ways
 * they go.
 *
 * TWO HOSTS, because the seam has two sides. The first describe drives the session with a MOCK host,
 * which is the only way to pin "a drag previews and only the drop re-lays" — a real host lands a road
 * and the two calls are not observable. The second drives the REAL `MacroTool` over a real executor,
 * because "one undo entry" and "nothing a hand placed is re-laid" are facts about the tool rather
 * than about the overlay.
 *
 * The component projects through the ACTIVE view, so a trivial 1-cell-per-10px projection is
 * registered and the marks are read back in those coordinates (`curve-handles.test.tsx`'s pattern).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import { RouteMarks } from '../../../ui/chrome/floating/RouteMarks';
import {
  __resetRouteSession, closeRouteMarks, getRouteSession, LINGER_MS, moveRouteMark, openRouteMarks,
} from '../../../tools/macros/route-session';
import { setActiveView } from '../../../canvas/active-view';
import type { ActiveView } from '../../../canvas/view-projection';
import { I18nProvider } from '../../../i18n/context';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { useEditorStore } from '../../../state/store';
import { roadLookup } from '../../../state/object-index';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { MacroTool } from '../../../tools/macros/macro-tool';
import { makeState } from '../../rules/_helpers';
import { makeToolCtx } from '../../tools/_tool-ctx';
import {
  CellZone, type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';

const SCALE = 10;
const SIZE = 45;
const SHORE = 3;

/** A flat projection: one cell is 10px, no camera. */
const view = {
  projection: {
    cellToScreen: (x: number, y: number) => ({ x: x * SCALE, y: y * SCALE, scale: SCALE }),
    screenToMacro: (sx: number, sy: number) => ({ x: Math.round(sx / SCALE), y: Math.round(sy / SCALE) }),
    screenToMicro: (sx: number, sy: number) => ({ x: Math.round(sx / SCALE), y: Math.round(sy / SCALE) }),
    pan: () => {},
  },
  overlay: {} as ActiveView['overlay'],
  applyCameraTransform: () => {},
  camera: { pan: () => {}, zoomStep: () => {}, zoomBy: () => {} },
} as unknown as ActiveView;

const preview = vi.fn();
const relay = vi.fn();
const finalize = vi.fn();
const host = () => ({ preview, relay, finalize });

/** jsdom has no PointerEvent; MouseEvent carries every field these handlers read. */
const pointer = (type: string, init: MouseEventInit = {}) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, ...init });

function paint(): void {
  render(<I18nProvider><RouteMarks /></I18nProvider>);
}

/** The arming count the store is on. A session opened at any OTHER count is stale by construction,
 *  so a test that wants live marks has to open them at this one. */
const epochNow = () => useEditorStore.getState().armingEpoch;

const marks = () => screen.queryAllByTestId(/^route-mark-/);
const cellOf = (id: 'from' | 'to') => (screen.getByTestId(`route-mark-${id}`) as HTMLElement).dataset['cell'];

/** Drag a mark from its own point to a target CELL, the way a pointer does it. */
function drag(el: Element, toCell: MacroCoord): void {
  act(() => { el.dispatchEvent(pointer('pointerdown')); });
  const at = { clientX: toCell.x * SCALE, clientY: toCell.y * SCALE };
  act(() => { window.dispatchEvent(pointer('pointermove', at)); });
  act(() => { window.dispatchEvent(pointer('pointerup', at)); });
}

/** An open, flat, buildable map with a sea border — `road-link-gesture.test.ts`'s fixture. */
function makeMap(size = SIZE): { state: GridState; executor: CommandExecutor } {
  const state = makeState(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < SHORE || y < SHORE || x >= size - SHORE || y >= size - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor };
}

function place(executor: CommandExecutor, catalogId: string, x: number, y: number): PlacedObject {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0, elevation: 0 };
  const r = executor.execute(objectPlacementCommand(obj));
  expect(r.success, `place ${catalogId}@${x},${y}: ${r.errors?.[0]?.message ?? ''}`).toBe(true);
  return obj;
}

/** Every object on the map as `catalogId@x,y`, sorted — a whole-map fingerprint a refused nudge must
 *  not move. */
const fingerprint = (state: GridState): string[] =>
  [...state.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort();

/** A two-tap route, committed through the real tool on a fresh map. */
function laidRoute(pre?: (executor: CommandExecutor) => void): {
  tool: MacroTool; state: GridState; executor: CommandExecutor; ctx: ReturnType<typeof makeToolCtx>;
} {
  const { state, executor } = makeMap();
  pre?.(executor);
  // The session records the arming it was laid at and the component compares it against the store's
  // live count, so a context frozen at a different one would open marks that are stale on arrival.
  const ctx = makeToolCtx(state, executor, 1, 1, { armedMacro: 'road-link', armingEpoch: epochNow() });
  const tool = new MacroTool();
  tool.onActivate();
  act(() => {
    tool.onPointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, ctx);
    tool.onPointerDown({ x: 30, y: 10 }, { x: 30, y: 10 }, ctx);
  });
  return { tool, state, executor, ctx };
}

beforeEach(() => {
  preview.mockClear();
  relay.mockClear();
  finalize.mockClear();
  setActiveView(view);
});
afterEach(() => {
  __resetRouteSession();
  setActiveView(null);
});

describe('the marks a route leaves', () => {
  it('nothing at all until a route has been laid', () => {
    paint();
    expect(marks()).toHaveLength(0);
  });

  it('the two marks stand where the taps did', () => {
    paint();
    act(() => { openRouteMarks({ x: 5, y: 7 }, { x: 19, y: 7 }, host(), epochNow()); });
    expect(marks()).toHaveLength(2);
    expect(cellOf('from')).toBe('5,7');
    expect(cellOf('to')).toBe('19,7');
  });

  it('says which end each one is', () => {
    paint();
    act(() => { openRouteMarks({ x: 5, y: 7 }, { x: 19, y: 7 }, host(), epochNow()); });
    expect(screen.getByTestId('route-mark-from').textContent).toBe('From');
    expect(screen.getByTestId('route-mark-to').textContent).toBe('To');
  });

  it('a drag previews and only the drop re-lays', () => {
    paint();
    act(() => { openRouteMarks({ x: 5, y: 7 }, { x: 19, y: 7 }, host(), epochNow()); });
    drag(screen.getByTestId('route-mark-to'), { x: 19, y: 14 });

    expect(preview, 'every frame of the drag shows where the route is going').toHaveBeenCalled();
    expect(preview.mock.calls[0]![1]).toMatchObject({ x: 19, y: 14 });
    expect(relay, 'one relay per drag, not one per pointer event').toHaveBeenCalledTimes(1);
    expect(relay.mock.calls[0]).toEqual([{ x: 5, y: 7 }, { x: 19, y: 14 }]);
    expect(cellOf('to')).toBe('19,14');
  });

  it('does not let the press through to the canvas, which would dismiss them', () => {
    paint();
    act(() => { openRouteMarks({ x: 5, y: 7 }, { x: 19, y: 7 }, host(), epochNow()); });
    const seen = vi.fn();
    window.addEventListener('pointerdown', seen);
    act(() => { screen.getByTestId('route-mark-from').dispatchEvent(pointer('pointerdown')); });
    window.removeEventListener('pointerdown', seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it('they go on their own', () => {
    vi.useFakeTimers();
    try {
      paint();
      act(() => { openRouteMarks({ x: 5, y: 7 }, { x: 19, y: 7 }, host(), epochNow()); });
      expect(marks()).toHaveLength(2);
      act(() => { vi.advanceTimersByTime(LINGER_MS + 1); });
      expect(marks()).toHaveLength(0);
      expect(finalize, 'the tool is told the route is final').toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the clock starts again on a nudge, so a hand on a mark keeps them', () => {
    vi.useFakeTimers();
    try {
      paint();
      act(() => { openRouteMarks({ x: 5, y: 7 }, { x: 19, y: 7 }, host(), epochNow()); });
      act(() => { vi.advanceTimersByTime(LINGER_MS - 100); });
      act(() => { moveRouteMark('to', 19, 9, true); });
      act(() => { vi.advanceTimersByTime(200); });
      expect(marks(), 'the old clock was cancelled, not merely ignored').toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an undo takes the route back, so the marks go with it', () => {
    paint();
    act(() => { openRouteMarks({ x: 5, y: 7 }, { x: 19, y: 7 }, host(), epochNow()); });
    // `history-applied` is emitted by undo and redo and by nothing else, which is what lets the marks
    // read a step through history without reading their own relay as one.
    act(() => { useEditorStore.getState().eventBus.emit('history-applied', { cells: [] }); });
    expect(marks()).toHaveLength(0);
  });
});

describe('the nudge, through the tool that owns the route', () => {
  it('opens the marks at the two taps once the route lands', () => {
    paint();
    laidRoute();
    expect(marks()).toHaveLength(2);
    expect(cellOf('from')).toBe('10,10');
    expect(cellOf('to')).toBe('30,10');
  });

  it('a nudge is one undo entry', () => {
    paint();
    const { state, executor } = laidRoute();
    const committed = executor.getUndoStackSize();

    act(() => { moveRouteMark('to', 30, 16, true); });

    expect(executor.getUndoStackSize()).toBe(committed);
    // Depth alone is also what a fully REFUSED nudge leaves behind, so the relay is shown to have
    // happened as well: one entry, and it is the moved route's.
    const paved = [...state.objects.values()].map((o) => `${o.position.x},${o.position.y}`);
    expect(paved, 'the entry is the nudged route, not the original left standing').toContain('30,16');
  });

  it('a nudge lays the route at the moved end, and takes the old line back', () => {
    paint();
    const { state } = laidRoute();

    // Straight down from the first mark, so the new line shares nothing with the old one but its
    // start: a route that merely EXTENDED the old one would prove nothing about the rollback.
    act(() => { moveRouteMark('to', 10, 30, true); });

    const paved = [...state.objects.values()].map((o) => `${o.position.x},${o.position.y}`);
    expect(paved, 'the route reaches the mark it was dragged to').toContain('10,30');
    expect(paved, 'and no longer runs to where the mark was').not.toContain('30,10');
  });

  it('a nudge does not re-lay what stood', () => {
    paint();
    let byHand: PlacedObject | null = null;
    const { state } = laidRoute((executor) => { byHand = place(executor, 'path-overgrown-dirt', 8, 36); });

    act(() => { moveRouteMark('to', 30, 16, true); });

    expect(state.objects.has(byHand!.id), 'the hand-placed road kept its own id').toBe(true);
    expect(state.objects.get(byHand!.id)!.position).toEqual({ x: 8, y: 36 });
  });

  it('a nudge refuses rather than roll back a hand placement made AFTER the route', () => {
    // The rollback aims at a KNOWN depth, so anything laid on top of the route would go with it. The
    // depth having moved at all is the evidence, and this is the rule "nothing a hand placed is
    // deleted by a gesture" reaching the one line that enforces it.
    paint();
    const { state, executor } = laidRoute();
    const byHand = place(executor, 'path-overgrown-dirt', 8, 36);
    const before = fingerprint(state);

    act(() => { moveRouteMark('to', 30, 16, true); });

    expect(state.objects.has(byHand.id), 'the hand placement survived').toBe(true);
    expect(fingerprint(state), 'and so did the route, untouched').toEqual(before);
    expect(marks(), 'the offer went instead: the route is no longer the top entry').toHaveLength(0);
  });

  it('they go when the next gesture starts', () => {
    paint();
    const { tool, ctx } = laidRoute();
    expect(marks()).toHaveLength(2);

    act(() => { tool.onPointerDown({ x: 12, y: 24 }, { x: 12, y: 24 }, ctx); });

    expect(marks()).toHaveLength(0);
  });

  it('they go when the card under the hand changes', () => {
    paint();
    const { tool, ctx } = laidRoute();
    expect(marks()).toHaveLength(2);

    // The switch is the EPOCH moving, not the id: `setEditMode` bumps the count on every change of
    // armed macro, and a hand-built context has to move it for the same reason (a switch away and
    // back restores the id, so the id alone cannot say the arming was touched).
    const switched = { ...ctx, armedMacro: 'patch-tree', armingEpoch: ctx.armingEpoch + 1 };
    act(() => { tool.onPointerMove({ x: 12, y: 24 }, { x: 12, y: 24 }, switched); });

    expect(marks()).toHaveLength(0);
  });

  it('they go on a card switch the pointer never reports', () => {
    // A switch made with the pointer off the map, or a drag that begins and ends inside a pill, never
    // reaches the tool — so the overlay reads the same counter the tool does rather than waiting to be
    // told. Without this a relay could run under a card the hand has moved on from.
    paint();
    laidRoute();
    expect(marks()).toHaveLength(2);

    act(() => { useEditorStore.setState({ armingEpoch: useEditorStore.getState().armingEpoch + 1 }); });

    expect(marks()).toHaveLength(0);
    expect(getRouteSession()).toBeNull();
  });

  it('they go on a SILENT round trip back to the same card', () => {
    // The route's marks offer a nudge; two card clicks with no pointer event between them leave the
    // id at `road-link` and the arming twice-changed, and the offer belongs to neither of those
    // clicks. The count is the only thing that says so.
    paint();
    const { tool, ctx } = laidRoute();
    expect(marks()).toHaveLength(2);

    const roundTrip = { ...ctx, armingEpoch: ctx.armingEpoch + 2 };
    act(() => { tool.onPointerMove({ x: 12, y: 24 }, { x: 12, y: 24 }, roundTrip); });

    expect(marks()).toHaveLength(0);
  });

  it('marks that would open AFTER the switch never stand at all', () => {
    // A route builds off the main thread, so its marks can open after the card that laid it is gone.
    // The switch is then already in the past: a subscriber watching the count for a CHANGE sees that
    // switch while there is nothing standing, and nothing afterwards. Asking whether the session
    // belongs to the arming in force has no such gap, which is why the session carries its own count.
    paint();
    const { state, executor } = makeMap();
    const stale = makeToolCtx(state, executor, 1, 1, { armedMacro: 'road-link', armingEpoch: epochNow() - 1 });
    const tool = new MacroTool();
    tool.onActivate();
    act(() => {
      tool.onPointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, stale);
      tool.onPointerDown({ x: 30, y: 10 }, { x: 30, y: 10 }, stale);
    });

    expect(marks(), 'the route is laid, but its marks belong to an arming that is over').toHaveLength(0);
    // And the tool is not left claiming a gesture whose marks were never on screen.
    expect(tool.cancelPending(stale)).toBe(false);
  });

  it('Escape puts them away before it disarms the card', () => {
    paint();
    const { tool, ctx } = laidRoute();

    let used = false;
    act(() => { used = tool.cancelPending(ctx); });
    expect(used, 'the key was used on the marks').toBe(true);
    expect(marks()).toHaveLength(0);
    // And a second Escape falls through, so the disarm is still one key away.
    expect(tool.cancelPending(ctx)).toBe(false);
  });

  it('a release off the map still drops the mark where the ghost last was', () => {
    paint();
    const { state } = laidRoute();
    const to = screen.getByTestId('route-mark-to');

    act(() => { to.dispatchEvent(pointer('pointerdown')); });
    act(() => { window.dispatchEvent(pointer('pointermove', { clientX: 10 * SCALE, clientY: 30 * SCALE })); });
    // A projection that answers nothing, which is what a release past the map's edge looks like.
    act(() => { setActiveView({ ...view, projection: { ...view.projection, screenToMacro: () => null } } as unknown as ActiveView); });
    act(() => { window.dispatchEvent(pointer('pointerup', { clientX: 0, clientY: 0 })); });

    expect(cellOf('to')).toBe('10,30');
    const paved = [...state.objects.values()].map((o) => `${o.position.x},${o.position.y}`);
    expect(paved).toContain('10,30');
  });

  it('they go when the tool is put away', () => {
    paint();
    const { tool, ctx } = laidRoute();
    expect(marks()).toHaveLength(2);

    act(() => { tool.onDeactivate(ctx); });

    expect(marks()).toHaveLength(0);
    expect(getRouteSession()).toBeNull();
  });

  it('a refused nudge leaves the map exactly as the route left it', () => {
    paint();
    const { state } = laidRoute();
    const before = fingerprint(state);
    expect(before.length).toBeGreaterThan(0);

    // Dragged clean off the edge of the map: there is no cell to aim at, so the relay lays nothing.
    act(() => { moveRouteMark('to', -3, -3, true); });

    expect(fingerprint(state)).toEqual(before);
    expect(cellOf('to'), 'the marks describe the route the map actually has').toBe('30,10');
  });

  it('closing the session is what tells the tool the route is final', () => {
    paint();
    laidRoute();
    act(() => { closeRouteMarks(); });
    expect(marks()).toHaveLength(0);
    expect(getRouteSession()).toBeNull();
  });
});

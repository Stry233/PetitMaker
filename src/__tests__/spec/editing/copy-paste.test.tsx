// @vitest-environment jsdom
/**
 * Copying and pasting objects as a person does: the keys through the commands they run, the map's
 * own pointer machine over a mounted canvas for where the pointer rests and the Ctrl+drag copy, the
 * map's menu through its Paste, and the toasts a person reads. The map is a spec world the editor
 * store holds; a cell is ten screen pixels.
 */
import { describe, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, screen as page, fireEvent, within } from '@testing-library/react';
import { SelectionCard } from '../../../ui/chrome/floating/SelectionCard';
import { DeletePopover } from '../../../ui/chrome/floating/DeletePopover';
import { I18nProvider, translate } from '../../../i18n/context';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { world, rect, TerrainType, type SpecWorld } from '../_world';
import { placeItem, plateau } from './_editing';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { installClipboardBridge, pasteAtCell } from '../../../editor/editing/clipboard';
import { installSelectionViewSync } from '../../../view/shared/overlay/selection-view-sync';
import { encodeArrangement } from '../../../io/clipboard/payload';
import { useEditorStore } from '../../../state/store';
import { armedItemOf } from '../../../state/editing/edit-mode';
import { selectedObjectIds } from '../../../state/selection';
import { ToolType } from '../../../state/editing/vocabulary';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import { objectRect, surfaceElevationAt } from '../../../state/object-geometry';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import type { PlanetSession } from '../../../state/slices/planet-session';

const ROSE = 'flower-rose';
const DAISY = 'flower-daisy';
const ROAD = 'path-overgrown-dirt';
const CABIN = 'building-forest-cabin';
const noop = (): void => {};
/** The selection marks the overlay was last told to draw: the rects of `showSelection` since the
 *  last `clearSelection`, on the grid each lies on. */
let marks: { rect: Rect; grid: string }[] = [];
const overlay = new Proxy({} as ToolOverlay, {
  get: (_, name) => {
    if (name === 'showSelection') return (rect: Rect, grid: string, opts?: { append?: boolean }) => { marks = opts?.append ? [...marks, { rect, grid }] : [{ rect, grid }]; };
    if (name === 'clearSelection') return () => { marks = []; };
    return noop;
  },
});
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
  overlay, camera: { pan: noop, zoomStep: noop, zoomBy: noop }, ...headlessViewVerbs(),
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let unsync: (() => void) | null = null;
let toasts: string[] = [];
let stopToasts: (() => void) | null = null;
let stopBridge: (() => void) | null = null;
const mouse = (type: string, init: MouseEventInit) => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
const screen = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: c.y * 10 + 5 });
function press(from: MacroCoord, ...path: MacroCoord[]): void {
  canvas.dispatchEvent(mouse('pointerdown', { button: 0, buttons: 1, ...screen(from) }));
  for (const c of path) window.dispatchEvent(mouse('pointermove', { buttons: 1, ...screen(c) }));
  window.dispatchEvent(mouse('pointerup', { button: 0, buttons: 0, ...screen(path[path.length - 1] ?? from) }));
}
/** A mouse resting over cell `c` of the map. */
const hover = (c: MacroCoord) => canvas.dispatchEvent(mouse('pointermove', { buttons: 0, ...screen(c) }));
/** The browser's `paste` event carrying `text` from the system clipboard. */
function pasteEvent(text: string): void {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
  document.body.dispatchEvent(e);
}
function holdCtrl(held: boolean): void {
  window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { ctrlKey: held, key: 'Control' }));
}
const key = (id: string) => COMMAND_BY_ID.get(id)!.run({ toggleMenu: noop } as unknown as CommandContext);
/** The paste key runs its body on the next turn, after the browser's own paste event. */
async function pasteKey(): Promise<void> {
  key('selection.paste');
  await new Promise((r) => setTimeout(r, 0));
}
const s = () => useEditorStore.getState();
const selected = () => selectedObjectIds(s().selection);
const select = (...objects: PlacedObject[]) => s().setSelection(objects.map((o) => ({ kind: 'object', id: o.id })));
const objectsOf = (w: SpecWorld, id: string) => [...w.state.objects.values()].filter((o) => o.catalogId === id);
const at = (w: SpecWorld, c: MacroCoord) => [...w.state.objects.values()].filter((o) => o.position.x === c.x && o.position.y === c.y);
/** The objects placed after the map held `before`, in placement order sorted along the row. */
const added = (w: SpecWorld, before: number) => [...w.state.objects.values()].slice(before)
  .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
/** The cells a group of objects covers, as one rectangle. */
function outline(objects: readonly PlacedObject[]): Rect {
  const rs = objects.map((o) => objectRect(o));
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** Whether `b` shares an edge with `a`, or overlaps it. */
const touches = (a: Rect, b: Rect) => overlaps({ x: a.x - 1, y: a.y, w: a.w + 2, h: a.h }, b) || overlaps({ x: a.x, y: a.y - 1, w: a.w, h: a.h + 2 }, b);

/** Open `w` in the editor with the Hand tool up, the live tool manager over it. */
function open(w: SpecWorld): void {
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool: ToolType.Hand }) });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  unsync?.();
  unsync = useEditorStore.subscribe(() => manager.syncArming());
}

/** An "abab" row of flowers on open ground, opened in the editor. */
function row(): { w: SpecWorld; at: MacroCoord; flowers: PlacedObject[] } {
  const w = world();
  const origin = w.openGround(16, 10);
  const flowers = [ROSE, DAISY, ROSE, DAISY].map((id, i) => placeItem(w, id, { x: origin.x + i, y: origin.y })!);
  open(w);
  return { w, at: origin, flowers };
}

beforeEach(() => {
  resetStore();
  marks = [];
  __resetCursorController();
  setActiveView(view);
  canvas = render(<Canvas />).getByTestId('canvas');
  toasts = [];
  stopToasts = setToastPresenter((text) => { toasts.push(text); });
});

afterEach(() => {
  unsync?.();
  unsync = null;
  stopToasts?.();
  stopBridge?.();
  stopBridge = null;
  holdCtrl(false);
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

describe('copying objects', () => {
  spec('EDIT-53', 'Copy takes the selection with its arrangement, changes nothing and says how many it took', () => {
    const { w, flowers } = row();
    select(...flowers);
    const before = w.fingerprint();
    key('selection.copy');
    expect(w.fingerprint()).toBe(before);
    expect(selected()).toEqual(flowers.map((f) => f.id));
    const copy = s().clipboard!;
    expect(copy.members.map((m) => [m.catalogId, m.x, m.y, m.rise])).toEqual([[ROSE, 0, 0, 0], [DAISY, 1, 0, 0], [ROSE, 2, 0, 0], [DAISY, 3, 0, 0]]);
    expect(toasts).toEqual(['4 objects copied']);
  });

  spec('EDIT-53', 'roads are copied with the objects on them; the terrain under them is not, and a landmark stays', () => {
    const w = world();
    const origin = w.openGround(12, 8);
    const road = w.object(w.place(ROAD, origin.x, origin.y).id!)!;
    const rose = placeItem(w, ROSE, { x: origin.x + 1, y: origin.y })!;
    open(w);
    const landmark = [...w.state.objects.values()].find((o) => o.locked)!;
    select(road, rose, landmark);
    key('selection.copy');
    expect(s().clipboard!.members.map((m) => m.catalogId).sort()).toEqual([ROAD, ROSE].sort());
    expect(toasts).toEqual(['2 objects copied', '1 object comes with this planet and was not copied']);
  });
});

describe('pasting at a picked block', () => {
  spec('EDIT-54', 'a click on open ground picks that cell, marked, and Ctrl+V puts the copy\'s top-left on it, selected', async () => {
    const { w, at: origin, flowers } = row();
    const stopSync = installSelectionViewSync();
    try {
      select(...flowers);
      key('selection.copy');
      const block = { x: origin.x + 3, y: origin.y + 5 };
      press(block);
      expect(selected(), 'the pick selects nothing').toEqual([]);
      expect(marks, 'the picked block is marked').toEqual([{ rect: { x: block.x, y: block.y, w: 1, h: 1 }, grid: 'object' }]);
      hover({ x: origin.x + 9, y: origin.y + 1 });
      const before = w.state.objects.size;
      await pasteKey();
      expect([0, 1, 2, 3].map((i) => at(w, { x: block.x + i, y: block.y }).map((o) => o.catalogId)))
        .toEqual([[ROSE], [DAISY], [ROSE], [DAISY]]);
      expect(selected().sort(), 'the copy is the selection').toEqual(added(w, before).map((o) => o.id).sort());
      expect(s().pickedCell, 'the paste\'s selection replaces the pick').toBeNull();
      expect(marks, 'the pick mark is gone').not.toContainEqual({ rect: { x: block.x, y: block.y, w: 1, h: 1 }, grid: 'object' });
      expect(toasts.filter((t) => t.includes('nearby'))).toEqual([]);
    } finally { stopSync(); }
  });

  spec('EDIT-57', 'where the copy does not fit at the picked block, it goes whole to the nearest place from it and the toast says so', async () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    key('selection.copy');
    toasts = [];
    // Four wide from two cells left of the original row, the copy would cover its first two flowers.
    const block = { x: origin.x - 2, y: origin.y };
    press(block);
    expect(s().pickedCell).toEqual(block);
    const before = w.state.objects.size;
    await pasteKey();
    const copy = added(w, before);
    expect(copy, 'the copy is placed whole').toHaveLength(4);
    const box = outline(copy);
    expect(overlaps(box, outline(flowers)), 'the copy covers nothing').toBe(false);
    expect(Math.hypot(box.x - block.x, box.y - block.y), 'within a few cells of the picked block').toBeLessThanOrEqual(3);
    expect(toasts).toEqual(['There was no room here, so the copy was placed nearby']);
  });

  spec('EDIT-54', 'Escape clears the picked block and its mark, and Ctrl+V then lays the copy beside the original', async () => {
    const { w, at: origin, flowers } = row();
    const stopSync = installSelectionViewSync();
    try {
      select(...flowers);
      key('selection.copy');
      const block = { x: origin.x + 8, y: origin.y + 8 };
      press(block);
      expect(s().pickedCell).toEqual(block);
      key('selection.deselect');
      expect(s().pickedCell).toBeNull();
      expect(marks).toEqual([]);
      const before = w.state.objects.size;
      await pasteKey();
      const copy = added(w, before);
      expect(at(w, block)).toEqual([]);
      expect(touches(outline(copy), outline(flowers)), 'the copy stands against the original').toBe(true);
    } finally { stopSync(); }
  });

  spec('EDIT-54', 'picking a block is no undo step, and selecting objects or arming a tool drops it', () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    press({ x: origin.x + 6, y: origin.y + 4 });
    expect(selected(), 'the click on open ground clears the selection').toEqual([]);
    press({ x: origin.x + 7, y: origin.y + 5 });
    expect(s().pickedCell).toEqual({ x: origin.x + 7, y: origin.y + 5 });
    // The one step is the click that cleared the objects; the second pick added none.
    w.undo();
    expect(selected(), 'undo gives back the objects').toEqual(flowers.map((f) => f.id));
    expect(s().pickedCell, 'and no pick').toBeNull();
    press({ x: origin.x + 7, y: origin.y + 5 });
    press(flowers[0]!.position);
    expect(s().pickedCell, 'selecting an object drops the pick').toBeNull();
    press({ x: origin.x + 7, y: origin.y + 5 });
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    expect(s().pickedCell, 'arming a tool drops the pick').toBeNull();
  });

  spec('EDIT-25', 'a click on a mountain selects its cell with its card, and Ctrl+V puts the copy\'s top-left on the object cell under the click, on that layer', async () => {
    const { w, at: origin, flowers } = row();
    plateau(w, { x: origin.x + 6, y: origin.y + 3 }, 8, 6, 2);
    const stopSync = installSelectionViewSync();
    try {
      render(<I18nProvider><SelectionCard /><DeletePopover /></I18nProvider>);
      select(...flowers);
      key('selection.copy');
      // Late in object cell `block`, nearer the next half-cell point: the terrain cell holding that
      // point is one further right and down.
      const block = { x: origin.x + 8, y: origin.y + 4 };
      const click = { clientX: (block.x + 0.8) * 10, clientY: (block.y + 0.8) * 10 };
      act(() => {
        canvas.dispatchEvent(mouse('pointerdown', { button: 0, buttons: 1, ...click }));
        window.dispatchEvent(mouse('pointerup', { button: 0, buttons: 0, ...click }));
      });
      const cell = { x: block.x + 1, y: block.y + 1 };
      expect(s().selection).toEqual([{ kind: 'terrain', ...cell }]);
      expect(page.getByTestId('selection-card'), 'the mountain cell\'s card').toBeTruthy();
      expect(marks, 'one outline, the selected cell\'s').toEqual([{ rect: { ...cell, w: 1, h: 1 }, grid: 'terrain' }]);
      const before = w.state.objects.size;
      await act(pasteKey);
      const copy = added(w, before);
      expect(copy.map((o) => [o.catalogId, o.position.x - block.x, o.position.y - block.y, o.elevation]))
        .toEqual([[ROSE, 0, 0, 2], [DAISY, 1, 0, 2], [ROSE, 2, 0, 2], [DAISY, 3, 0, 2]]);
      expect(toasts.filter((t) => t.includes('nearby'))).toEqual([]);
      // Delete on the card still lowers the mountain cell it names.
      act(() => press({ x: cell.x, y: cell.y + 2 }));
      const [lowered] = s().selection;
      expect(lowered?.kind).toBe('terrain');
      if (lowered?.kind !== 'terrain') return;
      // The card for the pasted copy may still be leaving; the live one is last.
      act(() => { fireEvent.click(page.getAllByTestId('handle-delete').at(-1)!); });
      const ask = page.getByRole('dialog', { name: translate('delete.confirm_terrain') });
      act(() => { fireEvent.click(within(ask).getByRole('button', { name: translate('delete.confirm_btn') })); });
      expect(w.state.cells[lowered.y]![lowered.x]!.terrain?.elevation).toBe(1);
    } finally { stopSync(); }
  });
});

describe('pasting', () => {
  spec('EDIT-54', 'with no region, Ctrl+V places one copy at once on the open ground nearest the original, selected, as one undo step, wherever the pointer rests', async () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    key('selection.copy');
    const far = { x: origin.x + 9, y: origin.y + 7 };
    hover(far);
    const before = w.state.objects.size;
    await pasteKey();
    const copy = added(w, before);
    expect(copy.map((o) => o.catalogId)).toEqual([ROSE, DAISY, ROSE, DAISY]);
    expect(at(w, far), 'the pointer plays no part').toEqual([]);
    expect(touches(outline(copy), outline(flowers)), 'the copy stands against the original').toBe(true);
    expect(selected().sort(), 'the copy is the selection').toEqual(copy.map((o) => o.id).sort());
    expect(armedItemOf(s()), 'nothing is armed').toBeNull();
    expect(toasts.filter((t) => t.includes('nearby')), 'nearest is what was asked for').toEqual([]);
    w.undo();
    expect(w.state.objects.size, 'one undo takes back the copy').toBe(before);
  });

  spec('EDIT-54', 'repeated Ctrl+V lays copies beside the original and beside one another, never on top', async () => {
    const { w, flowers } = row();
    select(...flowers);
    key('selection.copy');
    const groups: Rect[] = [outline(flowers)];
    for (let n = 0; n < 4; n++) {
      const before = w.state.objects.size;
      await pasteKey();
      const copy = added(w, before);
      expect(copy, `copy ${n + 1} is placed whole`).toHaveLength(4);
      const box = outline(copy);
      expect(groups.some((g) => overlaps(g, box)), `copy ${n + 1} covers nothing placed before`).toBe(false);
      expect(groups.some((g) => touches(g, box)), `copy ${n + 1} stands against the group`).toBe(true);
      groups.push(box);
    }
  });

  spec('EDIT-54', 'a cut pasted back with Ctrl+V returns to the place it was cut from', async () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    key('selection.cut');
    hover({ x: origin.x + 6, y: origin.y + 5 });
    await pasteKey();
    expect([0, 1, 2, 3].map((i) => at(w, { x: origin.x + i, y: origin.y }).map((o) => o.catalogId)))
      .toEqual([[ROSE], [DAISY], [ROSE], [DAISY]]);
  });

  spec('EDIT-54', 'with a region painted, Ctrl+V places the copy inside it at its first top-left that fits, wherever the pointer rests', async () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    key('selection.copy');
    hover(origin);
    // An L of a region: its top row is too short for the row of four, its second row holds it.
    s().setRegion([...rect({ x: origin.x + 2, y: origin.y + 5 }, 2, 1), ...rect({ x: origin.x + 1, y: origin.y + 6 }, 6, 2)]);
    await pasteKey();
    expect([0, 1, 2, 3].map((i) => at(w, { x: origin.x + 1 + i, y: origin.y + 6 }).map((o) => o.catalogId)))
      .toEqual([[ROSE], [DAISY], [ROSE], [DAISY]]);
  });

  spec('EDIT-54', 'the abab row grows into abababab with one Ctrl+V into a region painted beside it', async () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    key('selection.copy');
    s().setRegion(rect({ x: origin.x + 4, y: origin.y }, 4, 1));
    await pasteKey();
    const line = [...w.state.objects.values()].filter((o) => o.position.y === origin.y && !o.locked)
      .sort((a, b) => a.position.x - b.position.x).map((o) => o.catalogId);
    expect(line).toEqual([ROSE, DAISY, ROSE, DAISY, ROSE, DAISY, ROSE, DAISY]);
  });

  spec('EDIT-54', 'a copy from another map, pasted from the system clipboard, lands where it was copied there, held inside this map', async () => {
    const w = world();
    const origin = w.openGround(8, 6);
    open(w);
    stopBridge = installClipboardBridge();
    const pair = (from: MacroCoord) => encodeArrangement({
      members: [{ catalogId: ROSE, x: 0, y: 0, rotation: 0, rise: 0 }, { catalogId: DAISY, x: 1, y: 0, rotation: 0, rise: 0 }],
      w: 2, h: 1, origin: from,
    });
    const before = w.state.objects.size;
    key('selection.paste');
    pasteEvent(pair({ x: origin.x + 3, y: origin.y + 2 }));
    await new Promise((r) => setTimeout(r, 0));
    expect([at(w, { x: origin.x + 3, y: origin.y + 2 }), at(w, { x: origin.x + 4, y: origin.y + 2 })].map((p) => p.map((o) => o.catalogId)))
      .toEqual([[ROSE], [DAISY]]);
    // Copied from far beyond this map's edge: the search starts inside the map and still finds room.
    key('selection.paste');
    pasteEvent(pair({ x: 1000, y: 1000 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(w.state.objects.size).toBe(before + 4);
    expect(toasts).not.toContain('There is no room for the copy here or nearby');
  });

  spec('EDIT-56', 'the menu Paste places one copy with its top-left on the pressed cell and selects it', () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    key('selection.copy');
    pasteAtCell({ x: origin.x + 5, y: origin.y + 4 });
    const daisies = objectsOf(w, DAISY).filter((o) => o.position.y === origin.y + 4);
    expect(daisies.map((o) => o.position)).toEqual([{ x: origin.x + 6, y: origin.y + 4 }, { x: origin.x + 8, y: origin.y + 4 }]);
    expect(selected()).toHaveLength(4);
    expect(selected()).toContain(daisies[0]!.id);
  });

  spec('EDIT-57', 'a copy that does not fit at the cell goes whole to the nearest open ground, and the toast says so', () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    key('selection.copy');
    toasts = [];
    const before = w.state.objects.size;
    pasteAtCell({ x: origin.x + 1, y: origin.y });
    expect(w.state.objects.size).toBe(before + 4);
    const copies = [...w.state.objects.values()].slice(before);
    const ys = new Set(copies.map((o) => o.position.y));
    expect(ys.size, 'the copy keeps its row').toBe(1);
    expect([...ys][0]).not.toBe(origin.y);
    expect(toasts).toEqual(['There was no room here, so the copy was placed nearby']);
  });

  spec('EDIT-57', 'with no open ground in reach nothing changes and the toast says there is no room', () => {
    const w = world();
    const origin = w.openGround(3, 3);
    placeItem(w, ROSE, origin);
    open(w);
    // A copy wider than the planet: two hundred roses in a row.
    s().setClipboard({ members: Array.from({ length: 200 }, (_, i) => ({ catalogId: ROSE, x: i, y: 0, rotation: 0, rise: 0 })), w: 200, h: 1 });
    const before = w.fingerprint();
    pasteAtCell(origin);
    expect(w.fingerprint()).toBe(before);
    expect(toasts).toContain('There is no room for the copy here or nearby');
  });

  spec('EDIT-57', 'Ctrl+V on a map with no room for the copy changes nothing and says there is no room', async () => {
    const w = world();
    open(w);
    s().setClipboard({ members: Array.from({ length: 200 }, (_, i) => ({ catalogId: ROSE, x: i, y: 0, rotation: 0, rise: 0 })), w: 200, h: 1 });
    const before = w.fingerprint();
    await pasteKey();
    expect(w.fingerprint()).toBe(before);
    expect(toasts).toEqual(['There is no room for the copy here or nearby']);
    expect(selected()).toEqual([]);
  });

  spec('EDIT-58', 'a copy from a plateau lands on the ground under it, and never splits across a cliff', async () => {
    const w = world();
    const origin = w.openGround(16, 12);
    plateau(w, origin, 6, 4, 2);
    const flowers = [0, 1, 2].map((i) => placeItem(w, i % 2 ? DAISY : ROSE, { x: origin.x + 1 + i, y: origin.y + 1 })!);
    open(w);
    expect(flowers.every((f) => surfaceElevationAt(w.state, f.position.x, f.position.y) === 2)).toBe(true);
    select(...flowers);
    key('selection.copy');
    // Open ground below the plateau, at layer 0.
    pasteAtCell({ x: origin.x + 9, y: origin.y + 8 });
    const low = [...w.state.objects.values()].filter((o) => o.position.y === origin.y + 8);
    expect(low).toHaveLength(3);
    expect(low.every((o) => o.elevation === 0)).toBe(true);
    // Straddling the plateau's edge: the row moves whole onto one height.
    const plan = [...w.state.objects.values()].length;
    pasteAtCell({ x: origin.x + 5, y: origin.y + 2 });
    const added = [...w.state.objects.values()].slice(plan);
    expect(added).toHaveLength(3);
    expect(new Set(added.map((o) => surfaceElevationAt(w.state, o.position.x, o.position.y))).size).toBe(1);
  });

  spec('EDIT-59', 'a one-of-a-kind building already on the planet is left out of a paste, the rest placed, and the toast says why', () => {
    const w = world();
    const origin = w.openGround(24, 12);
    const cabin = placeItem(w, CABIN, origin)!;
    const rose = placeItem(w, ROSE, { x: origin.x + 6, y: origin.y })!;
    open(w);
    expect(cabin).toBeTruthy();
    select(cabin, rose);
    key('selection.copy');
    toasts = [];
    pasteAtCell({ x: origin.x + 10, y: origin.y + 8 });
    expect(objectsOf(w, CABIN)).toHaveLength(1);
    expect(objectsOf(w, ROSE)).toHaveLength(2);
    expect(toasts).toContain('1 object was left out because the planet already has as many as it can hold');
  });
});

describe('Ctrl gestures', () => {
  spec('EDIT-60', 'a Ctrl+drag from a selected object drags a copy and leaves the originals, and the copy becomes the selection', () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    holdCtrl(true);
    press(flowers[0]!.position, { x: origin.x + 2, y: origin.y + 2 }, { x: origin.x + 4, y: origin.y + 3 });
    holdCtrl(false);
    expect(flowers.every((f) => w.state.objects.get(f.id)?.position.x === f.position.x)).toBe(true);
    const copies = at(w, { x: origin.x + 4, y: origin.y + 3 });
    expect(copies.map((o) => o.catalogId)).toEqual([ROSE]);
    expect(selected()).toHaveLength(4);
    expect(selected().every((id) => !flowers.some((f) => f.id === id))).toBe(true);
    w.undo();
    expect(objectsOf(w, ROSE), 'one undo step').toHaveLength(2);
  });

  spec('EDIT-60', 'a Ctrl+click on a selected object still takes it out, and a Ctrl+drag from open map still bands', () => {
    const { at: origin, flowers } = row();
    select(...flowers);
    holdCtrl(true);
    press(flowers[1]!.position);
    expect(selected()).toEqual([flowers[0]!.id, flowers[2]!.id, flowers[3]!.id]);
    s().clearSelection();
    press({ x: origin.x, y: origin.y + 3 }, { x: origin.x + 1, y: origin.y + 1 }, { x: origin.x + 1, y: origin.y });
    expect(selected().sort()).toEqual([flowers[0]!.id, flowers[1]!.id].sort());
  });

  spec('EDIT-61', 'Cut copies the selection and deletes it as one undo step', async () => {
    const { w, at: origin, flowers } = row();
    select(...flowers);
    key('selection.cut');
    expect(flowers.every((f) => !w.state.objects.has(f.id))).toBe(true);
    pasteAtCell(origin);
    expect(at(w, origin).map((o) => o.catalogId)).toEqual([ROSE]);
  });

  spec('EDIT-63', 'copy and paste are not offered in the planet editor', () => {
    const { w, flowers } = row();
    select(...flowers);
    const session = { entryId: null, name: '', nameReviewed: true } as unknown as PlanetSession;
    setStoreState({ planetSession: session });
    expect(selected()).toHaveLength(4);
    key('selection.copy');
    expect(s().clipboard).toBeNull();
    expect(w.state.objects.size).toBeGreaterThan(4);
  });
});

describe('roads in a copy', () => {
  spec('EDIT-58', 'pasted roads go on the ground they land on with their objects', () => {
    const w = world();
    const origin = w.openGround(12, 8);
    const road = w.object(w.place(ROAD, origin.x, origin.y).id!)!;
    const rose = placeItem(w, ROSE, { x: origin.x + 1, y: origin.y })!;
    w.stroke(rect({ x: origin.x + 6, y: origin.y + 4 }, 4, 3), TerrainType.Mountain, 1);
    open(w);
    select(road, rose);
    key('selection.copy');
    pasteAtCell({ x: origin.x + 7, y: origin.y + 5 });
    const pasted = [...w.state.objects.values()].filter((o) => o.position.y === origin.y + 5);
    expect(pasted.map((o) => o.catalogId).sort()).toEqual([ROAD, ROSE].sort());
    expect(pasted.every((o) => o.elevation === 1)).toBe(true);
  });
});

// @vitest-environment jsdom
/**
 * The long-press menu, latched multi-select and the two-finger tap, through the map's own pointer
 * machine over a mounted canvas with the rendered shell and menu around it. A cell is ten screen
 * pixels.
 */
import { describe, expect, beforeEach, afterEach, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { placeItem } from './_editing';
import { I18nProvider, translate } from '../../../i18n/context';
import { InputModeProvider } from '../../../ui/design/input-mode';
import { Shell } from '../../../ui/shell/Shell';
import { ContextMenu } from '../../../ui/chrome/floating/ContextMenu';
import { HoldRing } from '../../../ui/chrome/floating/HoldRing';
import { SpeechBubble } from '../../../ui/chrome/floating/SpeechBubble';
import { TOUR_OFFERED, TOUR_SEEN_KEY } from '../../_support/tour';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { installDeviceWiring } from '../../../editor/session/device-wiring';
import { useEditorStore } from '../../../state/store';
import { selectedObjectIds } from '../../../state/selection';
import { armedItemOf } from '../../../state/editing/edit-mode';
import { ToolType } from '../../../state/editing/vocabulary';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import type { InputMode } from '../../../platform/device/input-mode';
import { weightVars } from '../../../ui/design/text-weight';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';

vi.mock('../../../view/map2d/capture/thumbnail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../view/map2d/capture/thumbnail')>()),
  renderThumbnail: () => new Promise<null>(() => {}),
}));

const HOUSE = 'building-myhouse';
const TREE = 'tree-apple';
const noop = (): void => {};
const pan = vi.fn();
const overlay = new Proxy({} as ToolOverlay, { get: () => noop });
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
  overlay, camera: { pan, zoomStep: noop, zoomBy: noop }, ...headlessViewVerbs(),
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let unsync: (() => void) | null = null;
const at = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: c.y * 10 + 5 });

/** One pointer event at cell `c`; `pointerType` is not a MouseEvent field, so it is defined on the instance. */
function pointer(target: EventTarget, type: string, c: MacroCoord, { id = 1, kind = 'touch', button = 0, time = 0 } = {}): void {
  const buttons = type === 'pointerup' ? 0 : button === 2 ? 2 : 1;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, buttons, ...at(c) });
  Object.defineProperties(event, { pointerType: { value: kind }, pointerId: { value: id }, timeStamp: { value: time } });
  act(() => { target.dispatchEvent(event); });
}
const down = (c: MacroCoord, id = 1, time = 0) => pointer(canvas, 'pointerdown', c, { id, time });
const move = (c: MacroCoord, id = 1) => pointer(window, 'pointermove', c, { id });
const up = (c: MacroCoord, id = 1, time = 0) => pointer(window, 'pointerup', c, { id, time });
const tap = (c: MacroCoord) => { down(c); up(c); };
/** One finger from `from` to `to`, a cell at a time along the rows, then lifted. */
function drag(from: MacroCoord, to: MacroCoord): void {
  down(from);
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 1; i <= steps; i++) {
    move({ x: Math.round(from.x + ((to.x - from.x) * i) / steps), y: Math.round(from.y + ((to.y - from.y) * i) / steps) });
  }
  up(to);
}
function hold(c: MacroCoord): void {
  down(c);
  act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
  up(c);
}

const selected = () => selectedObjectIds(useEditorStore.getState().selection).sort();
const menuRows = () => screen.queryAllByRole('menuitem').map((b) => b.textContent);

interface Scene { w: SpecWorld; ground: MacroCoord; house: PlacedObject; a: PlacedObject; b: PlacedObject }

/** A house and two trees on open ground, opened in the editor with the shell and the menu shown in `mode`. */
function scene(mode: InputMode = 'touch', over: ReactNode = null): Scene {
  const w = world();
  const ground = w.openGround(16, 14);
  const a = placeItem(w, TREE, { x: ground.x + 1, y: ground.y + 1 })!;
  const b = placeItem(w, TREE, { x: ground.x + 6, y: ground.y + 1 })!;
  const house = placeItem(w, HOUSE, { x: ground.x + 2, y: ground.y + 7 })!;
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool: ToolType.Hand }) });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  unsync = useEditorStore.subscribe(() => manager.syncArming());
  canvas = render(
    <InputModeProvider inputMode={mode}>
      <I18nProvider>
        <Shell onRestoreSession={() => {}}><Canvas /></Shell>
        <HoldRing />
        <ContextMenu />
        {over}
      </I18nProvider>
    </InputModeProvider>,
  ).getByTestId('canvas');
  document.elementFromPoint = () => canvas;
  return { w, ground, house, a, b };
}

beforeEach(() => {
  localStorage.setItem(TOUR_SEEN_KEY, TOUR_OFFERED);
  resetStore();
  __resetCursorController();
  pan.mockClear();
  setActiveView(view);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  unsync?.();
  unsync = null;
  cleanup();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

describe('the long-press menu', () => {
  spec('EDIT-42', 'a long press on a house opens its menu with rotate, move, multi-select and delete, headed by its name, and no copy', () => {
    const { house } = scene();
    down(house.position);
    expect(screen.getByTestId('press-hold'), 'a ring fills while the finger holds still').toBeTruthy();
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    up(house.position);
    expect(screen.queryByTestId('press-hold'), 'the ring goes once the menu opens').toBeNull();
    const menu = screen.getByRole('menu');
    expect(menu.textContent).toContain('Charming Cottage');
    expect(menuRows()).toEqual([
      translate('a11y.rotate'), translate('menu.move'), translate('shortcut.multi_select'), translate('context.delete'),
    ]);
  });

  spec('EDIT-42', 'the menu offers pick where the selection card would, and pick arms the item', () => {
    const { a } = scene();
    hold(a.position);
    expect(menuRows()).toContain(translate('a11y.pick_material'));
    fireEvent.click(screen.getByRole('menuitem', { name: translate('a11y.pick_material') }));
    expect(armedItemOf(useEditorStore.getState())).toBe(TREE);
  });

  spec('EDIT-42', 'rotate turns the object a quarter each tap, one undo step a turn, and the menu stays for the next turn', () => {
    const { w, house } = scene();
    hold(house.position);
    fireEvent.click(screen.getByRole('menuitem', { name: translate('a11y.rotate') }));
    expect(w.state.objects.get(house.id)?.rotation).toBe(90);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: translate('a11y.rotate') }));
    expect(w.state.objects.get(house.id)?.rotation).toBe(180);
    act(() => { useEditorStore.getState().commandExecutor?.undo(); });
    expect(w.state.objects.get(house.id)?.rotation).toBe(90);
  });

  spec('EDIT-42', 'move selects the object and the next drag from anywhere moves it', () => {
    const { w, ground, b } = scene();
    hold(b.position);
    fireEvent.click(screen.getByRole('menuitem', { name: translate('menu.move') }));
    expect(selected()).toEqual([b.id]);
    const from = { x: ground.x + 10, y: ground.y + 3 };
    drag(from, { x: from.x, y: from.y + 2 });
    expect(pan).not.toHaveBeenCalled();
    expect(w.state.objects.get(b.id)?.position.y).toBe(b.position.y + 2);
    expect(useEditorStore.getState().moveLatched, 'one move').toBe(false);
  });

  spec('EDIT-56', 'with something copied, a long press on open map offers Paste, which places one copy there and selects it', () => {
    const { w, ground, a, b } = scene();
    act(() => { useEditorStore.getState().setSelection([{ kind: 'object', id: a.id }, { kind: 'object', id: b.id }]); });
    act(() => { COMMAND_BY_ID.get('selection.copy')!.run({ toggleMenu: noop } as unknown as CommandContext); });
    const spot = { x: ground.x + 1, y: ground.y + 4 };
    hold(spot);
    expect(menuRows()).toContain(translate('context.paste'));
    const paste = screen.getByRole('menuitem', { name: translate('context.paste') });
    fireEvent.pointerDown(paste);
    fireEvent.click(paste, { detail: 1 });
    // The pair's outline takes the pressed cell as its top-left, and the copy is what is selected after.
    const lead = useEditorStore.getState().clipboard!.members[0]!;
    const copies = [...w.state.objects.values()].filter((o) => o.position.y === spot.y + lead.y
      && (o.position.x === spot.x + lead.x || o.position.x === spot.x + lead.x + 5));
    expect(copies.map((o) => o.catalogId)).toEqual([TREE, TREE]);
    expect(selected()).toEqual(copies.map((o) => o.id).sort());
  });

  spec('EDIT-42', 'rotate on an object facing 270 turns it on clockwise to 0, selected as the card would turn it', () => {
    const { w, house } = scene();
    const spin = vi.spyOn(view, 'animateRotation');
    hold(house.position);
    const rotate = () => fireEvent.click(screen.getByRole('menuitem', { name: translate('a11y.rotate') }));
    rotate(); rotate(); rotate();
    expect(w.state.objects.get(house.id)?.rotation).toBe(270);
    spin.mockClear();
    rotate();
    expect(w.state.objects.get(house.id)?.rotation).toBe(0);
    expect(spin).toHaveBeenCalledOnce();
    const [, from, to] = spin.mock.calls[0]!;
    expect(to - from, 'a quarter clockwise, not three quarters back').toBe(90);
    expect(selected()).toEqual([house.id]);
    spin.mockRestore();
  });

  spec('EDIT-42', 'the release that ends the long press chooses no row, and a tap on a row then acts', () => {
    const { w, house } = scene();
    hold(house.position);
    const remove = screen.getByRole('menuitem', { name: translate('context.delete') });
    // The click a platform may send for the lifting finger, whose press began on the map.
    fireEvent.click(remove, { detail: 1 });
    expect(screen.getByRole('menu'), 'the menu stands').toBeTruthy();
    expect(w.state.objects.get(house.id)).toBeDefined();
    fireEvent.pointerDown(remove);
    fireEvent.click(remove, { detail: 1 });
    expect(w.state.objects.get(house.id)).toBeUndefined();
  });

  spec('EDIT-42', 'the head names the object in full, wrapping rather than cutting a long name', () => {
    const { house } = scene();
    hold(house.position);
    const name = screen.getByTestId('context-menu-name');
    expect(name.textContent).toBe('Charming Cottage');
    expect(name.style.whiteSpace).not.toBe('nowrap');
    expect(name.style.textOverflow).not.toBe('ellipsis');
  });

  spec('EDIT-42', 'a mouse right-click in touch mode opens the mouse rows', () => {
    const { house } = scene('touch');
    pointer(canvas, 'pointerdown', house.position, { kind: 'mouse', button: 2 });
    pointer(window, 'pointerup', house.position, { kind: 'mouse', button: 2 });
    const pcRows = [
      translate('context.rotate_0'), translate('context.rotate_90'), translate('context.rotate_180'), translate('context.rotate_270'),
      translate('context.delete'),
    ];
    expect(menuRows()).toEqual(pcRows);
  });

  spec('EDIT-42', 'a finger\'s long press in PC mode opens the finger\'s rows under the object\'s name', () => {
    const { house } = scene('pc');
    hold(house.position);
    const touchRows = [translate('a11y.rotate'), translate('menu.move'), translate('shortcut.multi_select'), translate('context.delete')];
    expect(menuRows()).toEqual(touchRows);
    expect(screen.getByRole('menu').textContent).toContain('Charming Cottage');
  });

  it('publishes the text weights for the zoom a finger\'s menu is drawn at', () => {
    const { house } = scene();
    hold(house.position);
    const menu = screen.getByRole('menu');
    const zoom = Number(menu.style.zoom);
    for (const [name, weight] of Object.entries(weightVars(zoom, 1, false))) {
      expect(menu.style.getPropertyValue(name), name).toBe(String(weight));
    }
  });

  spec('EDIT-42', 'the PC right-click menu offers the four facings and delete, with no head', () => {
    const { house } = scene('pc');
    pointer(canvas, 'pointerdown', house.position, { kind: 'mouse', button: 2 });
    pointer(window, 'pointerup', house.position, { kind: 'mouse', button: 2 });
    expect(menuRows()).toEqual([
      translate('context.rotate_0'), translate('context.rotate_90'), translate('context.rotate_180'), translate('context.rotate_270'),
      translate('context.delete'),
    ]);
    expect(screen.getByRole('menu').textContent).not.toContain('Charming Cottage');
  });
});

describe('latched multi-select', () => {
  spec('EDIT-43', 'after multi-select, taps add and remove, a drag from empty map bands, a drag from a selected object moves the group, Done clears the latch', () => {
    const { w, ground, house, a, b } = scene();
    hold(house.position);
    fireEvent.click(screen.getByRole('menuitem', { name: translate('shortcut.multi_select') }));
    expect(selected()).toEqual([house.id]);
    expect(screen.getByTestId('multi-select-plate').textContent).toContain(translate('selection.multi_count', { n: 1 }));

    tap(a.position);
    expect(selected(), 'a tap adds').toEqual([a.id, house.id].sort());
    tap(house.position);
    expect(selected(), 'a tap on a member removes it').toEqual([a.id]);

    drag({ x: ground.x + 5, y: ground.y }, { x: ground.x + 8, y: ground.y + 3 });
    expect(selected(), 'a drag from empty map bands').toEqual([a.id, b.id].sort());
    expect(pan).not.toHaveBeenCalled();
    expect(screen.getByTestId('multi-select-plate').textContent).toContain(translate('selection.multi_count', { n: 2 }));

    drag(a.position, { x: a.position.x, y: a.position.y + 2 });
    expect(w.state.objects.get(a.id)?.position.y, 'the group moves').toBe(a.position.y + 2);
    expect(w.state.objects.get(b.id)?.position.y).toBe(b.position.y + 2);

    fireEvent.click(screen.getByTestId('multi-select-done'));
    expect(useEditorStore.getState().multiSelectLatched).toBe(false);
    expect(selected()).toEqual([]);
    tap(house.position);
    expect(selected(), 'a tap selects again').toEqual([house.id]);
  });

  spec('EDIT-43', 'Done gives back the object shelf on the tab it was left on', async () => {
    const { a } = scene();
    fireEvent.click(screen.getByRole('button', { name: translate('mode.object') }));
    fireEvent.click(screen.getByRole('tab', { name: translate('shelf.tab_tree') }));
    hold(a.position);
    fireEvent.click(screen.getByRole('menuitem', { name: translate('shortcut.multi_select') }));
    // The shelf leaves after its exit motion, which runs on real time.
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByRole('tab', { name: translate('shelf.tab_tree') })).toBeNull());
    fireEvent.click(screen.getByTestId('multi-select-done'));
    expect(screen.getByRole('tab', { name: translate('shelf.tab_tree') }).getAttribute('aria-selected')).toBe('true');
  });

  spec('EDIT-43', 'a change of mode ends multi-select', () => {
    const { a } = scene();
    hold(a.position);
    fireEvent.click(screen.getByRole('menuitem', { name: translate('shortcut.multi_select') }));
    expect(useEditorStore.getState().multiSelectLatched).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: translate('mode.mountain') }));
    expect(useEditorStore.getState().multiSelectLatched).toBe(false);
  });

  spec('EDIT-43', 'Escape ends multi-select as Done does', () => {
    const { a } = scene();
    hold(a.position);
    fireEvent.click(screen.getByRole('menuitem', { name: translate('shortcut.multi_select') }));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); });
    expect(useEditorStore.getState().multiSelectLatched).toBe(false);
    expect(selected()).toEqual([]);
  });

  spec('EDIT-43', 'a mouse or key taking over ends multi-select and the move latch, so PC presses read the modifier key alone', () => {
    const { a } = scene();
    hold(a.position);
    fireEvent.click(screen.getByRole('menuitem', { name: translate('shortcut.multi_select') }));
    act(() => { useEditorStore.getState().setMoveLatched(true); });
    act(() => { useEditorStore.getState().setInputMode('pc'); });
    expect(useEditorStore.getState().multiSelectLatched).toBe(false);
    expect(useEditorStore.getState().moveLatched).toBe(false);
    expect(selected(), 'the selection stands').toEqual([a.id]);
  });

  spec('EDIT-43', 'the bar acts on the group: select all, then delete', () => {
    const { w, house, a } = scene();
    hold(a.position);
    fireEvent.click(screen.getByRole('menuitem', { name: translate('shortcut.multi_select') }));
    fireEvent.click(screen.getByRole('button', { name: translate('shortcut.select_all') }));
    expect(selected()).toEqual([...w.state.objects.keys()].sort());
    fireEvent.click(screen.getByRole('button', { name: translate('a11y.delete') }));
    expect(w.state.objects.get(house.id)).toBeUndefined();
    expect(w.state.objects.get(a.id)).toBeUndefined();
  });
});

describe('a hint bubble over the map', () => {
  spec('UI-12', 'in touch mode a tap on the map closes the bubble and still selects the object it lands on', () => {
    const onClose = vi.fn();
    const { a } = scene('touch', <SpeechBubble anchor="menu" text="Hint" onAct={noop} onClose={onClose} />);
    expect(screen.getByTestId('speech-bubble')).toBeTruthy();
    tap(a.position);
    expect(onClose).toHaveBeenCalledOnce();
    expect(selected()).toEqual([a.id]);
  });

  spec('UI-12', 'in PC mode a mouse press on the map only closes the bubble and selects nothing', () => {
    const onClose = vi.fn();
    const { a } = scene('pc', <SpeechBubble anchor="menu" text="Hint" onAct={noop} onClose={onClose} />);
    pointer(canvas, 'pointerdown', a.position, { kind: 'mouse' });
    pointer(window, 'pointerup', a.position, { kind: 'mouse' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(selected()).toEqual([]);
  });
});

describe('the two-finger tap', () => {
  let stop: (() => void) | null = null;
  afterEach(() => { stop?.(); stop = null; });

  spec('EDIT-44', 'a two-finger tap undoes one step and a two-finger pan does not', () => {
    const { w, ground } = scene();
    stop = installDeviceWiring();
    const one = { x: ground.x + 10, y: ground.y + 5 };
    const two = { x: ground.x + 13, y: ground.y + 5 };
    const before = w.fingerprint();
    const placed = placeItem(w, TREE, { x: ground.x + 10, y: ground.y + 10 })!;
    placeItem(w, TREE, { x: ground.x + 12, y: ground.y + 10 });
    const second = w.fingerprint();

    down(one, 1); down(two, 2);
    for (let i = 1; i <= 3; i++) { move({ x: one.x, y: one.y + i }, 1); move({ x: two.x, y: two.y + i }, 2); }
    up({ x: one.x, y: one.y + 3 }, 1); up({ x: two.x, y: two.y + 3 }, 2);
    expect(w.fingerprint(), 'a pan undoes nothing').toBe(second);

    down(one, 1); down(two, 2); up(one, 1); up(two, 2);
    expect(w.state.objects.get(placed.id), 'the earlier step stands').toBeDefined();
    expect(w.fingerprint()).not.toBe(second);
    down(one, 1); down(two, 2); up(two, 2); up(one, 1);
    expect(w.fingerprint(), 'each tap undoes one step').toBe(before);
  });

  spec('EDIT-44', 'two fingers held past the tap window undo nothing', () => {
    const { w, ground } = scene();
    stop = installDeviceWiring();
    placeItem(w, TREE, { x: ground.x + 10, y: ground.y + 10 });
    const placed = w.fingerprint();
    const one = { x: ground.x + 10, y: ground.y + 5 };
    const two = { x: ground.x + 13, y: ground.y + 5 };
    const late = GESTURE_TIMING.touch.twoFingerTapMs + 1;
    down(one, 1, 0); down(two, 2, 0); up(one, 1, late); up(two, 2, late);
    expect(w.fingerprint()).toBe(placed);
  });
});

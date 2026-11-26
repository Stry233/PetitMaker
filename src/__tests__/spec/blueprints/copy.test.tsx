// @vitest-environment jsdom
/** Copying a placed blueprint selected whole, as a person does: Ctrl+drag, Ctrl+C and Ctrl+V, Cut
 *  and Paste, and from another tab; the copy lands as a placement of the same blueprint does. */
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { useEditorStore } from '../../../state/store';
import { selectedObjectIds, type BlockRef } from '../../../state/selection';
import { groupRefs } from '../../../state/placed-groups';
import { liveMembers, mapGroups, type PlacedGroup } from '../../../core/model/placed-group';
import { __resetTextVerdicts, textApproved } from '../../../state/text-verdicts';
import { __resetTriedGroupText } from '../../../editor/review/background';
import { reviewText } from '../../../pipelines/moderation/text/reviewer';
import { armBlueprint, placeArmedAt, saveBlueprint, selectedGroupName } from '../../../editor/editing/blueprint';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { installEditorSession } from '../../../editor/session/install';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { encodeArrangement } from '../../../io/clipboard/payload';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import type { Arrangement } from '../../../state/clipboard';
import type { MacroCoord } from '../../../core/model/types';
import { headlessViewVerbs } from '../../_support/tool-manager';
import { rect, TerrainType } from '../_world';
import { blueprintEditor, open, roads, scene, shift, type Scene } from './_blueprints';

vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

const editor = blueprintEditor();
const s = () => useEditorStore.getState();
const noop = (): void => {};
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
  overlay: new Proxy({} as ToolOverlay, { get: () => noop }),
  camera: { pan: noop, zoomStep: noop, zoomBy: noop }, ...headlessViewVerbs(),
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let stops: (() => void)[] = [];
beforeEach(() => {
  __resetCursorController();
  setActiveView(view);
  canvas = render(<Canvas />).getByTestId('canvas');
});
afterEach(() => {
  for (const stop of stops.reverse()) stop();
  stops = [];
  holdCtrl(false);
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
  __resetTextVerdicts();
  __resetTriedGroupText();
});

const mouse = (type: string, init: MouseEventInit) => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
const screen = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: c.y * 10 + 5 });
/** A mouse press on cell `from`, moved along `path` and let go at its end. */
function press(from: MacroCoord, ...path: MacroCoord[]): void {
  canvas.dispatchEvent(mouse('pointerdown', { button: 0, buttons: 1, ...screen(from) }));
  for (const c of path) window.dispatchEvent(mouse('pointermove', { buttons: 1, ...screen(c) }));
  window.dispatchEvent(mouse('pointerup', { button: 0, buttons: 0, ...screen(path[path.length - 1] ?? from) }));
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
/** The browser's `paste` event carrying `text` from the system clipboard. */
function pasteEvent(text: string): void {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
  document.body.dispatchEvent(e);
}

/** The scene's sample saved as Terrace by Mei and placed once beside it, selected whole, on the live
 *  editor with its pointer and tools. */
async function placed(): Promise<{ sc: Scene; group: PlacedGroup }> {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const manager = new ToolManager(view, sc.w.sandbox.executor, sc.w.state, editorToolWiring());
  registerToolManager(manager);
  stops.push(useEditorStore.subscribe(() => manager.syncArming()));
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(`refused: ${record}`);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const group = mapGroups(sc.w.state)[0]!;
  expect(s().selection).toEqual(groupRefs(sc.w.state, group));
  return { sc, group };
}

/** A plain one layer up under a frame whose top-left is `at`, reaching a cell past every side. */
const plainUnder = (sc: Scene, at: MacroCoord): void => { sc.w.stroke(rect(shift(at, -1, -1), 7, 8), TerrainType.Mountain, 1); };

const counts = (sel: readonly BlockRef[]) => ({
  objects: sel.filter((r) => r.kind === 'object').length,
  cells: sel.filter((r) => r.kind === 'terrain').length,
});
/** What a group still holds, counted. */
const holds = (sc: Scene, g: PlacedGroup) => counts(groupRefs(sc.w.state, g));
/** The roads standing inside `g`'s frame. */
const roadsIn = (sc: Scene, g: PlacedGroup) => roads(sc.w).filter((o) =>
  o.position.x >= g.frame.x && o.position.x < g.frame.x + g.frame.w && o.position.y >= g.frame.y && o.position.y < g.frame.y + g.frame.h);
const overlaps = (a: PlacedGroup['frame'], b: PlacedGroup['frame']) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The newest group, which a copy lays, checked to be a new group of the same blueprint, named as the
 *  first, standing beside it. */
function copyOf(sc: Scene, first: PlacedGroup): PlacedGroup {
  const groups = mapGroups(sc.w.state);
  expect(groups).toHaveLength(2);
  const copy = groups[1]!;
  expect(copy.id).not.toBe(first.id);
  expect({ blueprint: copy.blueprint, name: copy.name, origin: copy.origin })
    .toEqual({ blueprint: first.blueprint, name: first.name, origin: first.origin });
  expect(holds(sc, groups[0]!), 'the original stays as it was').toEqual(holds(sc, first));
  return copy;
}

spec('EDIT-60', 'a Ctrl+drag from a placement selected whole lays a copy with its terrain on the raised surface it lands on, selected whole, as one undo step', async () => {
  const { sc, group } = await placed();
  const to = shift(sc.free, 8, 0);
  plainUnder(sc, to);
  const before = sc.w.fingerprint();
  const road = roadsIn(sc, group).sort((a, b) => a.position.x - b.position.x)[0]!;
  holdCtrl(true);
  press(road.position, shift(road.position, 3, 1), shift(road.position, 8, 0));
  holdCtrl(false);

  const copy = copyOf(sc, group);
  expect(copy.frame).toEqual({ ...group.frame, x: to.x, y: to.y });
  // The plateau stands a layer above the plain it landed on, its roads on the plain.
  expect(sc.w.terrainAt(shift(to, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  expect(roadsIn(sc, copy).map((o) => o.elevation)).toEqual([1, 1]);
  expect(holds(sc, copy)).toEqual(holds(sc, group));
  expect(s().selection).toEqual(groupRefs(sc.w.state, copy));
  // The original never moved.
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(s().gridState!.objects.get(road.id)?.position).toEqual(road.position);

  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(before);
  expect(mapGroups(sc.w.state)).toHaveLength(1);
});

spec('EDIT-60', 'a Ctrl+drag from open ground in the frame of a placement selected whole copies it as well', async () => {
  const { sc, group } = await placed();
  const empty = shift(sc.free, 3, 3);
  holdCtrl(true);
  press(empty, shift(empty, 4, 0), shift(empty, 8, 0));
  holdCtrl(false);
  const copy = copyOf(sc, group);
  expect(copy.frame).toEqual({ ...group.frame, x: group.frame.x + 8 });
  expect(sc.w.terrainAt(shift(sc.free, 9, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
});

spec('EDIT-54', 'Ctrl+C then Ctrl+V on a placement selected whole lays a copy with its terrain beside the placement as a new group, selected whole, as one undo step', async () => {
  const { sc, group } = await placed();
  const before = sc.w.fingerprint();
  key('selection.copy');
  expect(sc.w.fingerprint(), 'copying changes nothing').toBe(before);
  expect(editor.toasts()).toEqual(['Blueprint copied']);
  await pasteKey();
  const copy = copyOf(sc, group);
  expect(overlaps(copy.frame, group.frame)).toBe(false);
  expect(holds(sc, copy)).toEqual(holds(sc, group));
  expect(roadsIn(sc, copy)).toHaveLength(2);
  expect(s().selection).toEqual(groupRefs(sc.w.state, copy));
  sc.w.undo();
  expect(sc.w.fingerprint(), 'one undo takes the copy back').toBe(before);
  expect(mapGroups(sc.w.state)).toHaveLength(1);
});

spec('BLUE-08', 'a copy pasted on a picked block of a raised plain stacks its terrain on the plain', async () => {
  const { sc, group } = await placed();
  key('selection.copy');
  const to = shift(sc.free, 8, 0);
  plainUnder(sc, to);
  s().pickCell(to);
  await pasteKey();
  const copy = copyOf(sc, group);
  expect(copy.frame).toEqual({ ...group.frame, x: to.x, y: to.y });
  expect(sc.w.terrainAt(shift(to, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  expect(roadsIn(sc, copy).map((o) => o.elevation)).toEqual([1, 1]);
});

spec('EDIT-61', 'Cut takes a placement selected whole back as Delete does, and Paste puts it back as a group', async () => {
  const { sc, group } = await placed();
  key('selection.cut');
  expect(mapGroups(sc.w.state)).toEqual([]);
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toBeNull();
  expect(roadsIn(sc, group)).toEqual([]);
  expect(s().selection).toEqual([]);
  await pasteKey();
  const back = mapGroups(sc.w.state);
  expect(back).toHaveLength(1);
  expect(back[0]!.frame).toEqual(group.frame);
  expect({ name: back[0]!.name, blueprint: back[0]!.blueprint }).toEqual({ name: group.name, blueprint: group.blueprint });
  expect(holds(sc, back[0]!)).toEqual({ objects: 2, cells: 9 });
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(s().selection).toEqual(groupRefs(sc.w.state, back[0]!));
  expect(roadsIn(sc, back[0]!).map((o) => o.position)).toEqual(roadsIn(sc, group).map((o) => o.position));
});

spec('BLUE-07', 'with the selection narrowed to some of a placement\'s objects, Copy, Paste and Ctrl+drag take those objects alone', async () => {
  const { sc, group } = await placed();
  const laid = roadsIn(sc, group);
  s().setSelection(laid.map((o) => ({ kind: 'object', id: o.id })));
  key('selection.copy');
  expect(s().clipboard?.group).toBeUndefined();
  const cells = (): number => sc.w.state.cells.flat().filter((c) => c.terrain).length;
  const terrain = cells();
  await pasteKey();
  expect(mapGroups(sc.w.state)).toHaveLength(1);
  expect(cells(), 'no terrain is pasted').toBe(terrain);
  expect(roads(sc.w).length).toBe(6);
  expect(counts(s().selection)).toEqual({ objects: 2, cells: 0 });

  s().setSelection(laid.map((o) => ({ kind: 'object', id: o.id })));
  holdCtrl(true);
  press(laid[0]!.position, shift(laid[0]!.position, 0, 2), shift(laid[0]!.position, 0, 3));
  holdCtrl(false);
  expect(mapGroups(sc.w.state)).toHaveLength(1);
  expect(cells()).toBe(terrain);
  expect(roads(sc.w).length).toBe(8);
});

spec('BLUE-07', 'a placement copied in another tab lands as a group whose name shows only once the text check approves it', async () => {
  const { sc } = await placed();
  stops.push(installEditorSession({ frameFlashMs: 0 }));
  key('selection.copy');
  const copied = s().clipboard as Arrangement;
  expect(copied.group).toBeDefined();
  const text = encodeArrangement({ ...copied, group: { ...copied.group!, seed: { ...copied.group!.seed, name: 'Harbour view', origin: 'Kai' } } });
  useEditorStore.setState({ clipboard: null });
  s().pickCell(shift(sc.free, 8, 0));
  key('selection.paste');
  pasteEvent(text);
  await new Promise((r) => setTimeout(r, 0));
  const copy = mapGroups(sc.w.state)[1]!;
  expect(copy).toBeDefined();
  expect(copy.name).toBe('Harbour view');
  expect(liveMembers(sc.w.state, copy).cells).toHaveLength(9);
  expect(selectedObjectIds(s().selection)).toHaveLength(2);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  expect(vi.mocked(reviewText)).toHaveBeenCalled();
  expect(textApproved('Harbour view')).toBe(true);
  expect(selectedGroupName(s())).toBe('Harbour view');
});

spec('BLUE-07', 'a copy of a placement whose name awaits the text check keeps it waiting', async () => {
  const { sc } = await placed();
  const groups = mapGroups(sc.w.state);
  sc.w.state.groups = [{ ...groups[0]!, name: 'Harbour view' }];
  s().setSelection(groupRefs(sc.w.state, sc.w.state.groups[0]!));
  key('selection.copy');
  s().pickCell(shift(sc.free, 8, 0));
  vi.mocked(reviewText).mockImplementation(() => new Promise(() => {}));
  await pasteKey();
  expect(mapGroups(sc.w.state)[1]!.name).toBe('Harbour view');
  expect(textApproved('Harbour view')).toBe(false);
  expect(selectedGroupName(s())).toBe('Blueprint 2');
  vi.mocked(reviewText).mockImplementation(async () => ({ allowed: true }));
});

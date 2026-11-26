// @vitest-environment jsdom
/** Placed blueprints kept as groups: selected whole in Blueprint mode, kept with the map file, and
 *  keeping what is left of them as the map is edited, through undo and redo. */
import { afterEach, expect, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';
import { spec } from '../../_support/spec';
import { __resetTextVerdicts, textApproved } from '../../../state/text-verdicts';
import { __resetTriedGroupText, reviewGroupText } from '../../../editor/review/background';
import { reviewText } from '../../../pipelines/moderation/text/reviewer';
import { deserialize } from '../../_support/save-file';
import { SHARE_META } from '../../_support/share-identity';
import { I18nProvider } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { selectedObjectIds, type BlockRef } from '../../../state/selection';
import { armBlueprint, moveSelectedGroup, originFor, placeArmedAt, saveBlueprint, selectedGroupDrag } from '../../../editor/editing/blueprint';
import { deleteSelection, rotateSelection } from '../../../editor/editing/group-edit';
import { pressSelectionDelete } from '../../../editor/editing/object-menu';
import { RUN } from '../../../editor/commands/commands';
import { SelectionMarks } from '../../../ui/chrome/floating/SelectionMarks';
import { MODE_ICONS } from '../../../ui/design/mode-icons';
import { setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { groupHoverFrame, selectionHoverBox } from '../../../view/interaction/selection-hover';
import { SelectionCard } from '../../../ui/chrome/floating/SelectionCard';
import { pressFactsAt } from '../../../view/interaction/pointer/press-facts';
import { resolvePress, type PressPlan } from '../../../view/interaction/press/press-plan';
import { ObjectDragSession } from '../../../tools/pointer/objects';
import type { MapPoint } from '../../../core/grid/grids';
import { canonicalBytes, canonicalize } from '../../../io/save/canonical';
import { buildSaveFile, serialize } from '../../../io/save/json-codec';
import { encodeMapPayload } from '../../../io/share/codec/payload';
import { createDefaultRegistry } from '../../../rules';
import { translate } from '../../../i18n/context';
import type { MacroCoord } from '../../../core/model/types';
import type { BlueprintRecord } from '../../../io/blueprint';
import { TerrainType } from '../_world';
import { blueprintEditor, open, ROAD, roads, scene, shift, type Scene } from './_blueprints';
import { groupOf } from '../../../core/model/placed-group';
import { groupRefs } from '../../../state/placed-groups';

vi.mock('../../../pipelines/moderation/text/reviewer', async (original) => ({
  ...(await original<typeof import('../../../pipelines/moderation/text/reviewer')>()),
  reviewText: vi.fn(async () => ({ allowed: true })),
}));

blueprintEditor();
afterEach(cleanup);
afterEach(() => { __resetTextVerdicts(); __resetTriedGroupText(); });
const s = () => useEditorStore.getState();

/** The scene's sample saved and placed once on open ground beside it; `dress` adds to the sample first. */
async function placed(dress: (sc: Scene) => void = () => {}): Promise<{ sc: ReturnType<typeof scene>; record: BlueprintRecord }> {
  const sc = scene();
  dress(sc);
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(`refused: ${record}`);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  return { sc, record };
}

type On = { object: string } | { cell: MacroCoord };

/** What a press of a mouse, or of a finger, on `on` (an object or a terrain cell) means, as the
 *  map's pointer machine resolves it. */
function pressPlan(on: On, pointerType = 'mouse'): PressPlan {
  const store = s();
  const hit = 'object' in on ? store.gridState!.objects.get(on.object)! : null;
  const terrain = 'cell' in on ? on.cell : hit!.position;
  const probe = { store, macro: terrain, target: { hit, terrain, pick: null }, tool: undefined, ctx: null, toolCoord: terrain };
  return resolvePress(pressFactsAt(0, pointerType, probe as never));
}

/** A mouse click on `on`, an object or a terrain cell, as the map's pointer machine resolves it. */
function click(on: On): void {
  const store = s();
  const plan = pressPlan(on);
  for (const intent of [...plan.down, ...plan.onTap]) {
    if (intent.kind === 'select') store.setSelection([intent.block]);
    if (intent.kind === 'select-group') store.setSelection([...intent.blocks]);
    if (intent.kind === 'collapse-select') store.setSelection([{ kind: 'object', id: intent.id }]);
    if (intent.kind === 'select-on-release' && intent.select.kind === 'select') store.setSelection([intent.select.block]);
  }
}

/** A press on `on` dragged to cell `to` and let go, as the map's pointer machine runs it: what the
 *  press does at once (nothing yet for a finger, whose press waits), then what its drag does, the
 *  drop landing through the map's object drag as the live tool wiring feeds it. */
function drag(on: On, to: MacroCoord, pointerType = 'mouse'): void {
  const plan = pressPlan(on, pointerType);
  const from = 'object' in on ? s().gridState!.objects.get(on.object)!.position : on.cell;
  for (const intent of plan.down) {
    if (intent.kind === 'select') s().setSelection([intent.block]);
    if (intent.kind === 'select-group') s().setSelection([...intent.blocks]);
  }
  const session = new ObjectDragSession({
    state: () => s().gridState, executor: () => s().commandExecutor, selection: () => s().selection,
    setSelection: (blocks) => s().setSelection(blocks, { record: false }), report: () => {}, notify: () => {}, t: translate,
    placementDrag: () => selectedGroupDrag,
  });
  const at = (c: MacroCoord) => ({ x: c.x + 0.5, y: c.y + 0.5 }) as MapPoint;
  for (const intent of plan.onDrag) {
    if (intent.kind === 'move-selection') session.begin(intent.anchorId, at(from), from);
    if (intent.kind === 'move-placement') session.beginPlacement(at(from), from);
  }
  const view = { overlay: { showGhost: () => {}, showObjectMove: () => {}, showGroupPlacementGhost: () => {} }, plopObject: () => {} };
  if (session.armed) session.commit(view, at(to));
}

const counts = (sel: readonly BlockRef[]) => ({
  objects: sel.filter((r) => r.kind === 'object').length,
  cells: sel.filter((r) => r.kind === 'terrain').length,
});

/** The placement's two roads, the first on the left. */
const laidRoads = (sc: ReturnType<typeof scene>) => roads(sc.w).filter((o) => o.position.x >= sc.free.x - 1).sort((a, b) => a.position.x - b.position.x);

spec('BLUE-07', 'in Blueprint mode a click on any object or laid cell of a placement selects it whole, named on the card', async () => {
  const { sc } = await placed();
  s().clearSelection();
  const road = laidRoads(sc)[0]!;
  act(() => { click({ object: road.id }); });
  expect(counts(s().selection)).toEqual({ objects: 2, cells: 9 });
  render(<MotionConfig reducedMotion="always"><I18nProvider><SelectionCard /></I18nProvider></MotionConfig>);
  expect(screen.getByText('Terrace')).toBeTruthy();

  act(() => { s().clearSelection(); click({ cell: shift(sc.free, 1, 1) }); });
  expect(counts(s().selection)).toEqual({ objects: 2, cells: 9 });
  // The sample it was saved from was never placed: a click there selects what it lands on.
  act(() => { click({ object: roads(sc.w).find((o) => o.position.x < sc.free.x - 1)!.id }); });
  expect(counts(s().selection)).toEqual({ objects: 1, cells: 0 });
});

spec('BLUE-07', 'outside Blueprint mode the same click selects the object alone', async () => {
  const { sc } = await placed();
  s().setEditMode({ mode: null });
  const road = laidRoads(sc)[0]!;
  click({ object: road.id });
  expect(s().selection).toEqual([{ kind: 'object', id: road.id }]);
  // Back in Blueprint mode it is a group again.
  s().setEditMode({ mode: 'blueprint' });
  s().clearSelection();
  click({ object: road.id });
  expect(counts(s().selection)).toEqual({ objects: 2, cells: 9 });
});

spec('BLUE-07', 'a map file keeps its groups, and a share code and the map\'s content never carry them', async () => {
  const { sc } = await placed();
  const json = serialize(sc.w.state);
  const reopened = deserialize(json, sc.w.state.template);
  s().loadMap(reopened, createDefaultRegistry());
  s().setEditMode({ mode: 'blueprint' });
  click({ object: laidRoads(sc)[1]!.id });
  expect(counts(s().selection)).toEqual({ objects: 2, cells: 9 });

  const without = { ...sc.w.state, groups: undefined };
  expect(canonicalBytes(canonicalize(sc.w.state))).toEqual(canonicalBytes(canonicalize(without)));
  expect(await encodeMapPayload(sc.w.state, null, SHARE_META)).toEqual(await encodeMapPayload(without, null, SHARE_META));
});

spec('BLUE-07', 'a map file written before groups opens with none', async () => {
  const { sc } = await placed();
  const file = buildSaveFile(sc.w.state);
  expect(file.groups).toBeDefined();
  delete file.groups;
  const reopened = deserialize(JSON.stringify(file), sc.w.state.template);
  expect(reopened.groups).toBeUndefined();
  expect(reopened.objects.size).toBe(sc.w.state.objects.size);
  s().loadMap(reopened, createDefaultRegistry());
  s().setEditMode({ mode: 'blueprint' });
  const road = laidRoads(sc)[0]!;
  click({ object: road.id });
  expect(s().selection).toEqual([{ kind: 'object', id: road.id }]);
});

spec('BLUE-07', 'a group keeps what is left: a deleted object or a recut cell leaves it, and nothing added later joins', async () => {
  const { sc } = await placed();
  const [left, right] = laidRoads(sc);
  sc.w.remove(left!.id);
  // A tree set down later inside its frame, on ground the placement never laid.
  const tree = sc.w.place('tree-apple', sc.free.x + 3, sc.free.y + 1);
  expect(tree.ok).toBe(true);
  sc.w.stroke([shift(sc.free, 1, 1)], TerrainType.Mountain, 2);
  s().clearSelection();
  click({ object: right!.id });
  expect(counts(s().selection)).toEqual({ objects: 1, cells: 8 });
  // Repainted later exactly as it was laid, the cell stays out.
  sc.w.stroke([shift(sc.free, 1, 1)], TerrainType.Mountain, 1);
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  s().clearSelection();
  click({ object: right!.id });
  expect(counts(s().selection)).toEqual({ objects: 1, cells: 8 });
  // Neither the tree nor the recut cell is in it: in Blueprint mode a press on the tree selects the
  // placement around it without the tree, and outside it the tree alone.
  click({ object: tree.id! });
  expect(selectedObjectIds(s().selection)).not.toContain(tree.id);
  expect(counts(s().selection)).toEqual({ objects: 1, cells: 8 });
  s().setEditMode({ mode: null });
  click({ object: tree.id! });
  expect(selectedObjectIds(s().selection)).toEqual([tree.id]);
});

spec('BLUE-07', 'an old group turns, moves and deletes by what is left of it, never touching other work', async () => {
  const { sc } = await placed();
  const [left, right] = laidRoads(sc);
  sc.w.remove(left!.id);
  const tree = sc.w.place('tree-apple', sc.free.x + 6, sc.free.y + 1);
  expect(tree.ok).toBe(true);
  const others = () => [...sc.w.state.objects.values()].filter((o) => o.id === tree.id || o.position.x < sc.free.x - 1).map((o) => JSON.stringify(o)).sort();
  const before = others();

  s().clearSelection();
  click({ object: right!.id });
  rotateSelection(90);
  expect(counts(s().selection)).toEqual({ objects: 1, cells: 9 });
  expect(others()).toEqual(before);
  expect(laidRoads(sc).filter((o) => o.id !== tree.id)).toHaveLength(1);

  expect(moveSelectedGroup(shift(sc.free, 8, 0))).toBe(true);
  expect(counts(s().selection)).toEqual({ objects: 1, cells: 9 });
  expect(others()).toEqual(before);
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toBeNull();

  const moved = sc.w.fingerprint();
  deleteSelection(translate, selectedObjectIds(s().selection));
  expect(s().selection).toEqual([]);
  expect(others()).toEqual(before);
  expect(roads(sc.w).filter((o) => o.position.x >= sc.free.x - 1)).toEqual([]);
  for (let dx = 0; dx < 14; dx++) for (let dy = 0; dy < 6; dy++) expect(sc.w.terrainAt(shift(sc.free, dx, dy))).toBeNull();
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(moved);
  expect(s().selection).toEqual([]);
  click({ object: roads(sc.w).find((o) => o.position.x >= sc.free.x + 7)!.id });
  expect(counts(s().selection)).toEqual({ objects: 1, cells: 9 });
});

spec('BLUE-07', 'a placement moved whole takes its card along to where it now stands', async () => {
  const { sc } = await placed();
  // A plain projection, 10 px a cell, with the placement well inside the window.
  setActiveView({
    projection: {
      cellToScreen: (x: number, y: number) => ({ x: (x - sc.free.x) * 10 + 300, y: (y - sc.free.y) * 10 + 300, scale: 10 }),
      screenToPoint: () => ({ x: 0, y: 0 }),
    },
  } as unknown as ActiveView);
  s().clearSelection();
  click({ object: laidRoads(sc)[0]!.id });
  render(<MotionConfig reducedMotion="always"><I18nProvider><SelectionCard /></I18nProvider></MotionConfig>);
  const card = () => screen.getAllByTestId('selection-card').slice(-1)[0]!;
  const before = card().style.left;
  expect(card().style.visibility).not.toBe('hidden');

  act(() => { expect(moveSelectedGroup(shift(sc.free, 8, 0))).toBe(true); });

  // It stands where a card opened on the moved placement stands.
  const after = { left: card().style.left, bottom: card().style.bottom, top: card().style.top };
  expect(after.left).not.toBe(before);
  cleanup();
  render(<MotionConfig reducedMotion="always"><I18nProvider><SelectionCard /></I18nProvider></MotionConfig>);
  expect({ left: card().style.left, bottom: card().style.bottom, top: card().style.top }).toEqual(after);
  setActiveView(null);
});

spec('BLUE-07', 'Delete takes a group back at once however little it still holds, by key as on the selection card', async () => {
  const { sc } = await placed();
  const [left, right] = laidRoads(sc);
  sc.w.remove(left!.id);
  const plateau = [1, 2, 3].flatMap((y) => [1, 2, 3].map((x) => shift(sc.free, x - 1, y - 1)))
    .filter((c) => sc.w.terrainAt(c) !== null);
  sc.w.stroke(plateau, TerrainType.Mountain, 2);
  const presses: [string, () => void][] = [
    ['the key', () => { RUN['selection.delete']({ toggleMenu: () => {} }); }],
    ['the card', pressSelectionDelete],
  ];
  for (const [by, press] of presses) {
    s().clearSelection();
    click({ object: right!.id });
    expect(counts(s().selection), by).toEqual({ objects: 1, cells: 0 });
    press();
    expect(s().deletePopover, by).toBeNull();
    expect(sc.w.state.objects.has(right!.id), by).toBe(false);
    sc.w.undo();
    expect(sc.w.state.objects.has(right!.id), by).toBe(true);
  }
});

spec('BLUE-07', 'a group emptied of everything is gone, and repainting what it laid never brings it back', async () => {
  const { sc } = await placed();
  for (const road of laidRoads(sc)) sc.w.remove(road.id);
  const plateau = [1, 2, 3].flatMap((y) => [1, 2, 3].map((x) => shift(sc.free, x - 1, y - 1)))
    .filter((c) => sc.w.terrainAt(c) !== null);
  sc.w.stroke(plateau, TerrainType.Mountain, 2);
  expect(sc.w.state.groups ?? []).toEqual([]);
  sc.w.stroke(plateau, TerrainType.Mountain, 1);
  s().clearSelection();
  click({ cell: plateau[0]! });
  expect(counts(s().selection)).toEqual({ objects: 0, cells: 1 });
});

spec('BLUE-07', 'a group\'s name and original author from a map file show only once the text check approves them', async () => {
  const { sc } = await placed();
  const file = buildSaveFile(sc.w.state);
  const group = (file.groups as { name: string; origin: string | null }[])[0]!;
  group.name = 'Harbour view';
  group.origin = 'Kai';
  s().loadMap(deserialize(JSON.stringify(file), sc.w.state.template), createDefaultRegistry());
  s().setEditMode({ mode: 'blueprint' });
  click({ object: laidRoads(sc)[0]!.id });
  render(<MotionConfig reducedMotion="always"><I18nProvider><SelectionCard /></I18nProvider></MotionConfig>);
  // Unchecked, the card names it by its placeholder and a frame over it names no one.
  expect(screen.queryByText('Harbour view')).toBeNull();
  expect(screen.getByText('Blueprint 1')).toBeTruthy();
  const over = { x: sc.free.x, y: sc.free.y, w: 4, h: 5 };
  expect(originFor(over)).toBeNull();
  await act(async () => { await reviewGroupText(); });
  expect(vi.mocked(reviewText)).toHaveBeenCalled();
  expect(textApproved('Harbour view')).toBe(true);
  expect(screen.getByText('Harbour view')).toBeTruthy();
  expect(originFor(over)).toBe('Kai');
});

/** A projection that boxes each object by its footprint cell at ten px a cell. */
function boxView(): ActiveView {
  const box = (id: string) => {
    const o = s().gridState!.objects.get(id);
    return o ? { x: o.position.x * 10, y: o.position.y * 10, w: 10, h: 10 } : null;
  };
  const cellToScreen = (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 });
  const projection = { cellToScreen, screenToPoint: () => ({ x: 0, y: 0 }), objectScreenBox: box };
  return { projection, camera: {}, overlay: {}, animateGroupRotation: () => {} } as unknown as ActiveView;
}

spec('BLUE-07', 'a placement selected whole is marked as one thing: one outline, no ring per member, no count on its card', async () => {
  const { sc } = await placed();
  const road = laidRoads(sc)[0]!;
  setActiveView(boxView());
  act(() => { s().clearSelection(); click({ object: road.id }); });
  render(<MotionConfig reducedMotion="always"><I18nProvider><SelectionMarks /><SelectionCard /></I18nProvider></MotionConfig>);
  const arcs = [...screen.getByTestId('selection-marks').querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
  expect(arcs).toHaveLength(2); // the group's brackets: edge and ink
  expect(arcs.some((d) => /a\d/.test(d))).toBe(false);
  const card = screen.getByTestId('selection-card');
  // Its thumb is a glyph of its own, never the Blueprint mode tile.
  const thumb = screen.getAllByTestId('selection-thumb')[0]!;
  expect(thumb.querySelectorAll('img')).toHaveLength(0);
  expect(thumb.querySelector('svg')).toBeTruthy();
  expect(card.innerHTML).not.toContain(MODE_ICONS.blueprint.pressed);
  expect(card.textContent).not.toMatch(/^\d+$/m);
  // An ordinary multi-selection keeps its rings.
  s().setEditMode({ mode: null });
  act(() => { s().setSelection(laidRoads(sc).map((o) => ({ kind: 'object', id: o.id }))); });
  const multi = [...screen.getByTestId('selection-marks').querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
  expect(multi.some((d) => /a\d/.test(d))).toBe(true);
  setActiveView(null);
});

spec('BLUE-07', 'hovering any member of a placement in Blueprint mode boxes the whole placement, and outside it only the object', async () => {
  const { sc } = await placed();
  const road = laidRoads(sc)[0]!;
  const gs = s().gridState!;
  const target = { hit: road, centre: road.position, terrain: road.position, pick: null } as never;
  const frame = gs.groups![0]!.frame;
  const boxIn = () => selectionHoverBox(gs, target, true, false, groupHoverFrame(s(), target, road.position));
  expect(boxIn()).toEqual({ ...frame, grid: 'object' });
  s().setEditMode({ mode: null });
  expect(boxIn()).toMatchObject({ x: road.position.x, y: road.position.y });
  expect(boxIn()).not.toEqual({ ...frame, grid: 'object' });
});

spec('BLUE-07', 'in Blueprint mode the pointer anywhere in a placement\'s frame hovers and selects it, over open ground or another object there', async () => {
  const { sc } = await placed();
  const group = s().gridState!.groups![0]!;
  const empty = shift(sc.free, 3, 3);
  expect(groupOf(s().gridState!, { cell: empty })).toBeNull();
  expect(s().gridState!.objects.size).toBeGreaterThan(0);
  const ground = { hit: null, centre: empty, terrain: empty, pick: null } as never;
  expect(selectionHoverBox(s().gridState!, ground, true, false, groupHoverFrame(s(), ground, empty))).toEqual({ ...group.frame, grid: 'object' });
  s().clearSelection();
  click({ cell: empty });
  expect(counts(s().selection)).toEqual({ objects: 2, cells: 9 });

  // A road set down later inside the frame is no member, yet a press on it selects the placement.
  const later = sc.w.place(ROAD, sc.free.x + 3, sc.free.y + 4);
  expect(later.ok).toBe(true);
  const road = s().gridState!.objects.get(later.id!)!;
  const onRoad = { hit: road, centre: road.position, terrain: road.position, pick: null } as never;
  expect(groupHoverFrame(s(), onRoad, road.position)).toEqual(group.frame);
  s().clearSelection();
  click({ object: road.id });
  expect(counts(s().selection)).toEqual({ objects: 2, cells: 9 });
  expect(selectedObjectIds(s().selection)).not.toContain(road.id);

  // Outside Blueprint mode the frame claims nothing: each press selects what it lands on.
  s().setEditMode({ mode: null });
  expect(groupHoverFrame(s(), ground, empty)).toBeNull();
  click({ object: road.id });
  expect(s().selection).toEqual([{ kind: 'object', id: road.id }]);
});

spec('BLUE-07', 'where placements\' frames overlap the one placed last is hovered and selected', async () => {
  const { sc, record } = await placed();
  armBlueprint(record.id);
  placeArmedAt(shift(sc.free, 2, 0));
  const groups = s().gridState!.groups!;
  expect(groups).toHaveLength(2);
  const newest = groups[1]!;
  expect(newest.frame.x).toBe(sc.free.x + 2);
  const both = shift(sc.free, 2, 3);
  const ground = { hit: null, centre: both, terrain: both, pick: null } as never;
  expect(groupHoverFrame(s(), ground, both)).toEqual(newest.frame);
  s().clearSelection();
  click({ cell: both });
  expect(s().selection).toEqual(groupRefs(s().gridState!, newest));
  // Where only the first frame reaches, the first placement.
  s().clearSelection();
  click({ cell: shift(sc.free, 0, 3) });
  expect(s().selection).toEqual(groupRefs(s().gridState!, groups[0]!));
});

spec('BLUE-07', 'a placement of terrain alone is selected whole with its card, one outline, no flat rectangle, and turns and deletes', async () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ locale: 'en' });
  const record = await saveBlueprint({ frame: { ...sc.frame, h: 3 }, name: 'Pad', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(`refused: ${record}`);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const group = s().gridState!.groups![0]!;
  expect(group.objects).toHaveLength(0);
  setActiveView(boxView());
  expect(counts(s().selection).objects).toBe(0);
  render(<MotionConfig reducedMotion="always"><I18nProvider><SelectionMarks /><SelectionCard /></I18nProvider></MotionConfig>);
  const marks = screen.getByTestId('selection-marks');
  expect(marks.querySelectorAll('rect')).toHaveLength(0);
  expect(marks.querySelectorAll('path')).toHaveLength(2);
  expect(screen.getByTestId('selection-card')).toBeTruthy();
  expect(screen.getByTestId('handle-rotate')).toBeTruthy();
  act(() => { screen.getByTestId('handle-rotate').click(); });
  expect(s().gridState!.groups).toHaveLength(1);
  act(() => { screen.getByTestId('handle-delete').click(); });
  expect(s().gridState!.groups ?? []).toEqual([]);
  setActiveView(null);
});

spec('BLUE-07', 'turning a placement plays the group rotation on its objects, a quarter about its frame centre', async () => {
  const { sc } = await placed();
  const road = laidRoads(sc)[0]!;
  const turns: { pivot: { x: number; y: number }; sweepDeg: number; members: readonly { id: string }[] }[] = [];
  const view = boxView() as unknown as Record<string, unknown>;
  view.animateGroupRotation = (turn: (typeof turns)[number]) => { turns.push(turn); };
  const bodies: { n: number; prior: unknown[]; pivot: { x: number; y: number }; sweepDeg: number }[] = [];
  view.overlay = {
    turnBlocks: (b: unknown[], prior: unknown[], pivot: { x: number; y: number }, sweepDeg: number) => {
      bodies.push({ n: b.length, prior, pivot, sweepDeg });
    },
  };
  setActiveView(view as unknown as ActiveView);
  act(() => { s().clearSelection(); click({ object: road.id }); });
  act(() => { rotateSelection(90); });
  const group = s().gridState!.groups![0]!;
  expect(turns).toHaveLength(1);
  expect(turns[0]!.sweepDeg).toBe(90);
  expect(turns[0]!.pivot).toEqual({ x: group.frame.x + group.frame.w / 2, y: group.frame.y + group.frame.h / 2 });
  // The laid terrain turns as one body with the objects, about the same pivot.
  expect(bodies).toEqual([{
    n: group.cells.length, pivot: turns[0]!.pivot, sweepDeg: 90,
    // Under it the landed cells stand as they were before the placement.
    prior: group.cells.map((c) => ({ x: c.x, y: c.y, terrain: c.prior })),
  }]);
  expect(turns[0]!.members.map((m) => m.id).sort()).toEqual(group.objects.map((o) => o.id).sort());
  setActiveView(null);
});

spec('BLUE-07', 'a placement\'s card shows the region glyph and lists its objects by kind, then its mountain and water cells', async () => {
  const { sc } = await placed();
  const road = laidRoads(sc)[0]!;
  act(() => { s().clearSelection(); click({ object: road.id }); });
  render(<MotionConfig reducedMotion="always"><I18nProvider><SelectionCard /></I18nProvider></MotionConfig>);
  // The round picture is a dashed square, the region the placement covers.
  expect(screen.getAllByTestId('selection-thumb')[0]!.querySelector('svg [stroke-dasharray]')).toBeTruthy();
  act(() => { screen.getByTestId('selection-details').click(); });
  const rows = screen.getAllByTestId(/^selection-(kind|terrain)$/).map((r) => r.textContent);
  expect(rows).toEqual([expect.stringMatching(/×2$/), expect.stringMatching(/Mountains.*9 cells/)]);
  // The plateau holds no water, so no water row stands.
  expect(screen.queryByText(/Water/)).toBeNull();
  // A kind's row narrows the selection to those objects.
  act(() => { screen.getByTestId('selection-kind').click(); });
  expect(counts(s().selection)).toEqual({ objects: 2, cells: 0 });
});

/** An apple tree in the sample beside its plateau, so the placement holds two kinds of object. */
const TREE = 'tree-apple';
const withTree = (sc: Scene): void => {
  const out = sc.w.place(TREE, sc.frame.x + 3, sc.frame.y + 1);
  if (!out.ok) throw new Error(`tree refused: ${out.refusedBy.join(', ')}`);
};

/** The selection card's details row of the placement's roads pressed, narrowing the selection to them. */
function narrowToRoads(): void {
  const card = render(<MotionConfig reducedMotion="always"><I18nProvider><SelectionCard /></I18nProvider></MotionConfig>);
  act(() => { screen.getByTestId('selection-details').click(); });
  const row = screen.getAllByTestId('selection-kind').find((r) => /×2$/.test(r.textContent ?? ''))!;
  act(() => { row.click(); });
  card.unmount();
}

const refsOf = (objs: readonly { id: string }[]): BlockRef[] => objs.map((o) => ({ kind: 'object', id: o.id }));

for (const [by, pointerType] of [['a mouse', 'mouse'], ['a finger', 'touch']] as const) {
  spec('BLUE-07', `objects narrowed from a placement come before it: hovered alone, and a drag from one by ${by} moves them, the placement staying`, async () => {
    const { sc } = await placed(withTree);
    const tree = [...sc.w.state.objects.values()].find((o) => o.catalogId === TREE && o.position.x >= sc.free.x)!;
    const [left, right] = laidRoads(sc);
    const group = s().gridState!.groups![0]!;
    expect(s().selection).toEqual(groupRefs(s().gridState!, group));
    narrowToRoads();
    expect(s().selection).toEqual(refsOf([left!, right!]));

    // The pointer on a selected road outlines that road, not the placement's frame.
    const gs = s().gridState!;
    const onRoad = { hit: left, centre: left!.position, terrain: left!.position, pick: null } as never;
    expect(groupHoverFrame(s(), onRoad, left!.position)).toBeNull();
    expect(selectionHoverBox(gs, onRoad, true, false, groupHoverFrame(s(), onRoad, left!.position)))
      .toEqual({ x: left!.position.x, y: left!.position.y, w: 1, h: 1, grid: 'object' });

    drag({ object: left!.id }, shift(left!.position, 0, 2), pointerType);
    expect([left!, right!].map((o) => gs.objects.get(o.id)?.position)).toEqual([shift(left!.position, 0, 2), shift(right!.position, 0, 2)]);
    expect(s().selection).toEqual(refsOf([left!, right!]));
    // The placement stays where it was laid, its terrain and its tree with it.
    const after = s().gridState!.groups![0]!;
    expect(after.frame).toEqual(group.frame);
    expect(counts(groupRefs(s().gridState!, after))).toEqual({ objects: 1, cells: 9 });
    expect(gs.objects.get(tree.id)?.position).toEqual(tree.position);
    expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });
}

spec('BLUE-07', 'with objects narrowed from a placement, a press elsewhere in its frame still selects it whole, which a drag then carries', async () => {
  const { sc } = await placed(withTree);
  const gs = s().gridState!;
  const group = gs.groups![0]!;
  const whole = groupRefs(gs, group);
  const tree = [...gs.objects.values()].find((o) => o.catalogId === TREE && o.position.x >= sc.free.x)!;
  const empty = shift(sc.free, 3, 3);
  const presses: [string, On][] = [
    ['open ground in the frame', { cell: empty }],
    ['a laid terrain cell', { cell: shift(sc.free, 1, 1) }],
    ['the placement\'s object not selected', { object: tree.id }],
  ];
  for (const [where, on] of presses) {
    narrowToRoads();
    expect(counts(s().selection), where).toEqual({ objects: 2, cells: 0 });
    if ('cell' in on) {
      const ground = { hit: null, centre: on.cell, terrain: on.cell, pick: null } as never;
      expect(groupHoverFrame(s(), ground, on.cell), where).toEqual(group.frame);
    }
    click(on);
    expect(s().selection, where).toEqual(whole);
  }
  // Selected whole, a drag from one of its roads carries all of it.
  drag({ object: laidRoads(sc)[0]!.id }, shift(laidRoads(sc)[0]!.position, 6, 0));
  expect(s().gridState!.groups![0]!.frame).toEqual({ ...group.frame, x: group.frame.x + 6 });
  expect(sc.w.terrainAt(shift(sc.free, 7, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
});

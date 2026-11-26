// @vitest-environment jsdom
/** Flip, as a person uses it: one button and one key stepping a selection, a placed blueprint or an
 *  armed blueprint through left-right, top-bottom, both and back, mirroring where things stand and
 *  which side they face while every item keeps its own look. */
import { afterEach, expect, vi } from 'vitest';
import { spec } from '../../_support/spec';
import { deserialize } from '../../_support/save-file';
import { useEditorStore } from '../../../state/store';
import { groupRefs } from '../../../state/placed-groups';
import { armBlueprint, flipSelectedGroup, moveSelectedGroup, placeArmedAt, saveBlueprint, selectedGroupDrag } from '../../../editor/editing/blueprint';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { selectionTarget } from '../../../editor/editing/object-menu';
import { createAutosave, readRestorableAutosave } from '../../../io/storage/autosave';
import { restoreSession } from '../../../editor/session/restore';
import { buildSaveFile } from '../../../io/save/json-codec';
import { createDefaultRegistry } from '../../../rules';
import { footprintTerrain } from '../../../core/grid/footprint';
import { groupBody, groupRecipe, liveMembers, mapGroups, type PlacedGroup } from '../../../core/model/placed-group';
import { CommandType, type GridState, type PlacedObject, type TerrainCell } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import { orientBody, type BlueprintBody } from '../../../tools/blueprint';
import { PRESETS } from '../../../state/keymap/registry';
import { effectiveCombo, currentBinds, overridesFor } from '../../../state/keymap/resolve';
import { normalizeCombo } from '../../../platform/input/combo';
import { setStoreState } from '../../_support/store';
import { world, type SpecWorld } from '../_world';
import { Pointer, placeItem, plateau } from '../editing/_editing';
import { ToolType } from '../../../state/editing/vocabulary';
import { blueprintEditor, open, roads, scene, shift } from './_blueprints';
import { makeToolCtx } from '../../_support/tool-ctx';
import { BlueprintTool } from '../../../tools/pointer/blueprint';
import { HEADLESS_OVERLAY } from '../../../tools/pointer/runtime/host';
import { gridCell, mapPoint } from '../../../core/grid/grids';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { act, renderHook } from '@testing-library/react';
import { useEditorShortcuts } from '../../../ui/shell/use-editor-shortcuts';
import { useKeybinds } from '../../../state/keymap/store';
import { setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import type { GroupRotation } from '../../../tools/objects';

const editor = blueprintEditor();
const s = () => useEditorStore.getState();
const key = (id: string) => COMMAND_BY_ID.get(id)!.run({ toggleMenu: () => {} } as unknown as CommandContext);
afterEach(() => { localStorage.clear(); });

/** The one group on the map. */
const theGroup = (state: GridState): PlacedGroup => {
  const groups = mapGroups(state);
  expect(groups).toHaveLength(1);
  return groups[0]!;
};

/** Selects the one group whole, as a click on it does in Blueprint mode. */
const selectGroup = (): void => {
  const state = s().gridState!;
  s().setSelection(groupRefs(state, theGroup(state)), { record: false });
};

/** What stands in `frame` as a person sees it, ids aside: each object's kind, place, facing, height
 *  and cuts, and each terrain cell under the frame. */
function standing(state: GridState, frame: Rect): string {
  const area = footprintTerrain(frame);
  const objects = [...state.objects.values()]
    .filter((o) => o.position.x >= frame.x && o.position.y >= frame.y && o.position.x < frame.x + frame.w && o.position.y < frame.y + frame.h)
    .map((o) => [o.catalogId, o.position.x, o.position.y, o.rotation, o.elevation, o.spanLength ?? null, o.corners ?? null])
    .map((o) => JSON.stringify(o)).sort();
  const cells: string[] = [];
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) cells.push(JSON.stringify(state.cells[y]?.[x]?.terrain ?? null));
  }
  return JSON.stringify({ objects, cells });
}

/** The terrain under `frame`, row by row relative to it, each row read right to left when `mirrored`. */
function terrainRows(state: GridState, frame: Rect, mirrored = false): (TerrainCell | null)[][] {
  const area = footprintTerrain(frame);
  const rows: (TerrainCell | null)[][] = [];
  for (let y = area.y; y < area.y + area.h; y++) {
    const row: (TerrainCell | null)[] = [];
    for (let x = area.x; x < area.x + area.w; x++) row.push(state.cells[y]?.[x]?.terrain ?? null);
    rows.push(mirrored ? row.reverse() : row);
  }
  return rows;
}

/** `body` with its objects in reading order, which laying them does not keep. */
const inOrder = (body: BlueprintBody): BlueprintBody => ({
  ...body, objects: [...body.objects].sort((a, b) => a.y - b.y || a.x - b.x || a.catalogId.localeCompare(b.catalogId)),
});

async function saveFrame(w: SpecWorld, frame: Rect, name = 'Terrace') {
  open(w);
  const record = await saveBlueprint({ frame, name, author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(`refused: ${record}`);
  return record;
}

/** The scene's sample saved and placed once on open ground beside it, selected whole. */
async function placedScene() {
  const sc = scene();
  const record = await saveFrame(sc.w, sc.frame);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const frame = { ...sc.frame, x: sc.free.x, y: sc.free.y };
  return { sc, record, frame };
}

spec('BLUE-14', 'a selection of objects steps left-right, top-bottom, both and back about its centre, one key press each', () => {
  const w = world();
  const at = w.openGround(8, 6);
  const a = w.place('building-stall', at.x, at.y, { rotation: 90 });
  const b = w.place('building-stall', at.x + 3, at.y + 1);
  if (!a.ok || !b.ok) throw new Error('stall refused');
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [{ kind: 'object', id: a.id! }, { kind: 'object', id: b.id! }] });
  const look = (id: string) => { const o = w.object(id)!; return [o.position.x - at.x, o.position.y - at.y, o.rotation]; };
  const start = w.fingerprint();

  key('selection.flip');
  // Mirrored left to right across the bounding box (x 0 to 4): the stall facing -x faces +x.
  expect([look(a.id!), look(b.id!)]).toEqual([[3, 0, 270], [0, 1, 0]]);
  key('selection.flip');
  // Top to bottom (y 0 to 2): the stall facing -x faces -x again, the one facing +y faces -y.
  expect([look(a.id!), look(b.id!)]).toEqual([[0, 1, 90], [3, 0, 180]]);
  key('selection.flip');
  expect([look(a.id!), look(b.id!)]).toEqual([[3, 1, 270], [0, 0, 180]]);
  key('selection.flip');
  expect(w.fingerprint(), 'four presses end as it began').toBe(start);

  // A new selection starts the cycle again.
  key('selection.flip');
  s().setSelection([{ kind: 'object', id: b.id! }, { kind: 'object', id: a.id! }]);
  key('selection.flip');
  expect(w.fingerprint(), 'a mirror after a fresh selection mirrors back').toBe(start);
});

spec('BLUE-14', 'a placed group steps through the same cycle about its frame\'s centre and stays the same group', async () => {
  const { sc, frame } = await placedScene();
  const group = theGroup(sc.w.state);
  const start = standing(sc.w.state, frame);
  const startRows = terrainRows(sc.w.state, frame);

  expect(flipSelectedGroup()).toBe(true);
  // Mirrored left to right: the two roads under the plateau move from the left of the frame to its right.
  expect(roads(sc.w).filter((o) => o.position.x >= frame.x).map((o) => o.position.x - frame.x).sort()).toEqual([2, 3]);
  expect(terrainRows(sc.w.state, frame, true)).toEqual(startRows);
  const flipped = theGroup(sc.w.state);
  expect({ id: flipped.id, blueprint: flipped.blueprint, name: flipped.name, origin: flipped.origin, frame: flipped.frame })
    .toEqual({ id: group.id, blueprint: group.blueprint, name: group.name, origin: group.origin, frame: group.frame });

  expect(key('selection.flip')).toBeUndefined();
  // Top to bottom: the roads at the top row, back on the left.
  expect(roads(sc.w).filter((o) => o.position.x >= frame.x).map((o) => [o.position.x - frame.x, o.position.y - frame.y]).sort())
    .toEqual([[0, 0], [1, 0]]);
  expect(terrainRows(sc.w.state, frame)).toEqual([...startRows].reverse());
  flipSelectedGroup();
  expect(terrainRows(sc.w.state, frame, true)).toEqual([...startRows].reverse());
  flipSelectedGroup();
  expect(standing(sc.w.state, frame), 'four presses end as it began').toBe(start);
  expect(theGroup(sc.w.state).id).toBe(group.id);
  expect(liveMembers(sc.w.state, theGroup(sc.w.state)).objects).toHaveLength(2);
});

spec('BLUE-14', 'an armed blueprint steps through the cycle before it is placed and lays as it was flipped', async () => {
  const sc = scene();
  const record = await saveFrame(sc.w, sc.frame);
  armBlueprint(record.id);
  const orientation = () => ({ quarters: s().blueprint.quarters, mirror: s().blueprint.mirror });
  key('selection.flip');
  expect(orientation()).toEqual({ quarters: 0, mirror: true });
  key('selection.flip');
  expect(orientation()).toEqual({ quarters: 2, mirror: true });
  key('selection.flip');
  expect(orientation()).toEqual({ quarters: 2, mirror: false });
  key('selection.flip');
  expect(orientation()).toEqual({ quarters: 0, mirror: false });

  key('selection.flip');
  expect(s().selection).toEqual([]);
  placeArmedAt(sc.free);
  const frame = { ...sc.frame, x: sc.free.x, y: sc.free.y };
  expect(roads(sc.w).filter((o) => o.position.x >= frame.x).map((o) => o.position.x - frame.x).sort()).toEqual([2, 3]);
  expect(inOrder(groupBody(sc.w.state, theGroup(sc.w.state)))).toEqual(inOrder(orientBody(record.body, { quarters: 0, mirror: true })));
  // The placed group carries on from the armed blueprint's place in the cycle: next comes top to bottom.
  selectGroup();
  flipSelectedGroup();
  expect(inOrder(groupBody(sc.w.state, theGroup(sc.w.state)))).toEqual(inOrder(orientBody(record.body, { quarters: 2, mirror: true })));
});

spec('BLUE-14', 'a door, a ramp\'s downhill side and a print\'s exits face the mirrored side, and a bridge keeps its axis', async () => {
  const w = world();
  const at = w.openGround(16, 16);
  // Two terraces with a gap a bridge spans, a ramp down the far terrace's east side, a cabin below
  // facing west and a corner print.
  plateau(w, at, 4, 6, 1);
  plateau(w, shift(at, 8, 0), 4, 6, 1);
  const bridge = placeItem(w, 'bridge-iron', shift(at, 5, 2));
  const ramp = placeItem(w, 'ramp-grassy', shift(at, 11, 2));
  const cabin = w.place('building-forest-cabin', at.x + 3, at.y + 8, { rotation: 90 });
  const print = w.place('print-field-corner', at.x + 12, at.y + 12);
  if (!bridge || !ramp || !cabin.ok || !print.ok) throw new Error('the scene did not build');
  expect([bridge.rotation, ramp.rotation, w.object(cabin.id!)!.rotation, w.object(print.id!)!.rotation]).toEqual([0, 90, 90, 0]);
  const frame = { x: at.x, y: at.y, w: 15, h: 15 };
  const record = await saveFrame(w, frame);
  const was = w.object(cabin.id!)!;
  // A cabin stands once per map, so the original makes way for the copy.
  expect(w.remove(cabin.id!).ok).toBe(true);
  const free = w.openGround(15, 15);
  armBlueprint(record.id);
  key('selection.flip');
  expect(placeArmedAt(free)).toEqual({ ground: 0, objects: 0, capped: 0, unknown: 0 });
  const laid = (catalogId: string): PlacedObject => {
    const found = [...w.state.objects.values()].filter((o) => o.catalogId === catalogId
      && o.position.x >= free.x && o.position.y >= free.y && o.position.x < free.x + frame.w && o.position.y < free.y + frame.h);
    expect(found, catalogId).toHaveLength(1);
    return found[0]!;
  };
  // The cabin's door faces east, the ramp runs down to the west, the print's exits run south and west.
  expect(laid('building-forest-cabin').rotation).toBe(270);
  expect(laid('ramp-grassy').rotation).toBe(270);
  expect(laid('print-field-corner').rotation).toBe(90);
  expect(laid('bridge-iron').rotation).toBe(0);
  // Each stands where the mirror puts its footprint.
  const mirrored = (o: PlacedObject, size: number) => frame.w - (o.position.x - at.x) - size;
  expect(laid('building-forest-cabin').position).toEqual({ x: free.x + mirrored(was, 4), y: free.y + 8 });
  expect(laid('bridge-iron').position.x - free.x).toBe(mirrored(bridge, bridge.spanLength!));
});

spec('BLUE-14', 'terrain cells, their corner cuts and a road\'s corner cuts are mirrored with the group', async () => {
  const sc = scene();
  const { w } = sc;
  // The plateau's south-east block cut, and the right road tile's corner cut.
  const corner = shift(sc.frame, 2, 2);
  new Pointer(w, { tool: ToolType.EdgeCut }).click(corner);
  const cut = w.state.cells[corner.y]![corner.x]!.terrain!.corners!;
  expect(cut[3]).not.toBe('square');
  const right = roads(w).find((o) => o.position.x === sc.frame.x + 1)!;
  const res = w.sandbox.execute({ type: CommandType.TrimCorners, layer: 'road', objectId: right.id, x: right.position.x, y: right.position.y, afterCorners: ['square', 'square', 'square', 'tri-SE'] });
  expect(res.success).toBe(true);
  const record = await saveFrame(w, sc.frame);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const frame = { ...sc.frame, x: sc.free.x, y: sc.free.y };
  const startRows = terrainRows(w.state, frame);
  flipSelectedGroup();

  const rows = terrainRows(w.state, frame, true);
  // Each cell reads as its mirror did, its corners swapped left for right and a bevel's quadrant with them.
  const mirrorCut = (c: TerrainCell | null) => {
    if (!c?.corners) return c;
    const swap: Record<string, string> = { 'tri-NW': 'tri-NE', 'tri-NE': 'tri-NW', 'tri-SW': 'tri-SE', 'tri-SE': 'tri-SW' };
    const [tl, tr, bl, br] = c.corners.map((t) => swap[t] ?? t);
    return { ...c, corners: [tr, tl, br, bl] };
  };
  expect(rows).toEqual(startRows.map((row) => row.map(mirrorCut)));
  expect(rows.flat().some((c) => c?.corners && c.corners.some((t) => t !== 'square')), 'a cut corner came along').toBe(true);
  const road = roads(w).find((o) => o.position.x === frame.x + 2 && o.position.y === frame.y + 4);
  expect(road?.corners).toEqual(['square', 'square', 'tri-SW', 'square']);
});

spec('BLUE-14', 'a part the flip cannot land is skipped and said, what stands in its way stays, and the next move lays it', async () => {
  const { sc, frame } = await placedScene();
  // A tree where the right road would land once mirrored.
  const tree = sc.w.place('tree-apple', frame.x + 3, frame.y + 4);
  if (!tree.ok) throw new Error('tree refused');
  selectGroup();
  editor.toasts().length = 0;

  expect(flipSelectedGroup()).toBe(true);
  expect(sc.w.object(tree.id!)?.position).toEqual({ x: frame.x + 3, y: frame.y + 4 });
  expect(roads(sc.w).filter((o) => o.position.x >= frame.x && o.position.x < frame.x + frame.w).map((o) => o.position.x - frame.x)).toEqual([2]);
  expect(editor.toasts(), 'the skip is said').toHaveLength(1);

  // A later move lays the blueprint flipped, the road the flip skipped included.
  const record = theGroup(sc.w.state);
  const to = shift(frame, 6, 0);
  expect(moveSelectedGroup(to)).toBe(true);
  expect(roads(sc.w).filter((o) => o.position.x >= to.x).map((o) => o.position.x - to.x).sort()).toEqual([2, 3]);
  expect(theGroup(sc.w.state).id).toBe(record.id);
});

spec('BLUE-14', 'a flipped group keeps its blueprint flipped: turned or moved later it lays flipped', async () => {
  const { sc, record } = await placedScene();
  flipSelectedGroup();
  expect(moveSelectedGroup(shift(sc.free, 8, 0))).toBe(true);
  expect(inOrder(groupBody(sc.w.state, theGroup(sc.w.state)))).toEqual(inOrder(orientBody(record.body, { quarters: 0, mirror: true })));
  key('selection.rotate_cw');
  expect(moveSelectedGroup(shift(sc.free, 16, 0))).toBe(true);
  expect(inOrder(groupBody(sc.w.state, theGroup(sc.w.state)))).toEqual(inOrder(orientBody(record.body, { quarters: 1, mirror: true })));

  // A Ctrl+drag copy lays it as it stands, flipped, what did not fit kept to lay later, and starts its own cycle.
  selectedGroupDrag.copy(shift(sc.free, 0, 8));
  const [, copy] = mapGroups(sc.w.state);
  expect(inOrder(groupRecipe(sc.w.state, copy!))).toEqual(inOrder(orientBody(record.body, { quarters: 1, mirror: true })));
  expect(copy!.flip ?? 0).toBe(0);
});

spec('BLUE-14', 'each press is one undo step, and redo repeats the presses in order', async () => {
  const { sc, frame } = await placedScene();
  const picture = () => `${standing(sc.w.state, frame)}|${JSON.stringify(mapGroups(sc.w.state).map((g) => [g.id, g.flip ?? 0]))}`;
  const placed = picture();
  flipSelectedGroup();
  const once = picture();
  flipSelectedGroup();
  const twice = picture();
  sc.w.undo();
  expect(picture()).toBe(once);
  sc.w.undo();
  expect(picture()).toBe(placed);
  sc.w.redo();
  expect(picture()).toBe(once);
  sc.w.redo();
  expect(picture()).toBe(twice);

  // A selection's flip too.
  const w = world();
  const at = w.openGround(8, 6);
  const a = w.place('building-stall', at.x, at.y, { rotation: 90 });
  const b = w.place('building-stall', at.x + 3, at.y + 1);
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [{ kind: 'object', id: a.id! }, { kind: 'object', id: b.id! }] });
  const before = w.fingerprint();
  key('selection.flip');
  const after = w.fingerprint();
  expect(after).not.toBe(before);
  w.undo();
  expect(w.fingerprint()).toBe(before);
  w.redo();
  expect(w.fingerprint()).toBe(after);
});

spec('BLUE-14', 'a flipped group reopened or restored lays flipped when moved or turned, and its next press mirrors it as it stands', async () => {
  const { sc, record } = await placedScene();
  flipSelectedGroup();
  const file = buildSaveFile(sc.w.state);
  const json = JSON.stringify(file);
  // The file holds the group as it stands and nothing of the cycle.
  expect(Object.keys((file as { groups: Record<string, unknown>[] }).groups[0]!)).not.toContain('flip');
  const mirrored = inOrder(orientBody(record.body, { quarters: 0, mirror: true }));

  s().loadMap(deserialize(json, sc.w.state.template), createDefaultRegistry());
  s().setEditMode({ mode: 'blueprint' });
  selectGroup();
  expect(moveSelectedGroup(shift(sc.free, 8, 0))).toBe(true);
  expect(inOrder(groupBody(s().gridState!, theGroup(s().gridState!))), 'a move lays the flipped layout').toEqual(mirrored);
  key('selection.rotate_cw');
  expect(inOrder(groupBody(s().gridState!, theGroup(s().gridState!)))).toEqual(inOrder(orientBody(record.body, { quarters: 1, mirror: true })));
  key('selection.rotate_ccw');
  // The reopened group starts the cycle as it stands: its next press mirrors it left to right, back to the blueprint.
  flipSelectedGroup();
  expect(inOrder(groupBody(s().gridState!, theGroup(s().gridState!)))).toEqual(inOrder(record.body));

  const autosave = createAutosave({ camera: () => undefined, history: () => undefined });
  autosave.schedule(sc.w.state);
  autosave.flush();
  const offer = readRestorableAutosave();
  if (!offer) throw new Error('no session offered');
  restoreSession(offer);
  s().setEditMode({ mode: 'blueprint' });
  selectGroup();
  expect(moveSelectedGroup(shift(sc.free, 16, 0))).toBe(true);
  expect(inOrder(groupBody(s().gridState!, theGroup(s().gridState!))), 'a restored group lays flipped').toEqual(mirrored);
  flipSelectedGroup();
  expect(inOrder(groupBody(s().gridState!, theGroup(s().gridState!)))).toEqual(inOrder(record.body));
});

spec('BLUE-14', 'F flips by default, Pro puts it on the slash beside its rotate keys, and no style binds two commands to one key', () => {
  expect(effectiveCombo({}, 'selection.flip')).toBe('f');
  for (const p of PRESETS) {
    const binds = currentBinds(overridesFor(p.binds));
    const combos = [...binds.values()].filter((c): c is string => c != null);
    expect(new Set(combos).size, `${p.id} binds one key twice`).toBe(combos.length);
    expect(binds.get('selection.flip'), `${p.id} binds Flip`).toBeTruthy();
  }
  expect(currentBinds(overridesFor((PRESETS.find((p) => p.id === 'pro')!).binds)).get('selection.flip')).toBe(normalizeCombo('/'));
});

spec('BLUE-14', 'a single object has no Flip and the key leaves it as it is, while a selection and a placed group offer it', async () => {
  const w = world();
  const at = w.openGround(6, 6);
  const a = w.place('building-stall', at.x, at.y, { rotation: 90 });
  const b = w.place('building-stall', at.x + 3, at.y + 1);
  const one = [{ kind: 'object', id: a.id! }] as const;
  const two = [...one, { kind: 'object', id: b.id! }] as const;
  expect(selectionTarget(one, w.state, false)?.flippable).toBe(false);
  expect(selectionTarget(two, w.state, false)?.flippable).toBe(true);
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [...one] });
  const before = w.fingerprint();
  key('selection.flip');
  expect(w.fingerprint()).toBe(before);

  const { sc } = await placedScene();
  const group = theGroup(sc.w.state);
  expect(selectionTarget(s().selection, sc.w.state, false, { planet: null, repairing: false, group })?.flippable).toBe(true);
});

spec('BLUE-14', 'a selection whose flip would land a member where the rules refuse it stays as it was, with the refusal said', () => {
  const w = world();
  const at = w.openGround(8, 6);
  const a = w.place('building-stall', at.x, at.y, { rotation: 90 });
  const b = w.place('building-stall', at.x + 3, at.y + 1);
  // A tree standing where the mirror puts the first stall.
  const tree = w.place('tree-apple', at.x + 3, at.y);
  if (!a.ok || !b.ok || !tree.ok) throw new Error('scene refused');
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [{ kind: 'object', id: a.id! }, { kind: 'object', id: b.id! }] });
  const refused = vi.fn();
  const stop = s().eventBus.on('validation-failed', refused);
  const before = w.fingerprint();
  key('selection.flip');
  stop();
  expect(w.fingerprint()).toBe(before);
  expect(refused).toHaveBeenCalledTimes(1);
});

spec('BLUE-14', 'the armed blueprint\'s ghost shows it flipped before it is placed', async () => {
  const sc = scene();
  const record = await saveFrame(sc.w, sc.frame);
  armBlueprint(record.id);
  const ghostAt = (): { x: number; y: number }[] => {
    const overlay = { ...HEADLESS_OVERLAY, showGhost: vi.fn(), showGroupPlacementGhost: vi.fn(), clearGhost: vi.fn() };
    const ctx = Object.assign(makeToolCtx(sc.w.state, sc.w.sandbox.executor, 1, {
      overlay, tool: ToolType.Blueprint, setDisplayLayer: vi.fn(), blueprint: s().blueprint,
    }), { blueprintPlaced: vi.fn() });
    // The pointer on the frame's centre cell holds the frame with its top-left on the free ground.
    const held = { x: sc.free.x + 1, y: sc.free.y + 2 };
    new BlueprintTool().onPointerMove(gridCell(PLACEMENT_GRID, held), mapPoint({ x: held.x + 0.5, y: held.y + 0.5 }), ctx);
    const [, paint] = overlay.showGhost.mock.calls.at(-1)!;
    return (paint as { blocks: { x: number; y: number }[] }).blocks.map((b) => ({ x: b.x, y: b.y }));
  };
  const area = footprintTerrain({ ...sc.frame, x: sc.free.x, y: sc.free.y });
  const plain = ghostAt();
  key('selection.flip');
  const flipped = ghostAt();
  const key2 = (c: { x: number; y: number }) => `${c.x},${c.y}`;
  expect(new Set(flipped.map(key2))).toEqual(new Set(plain.map((c) => key2({ x: area.x + area.w - 1 - (c.x - area.x), y: c.y }))));
  expect(new Set(flipped.map(key2))).not.toEqual(new Set(plain.map(key2)));
});

spec('BLUE-14', 'pressing F flips the armed blueprint, and under the Pro style the slash does', async () => {
  const sc = scene();
  const record = await saveFrame(sc.w, sc.frame);
  armBlueprint(record.id);
  const view = renderHook(() => useEditorShortcuts({ toggleMenu: () => {} }));
  const send = (k: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true })); });
  try {
    send('f');
    expect(s().blueprint).toMatchObject({ quarters: 0, mirror: true, flip: 1 });
    act(() => { useKeybinds.getState().applyBinds(PRESETS.find((p) => p.id === 'pro')!.binds); });
    send('/');
    expect(s().blueprint).toMatchObject({ quarters: 2, mirror: true, flip: 2 });
  } finally {
    view.unmount();
    useKeybinds.getState().resetAll();
  }
});

/** A view that records the flips it is asked to play, objects and terrain body alike. */
function recordingView() {
  const plays: GroupRotation[] = [];
  const bodies: { n: number; pivot: { x: number; y: number }; sweepDeg: number; flip: unknown }[] = [];
  const view = {
    projection: {}, camera: {},
    animateGroupRotation: (turn: GroupRotation) => { plays.push(turn); },
    overlay: {
      turnBlocks: (b: unknown[], _prior: unknown[], pivot: { x: number; y: number }, sweepDeg: number, flip?: unknown) => {
        bodies.push({ n: b.length, pivot, sweepDeg, flip });
      },
    },
  };
  setActiveView(view as unknown as ActiveView);
  return { plays, bodies };
}

spec('BLUE-14', 'each press plays a flip where Rotate plays its arc: a placed group\'s objects and terrain, and a selection', async () => {
  const { sc, frame } = await placedScene();
  const { plays, bodies } = recordingView();
  try {
    const pivot = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
    flipSelectedGroup();
    expect(plays.map((p) => ({ pivot: p.pivot, sweepDeg: p.sweepDeg, flip: p.flip, n: p.members.length })))
      .toEqual([{ pivot, sweepDeg: 0, flip: { x: true, y: false }, n: 2 }]);
    // Each laid road opens out from where it stood before the flip, its mirror across the frame's centre.
    for (const m of plays[0]!.members) {
      const o = sc.w.object(m.id)!;
      expect(m.from).toEqual({ x: 2 * pivot.x - (o.position.x + 0.5), y: o.position.y + 0.5 });
    }
    expect(bodies).toEqual([{ n: liveMembers(sc.w.state, theGroup(sc.w.state)).cells.length, pivot, sweepDeg: 0, flip: { x: true, y: false } }]);
    // The second press, the half turn to top to bottom, flips across both axes at once.
    flipSelectedGroup();
    expect(plays[1]!.flip).toEqual({ x: true, y: true });
    expect(bodies[1]!.flip).toEqual({ x: true, y: true });

    const w = world();
    const at = w.openGround(8, 6);
    const a = w.place('building-stall', at.x, at.y, { rotation: 90 });
    const b = w.place('building-stall', at.x + 3, at.y + 1);
    setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [{ kind: 'object', id: a.id! }, { kind: 'object', id: b.id! }] });
    key('selection.flip');
    expect(plays[2]).toEqual({
      pivot: { x: at.x + 2, y: at.y + 1 }, sweepDeg: 0, flip: { x: true, y: false },
      members: [{ id: a.id, from: { x: at.x + 0.5, y: at.y + 0.5 }, spun: false }, { id: b.id, from: { x: at.x + 3.5, y: at.y + 1.5 }, spun: false }],
    });
  } finally {
    setActiveView(null);
  }
});

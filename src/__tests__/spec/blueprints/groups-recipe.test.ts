// @vitest-environment jsdom
/** A placed group lays again from the blueprint it was placed from: what its placement skipped comes
 *  back wherever a turn, a move or a copy now finds room, what the player took out of it stays out,
 *  and map files and the autosave keep what it still has to lay. */
import { afterEach, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { deserialize } from '../../_support/save-file';
import { useEditorStore } from '../../../state/store';
import { groupRefs } from '../../../state/placed-groups';
import { armBlueprint, moveSelectedGroup, placeArmedAt, saveBlueprint, selectedGroupDrag, turnSelectedGroup } from '../../../editor/editing/blueprint';
import { createAutosave, readRestorableAutosave } from '../../../io/storage/autosave';
import { restoreSession } from '../../../editor/session/restore';
import { buildSaveFile } from '../../../io/save/json-codec';
import { createDefaultRegistry } from '../../../rules';
import { groupBody, liveMembers, mapGroups, type PlacedGroup } from '../../../core/model/placed-group';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { turnBody, type BlueprintBody } from '../../../tools/blueprint';
import type { BlueprintRecord } from '../../../io/blueprint';
import { TerrainType } from '../_world';
import { blueprintEditor, open, ROAD, roads, scene, shift } from './_blueprints';

blueprintEditor();
const s = () => useEditorStore.getState();
afterEach(() => { localStorage.clear(); });

type Scene = ReturnType<typeof scene>;

/** The scene's sample saved and placed once beside it over two things in its way: a road where its
 *  left road lands, and ground a layer higher than its plateau under the plateau's far corner. */
async function placedOverObstacles(): Promise<{ sc: Scene; record: BlueprintRecord; inWay: string; high: MacroCoord }> {
  const sc = scene();
  const inWay = sc.w.place(ROAD, sc.free.x, sc.free.y + 4);
  if (!inWay.ok) throw new Error('road refused');
  const high = shift(sc.free, 2, 2);
  for (const e of [1, 2]) expect(sc.w.stroke([high], TerrainType.Mountain, e).ok).toBe(true);
  open(sc.w);
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(record);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  return { sc, record, inWay: inWay.id!, high };
}

/** The one group on the map. */
const theGroup = (state: GridState): PlacedGroup => {
  const groups = mapGroups(state);
  expect(groups).toHaveLength(1);
  return groups[0]!;
};

/** How many objects and terrain cells the one group holds. */
const holds = (state: GridState) => {
  const m = liveMembers(state, theGroup(state));
  return { objects: m.objects.length, cells: m.cells.length };
};

/** The map, the groups and the selection, as they stand. */
const look = (state: GridState) => ({
  objects: JSON.stringify([...state.objects.values()].sort((a, b) => a.id.localeCompare(b.id))),
  cells: JSON.stringify(state.cells),
  groups: JSON.stringify(state.groups ?? []),
  selection: JSON.stringify(s().selection),
});

/** `body` with its objects in reading order, which laying them does not keep. */
const inOrder = (body: BlueprintBody): BlueprintBody => ({ ...body, objects: [...body.objects].sort((a, b) => a.y - b.y || a.x - b.x) });

/** Selects the one group whole, as a click on it does in Blueprint mode. */
const selectGroup = (): void => {
  const state = s().gridState!;
  s().setSelection(groupRefs(state, theGroup(state)), { record: false });
};

spec('BLUE-07', 'a moved group lays again what its placement skipped, wherever it now fits, as one undo step', async () => {
  const { sc, inWay, high } = await placedOverObstacles();
  expect(holds(sc.w.state)).toEqual({ objects: 1, cells: 8 });
  const placed = look(sc.w.state);

  expect(moveSelectedGroup(shift(sc.free, 6, 0))).toBe(true);
  expect(holds(sc.w.state)).toEqual({ objects: 2, cells: 9 });
  expect(sc.w.terrainAt(shift(sc.free, 8, 2))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(roads(sc.w).filter((o) => o.position.y === sc.free.y + 4 && o.position.x >= sc.free.x + 6).map((o) => o.position.x).sort())
    .toEqual([sc.free.x + 6, sc.free.x + 7]);
  // What stood in its way stands as it was.
  expect(sc.w.state.objects.get(inWay)?.position).toEqual({ x: sc.free.x, y: sc.free.y + 4 });
  expect(sc.w.terrainAt(high)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  const moved = look(sc.w.state);

  sc.w.undo();
  expect(look(sc.w.state), 'undo gives the group back as it stood, its skips included').toEqual(placed);
  sc.w.redo();
  expect(look(sc.w.state)).toEqual(moved);
});

spec('BLUE-07', 'what the player took out of a group stays out when it moves, while what its placement skipped comes back', async () => {
  const { sc } = await placedOverObstacles();
  const [laid] = roads(sc.w).filter((o) => o.position.x === sc.free.x + 1);
  expect(sc.w.remove(laid!.id).ok).toBe(true);
  const corner = shift(sc.free, 0, 0);
  expect(sc.w.stroke([corner], TerrainType.Mountain, 2).ok).toBe(true);
  expect(holds(sc.w.state)).toEqual({ objects: 0, cells: 7 });
  selectGroup();
  const before = look(sc.w.state);

  expect(moveSelectedGroup(shift(sc.free, 6, 0))).toBe(true);
  // The skipped left road lands; the deleted right road and the repainted corner do not.
  expect(roads(sc.w).filter((o) => o.position.x >= sc.free.x + 6).map((o) => o.position)).toEqual([{ x: sc.free.x + 6, y: sc.free.y + 4 }]);
  expect(sc.w.terrainAt(shift(sc.free, 6, 0))).toBeNull();
  expect(sc.w.terrainAt(shift(sc.free, 8, 2))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(holds(sc.w.state)).toEqual({ objects: 1, cells: 8 });
  // Moved on again, it lays the same.
  expect(moveSelectedGroup(shift(sc.free, 12, 0))).toBe(true);
  expect(holds(sc.w.state)).toEqual({ objects: 1, cells: 8 });

  sc.w.undo();
  sc.w.undo();
  expect(look(sc.w.state)).toEqual(before);
});

spec('BLUE-07', 'a turned group keeps its blueprint: turned where it stands, then moved, it lays turned with what was skipped', async () => {
  const { sc, record } = await placedOverObstacles();
  const placed = look(sc.w.state);
  expect(turnSelectedGroup(1)).toBe(true);
  const turned = look(sc.w.state);
  expect(moveSelectedGroup(shift(sc.free, 8, 0))).toBe(true);
  const group = theGroup(sc.w.state);
  expect(group.frame).toMatchObject({ w: 5, h: 4 });
  expect(inOrder(groupBody(sc.w.state, group))).toEqual(inOrder(turnBody(record.body, 1)));
  const moved = look(sc.w.state);

  sc.w.undo();
  expect(look(sc.w.state)).toEqual(turned);
  sc.w.undo();
  expect(look(sc.w.state)).toEqual(placed);
  sc.w.redo();
  sc.w.redo();
  expect(look(sc.w.state)).toEqual(moved);
});

spec('BLUE-07', 'a Ctrl+drag copy of a group lays what the group would lay now: what was skipped, not what the player took out', async () => {
  const { sc } = await placedOverObstacles();
  const [laid] = roads(sc.w).filter((o) => o.position.x === sc.free.x + 1);
  expect(sc.w.remove(laid!.id).ok).toBe(true);
  selectGroup();
  const original = theGroup(sc.w.state);
  const before = look(sc.w.state);

  selectedGroupDrag.copy(shift(sc.free, 6, 0));
  const groups = mapGroups(sc.w.state);
  expect(groups).toHaveLength(2);
  const copy = liveMembers(sc.w.state, groups[1]!);
  expect({ objects: copy.objects.length, cells: copy.cells.length }).toEqual({ objects: 1, cells: 9 });
  expect(copy.objects[0]!.position).toEqual({ x: sc.free.x + 6, y: sc.free.y + 4 });
  expect(groups[0]).toEqual(original);

  sc.w.undo();
  expect(look(sc.w.state)).toEqual(before);
});

spec('BLUE-07', 'a map file and the autosave keep what a group still has to lay, and a group from an older file moves as before', async () => {
  const { sc } = await placedOverObstacles();
  const to = shift(sc.free, 6, 0);
  const file = buildSaveFile(sc.w.state);
  const json = JSON.stringify(file);

  // Reopened from its map file.
  s().loadMap(deserialize(json, sc.w.state.template), createDefaultRegistry());
  s().setEditMode({ mode: 'blueprint' });
  selectGroup();
  expect(moveSelectedGroup(to)).toBe(true);
  expect(holds(s().gridState!)).toEqual({ objects: 2, cells: 9 });

  // Resumed from the autosave.
  const autosave = createAutosave({ camera: () => undefined, history: () => undefined });
  autosave.schedule(sc.w.state);
  autosave.flush();
  const offer = readRestorableAutosave();
  if (!offer) throw new Error('no session offered');
  restoreSession(offer);
  s().setEditMode({ mode: 'blueprint' });
  expect(holds(s().gridState!)).toEqual({ objects: 1, cells: 8 });
  selectGroup();
  expect(moveSelectedGroup(to)).toBe(true);
  expect(holds(s().gridState!)).toEqual({ objects: 2, cells: 9 });

  // A file written before groups kept their blueprint: the group lays what it holds.
  const older = JSON.parse(json) as { groups: Record<string, unknown>[] };
  const written = Object.keys(older.groups[0]!);
  for (const g of older.groups) for (const key of Object.keys(g)) if (!['id', 'blueprint', 'name', 'origin', 'frame', 'base', 'objects', 'cells'].includes(key)) delete g[key];
  expect(written.length, 'the new file wrote more than an older one').toBeGreaterThan(8);
  s().loadMap(deserialize(JSON.stringify(older), sc.w.state.template), createDefaultRegistry());
  s().setEditMode({ mode: 'blueprint' });
  selectGroup();
  expect(moveSelectedGroup(to)).toBe(true);
  expect(holds(s().gridState!)).toEqual({ objects: 1, cells: 8 });
});

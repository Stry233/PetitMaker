// @vitest-environment jsdom
/** Placing a saved blueprint as a person does: armed from the library, laid at each press, turned
 *  with E, and what it skipped said once. */
import { expect } from 'vitest';
import { spec } from '../../_support/spec';
import { armBlueprint, carryBlueprint, moveSelectedGroup, placeArmedAt, saveBlueprint, selectedGroupDrag, watchArmedBlueprint } from '../../../editor/editing/blueprint';
import { ObjectDragSession } from '../../../tools/pointer/objects';
import { ToolManager } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import type { MapPoint } from '../../../core/grid/grids';
import { registerCarryTarget, type CarrySample } from '../../../view/interaction/pointer/carry';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { useEditorStore } from '../../../state/store';
import { selectedObjectIds, type BlockRef } from '../../../state/selection';
import { objectRect } from '../../../state/object-geometry';
import { deleteSelection, rotateObjectTo, rotateSelection } from '../../../editor/editing/group-edit';
import { translate } from '../../../i18n/context';
import { setStoreState } from '../../_support/store';
import { rect, TerrainType, world } from '../_world';
import { open, roads, scene, shift, blueprintEditor } from './_blueprints';
import type { BlueprintRecord } from '../../../io/blueprint';

const editor = blueprintEditor();
const s = () => useEditorStore.getState();
const key = (id: string) => COMMAND_BY_ID.get(id)!.run({ toggleMenu: () => {} } as unknown as CommandContext);

async function saved(sc: ReturnType<typeof scene>): Promise<BlueprintRecord> {
  open(sc.w);
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(`refused: ${record}`);
  return record;
}

/** What a placement laid, as the selection holds it: its objects, then its terrain cells. */
const laidRefs = (sel: readonly BlockRef[]) => ({
  objects: sel.filter((r) => r.kind === 'object').length,
  cells: sel.filter((r) => r.kind === 'terrain').length,
});

spec('BLUE-06', 'a press places once, then nothing is armed and the placement is selected', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  expect(s().blueprint.armed).toBe(record.id);

  expect(placeArmedAt(sc.free)).toEqual({ ground: 0, objects: 0, capped: 0, unknown: 0 });
  expect(roads(sc.w)).toHaveLength(4);
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(editor.toasts()).toEqual([]);
  // The blueprint tool rests: nothing armed, no body for a ghost.
  expect(s().blueprint).toMatchObject({ armed: null, body: null });
  // Its two roads and the nine plateau cells it laid are the selection, in every input mode.
  expect(laidRefs(s().selection)).toEqual({ objects: 2, cells: 9 });
  // A second press places nothing more.
  const before = sc.w.fingerprint();
  expect(placeArmedAt(shift(sc.free, 6, 0))).toBeNull();
  expect(sc.w.fingerprint()).toBe(before);

  // Armed again and pressed where it already stands, nothing new fits and one toast says so.
  armBlueprint(record.id);
  const skips = placeArmedAt(sc.free)!;
  expect(skips.ground + skips.objects).toBeGreaterThan(0);
  expect(sc.w.fingerprint()).toBe(before);
  expect(editor.toasts()).toHaveLength(1);
  expect(editor.toasts()[0]).toMatch(/did not place/);

  // One placement is one undo step.
  sc.w.undo();
  expect(roads(sc.w)).toHaveLength(2);
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toBeNull();
});

spec('BLUE-06', 'the selected placement turns a quarter about its centre as one undo step', async () => {
  const sc = scene();
  const record = await saved(sc);
  const untouched = sc.w.fingerprint();
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const placed = sc.w.fingerprint();
  const before = new Set(sc.w.state.objects.keys());
  rotateSelection(90);
  // The 4 by 5 frame turns into 5 by 4 about the same centre: the road row now runs down its left side.
  const laid = roads(sc.w).filter((o) => o.position.x >= sc.free.x - 1);
  expect(laid).toHaveLength(2);
  expect(laid[0]!.position.x).toBe(laid[1]!.position.x);
  expect(laid.every((o) => before.has(o.id))).toBe(false);
  expect(laidRefs(s().selection)).toEqual({ objects: 2, cells: 9 });
  // The turn is a step of its own: one undo gives back the placement as placed, a second takes it back.
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(placed);
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(untouched);
});

spec('BLUE-06', 'deleting the selected placement removes exactly what it laid, as an edit undo brings back', async () => {
  const sc = scene();
  const record = await saved(sc);
  const untouched = sc.w.fingerprint();
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const placed = sc.w.fingerprint();
  deleteSelection(translate, selectedObjectIds(s().selection));
  expect(sc.w.fingerprint()).toBe(untouched);
  expect(s().selection).toEqual([]);
  // Undo brings the placement back and redo deletes it again, as for any deleted selection.
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(placed);
  sc.w.redo();
  expect(sc.w.fingerprint()).toBe(untouched);
});

spec('BLUE-06', 'dragging the selected placement moves it whole, terrain and objects, as one undo step', async () => {
  const sc = scene();
  const record = await saved(sc);
  const untouched = sc.w.fingerprint();
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const placed = sc.w.fingerprint();
  const road = roads(sc.w).find((o) => o.position.x >= sc.free.x)!;
  const ghosts: unknown[] = [];
  const view = {
    overlay: { showGhost: () => { ghosts.push('wash'); }, showObjectMove: () => { ghosts.push('objects'); }, showGroupPlacementGhost: () => { ghosts.push('placement'); } },
    plopObject: () => {},
  };
  // The drag reaches the placement through the editor's tool wiring, as the map's object drag does.
  const tools = new ToolManager(null, s().commandExecutor!, s().gridState!, editorToolWiring());
  const session = new ObjectDragSession({
    state: () => s().gridState, executor: () => s().commandExecutor, selection: () => s().selection,
    setSelection: (blocks) => s().setSelection(blocks, { record: false }), report: () => {}, notify: () => {}, t: translate,
    placementDrag: () => tools.getContext().placementDrag ?? null,
  });
  const at = (c: { x: number; y: number }) => ({ x: c.x + 0.5, y: c.y + 0.5 }) as MapPoint;
  expect(session.begin(road.id, at(road.position), road.position)).toBe(true);
  const to = shift(road.position, 6, 0);
  session.preview(view, at(to));
  // The ghost is the placement's own preview, not the objects lifted off their ground.
  expect(ghosts).toContain('placement');
  expect(ghosts).not.toContain('objects');
  session.commit(view, at(to));
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toBeNull();
  expect(sc.w.terrainAt(shift(sc.free, 7, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(roads(sc.w)).toHaveLength(4);
  expect(laidRefs(s().selection)).toEqual({ objects: 2, cells: 9 });
  // The move is a step of its own: one undo gives back the placement where it was placed, a second takes it back.
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(placed);
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(untouched);
});

spec('BLUE-07', 'after a later edit elsewhere the card still turns the placement whole, as a step of its own that keeps that edit', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const tree = sc.w.place('tree-apple', sc.free.x + 12, sc.free.y);
  expect(tree.ok).toBe(true);
  const withTree = sc.w.fingerprint();
  rotateSelection(90);
  // The tree still stands, and the turned placement is still the selection, whole.
  expect([...sc.w.state.objects.values()].some((o) => o.catalogId === 'tree-apple')).toBe(true);
  expect(laidRefs(s().selection)).toEqual({ objects: 2, cells: 9 });
  expect(sc.w.fingerprint()).not.toBe(withTree);
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(withTree);
});

spec('BLUE-08', 'lands on bare ground with its lowest ground on the ground', async () => {
  const sc = scene();
  const record = await saved(sc);
  // The layer panel names no base: showing layer 3 still lands the blueprint on the ground it covers.
  useEditorStore.getState().setDisplayLayer(3);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  expect(sc.w.terrainAt(shift(sc.free, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(sc.w.terrainAt(shift(sc.free, 3, 2))).toBeNull();
  expect(roads(sc.w).filter((o) => o.position.x >= sc.free.x).map((o) => o.elevation)).toEqual([0, 0]);
});

spec('BLUE-08', 'stacks its rises on the surface it is dropped on and never lowers what is there', async () => {
  const sc = scene();
  const record = await saved(sc);
  const at = sc.free;
  // A plain one layer up under the whole footprint, a taller block where the plateau goes, and one
  // where the blueprint holds only ground.
  const plain = rect(shift(at, -1, -1), 7, 8);
  sc.w.stroke(plain, TerrainType.Mountain, 1);
  for (const e of [2, 3]) sc.w.stroke([shift(at, 1, 1)], TerrainType.Mountain, e);
  sc.w.stroke([shift(at, 3, 1)], TerrainType.Mountain, 2);
  const tall = sc.w.terrainAt(shift(at, 1, 1));
  const aside = sc.w.terrainAt(shift(at, 3, 1));
  armBlueprint(record.id);
  placeArmedAt(at);
  expect(sc.w.terrainAt(shift(at, 1, 1))).toEqual(tall);
  expect(sc.w.terrainAt(shift(at, 3, 1))).toEqual(aside);
  expect(sc.w.terrainAt(at)).toEqual({ type: TerrainType.Mountain, elevation: 2 });
  expect(sc.w.terrainAt(shift(at, 3, 2))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(roads(sc.w).filter((o) => o.position.x >= at.x).map((o) => o.elevation)).toEqual([1, 1]);
});

spec('BLUE-08', 'a pond dropped on a plain turns its uncut blocks into water at the plain\'s height', async () => {
  const w = world();
  const g = w.openGround(20, 10);
  w.stroke(rect(shift(g, 2, 2), 2, 2), TerrainType.Water, 0);
  const record = await saved({ w, frame: { x: g.x, y: g.y, w: 5, h: 5 }, free: g });
  const at = shift(g, 10, 1);
  w.stroke(rect(shift(at, -1, -1), 8, 8), TerrainType.Mountain, 1);
  // A tree on one block the pond covers: that block stays as it is.
  const tree = w.place('tree-apple', at.x + 3, at.y + 2);
  expect(tree.ok).toBe(true);
  armBlueprint(record.id);
  placeArmedAt(at);
  expect(w.terrainAt(shift(at, 2, 2))).toMatchObject({ type: TerrainType.Water, elevation: 1 });
  expect(w.terrainAt(shift(at, 2, 3))).toMatchObject({ type: TerrainType.Water, elevation: 1 });
  expect(w.terrainAt(shift(at, 3, 2))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  expect(w.terrainAt(shift(at, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
});

spec('BLUE-09', 'E turns the armed blueprint a quarter', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  key('selection.rotate_cw');
  expect(s().blueprint.quarters).toBe(1);
  key('selection.rotate_ccw');
  key('selection.rotate_ccw');
  expect(s().blueprint.quarters).toBe(3);
  key('selection.rotate_cw');

  // A quarter turn lays the road row, below the plateau, down the left side instead.
  key('selection.rotate_cw');
  const before = new Set(roads(sc.w).map((o) => o.id));
  placeArmedAt(sc.free);
  const laid = roads(sc.w).filter((o) => !before.has(o.id));
  expect(laid).toHaveLength(2);
  expect(laid[0]!.position.x).toBe(laid[1]!.position.x);
  expect(laid[0]!.position.x).toBe(sc.free.x);
});

spec('BLUE-09', 'under touch the placement is selected too, and E then turns the placement, not an armed blueprint', async () => {
  const sc = scene();
  const record = await saved(sc);
  setStoreState({ inputMode: 'touch' });
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  expect(laidRefs(s().selection)).toEqual({ objects: 2, cells: 9 });
  const before = new Set(sc.w.state.objects.keys());
  key('selection.rotate_cw');
  expect(s().blueprint.quarters).toBe(0);
  expect(roads(sc.w).some((o) => !before.has(o.id))).toBe(true);
});

spec('BLUE-09', 'arming a blueprint clears the placement selected before it, so E turns the armed blueprint and the placement stays', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  expect(laidRefs(s().selection)).toEqual({ objects: 2, cells: 9 });
  armBlueprint(record.id);
  expect(s().selection).toEqual([]);
  const before = sc.w.fingerprint();
  key('selection.rotate_cw');
  expect(s().blueprint.quarters).toBe(1);
  expect(sc.w.fingerprint()).toBe(before);
});

spec('BLUE-09', 'coming back to Blueprint mode with a blueprint armed clears a selection made elsewhere, so E turns the blueprint', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  s().setEditMode({ mode: null });
  const road = roads(sc.w)[0]!;
  s().setSelection([{ kind: 'object', id: road.id }]);
  s().setEditMode({ mode: 'blueprint' });
  expect(s().blueprint.armed).toBe(record.id);
  expect(s().selection).toEqual([]);
  key('selection.rotate_cw');
  expect(s().blueprint.quarters).toBe(1);
  expect(sc.w.object(road.id)?.rotation).toBe(road.rotation);
});

spec('BLUE-09', 'a carried blueprint takes E from the placement selected before it, and a carry that never lands gives the selection back', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const placed = s().selection;
  const before = sc.w.fingerprint();
  const carry = carryBlueprint(record.id, { pointerId: 4, surface: null, onEnd: () => {} })!;
  expect(s().selection).toEqual([]);
  key('selection.rotate_cw');
  expect(s().blueprint.quarters).toBe(1);
  carry.cancel();
  expect(s().blueprint.armed).toBeNull();
  expect(s().selection).toEqual(placed);
  expect(sc.w.fingerprint()).toBe(before);
});

spec('BLUE-09', 'carrying the blueprint already armed clears a selection made under it and gives it back when the carry never lands', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  const sel = [{ kind: 'object', id: roads(sc.w)[0]!.id }] as const;
  s().setSelection([...sel]);
  const carry = carryBlueprint(record.id, { pointerId: 4, surface: null, onEnd: () => {} })!;
  expect(s().selection).toEqual([]);
  carry.cancel();
  expect(s().blueprint.armed).toBe(record.id);
  expect(s().selection).toEqual(sel);
});

spec('BLUE-06', 'a Help figure\'s world places from its own library and says what it skipped', async () => {
  const sc = scene();
  const record = await sc.w.sandbox.saveBlueprint(sc.frame, 'Terrace', { author: 'Mei' });
  if (typeof record === 'string') throw new Error(`refused: ${record}`);
  expect(sc.w.sandbox.blueprints().map((r) => r.id)).toEqual([record.id]);
  expect(editor.lib().records()).toEqual([]);

  expect(sc.w.sandbox.placeBlueprint(record.id, sc.free)).toEqual({ ground: 0, objects: 0, capped: 0, unknown: 0 });
  expect(sc.w.sandbox.notice).toBeNull();
  sc.w.sandbox.placeBlueprint(record.id, sc.free);
  expect(sc.w.sandbox.notice?.key).toMatch(/^blueprint\.skipped_/);
});

spec('BLUE-06', 'a deleted blueprint disarms and a press places nothing', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  await editor.lib().remove([record.id]);
  const before = sc.w.fingerprint();
  expect(placeArmedAt(sc.free)).toBeNull();
  expect(sc.w.fingerprint()).toBe(before);
  expect(s().blueprint.armed).toBeNull();

  const again = await saved(sc);
  const stop = watchArmedBlueprint();
  try {
    armBlueprint(again.id);
    await editor.lib().remove([again.id]);
    expect(s().blueprint).toMatchObject({ armed: null, body: null });
  } finally { stop(); }
});

spec('BLUE-06', 'a blueprint carried from its card and dropped on the map places once and leaves nothing armed', async () => {
  const sc = scene();
  const record = await saved(sc);
  // The map under the pointer: its drop is one press of the armed tool there, as the map view's is.
  const stop = registerCarryTarget({
    over: () => true, hover: () => {}, leave: () => {}, settle: () => {},
    drop: () => { placeArmedAt(sc.free); },
  });
  try {
    const at: CarrySample = { pointerId: 4, pointerType: 'mouse', clientX: 300, clientY: 300, timeStamp: 0 };
    const carry = carryBlueprint(record.id, { pointerId: 4, surface: null, onEnd: () => {} })!;
    expect(s().blueprint.armed).toBe(record.id);
    carry.move(at);
    carry.release(at);
  } finally { stop(); }
  expect(roads(sc.w)).toHaveLength(4);
  expect(s().blueprint).toMatchObject({ armed: null, body: null });
  expect(laidRefs(s().selection)).toEqual({ objects: 2, cells: 9 });
  // A press on the map afterwards places nothing more.
  const before = sc.w.fingerprint();
  expect(placeArmedAt(shift(sc.free, 6, 0))).toBeNull();
  expect(sc.w.fingerprint()).toBe(before);
});

spec('BLUE-06', 'an edit to a placed object ends the placement: Delete then deletes the selection and keeps that edit', async () => {
  const sc = scene();
  // A blueprint of one road on bare ground.
  open(sc.w);
  const record = await saveBlueprint({ frame: objectRect(roads(sc.w)[0]!), name: 'Tile', author: null, folder: null });
  if (typeof record === 'string') throw new Error(record);
  const at = shift(sc.free, 0, 7);
  armBlueprint(record.id);
  placeArmedAt(at);
  const placed = selectedObjectIds(s().selection);
  expect(placed).toHaveLength(1);
  rotateObjectTo(sc.w.state.objects.get(placed[0]!)!, 90);
  const faced = sc.w.state.objects.get(placed[0]!)!;
  expect(faced.rotation).toBe(90);
  const afterFace = sc.w.fingerprint();
  // Delete removes the faced road as an ordinary selection, and its undo brings the faced road back.
  deleteSelection(translate, placed);
  expect(sc.w.state.objects.has(placed[0]!)).toBe(false);
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(afterFace);
  // Rotate after the edit turns the road alone and lays no second copy.
  s().setSelection([{ kind: 'object', id: placed[0]! }], { record: false });
  const count = sc.w.state.objects.size;
  rotateSelection(90);
  expect(sc.w.state.objects.size).toBe(count);
});

spec('BLUE-06', 'a move where nothing of the placement would land is refused and the placement stays', async () => {
  const sc = scene();
  const record = await saved(sc);
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const placed = sc.w.fingerprint();
  const held = s().selection;
  // Onto the sample it was saved from, everything it holds is already there.
  expect(moveSelectedGroup({ x: sc.frame.x, y: sc.frame.y })).toBe(false);
  expect(sc.w.fingerprint()).toBe(placed);
  expect(s().selection).toEqual(held);
  expect(editor.toasts().length).toBeGreaterThan(0);
  // Still held: it moves whole where it fits.
  expect(moveSelectedGroup(shift(sc.free, 6, 0))).toBe(true);
  expect(sc.w.terrainAt(shift(sc.free, 7, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
});

spec('BLUE-06', 'a drag from a laid terrain cell moves the whole placement too', async () => {
  const sc = scene();
  const record = await saved(sc);
  const untouched = sc.w.fingerprint();
  armBlueprint(record.id);
  placeArmedAt(sc.free);
  const placed = sc.w.fingerprint();
  const session = new ObjectDragSession({
    state: () => s().gridState, executor: () => s().commandExecutor, selection: () => s().selection,
    setSelection: (blocks) => s().setSelection(blocks, { record: false }), report: () => {}, notify: () => {}, t: translate,
    placementDrag: () => selectedGroupDrag,
  });
  const view = { overlay: { showGhost: () => {}, showObjectMove: () => {}, showGroupPlacementGhost: () => {} }, plopObject: () => {} };
  const at = (c: { x: number; y: number }) => ({ x: c.x + 0.5, y: c.y + 0.5 }) as MapPoint;
  // The plateau's middle: laid terrain, no object on it.
  const cell = shift(sc.free, 1, 1);
  expect(session.beginPlacement(at(cell), cell)).toBe(true);
  session.commit(view, at(shift(cell, 6, 0)));
  expect(sc.w.terrainAt(cell)).toBeNull();
  expect(sc.w.terrainAt(shift(cell, 6, 0))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(placed);
  sc.w.undo();
  expect(sc.w.fingerprint()).toBe(untouched);
});

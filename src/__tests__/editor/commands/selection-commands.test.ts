/**
 * The commands of the selection card, the map's menu and the note verb row over the live store:
 * each does what its control does and refuses where its target does not offer it.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { listCommands, runCommand } from '../../../editor/commands/run';
import { placeObjectCommand, paintTerrainCommand } from '../../../core/model/command-build';
import type { ZoneNote } from '../../../core/model/annotations';
import { TerrainType, type PlacedObject } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { getCatalogItem } from '../../../state/catalog';
import { armedItemOf } from '../../../state/editing/edit-mode';
import { selectedObjectIds } from '../../../state/selection';
import { useEditorStore } from '../../../state/store';
import { candidateObject } from '../../../tools/objects';
import { makeTemplate } from '../../_support/map-state';
import { resetStore } from '../../_support/store';

const HOUSE = 'building-myhouse';
const TREE = 'tree-apple';
const ROSE = 'flower-rose';

const s = () => useEditorStore.getState();
const current = (id: string) => listCommands().find((command) => command.id === id)?.current;
const object = (id: string): PlacedObject => s().gridState!.objects.get(id)!;
const select = (...ids: string[]): void => s().setSelection(ids.map((id) => ({ kind: 'object', id }) as const));
const terrainAt = (x: number, y: number) => s().gridState!.cells[y]![x]!.terrain;

/** `item` placed with its top-left on (x, y), through the map's rules. */
function place(id: string, item: string, x: number, y: number): void {
  const placed = candidateObject(getCatalogItem(item)!, { x, y }, 0, s().gridState!, { id });
  expect(s().commandExecutor!.execute(placeObjectCommand(placed)).success, `${item} at ${x},${y}`).toBe(true);
}

beforeEach(() => {
  resetStore();
  s().initMap(makeTemplate(40, 40), createDefaultRegistry());
});

describe('selection.face', () => {
  it('turns the one selected object to the angle, as one undo step, and reads its facing back', async () => {
    place('house', HOUSE, 10, 10);
    select('house');
    expect(current('selection.face')).toBe('0');
    expect(await runCommand('selection.face', { angle: '180' })).toMatchObject({ ok: true });
    expect(object('house').rotation).toBe(180);
    expect(current('selection.face')).toBe('180');
    s().commandExecutor!.undo();
    expect(object('house').rotation).toBe(0);
  });

  it('turns the object named, whatever is selected, as the map menu\'s facings do', async () => {
    place('house', HOUSE, 10, 10);
    place('tree', TREE, 30, 30);
    select('tree');
    expect(await runCommand('selection.face', { angle: '90', object: 'house' })).toMatchObject({ ok: true });
    expect(object('house').rotation).toBe(90);
    expect(selectedObjectIds(s().selection), 'the selection stays').toEqual(['tree']);
  });

  it('refuses where no facing is offered: nothing or several selected, an item that does not turn, an unknown object or angle', async () => {
    place('house', HOUSE, 10, 10);
    place('tree', TREE, 30, 30);
    expect(current('selection.face')).toBe('none');
    expect(await runCommand('selection.face', { angle: '90' })).toMatchObject({ ok: false });
    select('house', 'tree');
    expect(await runCommand('selection.face', { angle: '90' })).toMatchObject({ ok: false });
    select('tree');
    expect(current('selection.face')).toBe('none');
    expect(await runCommand('selection.face', { angle: '90' })).toMatchObject({ ok: false });
    expect(await runCommand('selection.face', { angle: '90', object: 'tree' })).toMatchObject({ ok: false, reason: expect.stringContaining('does not turn') });
    expect(await runCommand('selection.face', { angle: '90', object: 'gone' })).toMatchObject({ ok: false, reason: expect.stringContaining('No object') });
    expect(await runCommand('selection.face', { angle: '45', object: 'house' })).toMatchObject({ ok: false });
    expect(object('house').rotation).toBe(0);
    expect(object('tree').rotation).toBe(0);
  });
});

describe('selection.pick', () => {
  it('arms the selected object\'s item and puts the selection down', async () => {
    place('tree', TREE, 12, 12);
    select('tree');
    expect(await runCommand('selection.pick')).toMatchObject({ ok: true });
    expect(armedItemOf(s())).toBe(TREE);
    expect(s().selection).toEqual([]);
  });

  it('arms the item of the object named, as Pick in a finger\'s menu does', async () => {
    place('tree', TREE, 12, 12);
    expect(await runCommand('selection.pick', { object: 'tree' })).toMatchObject({ ok: true });
    expect(armedItemOf(s())).toBe(TREE);
  });

  it('refuses with nothing or several selected, and an object that is not there', async () => {
    place('tree', TREE, 12, 12);
    place('rose', ROSE, 20, 12);
    expect(await runCommand('selection.pick')).toMatchObject({ ok: false });
    select('tree', 'rose');
    expect(await runCommand('selection.pick')).toMatchObject({ ok: false });
    expect(await runCommand('selection.pick', { object: 'gone' })).toMatchObject({ ok: false });
    expect(armedItemOf(s())).toBeNull();
    expect(selectedObjectIds(s().selection)).toEqual(['tree', 'rose']);
  });
});

describe('selection.save_blueprint', () => {
  it('opens Blueprint mode on the frame step around the selected objects', async () => {
    place('tree', TREE, 12, 12);
    place('rose', ROSE, 15, 13);
    select('tree', 'rose');
    expect(await runCommand('selection.save_blueprint')).toMatchObject({ ok: true });
    expect(s().editMode.mode).toBe('blueprint');
    expect(s().blueprintStep.at).toBe('frame');
  });

  it('refuses with no object selected', async () => {
    expect(await runCommand('selection.save_blueprint')).toMatchObject({ ok: false });
    expect(s().editMode.mode).not.toBe('blueprint');
  });
});

describe('selection.narrow', () => {
  it('keeps only the selected objects of one item, as one selection step', async () => {
    place('tree', TREE, 12, 12);
    place('rose-a', ROSE, 15, 13);
    place('rose-b', ROSE, 17, 13);
    select('tree', 'rose-a', 'rose-b');
    expect(await runCommand('selection.narrow', { item: ROSE })).toMatchObject({ ok: true });
    expect(selectedObjectIds(s().selection)).toEqual(['rose-a', 'rose-b']);
    s().commandExecutor!.undo();
    expect(selectedObjectIds(s().selection)).toEqual(['tree', 'rose-a', 'rose-b']);
  });

  it('refuses an item the selection does not hold, and a selection of one', async () => {
    place('tree', TREE, 12, 12);
    place('rose', ROSE, 15, 13);
    select('tree', 'rose');
    expect(await runCommand('selection.narrow', { item: HOUSE })).toMatchObject({ ok: false });
    expect(selectedObjectIds(s().selection)).toEqual(['tree', 'rose']);
    select('tree');
    expect(await runCommand('selection.narrow', { item: TREE })).toMatchObject({ ok: false });
  });
});

describe('the note commands', () => {
  const notes = () => s().gridState!.annotations!.items;
  const zone = (id: string, x: number): ZoneNote => ({ kind: 'zone', id, color: '#FFB347', cells: [{ x, y: 4 }], tag: null, num: x });
  beforeEach(() => {
    s().setEditMode({ mode: 'annotate' });
    s().addAnnotation(zone('a', 2));
    s().addAnnotation(zone('b', 6));
    s().addAnnotation({ kind: 'measure', id: 'm', color: '#FFB347', points: [{ x: 2, y: 8 }, { x: 8, y: 8 }] });
  });

  it('[EDIT-81] notes.merge folds the selected zones into the first picked, leaving other selected notes as they are', async () => {
    s().setAnnotationSelection(['b', 'm', 'a']);
    const lane = s().annotationUndoLane.length;
    expect(await runCommand('notes.merge')).toMatchObject({ ok: true });
    expect(notes().map((n) => n.id).sort()).toEqual(['b', 'm']);
    expect(notes().find((n) => n.id === 'b')).toMatchObject({ cells: [{ x: 6, y: 4 }, { x: 2, y: 4 }] });
    expect(s().annotationSelection).toEqual(['b']);
    expect(s().annotationUndoLane.length).toBe(lane + 1);
  });

  it('notes.merge refuses under two zones and on a locked layer', async () => {
    s().setAnnotationSelection(['a', 'm']);
    expect(await runCommand('notes.merge')).toMatchObject({ ok: false });
    s().setAnnotationSelection(['a', 'b']);
    s().setAnnotationsLocked(true);
    expect(await runCommand('notes.merge')).toMatchObject({ ok: false, reason: expect.stringContaining('locked') });
    expect(notes()).toHaveLength(3);
  });

  it('[EDIT-81] notes.flip draws each selected measurement on its other side, leaving other selected notes as they are', async () => {
    s().setAnnotationSelection(['a', 'm']);
    expect(await runCommand('notes.flip')).toMatchObject({ ok: true });
    expect(notes().find((n) => n.id === 'm')).toMatchObject({ flipped: true });
    expect(await runCommand('notes.flip')).toMatchObject({ ok: true });
    expect(notes().find((n) => n.id === 'm')).toMatchObject({ flipped: false });
  });

  it('notes.flip refuses with no measurement selected, with nothing selected and on a locked layer', async () => {
    expect(await runCommand('notes.flip')).toMatchObject({ ok: false });
    s().setAnnotationSelection(['a', 'b']);
    expect(await runCommand('notes.flip')).toMatchObject({ ok: false });
    s().setAnnotationSelection(['m']);
    s().setAnnotationsLocked(true);
    expect(await runCommand('notes.flip')).toMatchObject({ ok: false, reason: expect.stringContaining('locked') });
    expect(notes().find((n) => n.id === 'm')).not.toHaveProperty('flipped', true);
  });
});

describe('terrain.peel', () => {
  it('peels one layer off the cell as one undo step and empties the selection', async () => {
    for (const layer of [1, 2]) expect(s().commandExecutor!.execute(paintTerrainCommand([{ x: 5, y: 5 }], TerrainType.Mountain, layer)).success).toBe(true);
    s().setSelection([{ kind: 'terrain', x: 5, y: 5 }]);
    expect(await runCommand('terrain.peel', { x: 5, y: 5 })).toMatchObject({ ok: true });
    expect(terrainAt(5, 5)).toMatchObject({ elevation: 1 });
    expect(s().selection).toEqual([]);
    s().commandExecutor!.undo();
    expect(terrainAt(5, 5)).toMatchObject({ elevation: 2 });
  });

  it('refuses bare ground, a cell off the map and a coordinate that is no cell', async () => {
    const depth = s().commandExecutor!.historyDepth();
    expect(await runCommand('terrain.peel', { x: 5, y: 5 })).toMatchObject({ ok: false });
    expect(await runCommand('terrain.peel', { x: 200, y: 5 })).toMatchObject({ ok: false });
    expect(await runCommand('terrain.peel', { x: 5.5, y: 5 })).toMatchObject({ ok: false });
    expect(await runCommand('terrain.peel', { x: 5 })).toMatchObject({ ok: false });
    expect(s().commandExecutor!.historyDepth()).toBe(depth);
  });
});

describe('selection.paste at a cell', () => {
  it('places one copy with its top-left on the cell and selects it, as the map menu\'s Paste does', async () => {
    place('rose-a', ROSE, 10, 10);
    place('rose-b', ROSE, 12, 10);
    select('rose-a', 'rose-b');
    expect(await runCommand('selection.copy')).toMatchObject({ ok: true });
    expect(await runCommand('selection.paste', { x: 20, y: 24 })).toMatchObject({ ok: true });
    const copies = [...s().gridState!.objects.values()].filter((o) => o.position.y === 24);
    expect(copies.map((o) => o.position.x).sort((a, b) => a - b)).toEqual([20, 22]);
    expect(selectedObjectIds(s().selection).sort()).toEqual(copies.map((o) => o.id).sort());
  });

  it('refuses with nothing copied, and one coordinate without the other', async () => {
    expect(await runCommand('selection.paste', { x: 20, y: 24 })).toMatchObject({ ok: false, reason: expect.stringContaining('Nothing is copied') });
    expect(await runCommand('selection.paste', { x: 20 })).toMatchObject({ ok: false });
    expect(s().gridState!.objects.size).toBe(0);
  });
});

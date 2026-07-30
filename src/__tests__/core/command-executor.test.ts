import { describe, it, expect, vi } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { RuleRegistry } from '../../rules/registry';
import { createDefaultRegistry } from '../../rules/index';
import {
  CellZone, CommandType, ObjectCategory, TerrainType,
  type Corners, type EditorEvents, type EraseTerrainCommand, type PaintTerrainCommand, type PlaceObjectCommand,
  type PlacedObject, type RemoveObjectCommand, type TrimCornersCommand,
} from '../../core/model/types';
import { getCatalogItem } from '../../state/catalog';
import { planObjectRotation } from '../../tools/objects/object-placer';
import { createDefaultTerrainCell } from '../../core/model/grid-model';
import { makeState, setTerrain } from '../rules/_helpers';

function setup() {
  const state = makeState(10, 10);
  const eventBus = new EventBus<EditorEvents>();
  const registry = new RuleRegistry();
  const executor = new CommandExecutor(state, eventBus, registry);
  return { state, eventBus, registry, executor };
}

function paintMountain(x: number, y: number, elev: number): PaintTerrainCommand {
  return {
    type: CommandType.PaintTerrain, timestamp: 0,
    cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: elev,
  };
}

describe('CommandExecutor', () => {
  it('applies a valid command and emits cells-changed', () => {
    const { executor, state, eventBus } = setup();
    const spy = vi.fn();
    eventBus.on('cells-changed', spy);

    const result = executor.execute(paintMountain(5, 5, 1));
    expect(result.success).toBe(true);
    expect(state.cells[5]![5]!.terrain?.elevation).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it('rejects command when pre-command rule fails', () => {
    const { executor, registry, eventBus } = setup();
    registry.register({
      id: 'blocker', phase: 'pre-command', appliesTo: [CommandType.PaintTerrain],
      validate: () => [{ ruleId: 'blocker', message: 'no', cells: [], severity: 'error' }],
    });
    const spy = vi.fn();
    eventBus.on('validation-failed', spy);

    const result = executor.execute(paintMountain(5, 5, 1));
    expect(result.success).toBe(false);
    expect(spy).toHaveBeenCalled();
  });

  it('undo restores previous state', () => {
    const { executor, state } = setup();
    executor.execute(paintMountain(5, 5, 1));
    expect(state.cells[5]![5]!.terrain?.elevation).toBe(1);

    executor.undo();
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });

  it('redo restores undone state', () => {
    const { executor, state } = setup();
    executor.execute(paintMountain(5, 5, 1));
    executor.undo();
    executor.redo();
    expect(state.cells[5]![5]!.terrain?.elevation).toBe(1);
  });

  it('commitStroke auto-reverts when post-stroke rule fails', () => {
    const { executor, registry, state } = setup();
    registry.register({
      id: 'post-blocker', phase: 'post-stroke',
      validate: (s) => {
        const cell = s.cells[5]?.[5];
        if (cell?.terrain?.elevation === 1) {
          return [{ ruleId: 'post-blocker', message: 'bad', cells: [{ x: 5, y: 5 }], severity: 'error' }];
        }
        return [];
      },
    });

    const startSize = executor.getUndoStackSize();
    executor.execute(paintMountain(5, 5, 1));
    const violations = executor.commitStroke(startSize);

    expect(violations.length).toBeGreaterThan(0);
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });
});

describe('commitStroke — cut reconciliation', () => {
  it('squares a stale terrain cut after a neighbour paint commits', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    state.cells[5]![5]!.terrain!.corners = ['square', 'square', 'square', 'fan'] as Corners; // BR cut
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());

    const start = executor.getUndoStackSize();
    executor.execute({
      type: CommandType.PaintTerrain, timestamp: 0,
      cells: [{ x: 6, y: 5 }], terrainType: TerrainType.Mountain, elevation: 1,
    });
    executor.commitStroke(start);

    // The painted neighbour locks (5,5)'s BR corner; reconciliation squares it.
    expect(state.cells[5]![5]!.terrain!.corners).toBeUndefined();
    // The paint + its reconcile fold into ONE atomic undo entry — never separate steps.
    expect(executor.getUndoStackSize()).toBe(start + 1);

    // ONE undo reverts the paint AND its reconcile together: the original cut returns and the paint is gone.
    // (A separate reconcile step would let undo restore the cut while the locking neighbour stayed — an
    // illegal locked-but-cut corner.)
    executor.undo();
    expect(state.cells[5]![5]!.terrain!.corners).toEqual(['square', 'square', 'square', 'fan']);
    expect(state.cells[5]![6]?.terrain ?? null).toBeNull();
  });

  it('undo of an erase that triggered a patch-removal reconcile restores the original — no orphan fillet', () => {
    const state = makeState(10, 10);
    // an L of mountain@1 wrapping a Γ-patch fillet at (6,6)
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    const patch = createDefaultTerrainCell(TerrainType.Mountain, 1);
    patch.patchOnly = true;
    patch.corners = ['fan', 'empty', 'empty', 'empty'];
    state.cells[6]![6]!.terrain = patch;
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());

    const start = executor.getUndoStackSize();
    // erase a wrapping mountain → the patch's concave context breaks → reconcile removes the fillet
    executor.execute({ type: CommandType.EraseTerrain, timestamp: 0, cells: [{ x: 5, y: 5 }] } as EraseTerrainCommand);
    executor.commitStroke(start);
    expect(state.cells[6]![6]!.terrain, 'reconcile removed the now-unsupported fillet').toBeNull();
    expect(executor.getUndoStackSize(), 'erase + reconcile folded into one entry').toBe(start + 1);

    // ONE undo restores BOTH the erased wrap and the removed fillet — never the fillet alone (an orphan).
    executor.undo();
    expect(state.cells[5]![5]!.terrain?.type, 'wrapping mountain restored').toBe(TerrainType.Mountain);
    expect(state.cells[6]![6]!.terrain?.patchOnly, 'fillet restored (with its support), not orphaned').toBe(true);
  });
});

describe('undo/redo — objects map', () => {
  function placeRoad(executor: CommandExecutor, x: number, y: number): PlacedObject {
    const obj: PlacedObject = {
      id: `r-${x}-${y}`, catalogId: 'road-dirt',
      position: { x, y }, rotation: 0, category: ObjectCategory.Facility, elevation: 0,
    };
    const item = getCatalogItem('road-dirt');
    const res = executor.execute({
      type: CommandType.PlaceObject, timestamp: 0,
      object: obj, loadValue: item?.loadValue ?? 0,
    } as PlaceObjectCommand);
    expect(res.success).toBe(true);
    return obj;
  }

  it('undo removes a placed object; redo restores it', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const obj = placeRoad(executor, 3, 3);
    expect(state.objects.has(obj.id)).toBe(true);
    executor.undo();
    expect(state.objects.has(obj.id)).toBe(false);
    executor.redo();
    expect(state.objects.has(obj.id)).toBe(true);
  });

  it('undo restores a removed object; redo removes it again', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const obj = placeRoad(executor, 3, 3);
    executor.execute({
      type: CommandType.RemoveObject, timestamp: 0,
      objectId: obj.id, removedObject: obj,    } as RemoveObjectCommand);
    expect(state.objects.has(obj.id)).toBe(false);
    executor.undo();
    expect(state.objects.has(obj.id)).toBe(true);
    executor.redo();
    expect(state.objects.has(obj.id)).toBe(false);
  });

  it('undo restores road corners and rotation carried on a TrimCorners command', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const obj = placeRoad(executor, 3, 3); // rotation 0, no corners
    executor.execute({
      type: CommandType.TrimCorners, timestamp: 0,
      x: 3, y: 3, layer: 'road', objectId: obj.id,
      beforeCorners: undefined, afterCorners: ['square', 'fan', 'square', 'square'],
      beforeRotation: 0, afterRotation: 90,
    } as TrimCornersCommand);
    expect(state.objects.get(obj.id)!.rotation).toBe(90);
    expect(state.objects.get(obj.id)!.corners).toEqual(['square', 'fan', 'square', 'square']);
    executor.undo();
    expect(state.objects.get(obj.id)!.rotation).toBe(0);
    expect(state.objects.get(obj.id)!.corners).toBeUndefined();
  });
});

describe('commitStrokeGroup — batch undo', () => {
  it('collapses a multi-command batch into one undo entry that reverts everything', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const start = executor.getUndoStackSize();
    executor.execute(paintMountain(1, 1, 1));
    executor.execute(paintMountain(2, 2, 1));
    executor.execute(paintMountain(3, 3, 1));
    executor.commitStrokeGroup(start);

    expect(executor.getUndoStackSize()).toBe(start + 1); // three commands collapsed to one entry

    executor.undo(); // single undo reverts the whole batch
    expect(state.cells[1]![1]!.terrain).toBeNull();
    expect(state.cells[2]![2]!.terrain).toBeNull();
    expect(state.cells[3]![3]!.terrain).toBeNull();

    executor.redo(); // single redo re-applies the whole batch
    expect(state.cells[1]![1]!.terrain).not.toBeNull();
    expect(state.cells[2]![2]!.terrain).not.toBeNull();
    expect(state.cells[3]![3]!.terrain).not.toBeNull();
  });

  it('collapses an in-place rotate (remove + re-add same id) into one undo that restores the original', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const item = getCatalogItem('road-dirt');
    const obj: PlacedObject = {
      id: 'rot-1', catalogId: 'road-dirt',
      position: { x: 4, y: 4 }, rotation: 0, category: ObjectCategory.Facility, elevation: 0,
    };
    executor.execute({ type: CommandType.PlaceObject, timestamp: 0, object: obj, loadValue: item?.loadValue ?? 0 } as PlaceObjectCommand);

    const start = executor.getUndoStackSize();
    executor.execute({ type: CommandType.RemoveObject, timestamp: 0, objectId: obj.id, removedObject: obj } as RemoveObjectCommand);
    executor.execute({ type: CommandType.PlaceObject, timestamp: 0, object: { ...obj, rotation: 90 }, loadValue: item?.loadValue ?? 0 } as PlaceObjectCommand);
    executor.commitStrokeGroup(start);

    expect(executor.getUndoStackSize()).toBe(start + 1); // remove + place collapsed to one entry
    expect(state.objects.get('rot-1')!.rotation).toBe(90);

    executor.undo(); // ONE undo restores the original rotation (not two)
    expect(state.objects.get('rot-1')!.rotation).toBe(0);

    executor.redo();
    expect(state.objects.get('rot-1')!.rotation).toBe(90);
  });
});

describe('planObjectRotation — validate before mutate', () => {
  it('reports errors for an invalid rotation WITHOUT removing the object', () => {
    const state = makeState(30, 30); // all grass, elevation 0
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    // 7x4 house near the bottom edge: it fits as 7-wide, but rotating to 90 sweeps
    // a 4x7 (7-tall) footprint that runs off the map → the rotation is rejected.
    const houseItem = getCatalogItem('building-myhouse');
    const house: PlacedObject = {
      id: 'house', catalogId: 'building-myhouse',
      position: { x: 4, y: 25 }, rotation: 0, category: ObjectCategory.Facility, elevation: 0,
    };
    expect(executor.execute({ type: CommandType.PlaceObject, timestamp: 0, object: house, loadValue: houseItem?.loadValue ?? 0 } as PlaceObjectCommand).success).toBe(true);

    const before = state.objects.get('house');
    const { errors } = planObjectRotation(executor, state, house, 90);
    expect(errors.length).toBeGreaterThan(0);          // rotated footprint runs off the map
    expect(state.objects.get('house')).toBe(before);   // object is never removed during validation
  });

  it('reports no errors for a valid rotation and leaves state untouched', () => {
    const state = makeState(30, 30);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const house: PlacedObject = {
      id: 'house', catalogId: 'building-myhouse',
      position: { x: 4, y: 4 }, rotation: 0, category: ObjectCategory.Facility, elevation: 0,
    };
    executor.execute({ type: CommandType.PlaceObject, timestamp: 0, object: house, loadValue: 0 } as PlaceObjectCommand);
    const before = state.objects.get('house');
    const { errors } = planObjectRotation(executor, state, house, 90);
    expect(errors).toHaveLength(0);
    expect(state.objects.get('house')).toBe(before);   // validation does not mutate
  });
});

describe('runSilently', () => {
  it('suppresses validation-failed events for rejected commands but still reports failure', () => {
    const state = makeState(10, 10);
    state.cells[1]![1]!.zone = CellZone.Beach; // non-grass → V-ZONE-01 rejects a paint here
    const eventBus = new EventBus<EditorEvents>();
    const failed = vi.fn();
    eventBus.on('validation-failed', failed);
    const exec = new CommandExecutor(state, eventBus, createDefaultRegistry());
    const cmd: PaintTerrainCommand = { type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 1, y: 1 }], terrainType: TerrainType.Mountain, elevation: 1 };

    expect(exec.execute(cmd).success).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1); // normal path emits a toast event

    const res = exec.runSilently(() => exec.execute(cmd));
    expect(res.success).toBe(false);          // still reports failure to the caller
    expect(failed).toHaveBeenCalledTimes(1);  // but emitted no further validation-failed event
  });
});

describe('collapsed strokes and auto-revert', () => {
  function placeRoadAt(executor: CommandExecutor, x: number, y: number): PlacedObject {
    const obj: PlacedObject = {
      id: `r-${x}-${y}`, catalogId: 'road-dirt',
      position: { x, y }, rotation: 0, category: ObjectCategory.Facility, elevation: 0,
    };
    const item = getCatalogItem('road-dirt');
    const res = executor.execute({
      type: CommandType.PlaceObject, timestamp: 0,
      object: obj, loadValue: item?.loadValue ?? 0,
    } as PlaceObjectCommand);
    expect(res.success).toBe(true);
    return obj;
  }

  it('undo of a collapsed stroke restores road corners and rotation', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const road = placeRoadAt(executor, 3, 3);
    // Give the road a user cut BEFORE the stroke, so we can see it come back.
    executor.execute({
      type: CommandType.TrimCorners, timestamp: 0,
      x: 3, y: 3, layer: 'road', objectId: road.id,
      beforeCorners: undefined, afterCorners: ['square', 'fan', 'square', 'square'],
    } as TrimCornersCommand);

    // One stroke: a terrain paint + a road repair (as reconcileCuts issues), collapsed.
    const start = executor.getUndoStackSize();
    executor.execute(paintMountain(5, 5, 1));
    executor.execute({
      type: CommandType.TrimCorners, timestamp: 0,
      x: 3, y: 3, layer: 'road', objectId: road.id,
      beforeCorners: ['square', 'fan', 'square', 'square'],
      afterCorners: ['square', 'square', 'square', 'square'],
      beforeRotation: 0, afterRotation: 90,
    } as TrimCornersCommand);
    executor.commitStroke(start);
    expect(executor.getUndoStackSize()).toBe(start + 1); // collapsed

    executor.undo();
    const after = state.objects.get(road.id)!;
    expect(state.cells[5]![5]!.terrain).toBeNull();                    // paint undone
    expect(after.corners).toEqual(['square', 'fan', 'square', 'square']); // cut restored
    expect(after.rotation).toBe(0);                                    // rotation restored

    executor.redo();
    const redone = state.objects.get(road.id)!;
    expect(redone.rotation).toBe(90);
    expect(redone.corners).toBeUndefined(); // all-square normalizes to undefined
  });

  it('an auto-reverted stroke is not redoable, and later strokes still commit', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    // Build one cell up to 4 with no 3x3 base: V-MTN-03 auto-reverts the elev-4 step.
    const start = executor.getUndoStackSize();
    for (let e = 1; e <= 4; e++) executor.execute(paintMountain(5, 5, e));
    const violations = executor.commitStroke(start);
    expect(violations.length).toBeGreaterThan(0);
    expect(state.cells[5]![5]!.terrain?.elevation).toBe(3); // capped clean

    // The reverted illegal fragment must NOT be redoable.
    expect(executor.canRedo()).toBe(false);

    // And a later legal stroke commits instead of self-cancelling.
    const start2 = executor.getUndoStackSize();
    executor.execute(paintMountain(1, 1, 1));
    const v2 = executor.commitStroke(start2);
    expect(v2).toHaveLength(0);
    expect(state.cells[1]![1]!.terrain?.elevation).toBe(1);
  });

  it('rollbackTo silently reverts to a watermark without touching the redo stack', () => {
    const state = makeState(10, 10);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    executor.execute(paintMountain(1, 1, 1));
    const mark = executor.getUndoStackSize();
    executor.execute(paintMountain(2, 2, 1));
    executor.execute(paintMountain(3, 3, 1));

    executor.rollbackTo(mark);
    expect(executor.getUndoStackSize()).toBe(mark);
    expect(state.cells[2]![2]!.terrain).toBeNull();
    expect(state.cells[3]![3]!.terrain).toBeNull();
    expect(state.cells[1]![1]!.terrain?.elevation).toBe(1); // untouched below the mark
    expect(executor.canRedo()).toBe(false);
  });
});

/**
 * A programmatic write is a STROKE, not a bare command: the post-stroke rules run over the result,
 * the edge-cut reconcile repairs what the write invalidated, the whole thing lands as ONE undo
 * entry, and whatever survives carries an author that is not the person at the keyboard.
 *
 * The last of those is what `clearGenerated` reads: a cell it believes a human made is spared, so
 * an unsourced API write would be untakeable-back.
 *
 * The revert property is asserted where a rule can see the write. Nothing a removal does can break
 * a post-stroke rule (they read terrain, and objects only as support or as a surface something
 * stands on, both of which a removal can only relax), so `removeObject` is pinned on commitment
 * and atomicity instead.
 */
import { describe, it, expect } from 'vitest';
import { EditorAPI } from '../../api/editor-api';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { ItemCategory, TerrainType } from '../../core/model/types';
import type { EditorEvents, GridState } from '../../core/model/types';
import { getPlaceableByCategory } from '../../state/catalog';
import { makeState, setTerrain } from '../rules/_helpers';
import { roadLookup } from '../../state/object-index';

function world(): { state: GridState; executor: CommandExecutor; api: EditorAPI } {
  const state = makeState(20, 20);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, api: new EditorAPI(() => state, () => executor) };
}

const tree = (): string => getPlaceableByCategory(ItemCategory.Tree)[0]!.id;
const road = (): string => getPlaceableByCategory(ItemCategory.Road)[0]!.id;

describe('EditorAPI writes commit their stroke', () => {
  it('paints as one undo entry', () => {
    const { state, executor, api } = world();
    const res = api.paintTerrain([{ x: 5, y: 5 }, { x: 6, y: 5 }], TerrainType.Mountain, 1);
    expect(res.success).toBe(true);
    expect(executor.getUndoStackSize()).toBe(1);
    expect(state.cells[5]![5]!.terrain?.elevation).toBe(1);
    executor.undo();
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });

  it('erases as one undo entry', () => {
    const { state, executor, api } = world();
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const res = api.eraseTerrain([{ x: 5, y: 5 }]);
    expect(res.success).toBe(true);
    expect(executor.getUndoStackSize()).toBe(1);
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });

  it('places as one undo entry', () => {
    const { state, executor, api } = world();
    expect(api.placeObject(tree(), 5, 5).success).toBe(true);
    expect(executor.getUndoStackSize()).toBe(1);
    expect(state.objects.size).toBe(1);
  });

  it('removes as one undo entry, and undo puts the object back', () => {
    const { state, executor, api } = world();
    api.placeObject(tree(), 5, 5);
    const id = [...state.objects.values()][0]!.id;
    const before = executor.getUndoStackSize();
    expect(api.removeObject(id).success).toBe(true);
    expect(executor.getUndoStackSize()).toBe(before + 1);
    expect(state.objects.size).toBe(0);
    executor.undo();
    expect(state.objects.get(id)?.catalogId).toBe(tree());
  });

  it('reports a missing object rather than throwing', () => {
    const { api } = world();
    expect(api.removeObject('no-such-object').success).toBe(false);
  });
});

describe('EditorAPI writes are subject to the post-stroke rules', () => {
  it('reverts a paint the water-containment rule forbids', () => {
    const { state, executor, api } = world();
    // Water at the map edge pours off it: V-WTR-02 has no cap to find out there.
    const res = api.paintTerrain([{ x: 0, y: 5 }], TerrainType.Water, 0);
    expect(res.success).toBe(false);
    expect(res.errors.some((e) => e.ruleId === 'V-WTR-02')).toBe(true);
    expect(state.cells[5]![0]!.terrain).toBeNull();
    expect(executor.getUndoStackSize()).toBe(0);
  });

  it('reverts an erase that leaves a mountain unsupported', () => {
    const { state, executor, api } = world();
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Mountain, 3);
    setTerrain(state, 6, 6, TerrainType.Mountain, 4);
    const res = api.eraseTerrain([{ x: 5, y: 5 }]);
    expect(res.success).toBe(false);
    expect(res.errors.some((e) => e.ruleId === 'V-MTN-03')).toBe(true);
    expect(state.cells[5]![5]!.terrain?.elevation).toBe(3);
    expect(executor.getUndoStackSize()).toBe(0);
  });

  it('reverts a placement left standing on a road', () => {
    const { state, executor, api } = world();
    expect(api.placeObject(road(), 5, 5).success).toBe(true);
    const after = executor.getUndoStackSize();
    // V-PLACE-OVERLAP exempts coatings, so the placement passes pre-command; only the finished
    // stroke can tell "coated over" from "left standing on".
    const res = api.placeObject(tree(), 5, 5);
    expect(res.success).toBe(false);
    expect(res.errors.some((e) => e.ruleId === 'V-PLACE-COATED')).toBe(true);
    expect([...state.objects.values()].map((o) => o.catalogId)).toEqual([road()]);
    expect(executor.getUndoStackSize()).toBe(after);
  });
});

describe('EditorAPI writes name their author', () => {
  it('paints cells that are not the person\'s work', () => {
    const { executor, api } = world();
    expect(api.paintTerrain([{ x: 5, y: 5 }], TerrainType.Mountain, 1).success).toBe(true);
    const author = executor.getProvenanceTracker().cellAuthor(5, 5);
    expect(author).not.toBe('human');
    expect(author).toBe('procedural');
  });

  it('places objects that are not the person\'s work', () => {
    const { state, executor, api } = world();
    expect(api.placeObject(tree(), 5, 5).success).toBe(true);
    const id = [...state.objects.values()][0]!.id;
    const author = executor.getProvenanceTracker().objectAuthor(id);
    expect(author).not.toBe('human');
    expect(author).toBe('procedural');
  });

  it('leaves the map summary reporting procedural content', () => {
    const { executor, api } = world();
    api.paintTerrain([{ x: 5, y: 5 }], TerrainType.Mountain, 1);
    expect(executor.getProvenanceSummary().containsProcedural).toBe(true);
  });
});

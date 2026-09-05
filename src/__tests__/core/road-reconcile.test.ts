/**
 * Roads follow the surface they coat, whatever edited it.
 *
 * The pass runs inside `commitStroke`, so these tests drive the executor end-to-end: paint or
 * erase through `execute`, commit, and read what the map holds. A footprint uniform again at some
 * level carries the road there (up under a paint, down under an erase); a footprint left mixed or
 * wet removes the road — the game's no-floating rule (an eraser stroke must not leave a road
 * hanging over the cleared half of its ground).
 */
import { describe, it, expect } from 'vitest';
import { CommandType, TerrainType, type PlacedObject } from '../../core/model/types';
import { makeState, makeExecutor, paintCmd, placeCmd } from '../rules/_helpers';
import { CellZone } from '../../core/model/types';
import type { GridState } from '../../core/model/types';

function grassMap(): GridState {
  const state = makeState(10, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) state.cells[y]![x]!.zone = CellZone.Grass;
  return state;
}

function road(x: number, y: number, elevation = 0): PlacedObject {
  return { id: `road-${x}-${y}`, catalogId: 'path-overgrown-dirt', position: { x, y }, rotation: 0, elevation };
}

function findRoad(state: GridState): PlacedObject | undefined {
  return [...state.objects.values()].find((o) => o.catalogId === 'path-overgrown-dirt');
}

const SLAB: [number, number][] = [[5, 5], [6, 5], [5, 6], [6, 6]];

describe('commitStroke reconciles roads onto their surface', () => {
  it('a road rides UP when its footprint becomes uniform mountain', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    exec.execute(placeCmd(road(5, 5)));
    const start = exec.getUndoStackSize();
    for (const [x, y] of SLAB) exec.execute(paintCmd([{ x, y }], TerrainType.Mountain, 1));
    expect(exec.commitStroke(start)).toEqual([]);
    expect(findRoad(state)?.elevation).toBe(1);
  });

  it('a road rides DOWN when the ground under it is peeled away whole', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    for (const [x, y] of SLAB) makeExecutor(state).execute(paintCmd([{ x, y }], TerrainType.Mountain, 1));
    exec.execute(placeCmd(road(5, 5, 1)));
    const start = exec.getUndoStackSize();
    // The eraser's peel: mountain painted back to elevation 0 clears the cell.
    for (const [x, y] of SLAB) exec.execute(paintCmd([{ x, y }], TerrainType.Mountain, 0));
    expect(exec.commitStroke(start)).toEqual([]);
    const r = findRoad(state);
    expect(r, 'the road survives on the ground the slab left behind').toBeDefined();
    expect(r!.elevation).toBe(0);
  });

  it('a road is REMOVED when the erase leaves its footprint straddling a cliff', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    for (const [x, y] of SLAB) exec.execute(paintCmd([{ x, y }], TerrainType.Mountain, 1));
    exec.execute(placeCmd(road(5, 5, 1)));
    const start = exec.getUndoStackSize();
    exec.execute(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 0));
    exec.execute(paintCmd([{ x: 5, y: 6 }], TerrainType.Mountain, 0));
    expect(exec.commitStroke(start)).toEqual([]);
    expect(findRoad(state), 'half on 1 and half on 0 would float — the no-floating rule').toBeUndefined();
  });

  it('paint that never reaches a road leaves it untouched', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    exec.execute(placeCmd(road(1, 1)));
    const before = state.objects.get('road-1-1');
    const start = exec.getUndoStackSize();
    exec.execute(paintCmd([{ x: 8, y: 8 }], TerrainType.Mountain, 1));
    exec.commitStroke(start);
    expect(state.objects.get('road-1-1'), 'same object, no churn').toBe(before);
  });

  it('a carried road keeps its corners and rotation', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    const r = road(5, 5);
    r.corners = ['square', 'square', 'square', 'fan'];
    exec.execute(placeCmd(r));
    const start = exec.getUndoStackSize();
    for (const [x, y] of SLAB) exec.execute(paintCmd([{ x, y }], TerrainType.Mountain, 1));
    exec.commitStroke(start);
    const carried = findRoad(state);
    expect(carried?.elevation).toBe(1);
    expect(carried?.corners).toEqual(['square', 'square', 'square', 'fan']);
  });

  it('a SOLID object still blocks the terrain edit under it — only coatings follow', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    const placed = exec.execute(placeCmd({ id: 't1', catalogId: 'tree-apple', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 }));
    expect(placed.success).toBe(true);
    const r = exec.execute(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1));
    expect(r.success).toBe(false);
    expect(r.errors[0]?.ruleId).toBe('V-PLACE-BLOCK');
  });

  it('a road rides MID-STROKE, the moment its footprint settles at a new level', () => {
    // Real-time follow: the settle happens per command, not at the pointer's release, so the
    // road is seen dropping or rising while the stroke is still travelling.
    const state = grassMap();
    const exec = makeExecutor(state);
    exec.execute(placeCmd(road(5, 5)));
    exec.execute(paintCmd(SLAB.map(([x, y]) => ({ x, y })), TerrainType.Mountain, 1));
    expect(findRoad(state)?.elevation, 'up before any commit').toBe(1);
  });

  it('a deck whose ground is being taken away goes with it, mid-stroke', () => {
    // The floating state must not survive until the release: the moment any footprint cell drops
    // below the deck, the road is removed on the spot. If the same stroke goes on to clear the
    // rest of the slab, the road returns at the settled ground, still mid-stroke.
    const state = grassMap();
    const exec = makeExecutor(state);
    for (const [x, y] of SLAB) exec.execute(paintCmd([{ x, y }], TerrainType.Mountain, 1));
    exec.execute(placeCmd(road(5, 5, 1)));
    const start = exec.getUndoStackSize();
    exec.execute(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 0));
    expect(findRoad(state), 'gone the moment its ground is half gone').toBeUndefined();
    exec.execute(paintCmd([{ x: 5, y: 6 }], TerrainType.Mountain, 0));
    exec.execute(paintCmd([{ x: 6, y: 5 }], TerrainType.Mountain, 0));
    exec.execute(paintCmd([{ x: 6, y: 6 }], TerrainType.Mountain, 0));
    expect(findRoad(state)?.elevation, 'back on the settled ground, still mid-stroke').toBe(0);
    expect(exec.commitStroke(start)).toEqual([]);
    expect(findRoad(state)?.elevation).toBe(0);
  });

  it('a deck being BURIED leaves at the first illegal state and returns when the slab completes', () => {
    // Every mid-stroke state is judged as if the stroke ended there, against the pre-stroke road
    // as the base: a mixed footprint is an illegal stand, so the road goes at once, and it comes
    // back the moment the evolving ground makes it legal again — the intra-stroke sequence is not
    // a real sequence of steps.
    const state = grassMap();
    const exec = makeExecutor(state);
    exec.execute(placeCmd(road(5, 5)));
    const start = exec.getUndoStackSize();
    exec.execute(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1));
    expect(findRoad(state), 'gone while its stand is illegal').toBeUndefined();
    exec.execute(paintCmd([{ x: 5, y: 6 }], TerrainType.Mountain, 1));
    exec.execute(paintCmd([{ x: 6, y: 5 }], TerrainType.Mountain, 1));
    exec.execute(paintCmd([{ x: 6, y: 6 }], TerrainType.Mountain, 1));
    expect(findRoad(state)?.elevation, 'back on top the moment the slab completes').toBe(1);
    expect(exec.commitStroke(start)).toEqual([]);
    expect(findRoad(state)?.elevation).toBe(1);
  });

  it('a half-buried deck is removed at the commit, exactly as before', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    exec.execute(placeCmd(road(5, 5)));
    const start = exec.getUndoStackSize();
    exec.execute(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1));
    exec.execute(paintCmd([{ x: 5, y: 6 }], TerrainType.Mountain, 1));
    expect(exec.commitStroke(start)).toEqual([]);
    expect(findRoad(state), 'half on 1 and half on 0 would float').toBeUndefined();
  });

  it('one cell never carries two coatings, whatever a stroke does around a parked road', () => {
    // One stroke: the ground under a road is erased (the road parks and re-seats when the slab
    // finishes clearing), then a NEW tile is paved on the same cell the way the tile brush does —
    // strip, then place. The old road must be gone and the new one standing; a raw placement
    // without the strip is refused outright by V-PLACE-OVERLAP, so two coatings on one cell is a
    // state nothing can create.
    const state = grassMap();
    const exec = makeExecutor(state);
    for (const [x, y] of SLAB) exec.execute(paintCmd([{ x, y }], TerrainType.Mountain, 1));
    exec.execute(placeCmd({ id: 'old', catalogId: 'path-overgrown-dirt', position: { x: 5, y: 5 }, rotation: 0, elevation: 1 }, 10));
    exec.commitStroke(0);
    const start = exec.getUndoStackSize();
    for (const [x, y] of SLAB) exec.execute(paintCmd([{ x, y }], TerrainType.Mountain, 0));
    // The raw placement (no strip) is refused — the parked road re-seated when the ground settled.
    const raw = exec.execute(placeCmd({ id: 'new', catalogId: 'path-cobblestone', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 }, 10));
    expect(raw.success).toBe(false);
    // The brush's way: strip what covers the cell, then place.
    const covering = [...state.objects.values()].find((o) => o.position.x === 5 && o.position.y === 5)!;
    exec.execute({ type: CommandType.RemoveObject, timestamp: 0, objectId: covering.id, removedObject: covering } as never);
    exec.execute(placeCmd({ id: 'new', catalogId: 'path-cobblestone', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 }, 10));
    expect(exec.commitStroke(start)).toEqual([]);
    const at55 = [...state.objects.values()].filter((o) => o.position.x === 5 && o.position.y === 5);
    expect(at55.map((o) => o.id)).toEqual(['new']);
  });

  it('the whole gesture is ONE undo entry, road repair included', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    exec.execute(placeCmd(road(5, 5)));
    exec.collapseHistory(0);
    const undosBefore = exec.getUndoStackSize();
    const start = exec.getUndoStackSize();
    for (const [x, y] of SLAB) exec.execute(paintCmd([{ x, y }], TerrainType.Mountain, 1));
    exec.commitStroke(start);
    expect(exec.getUndoStackSize()).toBe(undosBefore + 1);
    exec.undo();
    expect(findRoad(state)?.elevation, 'undo restores the road with its old level').toBe(0);
  });
});

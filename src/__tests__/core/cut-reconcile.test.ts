import { describe, it, expect } from 'vitest';
import { reconcileCuts } from '../../core/edge-cut/cut-reconcile';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType, type Command, type Corners, type EditorEvents } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { type PlacedObject } from '../../core/model/types';

function exec(state: any): CommandExecutor {
  return new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
}
function setCorners(state: any, x: number, y: number, corners: Corners): void {
  state.cells[y][x].terrain.corners = corners;
}

describe('reconcileCuts — terrain', () => {
  it('squares a corner locked by a new shared-edge neighbour', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setCorners(state, 5, 5, ['square', 'square', 'square', 'fan']); // BR cut
    setTerrain(state, 6, 5, TerrainType.Mountain, 1); // new neighbour to the right locks TR+BR
    reconcileCuts([{ x: 6, y: 5 }], state, exec(state));
    expect(state.cells[5]![5]!.terrain!.corners).toBeUndefined(); // all square → normalized away
  });

  it('does NOT square a corner that only a DIAGONAL neighbour touches — the pinch stays cut (Bug 2.1)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setCorners(state, 5, 5, ['fan', 'square', 'square', 'square']); // TL cut
    setTerrain(state, 4, 4, TerrainType.Mountain, 1); // diagonal point — touches at a point, does not pin
    reconcileCuts([{ x: 4, y: 4 }], state, exec(state));
    expect(state.cells[5]![5]!.terrain!.corners).toEqual(['fan', 'square', 'square', 'square']); // preserved
  });

  it('Bug 4b: peeling a cut pool\'s bank into a waterfall squares the now-locked lip corners', () => {
    const state = makeState(12, 12);
    // A contained elevated pool: water@2 rimmed by mountains@2 on all four sides.
    setTerrain(state, 5, 5, TerrainType.Water, 2);
    setTerrain(state, 4, 5, TerrainType.Mountain, 2); // west cap
    setTerrain(state, 6, 5, TerrainType.Mountain, 2); // east cap
    setTerrain(state, 5, 4, TerrainType.Mountain, 2); // north rim
    setTerrain(state, 5, 6, TerrainType.Mountain, 2); // south bank (about to be peeled)
    setTerrain(state, 4, 6, TerrainType.Mountain, 1); // downstream row, kept uniform (V-WTR-03)
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    setCorners(state, 5, 5, ['square', 'square', 'fan', 'fan']); // rounded the pool's south corners (legal while a pool)
    const ex = exec(state);
    // Peel the south bank one tier (mountain@2 → @1) → the water now DROPS south → it becomes a waterfall lip.
    ex.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 5, y: 6 }], terrainType: TerrainType.Mountain, elevation: 1 } as Command);
    ex.commitStroke(0);
    const t = getCell(state.cells, 5, 5)!.terrain!;
    expect(t.corners?.[2] ?? 'square', 'BL lip squared (can\'t round a falling lip)').toBe('square');
    expect(t.corners?.[3] ?? 'square', 'BR lip squared').toBe('square');
  });

  it('reverts a mountain cut when water arrives on the edge — the mountain now BANKS the water', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setCorners(state, 5, 5, ['square', 'square', 'square', 'fan']); // BR fan, on the right edge
    setTerrain(state, 6, 5, TerrainType.Water, 1); // water arrives on the right → the mountain now banks it
    reconcileCuts([{ x: 6, y: 5 }], state, exec(state));
    // the BR corner is now the water's bank — cutting it would leave the pond unbanked — so reconcile
    // squares it back off.
    expect(state.cells[5]![5]!.terrain!.corners?.[3] ?? 'square').toBe('square');
  });
});

function addRoad(state: any, x: number, y: number): PlacedObject {
  const road: PlacedObject = {
    id: `road-${x}-${y}`, catalogId: 'road-dirt',
    position: { x, y }, rotation: 0, elevation: 0,
  };
  state.objects.set(road.id, road);
  return road;
}

describe('reconcileCuts — roads', () => {
  it('reverts to raw when the road becomes a straight-through middle', () => {
    const state = makeState(10, 10);
    addRoad(state, 4, 5);                          // west neighbour
    const road = addRoad(state, 5, 5);
    road.corners = ['square', 'square', 'square', 'fan']; // valid BR fan for a W endpoint
    addRoad(state, 6, 5);                          // east neighbour → W+E straight middle
    reconcileCuts([{ x: 6, y: 5 }], state, exec(state));
    expect(state.objects.get(road.id)!.corners).toBeUndefined(); // no cut legal → raw
  });

  it('preserves round: TR-fan invalid on an L-shape becomes BR-fan', () => {
    const state = makeState(10, 10);
    addRoad(state, 4, 5);                           // west neighbour
    const road = addRoad(state, 5, 5);
    road.corners = ['square', 'fan', 'square', 'square']; // TR fan
    addRoad(state, 5, 4);                           // north neighbour → L-shape N+W
    reconcileCuts([{ x: 5, y: 4 }], state, exec(state));
    // TR fan is adjacent to the connected N side (illegal); BR fan is the valid round form
    expect(state.objects.get(road.id)!.corners).toEqual(['square', 'square', 'square', 'fan']);
  });

  it('preserves direct: \\ invalid on an L-shape becomes /', () => {
    const state = makeState(10, 10);
    addRoad(state, 4, 5);                           // west neighbour
    const road = addRoad(state, 5, 5);
    road.corners = ['tri-SE', 'tri-SE', 'square', 'square']; // diagonal \
    addRoad(state, 5, 4);                           // north neighbour → L-shape N+W
    reconcileCuts([{ x: 5, y: 4 }], state, exec(state));
    // \ stops covering the N edge; / is the valid direct form
    expect(state.objects.get(road.id)!.corners).toEqual(['square', 'square', 'tri-NE', 'tri-NE']);
  });

  it('leaves a still-valid road cut untouched', () => {
    const state = makeState(10, 10);
    addRoad(state, 4, 5);
    const road = addRoad(state, 5, 5);
    road.corners = ['square', 'square', 'square', 'fan'];
    addRoad(state, 8, 8); // unrelated
    reconcileCuts([{ x: 8, y: 8 }], state, exec(state));
    expect(state.objects.get(road.id)!.corners).toEqual(['square', 'square', 'square', 'fan']);
  });
});

import { createDefaultTerrainCell, getCell } from '../../core/model/grid-model';

describe('reconcileCuts — Γ-patches', () => {
  it('removes a terrain patch when its concave context breaks', () => {
    const state = makeState(10, 10);
    // Concave Γ: three mountain cells, empty corner at (6,6) holding a TL patch.
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    const patch = createDefaultTerrainCell(TerrainType.Mountain, 1);
    patch.patchOnly = true;
    patch.corners = ['fan', 'empty', 'empty', 'empty']; // TL inner corner faces the centre
    state.cells[6]![6]!.terrain = patch;

    // Break the context: erase the diagonal mountain at (5,5).
    state.cells[5]![5]!.terrain = null;
    reconcileCuts([{ x: 5, y: 5 }], state, exec(state));

    expect(state.cells[6]![6]!.terrain).toBeNull(); // patch removed
  });

  it('leaves a patch whose context is intact', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 6, TerrainType.Mountain, 1);
    const patch = createDefaultTerrainCell(TerrainType.Mountain, 1);
    patch.patchOnly = true;
    patch.corners = ['fan', 'empty', 'empty', 'empty'];
    state.cells[6]![6]!.terrain = patch;

    setTerrain(state, 0, 0, TerrainType.Mountain, 1); // unrelated edit
    reconcileCuts([{ x: 0, y: 0 }], state, exec(state));

    expect(state.cells[6]![6]!.terrain).not.toBeNull();
    expect(state.cells[6]![6]!.terrain!.patchOnly).toBe(true);
  });
});

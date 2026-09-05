/**
 * The scene compiler folds a GridState into the facts a prompt can name (water bodies, bridges,
 * road coverage, clusters, terracing, island shape), then verbalizes them into English clauses.
 */
import { describe, it, expect } from 'vitest';
import { CellZone, TerrainType, type GridState, type PlacedObject } from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { buildManifest } from '../../../io/stylize/scene/manifest';
import { verbalizeScene } from '../../../io/stylize/scene/verbalize';

function water(state: GridState, x: number, y: number): void {
  const cell = state.cells[y]?.[x];
  if (cell) cell.terrain = { type: TerrainType.Water, elevation: 0 };
}

function building(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: 'building-bamboo-cabin', position: { x, y }, rotation: 0, elevation: 0 };
}

function tree(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: 'tree-apple', position: { x, y }, rotation: 0, elevation: 0 };
}

function bridge(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: 'bridge-iron', position: { x, y }, rotation: 0, elevation: 0 };
}

describe('buildManifest', () => {
  it('an empty state yields the empty manifest', () => {
    const state = makeState();
    const m = buildManifest(state);
    expect(m).toEqual({
      water: [],
      bridges: 0,
      roadCoverage: 'none',
      clusters: [],
      terraces: 0,
      peakAt: null,
      islandShaped: false,
    });
  });

  it('a vertical water strip spanning top-to-bottom borders yields one river running north-south', () => {
    const state = makeState(20, 20);
    for (let y = 0; y < 20; y++) water(state, 10, y);
    const m = buildManifest(state);
    expect(m.water).toHaveLength(1);
    expect(m.water[0]!.kind).toBe('river');
    expect(m.water[0]!.runs).toBe('north-south');
  });

  it('a horizontal water strip spanning left-to-right borders yields one river running east-west', () => {
    const state = makeState(20, 20);
    for (let x = 0; x < 20; x++) water(state, x, 10);
    const m = buildManifest(state);
    expect(m.water).toHaveLength(1);
    expect(m.water[0]!.kind).toBe('river');
    expect(m.water[0]!.runs).toBe('east-west');
  });

  it('a 100-cell blob in the northwest yields a lake at northwest', () => {
    const state = makeState(20, 20);
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) water(state, x, y);
    const m = buildManifest(state);
    expect(m.water).toHaveLength(1);
    expect(m.water[0]!.kind).toBe('lake');
    expect(m.water[0]!.at).toBe('northwest');
  });

  it('a small blob under 80 cells is a pond', () => {
    const state = makeState(20, 20);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) water(state, x + 15, y + 15);
    const m = buildManifest(state);
    expect(m.water).toHaveLength(1);
    expect(m.water[0]!.kind).toBe('pond');
    expect(m.water[0]!.at).toBe('southeast');
  });

  it('ranks water bodies by size and keeps only the top 3', () => {
    const state = makeState(30, 30);
    // Four separate ponds of decreasing size, far enough apart not to merge.
    // pond A: 9 cells
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) water(state, x, y);
    // pond B: 4 cells
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) water(state, x + 10, y);
    // pond C: 1 cell
    water(state, 25, 0);
    // pond D: 2 cells
    water(state, 0, 20);
    water(state, 1, 20);
    const m = buildManifest(state);
    expect(m.water.length).toBeLessThanOrEqual(3);
    expect(m.water[0]!.cells).toBe(9);
  });

  it('ten building objects in the southeast yield a building cluster at southeast', () => {
    const state = makeState(20, 20);
    for (let i = 0; i < 10; i++) state.objects.set(`b${i}`, building(`b${i}`, 16, 16));
    const m = buildManifest(state);
    expect(m.clusters).toEqual([{ category: 'building', count: 10, at: 'southeast' }]);
  });

  it('merges tree and flora objects into one plant cluster', () => {
    const state = makeState(20, 20);
    for (let i = 0; i < 5; i++) state.objects.set(`t${i}`, tree(`t${i}`, 1, 1));
    const m = buildManifest(state);
    expect(m.clusters).toEqual([{ category: 'plant', count: 5, at: 'northwest' }]);
  });

  it('does not report a cluster under the count-5 floor', () => {
    const state = makeState(20, 20);
    for (let i = 0; i < 4; i++) state.objects.set(`b${i}`, building(`b${i}`, 1, 1));
    const m = buildManifest(state);
    expect(m.clusters).toEqual([]);
  });

  it('counts bridge-category objects', () => {
    const state = makeState(20, 20);
    state.objects.set('br1', bridge('br1', 5, 5));
    state.objects.set('br2', bridge('br2', 6, 6));
    const m = buildManifest(state);
    expect(m.bridges).toBe(2);
  });

  it('classifies terraces from the highest terrain elevation and its quadrant', () => {
    const state = makeState(20, 20);
    const cell = state.cells[17]?.[17];
    if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: 4 };
    const m = buildManifest(state);
    expect(m.terraces).toBe(4);
    expect(m.peakAt).toBe('southeast');
  });

  it('reads a mostly-void border as an island', () => {
    const state = makeState(20, 20);
    for (let x = 0; x < 20; x++) {
      const top = state.cells[0]?.[x]; if (top) top.zone = CellZone.Void;
      const bottom = state.cells[19]?.[x]; if (bottom) bottom.zone = CellZone.Void;
    }
    for (let y = 1; y < 19; y++) {
      const left = state.cells[y]?.[0]; if (left) left.zone = CellZone.Void;
      const right = state.cells[y]?.[19]; if (right) right.zone = CellZone.Void;
    }
    const m = buildManifest(state);
    expect(m.islandShaped).toBe(true);
  });
});

describe('verbalizeScene', () => {
  it('an empty manifest verbalizes to no clauses', () => {
    const m = buildManifest(makeState());
    expect(verbalizeScene(m)).toEqual([]);
  });

  it('never exceeds 8 clauses', () => {
    const state = makeState(30, 30);
    for (let y = 0; y < 30; y++) water(state, 15, y);
    for (let i = 0; i < 10; i++) state.objects.set(`b${i}`, building(`b${i}`, 25, 25));
    for (let i = 0; i < 10; i++) state.objects.set(`t${i}`, tree(`t${i}`, 1, 1));
    state.objects.set('br1', bridge('br1', 15, 10));
    for (let i = 0; i < 25; i++) state.objects.set(`r${i}`, { id: `r${i}`, catalogId: 'path-overgrown-dirt', position: { x: i % 29, y: 0 }, rotation: 0, elevation: 0 });
    const cell = state.cells[3]?.[3];
    if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: 3 };
    const m = buildManifest(state);
    const clauses = verbalizeScene(m);
    expect(clauses.length).toBeLessThanOrEqual(8);
  });

  it('names the river, its direction and the bridge count in one clause', () => {
    const state = makeState(20, 20);
    for (let y = 0; y < 20; y++) water(state, 10, y);
    state.objects.set('br1', bridge('br1', 10, 5));
    state.objects.set('br2', bridge('br2', 10, 15));
    state.objects.set('br3', bridge('br3', 10, 10));
    const m = buildManifest(state);
    const clauses = verbalizeScene(m);
    expect(clauses[0]).toContain('river');
    expect(clauses[0]).toContain('north to south');
    expect(clauses[0]).toContain('3 bridges');
  });

  it('names a building cluster with its count and a plant cluster without one', () => {
    const state = makeState(20, 20);
    for (let i = 0; i < 14; i++) state.objects.set(`b${i}`, building(`b${i}`, 16, 16));
    for (let i = 0; i < 8; i++) state.objects.set(`t${i}`, tree(`t${i}`, 1, 1));
    const m = buildManifest(state);
    const clauses = verbalizeScene(m);
    expect(clauses).toContain('a village of 14 buildings gathers at the southeast');
    expect(clauses).toContain('dense planting fills the northwest');
  });

  it('names terraces with the peak quadrant', () => {
    const state = makeState(20, 20);
    const cell = state.cells[17]?.[17];
    if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: 4 };
    const m = buildManifest(state);
    const clauses = verbalizeScene(m);
    expect(clauses).toContain('the ground steps through 4 terraces, highest at the southeast');
  });

  it('names an island shape', () => {
    const state = makeState(20, 20);
    for (let x = 0; x < 20; x++) {
      const top = state.cells[0]?.[x]; if (top) top.zone = CellZone.Void;
      const bottom = state.cells[19]?.[x]; if (bottom) bottom.zone = CellZone.Void;
    }
    for (let y = 1; y < 19; y++) {
      const left = state.cells[y]?.[0]; if (left) left.zone = CellZone.Void;
      const right = state.cells[y]?.[19]; if (right) right.zone = CellZone.Void;
    }
    const m = buildManifest(state);
    expect(verbalizeScene(m)).toContain('the map reads as an island with open water at its edges');
  });
});

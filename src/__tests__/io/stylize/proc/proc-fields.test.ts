import { describe, it, expect } from 'vitest';
import { CellZone, TerrainType } from '../../../../core/model/types';
import type { GridState, MapTemplate, PlacedObject } from '../../../../core/model/types';
import { createGrid } from '../../../../core/model/grid-model';
import { buildProcFields, elevationMask, plantDrifts, plantingDensity, genusOf } from '../../../../io/stylize/proc/fields';

/** A small island: a ring of water around sand around grass, which is the shape of every template. */
function template(w = 16, h = 12): MapTemplate {
  const zones: CellZone[][] = [];
  for (let y = 0; y < h; y++) {
    const row: CellZone[] = [];
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      row.push(edge === 0 ? CellZone.Void : edge === 1 ? CellZone.Beach : CellZone.Grass);
    }
    zones.push(row);
  }
  return { id: 't', name: { en: 'T' }, width: w, height: h, zones } as unknown as MapTemplate;
}

function state(objects: PlacedObject[] = [], mutate?: (s: GridState) => void): GridState {
  const t = template();
  const s: GridState = {
    template: t,
    cells: createGrid(t),
    objects: new Map(objects.map((o) => [o.id, o])),
    lockedLayers: new Set<number>(),
  };
  mutate?.(s);
  return s;
}

const obj = (id: string, catalogId: string, x: number, y: number): PlacedObject => ({
  id, catalogId, position: { x, y }, rotation: 0, elevation: 0,
});

describe('proc/fields — the map becomes typed arrays', () => {
  it('separates water, beach and land from the template', () => {
    const f = buildProcFields(state(), 1);
    const at = (x: number, y: number) => y * f.width + x;
    expect(f.water[at(0, 0)]).toBe(1);
    expect(f.land[at(0, 0)]).toBe(0);
    expect(f.beach[at(1, 1)]).toBe(1);
    expect(f.land[at(1, 1)]).toBe(1);
    expect(f.beach[at(5, 5)]).toBe(0);
    expect(f.land[at(5, 5)]).toBe(1);
  });

  it('a flat map reports no elevation, which is the common case', () => {
    const f = buildProcFields(state(), 1);
    expect(f.maxElevation).toBe(0);
    // Tier 0 is the island; every tier above it is empty, so an elevation-driven pack draws nothing.
    expect(elevationMask(f, 0).some((v) => v === 1)).toBe(true);
    expect(elevationMask(f, 1).some((v) => v === 1)).toBe(false);
  });

  it('reads raised terrain into tiers', () => {
    const f = buildProcFields(state([], (s) => {
      for (let y = 4; y < 8; y++) {
        for (let x = 6; x < 11; x++) {
          s.cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation: y < 6 ? 2 : 1 };
        }
      }
    }), 1);
    expect(f.maxElevation).toBe(2);
    const tier1 = elevationMask(f, 1);
    const tier2 = elevationMask(f, 2);
    const count = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);
    expect(count(tier1)).toBe(20);
    expect(count(tier2)).toBe(10);
  });

  it('stamps object footprints into the class masks and keeps the objects', () => {
    const f = buildProcFields(state([
      obj('r1', 'path-cobblestone', 5, 5),
      obj('t1', 'tree-peach', 8, 5),
      obj('b1', 'building-bamboo-cabin', 3, 6),
    ]), 1);
    const at = (x: number, y: number) => y * f.width + x;
    expect(f.road[at(5, 5)]).toBe(1);
    expect(f.plant[at(8, 5)]).toBe(1);
    expect(f.building[at(3, 6)]).toBe(1);
    expect(f.plants).toHaveLength(1);
    expect(f.buildings).toHaveLength(1);
    expect(f.objects).toHaveLength(3);
  });

  it('an unknown catalog id still bakes rather than throwing, since a save may outlive an item', () => {
    const f = buildProcFields(state([obj('x', 'no-such-item', 5, 5)]), 1);
    expect(f.objects).toHaveLength(1);
    expect(f.objects[0]!.item).toBeUndefined();
  });

  it('signs the distance fields: inside is negative, outside positive', () => {
    const f = buildProcFields(state(), 1);
    const at = (x: number, y: number) => y * f.width + x;
    expect(f.landSdf[at(8, 6)]!).toBeLessThan(0);
    expect(f.landSdf[at(0, 0)]!).toBeGreaterThan(0);
    expect(f.waterSdf[at(0, 0)]!).toBeLessThan(0);
  });

  it('groups drifts by genus, so cultivars of one flower are one bed', () => {
    expect(genusOf('flower-agapanthus-blue')).toBe('flower-agapanthus');
    expect(genusOf('flower-agapanthus-white')).toBe('flower-agapanthus');
    expect(genusOf('tree-peach')).toBe('tree-peach');
    const objects: PlacedObject[] = [];
    let n = 0;
    for (let x = 5; x < 11; x++) {
      objects.push(obj(`a${n++}`, 'flower-agapanthus-blue', x, 5));
      objects.push(obj(`b${n++}`, 'flower-agapanthus-white', x, 6));
    }
    const f = buildProcFields(state(objects), 1);
    const drifts = plantDrifts(f, 4);
    expect(drifts).toHaveLength(1);
    expect(drifts[0]!.genus).toBe('flower-agapanthus');
    expect(drifts[0]!.cells).toBe(12);
  });

  it('drops a run below the floor, because single stamps in rows are the backbone not a bed', () => {
    const f = buildProcFields(state([obj('t', 'tree-peach', 7, 7)]), 1);
    expect(plantDrifts(f, 4)).toHaveLength(0);
  });

  it('density falls off away from planting', () => {
    const f = buildProcFields(state([obj('t', 'tree-peach', 8, 6)]), 1);
    const d = plantingDensity(f);
    const at = (x: number, y: number) => y * f.width + x;
    expect(d[at(8, 6)]!).toBeCloseTo(1, 3);
    expect(d[at(9, 6)]!).toBeLessThan(d[at(8, 6)]!);
    expect(d[at(12, 6)]!).toBeLessThan(d[at(9, 6)]!);
  });

  it('is a pure function of the map: the same state bakes identically', () => {
    const s = state([obj('t', 'tree-peach', 8, 5)]);
    const a = buildProcFields(s, 42);
    const b = buildProcFields(s, 42);
    expect(Array.from(a.land)).toEqual(Array.from(b.land));
    expect(Array.from(a.landSdf)).toEqual(Array.from(b.landSdf));
    expect(a.seed).toBe(b.seed);
  });
});

/**
 * The evidence contract on ValidationError: `cells` = the cells that CAUSE the
 * violation (complete, never a bare click anchor), `rects` = the exact drawn BODY where the cause
 * is an object rather than a cell, and `grid` tells the renderer which grid either renders on
 * ('micro' = terrain micro-grid, 'macro' = object/zone grid; absent → the command-type default).
 * Pinned per rule here; the renderer half lives in __tests__/canvas/overlay-flash.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { traitPlacementRule } from '../../rules/placement';
import { objectBlocksTerrainRule } from '../../rules/object-blocks-terrain';
import { placementOverlapRule } from '../../rules/placement-overlap';
import { placementMaxCountRule } from '../../rules/placement-max-count';
import { lockedObjectRule } from '../../rules/locked-object';
import { chunkLoadViolations } from '../../rules/chunk-load';
import { CommandType, ItemCategory, TerrainType } from '../../core/model/types';
import type { PaintTerrainCommand } from '../../core/model/types';
import type { MacroCoord, PlacedObject, PlaceObjectCommand, RemoveObjectCommand } from '../../core/model/types';
import { makeState, setTerrain } from './_helpers';
import { registerCatalogItem } from '../../state/catalog';

registerCatalogItem({
  id: 'ev-house', category: ItemCategory.Building, name: { en: 'Evidence House' },
  width: 2, height: 2, loadValue: 0, rotatable: true, placementMode: 'point',
  traits: [{ type: 'flat' }],
});
registerCatalogItem({
  id: 'ev-pier', category: ItemCategory.Facility, name: { en: 'Evidence Pier' },
  width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'noFloat' }],
});
registerCatalogItem({
  id: 'ev-path', category: ItemCategory.Road, name: { en: 'Evidence Path' },
  width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'surfaceCoating' }],
});
registerCatalogItem({
  id: 'ev-tree', category: ItemCategory.Tree, name: { en: 'Evidence Tree' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'exclusionRadius', radius: 2 }],
});
registerCatalogItem({
  id: 'ev-unique', category: ItemCategory.Building, name: { en: 'Evidence Unique' },
  width: 2, height: 1, loadValue: 0, maxCount: 1, rotatable: true, placementMode: 'point',
  traits: [],
});

function place(catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject, timestamp: 0,
    object: { id: 'candidate', catalogId, position: { x, y }, rotation, elevation: 0 },
    loadValue: 0,
  };
}

function existing(catalogId: string, id: string, x: number, y: number): PlacedObject {
  return { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 };
}

const has = (cells: MacroCoord[], x: number, y: number): boolean =>
  cells.some((c) => c.x === x && c.y === y);

describe('evidence cells: V-PLACE-TRAIT', () => {
  it('flat reports every offending cell — including one outside the footprint (+1 sweep)', () => {
    // 2x2 house at (5,5): footprint (5..6, 5..6); the flat sweep extends to (7,*) and (*,7).
    // Cliffs at (7,6) (outside the footprint) and (6,5) (inside it).
    const state = makeState();
    setTerrain(state, 7, 6, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2);
    const errors = traitPlacementRule.validate(place('ev-house', 5, 5), state);
    expect(errors).toHaveLength(1);
    expect(has(errors[0]!.cells, 7, 6)).toBe(true);
    expect(has(errors[0]!.cells, 6, 5)).toBe(true);
    expect(has(errors[0]!.cells, 5, 5)).toBe(false); // the anchor itself is level — not evidence
    expect(errors[0]!.grid).toBe('micro');
  });

  it('flat reports water cells as evidence', () => {
    const state = makeState();
    setTerrain(state, 6, 6, TerrainType.Water, 0);
    const errors = traitPlacementRule.validate(place('ev-house', 5, 5), state);
    expect(errors).toHaveLength(1);
    expect(has(errors[0]!.cells, 6, 6)).toBe(true);
    expect(errors[0]!.grid).toBe('micro');
  });

  it('noFloat reports exactly the cells with no real surface', () => {
    // 2x1 pier at (5,5): (5,5) sits on mountain, (6,5) on bare ground → only (6,5) floats.
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const errors = traitPlacementRule.validate(place('ev-pier', 5, 5), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([{ x: 6, y: 5 }]);
    expect(errors[0]!.grid).toBe('micro');
  });

  it('surfaceCoating reports exactly the water/missing cells', () => {
    // 2x1 path at (5,5): (6,5) is water → only that cell is evidence.
    const state = makeState();
    setTerrain(state, 6, 5, TerrainType.Water, 0);
    const errors = traitPlacementRule.validate(place('ev-path', 5, 5), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([{ x: 6, y: 5 }]);
    expect(errors[0]!.grid).toBe('micro');
  });

  it('exclusionRadius reports the footprints of ALL conflicting objects', () => {
    const state = makeState();
    state.objects.set('t1', existing('ev-tree', 't1', 5, 5));
    state.objects.set('t2', existing('ev-tree', 't2', 8, 6));
    const errors = traitPlacementRule.validate(place('ev-tree', 6, 6), state);
    expect(errors).toHaveLength(1);
    expect(has(errors[0]!.cells, 5, 5)).toBe(true);
    expect(has(errors[0]!.cells, 8, 6)).toBe(true);
    expect(has(errors[0]!.cells, 6, 6)).toBe(false); // the attempted spot is not the evidence
    expect(errors[0]!.grid).toBe('macro');
  });
});

describe('evidence cells: V-PLACE-OVERLAP', () => {
  it('reports the intersection cells, not the anchor', () => {
    // Existing 2x2 at (5,5) covers (5..6, 5..6); new 2x2 at (6,6) covers (6..7, 6..7).
    // Intersection = exactly (6,6).
    const state = makeState();
    state.objects.set('a', existing('ev-house', 'a', 5, 5));
    const errors = placementOverlapRule.validate(place('ev-house', 6, 6), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([{ x: 6, y: 6 }]);
    expect(errors[0]!.rects).toEqual([{ x: 6, y: 6, w: 1, h: 1 }]);
    expect(errors[0]!.grid).toBe('macro');
  });

  it('a half-grid blocker reports the true overlap, which no whole cell can name', () => {
    // A halfStep body anchored at (5.5, 5.5) covers [5.5, 7.5); the new 2x2 at (5,5) covers
    // [5, 7). Their overlap is [5.5, 7) — one and a half cells, on the half grid.
    const state = makeState();
    const halfBody: PlacedObject = {
      id: 'h', catalogId: 'ev-house', position: { x: 5.5, y: 5.5 }, rotation: 0, elevation: 0,
    };
    state.objects.set('h', halfBody);
    const errors = placementOverlapRule.validate(place('ev-house', 5, 5), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rects).toEqual([{ x: 5.5, y: 5.5, w: 1.5, h: 1.5 }]);
    // The whole-cell evidence rounds OUT of that body — which is why the flash draws the rect.
    expect(errors[0]!.cells).toEqual([
      { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 },
    ]);
  });

  it('accumulates intersection cells across multiple blockers', () => {
    // Blockers at (5,5) and (7,7); new 2x2 at (6,6) clips both: (6,6) and (7,7).
    const state = makeState();
    state.objects.set('a', existing('ev-house', 'a', 5, 5));
    state.objects.set('b', existing('ev-house', 'b', 7, 7));
    const errors = placementOverlapRule.validate(place('ev-house', 6, 6), state);
    expect(errors).toHaveLength(1);
    expect(has(errors[0]!.cells, 6, 6)).toBe(true);
    expect(has(errors[0]!.cells, 7, 7)).toBe(true);
  });
});

describe('evidence cells: V-PLACE-BLOCK', () => {
  const paintAt = (cells: { x: number; y: number }[]): PaintTerrainCommand => ({
    type: CommandType.PaintTerrain, timestamp: 0,
    cells, terrainType: TerrainType.Water, elevation: 0,
  });

  it('flashes the blocking object\'s footprint on the object grid, not the paint cell', () => {
    // A 2x1 pier at (5,5): painting the terrain cell under it must point at the
    // OBJECT that is in the way — its whole footprint, aligned to its sprite.
    const state = makeState();
    state.objects.set('p', existing('ev-pier', 'p', 5, 5));
    const errors = objectBlocksTerrainRule.validate(paintAt([{ x: 5, y: 5 }]), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }]);
    expect(errors[0]!.grid).toBe('macro');
  });

  it('flashes the blocker\'s exact fractional rect', () => {
    // A 20x27 plaza on the half grid touches a 21x28 whole-cell footprint. Rect evidence must
    // preserve its fractional body instead of adding half a cell on every side.
    const state = makeState(120, 120);
    const plaza: PlacedObject = {
      id: '__plaza__', catalogId: '__plaza__', position: { x: 76.5, y: 58.5 },
      width: 20, height: 27, rotation: 0, elevation: 1, locked: true,
    };
    state.objects.set(plaza.id, plaza);
    const errors = objectBlocksTerrainRule.validate(paintAt([{ x: 80, y: 60 }]), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rects).toEqual([{ x: 76.5, y: 58.5, w: 20, h: 27 }]);
    expect(errors[0]!.grid).toBe('macro');
    // and the whole-cell evidence still names every cell the plaza touches, for the readers
    // that cannot draw a fractional body (the agent's echo).
    const cells = errors[0]!.cells;
    expect(Math.min(...cells.map((c) => c.x))).toBe(76);
    expect(Math.max(...cells.map((c) => c.x))).toBe(96);
    expect(cells).toHaveLength(21 * 28);
  });

  it('a multi-cell command collects every distinct blocker once', () => {
    const state = makeState();
    state.objects.set('a', existing('ev-pier', 'a', 2, 2));
    state.objects.set('b', existing('ev-pier', 'b', 7, 7));
    const errors = objectBlocksTerrainRule.validate(paintAt([{ x: 2, y: 2 }, { x: 7, y: 7 }, { x: 8, y: 7 }]), state);
    expect(errors).toHaveLength(1);
    expect(has(errors[0]!.cells, 2, 2)).toBe(true);
    expect(has(errors[0]!.cells, 3, 2)).toBe(true);
    expect(has(errors[0]!.cells, 7, 7)).toBe(true);
    expect(has(errors[0]!.cells, 8, 7)).toBe(true);
    expect(errors[0]!.cells).toHaveLength(4); // each blocker's footprint exactly once
  });
});

describe('evidence cells: non-spatial rules use the whole footprint', () => {
  it('V-PLACE-MAX flashes the full rotated footprint', () => {
    const state = makeState();
    state.objects.set('u1', existing('ev-unique', 'u1', 2, 2));
    // 2x1 item rotated 90° → occupies 1x2 at (5,5).
    const errors = placementMaxCountRule.validate(place('ev-unique', 5, 5, 90), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([{ x: 5, y: 5 }, { x: 5, y: 6 }]);
    expect(errors[0]!.grid).toBe('macro');
  });

  it('V-LOCK-02 flashes the locked object\'s full footprint', () => {
    const state = makeState();
    const plaza: PlacedObject = {
      id: '__plaza__', catalogId: '__plaza__', position: { x: 3, y: 3 }, width: 2, height: 2,
      rotation: 0, elevation: 0, locked: true,
    };
    state.objects.set(plaza.id, plaza);
    const cmd: RemoveObjectCommand = {
      type: CommandType.RemoveObject, timestamp: 0, objectId: plaza.id, removedObject: plaza,    };
    const errors = lockedObjectRule.validate(cmd, state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([
      { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 4 },
    ]);
    expect(errors[0]!.grid).toBe('macro');
  });

  it('V-CHUNK-01 flashes the full attempted footprint', () => {
    const state = makeState();
    const candidate: PlacedObject = {
      id: 'c', catalogId: 'ev-house', position: { x: 5, y: 5 }, rotation: 0,
      elevation: 0,
    };
    const errors = chunkLoadViolations(state, candidate, 999_999);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([
      { x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 },
    ]);
    expect(errors[0]!.grid).toBe('macro');
  });
});

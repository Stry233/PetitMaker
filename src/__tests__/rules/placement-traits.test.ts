import { describe, it, expect } from 'vitest';
import { traitPlacementRule } from '../../rules/placement';
import { objectBlocksTerrainRule } from '../../rules/object-blocks-terrain';
import { CellZone, CommandType, TerrainType } from '../../core/model/types';
import type { PlaceObjectCommand, PaintTerrainCommand, EraseTerrainCommand } from '../../core/model/types';
import { makeState, setTerrain, setZone } from './_helpers';
import { registerCatalogItem } from '../../state/catalog';
import { ItemCategory } from '../../core/model/types';

// 2x2 flat-trait fixture (the shipped catalog has no 2x2 building; these tests
// exercise the flat-trait rule at small scale).
registerCatalogItem({
  id: 'test-house', category: ItemCategory.Building, name: { en: 'Test House', zh: '测试屋' },
  width: 2, height: 2, loadValue: 200, rotatable: true, placementMode: 'point',
  traits: [{ type: 'flat' }],
});

// 1x3 non-square rotatable fixture: exercises the flat trait against the ROTATED
// footprint (a square fixture can't, since rotation leaves its extent unchanged).
registerCatalogItem({
  id: 'test-bench', category: ItemCategory.Building, name: { en: 'Test Bench', zh: '测试长椅' },
  width: 1, height: 3, loadValue: 50, rotatable: true, placementMode: 'point',
  traits: [{ type: 'flat' }],
});

function placeItemRot(id: string, x: number, y: number, rotation: 0 | 90 | 180 | 270): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject,
    timestamp: 0,
    object: { id: 'test', catalogId: id, position: { x, y }, rotation, elevation: 0 },
    loadValue: 0,
  };
}

function placeItem(id: string, x: number, y: number): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject,
    timestamp: 0,
    object: { id: 'test', catalogId: id, position: { x, y }, rotation: 0, elevation: 0 },
    loadValue: 0,
  };
}

describe('V-PLACE-TRAIT: Trait-based placement', () => {
  describe('flat trait', () => {
    it('allows house on flat grass ground (all elev 0)', () => {
      const state = makeState();
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 5), state)).toHaveLength(0);
    });

    it('rejects house when footprint spans two elevations', () => {
      // 2x2 house at (5,5): cells (5,5)=elev0, (6,5)=elev2 → different
      const state = makeState();
      setTerrain(state, 6, 5, TerrainType.Mountain, 2);
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 5), state).length).toBeGreaterThan(0);
    });

    it('allows house on flat elevated plateau with cliff edge nearby', () => {
      // 4x6 plateau at elevation 2, surrounded by elevation 1:
      // House at (5,5): footprint + right/bottom extensions all on elev 2
      const state = makeState(12, 12);
      for (let y = 3; y <= 8; y++)
        for (let x = 4; x <= 7; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 2);
      for (let y = 2; y <= 9; y++)
        for (let x = 3; x <= 8; x++)
          if (!state.cells[y]![x]!.terrain)
            setTerrain(state, x, y, TerrainType.Mountain, 1);
      // House at (5,5): footprint (5,5)-(6,6) elev 2, extended (7,5),(7,6) elev 2, (5,7),(6,7) elev 2
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 5), state)).toHaveLength(0);
    });

    it('checks the ROTATED footprint, not the unrotated catalog dims', () => {
      // 1x3 bench at (5,5). A mountain block sits at (8,5): inside the rotated
      // (90°) footprint x[5..8] but outside the unrotated footprint x[5..6].
      const state = makeState(12, 12);
      setTerrain(state, 8, 5, TerrainType.Mountain, 2);
      // rotation 0 (occupies 1 wide x 3 tall): the block is clear of the footprint → allowed.
      expect(traitPlacementRule.validate(placeItemRot('test-bench', 5, 5, 0), state)).toHaveLength(0);
      // rotation 90 (occupies 3 wide x 1 tall): the block is now under the footprint → rejected.
      // (Before the fix this passed, because the check used the unrotated 1x3 box.)
      expect(traitPlacementRule.validate(placeItemRot('test-bench', 5, 5, 90), state).length).toBeGreaterThan(0);
    });

    it('rejects house with one footprint cell on water', () => {
      const state = makeState();
      setTerrain(state, 6, 5, TerrainType.Water, 0);
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 5), state).length).toBeGreaterThan(0);
    });

    it('allows house set back from cliff (extra right/bottom cells at same elev)', () => {
      // Cliff at x=7 (elev 2 → elev 1). House at (4,4): footprint is
      // (4,4)-(5,5) all elev 2, and extended check (6,4),(6,5) also elev 2.
      const state = makeState(10, 10);
      for (let y = 3; y <= 6; y++)
        for (let x = 3; x <= 6; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 2);
      for (let y = 3; y <= 6; y++)
        for (let x = 7; x <= 9; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 1);
      expect(traitPlacementRule.validate(placeItem('test-house', 4, 4), state)).toHaveLength(0);
    });

    it('rejects house at cliff edge (right extension hits lower elevation)', () => {
      // House at (5,4): footprint (5,4)-(6,5) all elev 2, but extended
      // right check (7,4),(7,5) at elev 1 → micro-block floating
      const state = makeState(10, 10);
      for (let y = 3; y <= 6; y++)
        for (let x = 3; x <= 6; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 2);
      for (let y = 3; y <= 6; y++)
        for (let x = 7; x <= 9; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 1);
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 4), state).length).toBeGreaterThan(0);
    });

    it('rejects house at bottom cliff edge (bottom extension hits lower elevation)', () => {
      // House at (4,5): footprint all elev 2, but extended bottom check
      // hits elev 1 row at y=7
      const state = makeState(10, 10);
      for (let y = 3; y <= 6; y++)
        for (let x = 3; x <= 7; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 2);
      for (let y = 7; y <= 9; y++)
        for (let x = 3; x <= 7; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 1);
      expect(traitPlacementRule.validate(placeItem('test-house', 4, 5), state).length).toBeGreaterThan(0);
    });

    it('rejects house straddling cliff (footprint itself spans two elevations)', () => {
      const state = makeState(10, 10);
      for (let y = 3; y <= 6; y++)
        for (let x = 3; x <= 5; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 2);
      for (let y = 3; y <= 6; y++)
        for (let x = 6; x <= 8; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 1);
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 4), state).length).toBeGreaterThan(0);
    });

    it('allows house on center of plateau (user scenario from RULES discussion)', () => {
      // 3-wide plateau at elev 2, surrounded by elev 1
      // House at center: footprint + extensions all on elev 2
      const state = makeState(10, 10);
      for (let y = 2; y <= 7; y++)
        for (let x = 2; x <= 7; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 1);
      for (let y = 3; y <= 6; y++)
        for (let x = 3; x <= 5; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 2);
      // House at (3,4): footprint (3,4)-(4,5) elev 2, extension (5,4),(5,5) elev 2, (3,6),(4,6) elev 2
      expect(traitPlacementRule.validate(placeItem('test-house', 3, 4), state)).toHaveLength(0);
    });

    it('allows a flat object flush against the plaza (plaza is overlap-only, not a cliff)', () => {
      // A raised plaza block at (6..7, 5..6): zone Plaza + terrain elev 1.
      const state = makeState(10, 10);
      for (const [px, py] of [[6, 5], [7, 5], [6, 6], [7, 6]] as const) {
        setZone(state, px, py, CellZone.Plaza);
        setTerrain(state, px, py, TerrainType.Mountain, 1);
      }
      // 1x1 stall at (5,5): footprint (5,5) is grass; its flat-trait +1 extension
      // reaches plaza cells (6,5)/(6,6) at elev 1 — those are skipped, so the stall
      // is allowed flush against the plaza (overlap itself is V-ZONE-01's job).
      expect(traitPlacementRule.validate(placeItem('building-stall', 5, 5), state)).toHaveLength(0);
    });
  });

  describe('waterSpan trait (bridges)', () => {
    it('allows wooden bridge over 3-wide water with full-width water coverage', () => {
      const state = makeState(20, 20);
      // Land on left (x=4), water at x=5,6,7, land on right (x=8)
      // Water must be 2 cells deep (bridgeWidth+1) to cover full bridge width
      setTerrain(state, 4, 5, TerrainType.Mountain, 1);
      setTerrain(state, 4, 6, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
        setTerrain(state, x, 6, TerrainType.Water, 0);
      }
      setTerrain(state, 8, 5, TerrainType.Mountain, 1);
      setTerrain(state, 8, 6, TerrainType.Mountain, 1);
      const cmd = placeItem('bridge-plank', 6, 5);
      const errors = traitPlacementRule.validate(cmd, state);
      expect(errors).toHaveLength(0);
    });

    it('rejects wooden bridge when water is only 1 cell deep (half-width)', () => {
      const state = makeState(20, 20);
      // Land on left, water at x=5,6,7 but only 1 row deep (y=5), land on right
      setTerrain(state, 4, 5, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
      }
      setTerrain(state, 8, 5, TerrainType.Mountain, 1);
      const cmd = placeItem('bridge-plank', 6, 5);
      const errors = traitPlacementRule.validate(cmd, state);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('bridge spanLength equals waterCount + 1 (not +2)', () => {
      const state = makeState(20, 20);
      // 3-wide water channel, 2 rows deep for full coverage
      setTerrain(state, 4, 5, TerrainType.Mountain, 1);
      setTerrain(state, 4, 6, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
        setTerrain(state, x, 6, TerrainType.Water, 0);
      }
      setTerrain(state, 8, 5, TerrainType.Mountain, 1);
      setTerrain(state, 8, 6, TerrainType.Mountain, 1);
      const cmd = placeItem('bridge-plank', 6, 5);
      traitPlacementRule.validate(cmd, state);
      // 3 water + 1 land end = 4 total (0.5 macro land on each visual end)
      expect(cmd.object.spanLength).toBe(4);
    });

    it('allows stone bridge over 3-wide water with full-width water coverage', () => {
      const state = makeState(20, 20);
      // Stone bridge width=2, needs 3 rows of water (bridgeWidth+1) perpendicular
      setTerrain(state, 4, 5, TerrainType.Mountain, 1);
      setTerrain(state, 4, 6, TerrainType.Mountain, 1);
      setTerrain(state, 4, 7, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
        setTerrain(state, x, 6, TerrainType.Water, 0);
        setTerrain(state, x, 7, TerrainType.Water, 0);
      }
      setTerrain(state, 8, 5, TerrainType.Mountain, 1);
      setTerrain(state, 8, 6, TerrainType.Mountain, 1);
      setTerrain(state, 8, 7, TerrainType.Mountain, 1);
      const cmd = placeItem('bridge-park-arch', 6, 5);
      const errors = traitPlacementRule.validate(cmd, state);
      expect(errors).toHaveLength(0);
    });

    it('rejects bridge when water gap is too narrow (2 cells)', () => {
      const state = makeState(20, 20);
      setTerrain(state, 4, 5, TerrainType.Mountain, 1);
      setTerrain(state, 4, 6, TerrainType.Mountain, 1);
      for (let x = 5; x <= 6; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
        setTerrain(state, x, 6, TerrainType.Water, 0);
      }
      setTerrain(state, 7, 5, TerrainType.Mountain, 1);
      setTerrain(state, 7, 6, TerrainType.Mountain, 1);
      const cmd = placeItem('bridge-plank', 5, 5);
      expect(traitPlacementRule.validate(cmd, state).length).toBeGreaterThan(0);
    });

    it('rejects bridge when water extends too far (>6) without land cap', () => {
      const state = makeState(20, 20);
      setTerrain(state, 2, 5, TerrainType.Mountain, 1);
      setTerrain(state, 2, 6, TerrainType.Mountain, 1);
      // 7-wide water gap → exceeds max span of 6
      for (let x = 3; x <= 9; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
        setTerrain(state, x, 6, TerrainType.Water, 0);
      }
      setTerrain(state, 10, 5, TerrainType.Mountain, 1);
      setTerrain(state, 10, 6, TerrainType.Mountain, 1);
      const cmd = placeItem('bridge-plank', 6, 5);
      expect(traitPlacementRule.validate(cmd, state).length).toBeGreaterThan(0);
    });

    it('allows a bridge over a dry valley (no water, equal-height flat ends)', () => {
      const state = makeState(20, 20);
      // Mountain banks at elevation 2; the gap (x=5,6,7) is bare ground (elev 0).
      for (const y of [5, 6]) {
        setTerrain(state, 4, y, TerrainType.Mountain, 2);
        setTerrain(state, 8, y, TerrainType.Mountain, 2);
      }
      const cmd = placeItem('bridge-plank', 6, 5);
      expect(traitPlacementRule.validate(cmd, state)).toHaveLength(0);
      expect(cmd.object.spanLength).toBe(4);
      expect(cmd.object.elevation).toBe(2); // deck sits at the ends' shared height
    });

    it('allows a bridge over lower mountain terrain (no water)', () => {
      const state = makeState(20, 20);
      // Banks at elevation 3; the floor (x=5,6,7) is lower mountain (elev 1).
      for (const y of [5, 6]) {
        setTerrain(state, 4, y, TerrainType.Mountain, 3);
        setTerrain(state, 8, y, TerrainType.Mountain, 3);
        for (let x = 5; x <= 7; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
      }
      const cmd = placeItem('bridge-plank', 6, 5);
      expect(traitPlacementRule.validate(cmd, state)).toHaveLength(0);
      expect(cmd.object.elevation).toBe(3);
    });

    it('rejects a bridge whose two ends are different heights', () => {
      const state = makeState(20, 20);
      for (const y of [5, 6]) {
        setTerrain(state, 4, y, TerrainType.Mountain, 2);
        setTerrain(state, 8, y, TerrainType.Mountain, 3); // far end higher → not equal
      }
      const cmd = placeItem('bridge-plank', 6, 5);
      expect(traitPlacementRule.validate(cmd, state).length).toBeGreaterThan(0);
    });
  });

  describe('exclusionRadius trait', () => {
    it('rejects tree too close to existing tree', () => {
      const state = makeState();
      state.objects.set('existing', {
        id: 'existing', catalogId: 'tree-apple',
        position: { x: 6, y: 5 }, rotation: 0, elevation: 0,
      });
      expect(traitPlacementRule.validate(placeItem('tree-apple', 5, 5), state).length).toBeGreaterThan(0);
    });

    it('allows tree far from existing tree', () => {
      const state = makeState();
      state.objects.set('existing', {
        id: 'existing', catalogId: 'tree-apple',
        position: { x: 8, y: 5 }, rotation: 0, elevation: 0,
      });
      expect(traitPlacementRule.validate(placeItem('tree-apple', 5, 5), state)).toHaveLength(0);
    });
  });

  describe('surfaceCoating trait', () => {
    it('allows road on ground (no terrain)', () => {
      const state = makeState();
      expect(traitPlacementRule.validate(placeItem('road-dirt', 5, 5), state)).toHaveLength(0);
    });

    it('allows road on flat mountain terrain', () => {
      const state = makeState();
      // flat trait checks (w+1)×(h+1) = 2×2 area for 1×1 road
      for (let y = 5; y <= 6; y++)
        for (let x = 5; x <= 6; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 1);
      expect(traitPlacementRule.validate(placeItem('road-dirt', 5, 5), state)).toHaveLength(0);
    });

    it('rejects road on water', () => {
      const state = makeState();
      setTerrain(state, 5, 5, TerrainType.Water, 1);
      expect(traitPlacementRule.validate(placeItem('road-dirt', 5, 5), state).length).toBeGreaterThan(0);
    });
  });

  it('returns empty for unknown catalog item', () => {
    const state = makeState();
    expect(traitPlacementRule.validate(placeItem('nonexistent', 5, 5), state)).toHaveLength(0);
  });
});

describe('V-PLACE-BLOCK: mountain over roads', () => {
  function addRoad(state: any, x: number, y: number) {
    state.objects.set(`road-${x}-${y}`, {
      id: `road-${x}-${y}`, catalogId: 'road-dirt',
      position: { x, y }, rotation: 0, elevation: 0,
    });
  }
  function addHouse(state: any, x: number, y: number) {
    state.objects.set(`house-${x}-${y}`, {
      id: `house-${x}-${y}`, catalogId: 'test-house',
      position: { x, y }, rotation: 0, elevation: 0,
    });
  }
  function paint(x: number, y: number, type: TerrainType): PaintTerrainCommand {
    return { type: CommandType.PaintTerrain, timestamp: 0,
      cells: [{ x, y }], terrainType: type, elevation: 1 };
  }
  function erase(x: number, y: number): EraseTerrainCommand {
    return { type: CommandType.EraseTerrain, timestamp: 0, cells: [{ x, y }] };
  }

  it('allows mountain paint on a road cell', () => {
    const state = makeState();
    addRoad(state, 5, 5);
    expect(objectBlocksTerrainRule.validate(paint(5, 5, TerrainType.Mountain), state)).toHaveLength(0);
  });

  it('blocks water paint on a road cell', () => {
    const state = makeState();
    addRoad(state, 5, 5);
    expect(objectBlocksTerrainRule.validate(paint(5, 5, TerrainType.Water), state).length).toBeGreaterThan(0);
  });

  it('blocks erase on a road cell', () => {
    const state = makeState();
    addRoad(state, 5, 5);
    expect(objectBlocksTerrainRule.validate(erase(5, 5), state).length).toBeGreaterThan(0);
  });

  it('blocks mountain paint on a house cell (solid object)', () => {
    const state = makeState();
    addHouse(state, 5, 5);
    expect(objectBlocksTerrainRule.validate(paint(5, 5, TerrainType.Mountain), state).length).toBeGreaterThan(0);
  });
});

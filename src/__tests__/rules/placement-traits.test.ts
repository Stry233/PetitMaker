import { describe, it, expect } from 'vitest';
import { traitPlacementRule } from '../../rules/placement';
import { objectBlocksTerrainRule } from '../../rules/object-blocks-terrain';
import { CommandType, TerrainType, type GridState, type Rotation } from '../../core/model/types';
import type { PlaceObjectCommand, PaintTerrainCommand, EraseTerrainCommand } from '../../core/model/types';
import { makeState, setTerrain } from '../_support/map-state';
import { __setCatalogItem } from '../../state/catalog';
import { ItemCategory } from '../../config/catalog/categories';

// 2x2 flat-trait fixture; the shipped catalog has no 2x2 building.
__setCatalogItem({
  id: 'test-house', category: ItemCategory.Building, name: { en: 'Test House', zh: '测试屋' },
  width: 2, height: 2, loadValue: 200, rotatable: true, placementMode: 'point',
  traits: [{ type: 'flat' }],
});

// 1x3 rotatable fixture: rotation leaves a square footprint's extent unchanged.
__setCatalogItem({
  id: 'test-bench', category: ItemCategory.Building, name: { en: 'Test Bench', zh: '测试长椅' },
  width: 1, height: 3, loadValue: 50, rotatable: true, placementMode: 'point',
  traits: [{ type: 'flat' }],
});

function placeItemRot(id: string, x: number, y: number, rotation: Rotation): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject,
    object: { id: 'test', catalogId: id, position: { x, y }, rotation, elevation: 0 },
  };
}

/** `cmd` as the trait resolves it, the command every rule judges. */
function landed(cmd: PlaceObjectCommand, state: GridState): PlaceObjectCommand {
  return traitPlacementRule.resolve!(cmd, state) as PlaceObjectCommand;
}

function placeItem(id: string, x: number, y: number): PlaceObjectCommand {
  return {
    type: CommandType.PlaceObject,
    object: { id: 'test', catalogId: id, position: { x, y }, rotation: 0, elevation: 0 },
  };
}

describe('V-PLACE-TRAIT: Trait-based placement', () => {
  describe('flat trait', () => {
    it('allows house on flat grass ground (all elev 0)', () => {
      const state = makeState();
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 5), state)).toHaveLength(0);
    });

    it('rejects house when footprint spans two elevations', () => {
      const state = makeState();
      setTerrain(state, 6, 5, TerrainType.Mountain, 2);
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 5), state).length).toBeGreaterThan(0);
    });

    it('allows house on flat elevated plateau with cliff edge nearby', () => {
      // 4x6 plateau at elevation 2 inside elevation 1; the footprint and its right and bottom
      // extensions all stand on 2.
      const state = makeState(12, 12);
      for (let y = 3; y <= 8; y++)
        for (let x = 4; x <= 7; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 2);
      for (let y = 2; y <= 9; y++)
        for (let x = 3; x <= 8; x++)
          if (!state.cells[y]![x]!.terrain)
            setTerrain(state, x, y, TerrainType.Mountain, 1);
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 5), state)).toHaveLength(0);
    });

    it('checks the ROTATED footprint, not the unrotated catalog dims', () => {
      // The block at (8,5) is inside the checked area x 5..8 of the bench rotated 90 degrees and
      // outside the unrotated one's x 5..6.
      const state = makeState(12, 12);
      setTerrain(state, 8, 5, TerrainType.Mountain, 2);
      expect(traitPlacementRule.validate(placeItemRot('test-bench', 5, 5, 0), state)).toHaveLength(0);
      expect(traitPlacementRule.validate(placeItemRot('test-bench', 5, 5, 90), state).length).toBeGreaterThan(0);
    });

    it('rejects house with one footprint cell on water', () => {
      const state = makeState();
      setTerrain(state, 6, 5, TerrainType.Water, 0);
      expect(traitPlacementRule.validate(placeItem('test-house', 5, 5), state).length).toBeGreaterThan(0);
    });

    it('allows house set back from cliff (extra right/bottom cells at same elev)', () => {
      // Cliff at x=7 (2 down to 1); the footprint (4,4)-(5,5) and its extension at x=6 are all on 2.
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
      // The footprint (5,4)-(6,5) is on 2 but its right extension at x=7 is on 1.
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
      // The footprint is on 2 but its bottom extension at y=7 is on 1.
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
      // 3-wide plateau at 2 inside 1; the footprint and its extensions all stand on 2.
      const state = makeState(10, 10);
      for (let y = 2; y <= 7; y++)
        for (let x = 2; x <= 7; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 1);
      for (let y = 3; y <= 6; y++)
        for (let x = 3; x <= 5; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 2);
      expect(traitPlacementRule.validate(placeItem('test-house', 3, 4), state)).toHaveLength(0);
    });
  });

  describe('waterSpan trait (bridges)', () => {
    it('allows wooden bridge over 3-wide water with full-width water coverage', () => {
      const state = makeState(20, 20);
      // Land at x=4 and x=8, water between; two rows deep (bridge width + 1) covers the full width.
      setTerrain(state, 4, 5, TerrainType.Mountain, 1);
      setTerrain(state, 4, 6, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
        setTerrain(state, x, 6, TerrainType.Water, 0);
      }
      setTerrain(state, 8, 5, TerrainType.Mountain, 1);
      setTerrain(state, 8, 6, TerrainType.Mountain, 1);
      const cmd = landed(placeItem('bridge-plank', 6, 5), state);
      const errors = traitPlacementRule.validate(cmd, state);
      expect(errors).toHaveLength(0);
    });

    it('rejects wooden bridge when water is only 1 cell deep (half-width)', () => {
      const state = makeState(20, 20);
      setTerrain(state, 4, 5, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
      }
      setTerrain(state, 8, 5, TerrainType.Mountain, 1);
      const cmd = landed(placeItem('bridge-plank', 6, 5), state);
      const errors = traitPlacementRule.validate(cmd, state);
      expect(errors.length).toBeGreaterThan(0);
    });

    it('bridge spanLength equals waterCount + 1 (not +2)', () => {
      const state = makeState(20, 20);
      setTerrain(state, 4, 5, TerrainType.Mountain, 1);
      setTerrain(state, 4, 6, TerrainType.Mountain, 1);
      for (let x = 5; x <= 7; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
        setTerrain(state, x, 6, TerrainType.Water, 0);
      }
      setTerrain(state, 8, 5, TerrainType.Mountain, 1);
      setTerrain(state, 8, 6, TerrainType.Mountain, 1);
      const cmd = landed(placeItem('bridge-plank', 6, 5), state);
      traitPlacementRule.validate(cmd, state);
      // Three water cells plus half a land cell at each end.
      expect(cmd.object.spanLength).toBe(4);
    });

    it('allows stone bridge over 3-wide water with full-width water coverage', () => {
      const state = makeState(20, 20);
      // A stone bridge is 2 wide, so it needs 3 rows of water.
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
      const cmd = landed(placeItem('bridge-park-arch', 6, 5), state);
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
      const cmd = landed(placeItem('bridge-plank', 5, 5), state);
      expect(traitPlacementRule.validate(cmd, state).length).toBeGreaterThan(0);
    });

    it('rejects bridge when water extends too far (>6) without land cap', () => {
      const state = makeState(20, 20);
      setTerrain(state, 2, 5, TerrainType.Mountain, 1);
      setTerrain(state, 2, 6, TerrainType.Mountain, 1);
      // A 7-wide gap exceeds the maximum span of 6.
      for (let x = 3; x <= 9; x++) {
        setTerrain(state, x, 5, TerrainType.Water, 0);
        setTerrain(state, x, 6, TerrainType.Water, 0);
      }
      setTerrain(state, 10, 5, TerrainType.Mountain, 1);
      setTerrain(state, 10, 6, TerrainType.Mountain, 1);
      const cmd = landed(placeItem('bridge-plank', 6, 5), state);
      expect(traitPlacementRule.validate(cmd, state).length).toBeGreaterThan(0);
    });

    it('allows a bridge over a dry valley (no water, equal-height flat ends)', () => {
      const state = makeState(20, 20);
      // Mountain banks at elevation 2; the gap (x=5,6,7) is bare ground (elev 0).
      for (const y of [5, 6]) {
        setTerrain(state, 4, y, TerrainType.Mountain, 2);
        setTerrain(state, 8, y, TerrainType.Mountain, 2);
      }
      const cmd = landed(placeItem('bridge-plank', 6, 5), state);
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
      const cmd = landed(placeItem('bridge-plank', 6, 5), state);
      expect(traitPlacementRule.validate(cmd, state)).toHaveLength(0);
      expect(cmd.object.elevation).toBe(3);
    });

    it('rejects a bridge whose two ends are different heights', () => {
      const state = makeState(20, 20);
      for (const y of [5, 6]) {
        setTerrain(state, 4, y, TerrainType.Mountain, 2);
        setTerrain(state, 8, y, TerrainType.Mountain, 3);
      }
      const cmd = landed(placeItem('bridge-plank', 6, 5), state);
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
      expect(traitPlacementRule.validate(placeItem('path-overgrown-dirt', 5, 5), state)).toHaveLength(0);
    });

    it('allows road on flat mountain terrain', () => {
      const state = makeState();
      // The flat trait checks (w+1) x (h+1), so a 1x1 road needs 2x2 level ground.
      for (let y = 5; y <= 6; y++)
        for (let x = 5; x <= 6; x++)
          setTerrain(state, x, y, TerrainType.Mountain, 1);
      expect(traitPlacementRule.validate(placeItem('path-overgrown-dirt', 5, 5), state)).toHaveLength(0);
    });

    it('rejects road on water', () => {
      const state = makeState();
      setTerrain(state, 5, 5, TerrainType.Water, 1);
      expect(traitPlacementRule.validate(placeItem('path-overgrown-dirt', 5, 5), state).length).toBeGreaterThan(0);
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
      id: `road-${x}-${y}`, catalogId: 'path-overgrown-dirt',
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
    return { type: CommandType.PaintTerrain,       cells: [{ x, y }], terrainType: type, elevation: 1 };
  }
  function erase(x: number, y: number): EraseTerrainCommand {
    return { type: CommandType.EraseTerrain, cells: [{ x, y }] };
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

  it('allows erase on a road cell — the road follows its surface down or is removed at commit', () => {
    const state = makeState();
    addRoad(state, 5, 5);
    expect(objectBlocksTerrainRule.validate(erase(5, 5), state)).toHaveLength(0);
  });

  it('blocks erase on a house cell (solid object)', () => {
    const state = makeState();
    addHouse(state, 5, 5);
    expect(objectBlocksTerrainRule.validate(erase(5, 5), state).length).toBeGreaterThan(0);
  });

  it('blocks mountain paint on a house cell (solid object)', () => {
    const state = makeState();
    addHouse(state, 5, 5);
    expect(objectBlocksTerrainRule.validate(paint(5, 5, TerrainType.Mountain), state).length).toBeGreaterThan(0);
  });
});

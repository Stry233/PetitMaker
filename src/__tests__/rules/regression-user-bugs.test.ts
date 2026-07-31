/**
 * Regression tests for user-reported bugs (2026-05-24).
 *
 * These tests reproduce the exact scenarios the user described.
 * All diagrams use top-view at elevation 2 unless noted otherwise.
 * "Two level" = elevation 2 (layer 2).
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { waterContainmentRule } from '../../rules/water-containment';
import { waterfallAdjacentUniformityRule } from '../../rules/waterfall-uniformity';
import { baseSupportRule } from '../../rules/base-support';
import { detectWaterfalls } from '../../core/model/waterfall-geometry';
import { CommandType, TerrainType, type EditorEvents, type PaintTerrainCommand } from '../../core/model/types';
import { makeState, setTerrain } from './_helpers';
import { cellOverlapsRect, createPlazaObject } from '../../core/model/grid-model';
import { getActiveLayers } from '../../core/model/layer-utils';

function paint(x: number, y: number, type: TerrainType, elev: number): PaintTerrainCommand {
  return { type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x, y }], terrainType: type, elevation: elev };
}

describe('User Bug 1: Water should become waterfall with south direction', () => {
  // Top-view at elev 2:
  // M M M M M M
  // M M M M M M
  // M W W W W M  ← water should have south-flowing waterfall face
  it('detects south-flowing waterfall after painting water row', () => {
    const state = makeState(10, 10);
    for (let y = 2; y <= 4; y++)
      for (let x = 2; x <= 7; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);
    for (let x = 3; x <= 6; x++)
      setTerrain(state, x, 4, TerrainType.Water, 2);

    const waterfalls = detectWaterfalls(state);
    const southFaces = waterfalls.flatMap(w => w.faces).filter(f => f.flowDirection === 'south');
    expect(southFaces.length).toBeGreaterThan(0);
  });
});

describe('User Bug 2: Enclosed water row must not be rejected', () => {
  // Top-view at elev 2:
  // M M M M M M
  // M W W W W M  ← enclosed by mountains on all sides
  // M M M M M M
  it('allows painting enclosed water row via full stroke pipeline', () => {
    const state = makeState(10, 10);
    for (let y = 3; y <= 5; y++)
      for (let x = 2; x <= 7; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const strokeStart = executor.getUndoStackSize();

    for (let x = 3; x <= 6; x++) {
      const result = executor.execute(paint(x, 4, TerrainType.Water, 2));
      expect(result.success).toBe(true);
    }

    const violations = executor.commitStroke(strokeStart);
    expect(violations).toHaveLength(0);

    for (let x = 3; x <= 6; x++)
      expect(state.cells[4]![x]!.terrain?.type).toBe(TerrainType.Water);
  });

  it('containment rule passes for enclosed water', () => {
    const state = makeState(10, 10);
    for (let y = 3; y <= 5; y++)
      for (let x = 2; x <= 7; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);
    for (let x = 3; x <= 6; x++)
      setTerrain(state, x, 4, TerrainType.Water, 2);

    expect(waterContainmentRule.validate(state)).toHaveLength(0);
  });

  it('adjacency uniformity rule passes for fully enclosed water', () => {
    const state = makeState(10, 10);
    for (let y = 3; y <= 5; y++)
      for (let x = 2; x <= 7; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);
    for (let x = 3; x <= 6; x++)
      setTerrain(state, x, 4, TerrainType.Water, 2);

    expect(waterfallAdjacentUniformityRule.validate(state)).toHaveLength(0);
  });
});

describe('User Bug 3: Cross pattern water in 3x3 mountain', () => {
  // Top-view at elev 2:
  //   M W M
  //   W W W  ← cross pattern
  //   M W M
  it('allows cross pattern via full stroke pipeline', () => {
    const state = makeState(10, 10);
    for (let y = 4; y <= 6; y++)
      for (let x = 4; x <= 6; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const strokeStart = executor.getUndoStackSize();

    const crossCells = [[5, 5], [5, 4], [4, 5], [6, 5], [5, 6]];
    for (const [x, y] of crossCells) {
      const result = executor.execute(paint(x!, y!, TerrainType.Water, 2));
      expect(result.success).toBe(true);
    }

    const violations = executor.commitStroke(strokeStart);
    expect(violations).toHaveLength(0);
  });

  it('allows painting left edge water cell individually', () => {
    const state = makeState(10, 10);
    for (let y = 4; y <= 6; y++)
      for (let x = 4; x <= 6; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const result = executor.execute(paint(4, 5, TerrainType.Water, 2));
    expect(result.success).toBe(true);
  });
});

describe('User Bug 4: Layer panel block counts', () => {
  // Side view: build a 3x3 mountain from layer 1 to 3
  // Each layer should show correct block count even when covered
  it('counts cells in all layers they occupy', () => {
    const state = makeState(10, 10);
    // Single column: mountain at elev 3 occupies layers 1, 2, 3
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);

    const layers = getActiveLayers(state);
    const l1 = layers.find(l => l.elevation === 1);
    const l2 = layers.find(l => l.elevation === 2);
    const l3 = layers.find(l => l.elevation === 3);

    expect(l1?.cellCount).toBe(1);
    expect(l2?.cellCount).toBe(1);
    expect(l3?.cellCount).toBe(1);
  });

  it('layer 1 count stays when fully covered by layer 2', () => {
    const state = makeState(10, 10);
    // 3x3 at elevation 2 — each cell occupies layers 1 and 2
    for (let y = 4; y <= 6; y++)
      for (let x = 4; x <= 6; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const layers = getActiveLayers(state);
    const l1 = layers.find(l => l.elevation === 1);
    const l2 = layers.find(l => l.elevation === 2);

    expect(l1?.cellCount).toBe(9);
    expect(l2?.cellCount).toBe(9);
  });

  it('stacking layers 1-4 shows correct counts at each layer', () => {
    const state = makeState(10, 10);
    // 3x3 at elev 1, then center column at elev 4
    for (let y = 4; y <= 6; y++)
      for (let x = 4; x <= 6; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);

    const layers = getActiveLayers(state);
    expect(layers.find(l => l.elevation === 1)?.cellCount).toBe(9);
    expect(layers.find(l => l.elevation === 2)?.cellCount).toBe(1);
    expect(layers.find(l => l.elevation === 3)?.cellCount).toBe(1);
    expect(layers.find(l => l.elevation === 4)?.cellCount).toBe(1);
  });

  // Adding an empty layer (selecting a layer above any terrain) must not drop the
  // empty intermediate layers — the list is contiguous Ground..top.
  it('keeps empty intermediate layers when a higher layer is active', () => {
    const state = makeState(10, 10); // no terrain at all
    const layers = getActiveLayers(state, 3); // active layer 3 (e.g. after +,+,+)
    expect(layers.map(l => l.elevation)).toEqual([0, 1, 2, 3]); // contiguous, no gaps
    // Every layer 1..3 is present even though empty (count 0).
    expect(layers.find(l => l.elevation === 2)?.cellCount).toBe(0);
  });

  it('shows the full contiguous range up to the highest of active-layer or terrain', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 5); // terrain reaches layer 5
    const layers = getActiveLayers(state, 2); // a lower layer is selected
    expect(layers.map(l => l.elevation)).toEqual([0, 1, 2, 3, 4, 5]); // terrain still listed
  });
});

describe('User Bug 5: Plaza collision boundary', () => {
  // Plaza occupies world x ∈ [76.5, 96.5]. Terrain renders on the micro-grid
  // (−HALF_TILE), so a terrain cell x covers [x−0.5, x+0.5]:
  //   x=76 → [75.5, 76.5]  touches the plaza edge, no overlap → buildable
  //   x=77 → [76.5, 77.5]  overlaps the plaza                → blocked
  //   x=96 → [95.5, 96.5]  overlaps the plaza                → blocked
  //   x=97 → [96.5, 97.5]  touches the plaza edge, no overlap → buildable
  // The plaza is an immutable object now; build a state that has it (from the
  // template's plaza config) so the standard placement rules enforce no-build.
  const PLAZA = { x: 76.5, y: 58.5, width: 20, height: 27, elevation: 1 };
  const withPlaza = (w = 100, h = 100) => {
    const state = makeState(w, h);
    state.template.plaza = { ...PLAZA };
    const plaza = createPlazaObject(state.template);
    if (plaza) state.objects.set(plaza.id, plaza);
    return state;
  };
  const exec = (state: ReturnType<typeof makeState>) =>
    new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());

  it('allows mountain/water on terrain cells adjacent to the plaza (touching, no overlap)', () => {
    const e = exec(withPlaza());
    expect(e.execute(paint(76, 70, TerrainType.Mountain, 1)).success).toBe(true);
    expect(e.execute(paint(97, 70, TerrainType.Water, 1)).success).toBe(true);
  });

  it('blocks terrain cells whose footprint overlaps the plaza', () => {
    const e = exec(withPlaza());
    expect(e.execute(paint(77, 70, TerrainType.Mountain, 1)).success).toBe(false);
    expect(e.execute(paint(96, 70, TerrainType.Mountain, 1)).success).toBe(false);
  });

  it('cellOverlapsRect uses the right cell extent for terrain (−0.5) vs objects (0)', () => {
    const rect = { x: 76.5, y: 58.5, w: 20, h: 27 }; // plaza footprint rect
    // Terrain (−0.5): cell 76/97 only touch the edge; 77/96 overlap.
    expect(cellOverlapsRect(rect, 76, 70, -0.5)).toBe(false);
    expect(cellOverlapsRect(rect, 77, 70, -0.5)).toBe(true);
    expect(cellOverlapsRect(rect, 96, 70, -0.5)).toBe(true);
    expect(cellOverlapsRect(rect, 97, 70, -0.5)).toBe(false);
    // Objects (shift 0): cell 76 [76,77] already overlaps the plaza; 75 doesn't.
    expect(cellOverlapsRect(rect, 76, 70, 0)).toBe(true);
    expect(cellOverlapsRect(rect, 75, 70, 0)).toBe(false);
  });
});

describe('User Bug 6: 3x3 block at layer 4 must not be self-supporting', () => {
  // Side view:
  // M M M   (layer 4)
  // M M M   (layer 3)
  // M M M   (layer 2)
  // M M M   (layer 1)
  // .........
  // The edge blocks at layer 4 have no 3x3 base of mountain at elev >= 1
  it('rejects 3x3 layer-4 block without proper lower base', () => {
    const state = makeState(10, 10);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 4);
    const errors = baseSupportRule.validate(state);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('User Bug 7: Two-layer structure with inner water at elev 2', () => {
  // Top view:
  // ..111111111111...
  // ..112222222211...
  // ..112↓↓↓↓↓↓211...   ← water at elev 2 between elev-2 caps
  // ..111111111111...
  it('allows water at elev 2 between elev-2 mountain caps (exact user scenario)', () => {
    const state = makeState(20, 20);
    // Outer ring at elevation 1
    for (let y = 5; y <= 10; y++)
      for (let x = 5; x <= 16; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 1);
    // Inner area at elevation 2
    for (let y = 6; y <= 9; y++)
      for (let x = 7; x <= 14; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);
    // Paint water at elev 2 on inner row, BETWEEN the elev-2 mountains
    for (let x = 8; x <= 13; x++)
      setTerrain(state, x, 8, TerrainType.Water, 2);
    // Caps at (7,8) and (14,8) are BOTH mountain elev 2

    expect(waterContainmentRule.validate(state)).toHaveLength(0);
    expect(waterfallAdjacentUniformityRule.validate(state)).toHaveLength(0);
  });

  it('full stroke pipeline succeeds for this scenario', () => {
    const state = makeState(20, 20);
    for (let y = 5; y <= 10; y++)
      for (let x = 5; x <= 16; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 1);
    for (let y = 6; y <= 9; y++)
      for (let x = 7; x <= 14; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    const strokeStart = executor.getUndoStackSize();
    for (let x = 8; x <= 13; x++) {
      const result = executor.execute(paint(x, 8, TerrainType.Water, 2));
      expect(result.success).toBe(true);
    }
    expect(executor.commitStroke(strokeStart)).toHaveLength(0);
  });
});

describe('User Bug 8: Water at elev 2 needs elev-2 caps on perpendicular', () => {
  // Two-layer structure with elev-1 outer ring, elev-2 inner area.
  // Water at elev 2 replacing bottom inner row:
  // ..111111111111...
  // ..112222222211...
  // ..11WWWWWWWW11...  ← water at elev 2
  // ..111111111111...
  // The elev-1 outer ring CANNOT cap elev-2 water — correct rejection.
  it('correctly rejects water at elev 2 when perpendicular caps are only elev 1', () => {
    const state = makeState(20, 20);
    // Outer ring at elevation 1
    for (let y = 5; y <= 10; y++)
      for (let x = 5; x <= 16; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 1);
    // Inner area at elevation 2
    for (let y = 6; y <= 9; y++)
      for (let x = 7; x <= 14; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);
    // Replace bottom inner row with water at elev 2
    for (let x = 7; x <= 14; x++)
      setTerrain(state, x, 9, TerrainType.Water, 2);

    const errors = waterContainmentRule.validate(state);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows water at elev 2 when perpendicular caps ARE at elev 2', () => {
    const state = makeState(20, 20);
    // Full block at elevation 2 — all caps at elev 2
    for (let y = 5; y <= 10; y++)
      for (let x = 5; x <= 16; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);
    // Replace one row with water
    for (let x = 7; x <= 14; x++)
      setTerrain(state, x, 8, TerrainType.Water, 2);

    const errors = waterContainmentRule.validate(state);
    expect(errors).toHaveLength(0);
  });
});

describe('Ramp placement — all 4 directions on rectangular mountain', () => {
  // Mountain block at elev 1: x=[5,14], y=[5,14]  (10x10 block)
  // Ground surrounds it. Ramp (2x4, heightDrop 1) placed at each edge.
  function makeRampState(): import('../../core/model/types').GridState {
    const state = makeState(20, 20);
    for (let y = 5; y <= 14; y++)
      for (let x = 5; x <= 14; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 1);
    return state;
  }

  function placeRamp(x: number, y: number): import('../../core/model/types').PlaceObjectCommand {
    return {
      type: CommandType.PlaceObject, timestamp: 0,
      object: { id: 'r1', catalogId: 'ramp-park-steps', position: { x, y }, rotation: 0 as const, elevation: 0 },
      loadValue: 80,
    };
  }

  it('rot=0 (south): click on bottom mountain edge, ramp extends down', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // Click on mountain at (8, 14) — neighbor (8, 15) is ground
    // rot=0 includes high cell: position stays at highY=14
    const cmd = placeRamp(8, 14);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors).toHaveLength(0);
    expect(cmd.object.rotation).toBe(0);
    expect(cmd.object.position.y).toBe(14);
  });

  it('rot=180 (north): click on top mountain edge, ramp extends up', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // Click on mountain at (8, 5) — neighbor (8, 4) is ground
    const cmd = placeRamp(8, 5);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors).toHaveLength(0);
    expect(cmd.object.rotation).toBe(180);
  });

  it('rot=90 (east): click on right mountain edge, ramp extends right', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // Click on mountain at (14, 8) — neighbor (15, 8) is ground
    const cmd = placeRamp(14, 8);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors).toHaveLength(0);
    expect(cmd.object.rotation).toBe(90);
  });

  it('rot=270 (west): click on left mountain edge, ramp extends left', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // Click on mountain at (5, 8) — neighbor (4, 8) is ground
    const cmd = placeRamp(5, 8);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors).toHaveLength(0);
    expect(cmd.object.rotation).toBe(270);
  });

  it('rejects ramp at corner (perpendicular extends off mountain)', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // rot=0 includes high cell: ramp at (14,14) has high cell at y=14, x=14,15.
    // x=15 is ground — micro-block check reaches x=16 (off mountain) → rejects.
    const cmd = placeRamp(14, 14);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects ramp where low terrain has mixed elevation', () => {
    const state = makeRampState();
    setTerrain(state, 8, 16, TerrainType.Mountain, 1);
    const registry = createDefaultRegistry();
    const cmd = placeRamp(8, 14);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors.length).toBeGreaterThan(0);
  });

  // Bug (user-reported): a mountain intruding on the LOW footprint from the trailing (bottom /
  // down-right) edge was MISSED — the validator swept the -HALF_TILE bleed on ONE axis only, so an
  // illegal ramp was accepted. The low run + its trailing bleed must all be clear.
  it('rejects ramp when a mountain intrudes on the trailing/bottom edge of the low run (no leak)', () => {
    const state = makeRampState();         // 10x10 elev-1 block [5,14]; south ramp at (8,14) spans y=14..17
    setTerrain(state, 8, 18, TerrainType.Mountain, 1); // the trailing bleed row that must be swept
    const cmd = placeRamp(8, 14);
    const errors = createDefaultRegistry().validatePreCommand(cmd, state);
    expect(errors.length, 'a mountain at the ramp foot must block it').toBeGreaterThan(0);
  });
});

describe('Ramp placement — multi-tier + directional symmetry', () => {
  // A two-tier plateau: a `depth`-deep tier-1 ring around a 6x6 tier-2 core, ground beyond.
  function twoTier(depth: number): { state: import('../../core/model/types').GridState; c0: number; c1: number; mid: number } {
    const state = makeState(40, 40);
    const ringLo = 5, core0 = ringLo + depth, core1 = core0 + 5, ringHi = core1 + depth;
    for (let y = ringLo; y <= ringHi; y++) for (let x = ringLo; x <= ringHi; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    for (let y = core0; y <= core1; y++) for (let x = core0; x <= core1; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    return { state, c0: core0, c1: core1, mid: (core0 + core1) >> 1 };
  }
  function legal(state: import('../../core/model/types').GridState, x: number, y: number): boolean {
    const cmd: import('../../core/model/types').PlaceObjectCommand = {
      type: CommandType.PlaceObject, timestamp: 0,
      object: { id: 'r1', catalogId: 'ramp-park-steps', position: { x, y }, rotation: 0 as const, elevation: 0 },
      loadValue: 80,
    };
    return createDefaultRegistry().validatePreCommand(cmd, state).length === 0;
  }

  it('a 2->1 ramp validates on a wide shelf from ALL FOUR edges of the inner block', () => {
    const { state, c0, c1, mid } = twoTier(5); // 5-deep ring — room for a 4-long ramp's landing
    expect(legal(state, mid, c1), 'south').toBe(true);
    expect(legal(state, c1, mid), 'east').toBe(true);
    expect(legal(state, mid, c0), 'north').toBe(true);
    expect(legal(state, c0, mid), 'west').toBe(true);
  });

  it('a too-narrow shelf rejects CONSISTENTLY in all 4 directions (no N/W vs S/E asymmetry)', () => {
    const { state, c0, c1, mid } = twoTier(3); // 3-deep ring can't fit a 4-long ramp from any side
    expect(legal(state, mid, c1), 'south').toBe(false);
    expect(legal(state, c1, mid), 'east').toBe(false);
    expect(legal(state, mid, c0), 'north').toBe(false);
    expect(legal(state, c0, mid), 'west').toBe(false);
  });
});

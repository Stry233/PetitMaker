import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { waterContainmentRule } from '../../rules/water-containment';
import { waterfallAdjacentUniformityRule } from '../../rules/waterfall-uniformity';
import { CommandType, TerrainType, type EditorEvents, type PaintTerrainCommand } from '../../core/model/types';
import { roadLookup } from '../../state/object-index';
import { makeState, setTerrain } from './_helpers';

function paint(x: number, y: number, type: TerrainType, elev: number): PaintTerrainCommand {
  return { type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x, y }], terrainType: type, elevation: elev };
}

describe('V-WTR-02: Water Containment', () => {
  it('allows river enclosed by mountains on all sides', () => {
    const state = makeState(10, 10);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) setTerrain(state, 5, 5, TerrainType.Water, 0);
        else setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
      }
    expect(waterContainmentRule.validate(state)).toHaveLength(0);
  });

  it('allows waterfall capped by mountains on both perpendicular ends', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    expect(waterContainmentRule.validate(state)).toHaveLength(0);
  });

  it('rejects waterfall uncapped on one side', () => {
    const state = makeState(10, 10);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    expect(waterContainmentRule.validate(state).length).toBeGreaterThan(0);
  });

  it('rejects single elevated water with no mountain caps', () => {
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    expect(waterContainmentRule.validate(state).length).toBeGreaterThan(0);
  });

  it('allows wide waterfall strip capped on both ends', () => {
    const state = makeState(10, 10);
    setTerrain(state, 3, 5, TerrainType.Mountain, 1);
    setTerrain(state, 4, 5, TerrainType.Water, 1);
    setTerrain(state, 5, 5, TerrainType.Water, 1);
    setTerrain(state, 6, 5, TerrainType.Water, 1);
    setTerrain(state, 7, 5, TerrainType.Mountain, 1);
    setTerrain(state, 4, 4, TerrainType.Mountain, 1);
    setTerrain(state, 5, 4, TerrainType.Mountain, 1);
    setTerrain(state, 6, 4, TerrainType.Mountain, 1);
    expect(waterContainmentRule.validate(state)).toHaveLength(0);
  });

  it('rejects water at map edge (out of bounds is not mountain)', () => {
    const state = makeState(10, 10);
    setTerrain(state, 0, 5, TerrainType.Water, 1);
    setTerrain(state, 0, 4, TerrainType.Mountain, 1);
    setTerrain(state, 0, 6, TerrainType.Mountain, 1);
    expect(waterContainmentRule.validate(state).length).toBeGreaterThan(0);
  });
});

describe('Water containment: an enclosed water row', () => {
  // Top-view at elev 2:
  // M M M M M M
  // M W W W W M  ← enclosed by mountains on all sides
  // M M M M M M
  it('allows painting enclosed water row via full stroke pipeline', () => {
    const state = makeState(10, 10);
    for (let y = 3; y <= 5; y++)
      for (let x = 2; x <= 7; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
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

describe('Water containment: a cross of water in a 3x3 mountain', () => {
  // Top-view at elev 2:
  //   M W M
  //   W W W  ← cross pattern
  //   M W M
  it('allows cross pattern via full stroke pipeline', () => {
    const state = makeState(10, 10);
    for (let y = 4; y <= 6; y++)
      for (let x = 4; x <= 6; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
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

    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const result = executor.execute(paint(4, 5, TerrainType.Water, 2));
    expect(result.success).toBe(true);
  });
});

describe('Water containment: inner water between elevation-2 caps', () => {
  // Top view:
  // ..111111111111...
  // ..112222222211...
  // ..112↓↓↓↓↓↓211...   ← water at elev 2 between elev-2 caps
  // ..111111111111...
  it('allows water at elev 2 between elev-2 mountain caps ', () => {
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

  it('commits the same water through the full stroke pipeline', () => {
    const state = makeState(20, 20);
    for (let y = 5; y <= 10; y++)
      for (let x = 5; x <= 16; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 1);
    for (let y = 6; y <= 9; y++)
      for (let x = 7; x <= 14; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 2);

    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const strokeStart = executor.getUndoStackSize();
    for (let x = 8; x <= 13; x++) {
      const result = executor.execute(paint(x, 8, TerrainType.Water, 2));
      expect(result.success).toBe(true);
    }
    expect(executor.commitStroke(strokeStart)).toHaveLength(0);
  });
});

describe('Water containment: elevation-2 water needs elevation-2 perpendicular caps', () => {
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

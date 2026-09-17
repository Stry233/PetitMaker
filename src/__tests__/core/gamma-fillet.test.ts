/**
 * Where a Γ fillet may go.
 *
 * It rounds the concave corner of the mass that wraps it and adds no mass of its own, so it needs
 * two things that are easy to lose sight of: a NOTCH to sit in (open on at least one side, the
 * ground inside continuing outside) and something to REST on (the notch floor, exactly one tier
 * down). Miss the first and the cell is a pit — it reads as terrain, holds no support, and refuses
 * the paint that would fill it. Miss the second and the fillet hangs in the air, which the 3D view
 * shows for what it is.
 */
import { describe, it, expect } from 'vitest';
import { enclosedGap } from '../../core/edge-cut/terrain-silhouette';
import { isInnerCorner } from '../../core/edge-cut/cut-validator';
import { TerrainType, type GridState, type MacroCoord } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { EdgeCutTool } from '../../tools/edge-cut/edge-cut-tool';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { makeToolCtx } from '../tools/_tool-ctx';
import type { EditorEvents } from '../../core/model/types';
import { roadLookup } from '../../state/object-index';

/** A plateau at `tier` covering the 3x3 around (10,10), with holes where told. */
function plateau(tier: number, holes: MacroCoord[] = [], fill?: (s: GridState) => void): GridState {
  const state = makeState(24, 24);
  const hole = new Set(holes.map((h) => `${h.x},${h.y}`));
  for (let y = 8; y <= 12; y++) {
    for (let x = 8; x <= 12; x++) {
      if (hole.has(`${x},${y}`)) continue;
      setTerrain(state, x, y, TerrainType.Mountain, tier);
    }
  }
  fill?.(state);
  return state;
}

describe('enclosedGap', () => {
  it('is true for a bare cell the mass surrounds on all four edges', () => {
    const state = plateau(3, [{ x: 10, y: 10 }]);
    expect(enclosedGap(state, 10, 10)).toBe(true);
  });

  it('and for a pit in a SLOPE, where the surrounding heights differ', () => {
    // The case from the reported map: the neighbours stand at 1, 2, 2 and 1, so nothing about them
    // matches the fillet's own tier — but the cell is still a hole in the surface.
    const state = makeState(24, 24);
    setTerrain(state, 9, 10, TerrainType.Mountain, 1);
    setTerrain(state, 11, 10, TerrainType.Mountain, 2);
    setTerrain(state, 10, 9, TerrainType.Mountain, 2);
    setTerrain(state, 10, 11, TerrainType.Mountain, 1);
    expect(enclosedGap(state, 10, 10)).toBe(true);
  });

  it('but not for an islet ringed by ground-level water, which stands at the ground\'s own height', () => {
    const state = makeState(24, 24);
    for (const [x, y] of [[9, 10], [11, 10], [10, 9], [10, 11]] as [number, number][]) {
      setTerrain(state, x, y, TerrainType.Water, 0);
    }
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });

  it('is false for a notch — the ground walks out of it', () => {
    // Open to the east: the classic Γ corner the fillet exists for.
    const state = plateau(3, [{ x: 10, y: 10 }, { x: 11, y: 10 }]);
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });

  it('is false where a real block sits in the hole — its rim is exactly what a fillet rounds', () => {
    const state = plateau(3, [{ x: 10, y: 10 }], (s) => setTerrain(s, 10, 10, TerrainType.Mountain, 2));
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });

  it('and false for a pond in the hole, which renders its own surface', () => {
    const state = plateau(3, [{ x: 10, y: 10 }], (s) => setTerrain(s, 10, 10, TerrainType.Water, 0));
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });

  it('is false when the mass only reaches three sides', () => {
    const state = plateau(3, [{ x: 10, y: 10 }, { x: 10, y: 11 }]);
    expect(enclosedGap(state, 10, 10)).toBe(false);
  });
});

describe('the Γ corner test', () => {
  it('offers no fillet on a hole the mass has closed round', () => {
    const state = plateau(3, [{ x: 10, y: 10 }]);
    for (let i = 0; i < 4; i++) {
      expect(isInnerCorner(state, 10, 10, i, TerrainType.Mountain, 3), `corner ${i}`).toBe(false);
    }
  });

  it('still offers one on a notch the fillet can rest in', () => {
    const state = plateau(1, [{ x: 10, y: 10 }, { x: 11, y: 10 }]);
    const offered = [0, 1, 2, 3].filter((i) => isInnerCorner(state, 10, 10, i, TerrainType.Mountain, 1));
    expect(offered.length).toBeGreaterThan(0);
  });

  it('a tall notch rounds as one grounded column, and never below or at its own floor (#17)', () => {
    // A tier-3 mass around a notch floored at the ground: the fillet renders as a column walled
    // from its tier down to the floor, so the notch of a tall wall is cuttable at the wall's tier.
    const state = plateau(3, [{ x: 10, y: 10 }, { x: 11, y: 10 }]);
    const offeredTall = [0, 1, 2, 3].filter((i) => isInnerCorner(state, 10, 10, i, TerrainType.Mountain, 3));
    expect(offeredTall.length).toBeGreaterThan(0);
    // Floor the notch at 2 and the wall tier still rounds; the floor's own tier does not (a fillet
    // at or below the surface it decorates would add nothing).
    setTerrain(state, 10, 10, TerrainType.Mountain, 2);
    const offered = [0, 1, 2, 3].filter((i) => isInnerCorner(state, 10, 10, i, TerrainType.Mountain, 3));
    expect(offered.length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) expect(isInnerCorner(state, 10, 10, i, TerrainType.Mountain, 2)).toBe(false);
  });
});

describe('the edge-cut tool on a pit', () => {
  it('leaves it alone, wherever in the cell you click', () => {
    // The reported case: a bare cell in a slope, terrain at 1, 2, 2 and 1 around it. Filleting a
    // corner there hangs a tier-2 scrap over bare ground — a cell that looks like terrain, holds no
    // support, and refuses the paint that would fill it.
    const state = makeState(24, 24);
    setTerrain(state, 9, 10, TerrainType.Mountain, 1);
    setTerrain(state, 11, 10, TerrainType.Mountain, 2);
    setTerrain(state, 10, 9, TerrainType.Mountain, 2);
    setTerrain(state, 10, 11, TerrainType.Mountain, 1);
    setTerrain(state, 11, 9, TerrainType.Mountain, 2);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = makeToolCtx(state, executor, 1, 1);
    const tool = new EdgeCutTool();
    tool.onActivate(ctx);
    // A click lands on an INTERSECTION and governs the four corners around it, so the four
    // intersections of cell (10,10) are its four corners.
    for (const [ix, iy] of [[9, 9], [10, 9], [9, 10], [10, 10]] as [number, number][]) {
      tool.onPointerDown({ x: ix, y: iy }, { x: ix, y: iy }, ctx);
      expect(state.cells[10]![10]!.terrain, `click at intersection ${ix},${iy}`).toBeNull();
    }
  });

  it('still fillets the notch beside it, which is open on two sides', () => {
    const state = makeState(24, 24);
    setTerrain(state, 9, 10, TerrainType.Mountain, 1);
    setTerrain(state, 10, 9, TerrainType.Mountain, 1);
    setTerrain(state, 9, 9, TerrainType.Mountain, 1);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = makeToolCtx(state, executor, 1, 1);
    const tool = new EdgeCutTool();
    tool.onActivate(ctx);
    // Intersection (9,9) is the cell's top-left corner — the one the mass wraps.
    tool.onPointerDown({ x: 9, y: 9 }, { x: 9, y: 9 }, ctx);
    expect(state.cells[10]![10]!.terrain?.patchOnly, 'the Γ corner still rounds').toBe(true);
  });
});

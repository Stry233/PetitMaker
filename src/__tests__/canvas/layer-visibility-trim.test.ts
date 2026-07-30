/**
 * Trimmed cells under hidden layers. Hiding a stack's top tiers peels them off:
 * a cell rendered below its own elevation is a full block (the stored corners
 * are the hidden top's silhouette), a Γ patch whose fillet tier is hidden shows
 * its real base, and cut backing always matches what the neighbour actually
 * draws at its own visible tier.
 */
import { describe, it, expect } from 'vitest';
import { cellRenderSpec, renderTier } from '../../canvas/map2d/layers/layer-visibility';
import { cutBackingByCorner } from '../../core/edge-cut/cut-backing';
import { TerrainType } from '../../core/model/types';
import type { Corners } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { makeState, setTerrain } from '../rules/_helpers';

const FAN_TL: Corners = ['fan', 'square', 'square', 'square'];

/** Terraced hill: a tier-1 disc with a trimmed tier-2 cell inset at (5,5); the
 *  tier-2 cell's TL cut is backed by the tier-1 step around it. */
function terracedHill() {
  const state = makeState(10, 10);
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  setTerrain(state, 5, 5, TerrainType.Mountain, 2);
  state.cells[5]![5]!.terrain!.corners = FAN_TL;
  return state;
}

describe('the failure mode: backing asked at a lowered tier against raw neighbours', () => {
  it('finds no step below the lowered tier and falls through to ground', () => {
    // The direct call shape that produces the bug: the cell's raw terrain with the
    // visibility-lowered tier, neighbours unclamped. The tier-1 step around the
    // cell is not strictly below tier 1, so every cut corner backs with null —
    // ground — even though the whole region renders solid.
    const state = terracedHill();
    const t = getCell(state.cells, 5, 5)!.terrain!;
    const raw = (dx: number, dy: number) => getCell(state.cells, 5 + dx, 5 + dy)?.terrain;
    const backing = cutBackingByCorner(t, 1, raw);
    expect(backing[0]).toBeNull();
  });
});

describe('cellRenderSpec under hidden layers', () => {
  it('unhidden: the trimmed cell keeps its cut, backed by the tier-1 step', () => {
    const state = terracedHill();
    const spec = cellRenderSpec(state, 5, 5, new Set());
    expect(spec?.base?.tier).toBe(2);
    expect(spec?.base?.corners?.[0]).toBe('fan');
    expect(spec?.base?.backing[0]).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });

  it('hiding the top layer peels the trim: a full block at the tier below, no ground holes', () => {
    const state = terracedHill();
    const spec = cellRenderSpec(state, 5, 5, new Set([2]));
    expect(spec?.base?.tier).toBe(1);
    expect(spec?.base?.corners).toBeUndefined();          // the cut belonged to the hidden tier
    expect(spec?.base?.backing.every((b) => b === null)).toBe(true); // a full block needs none
    expect(spec?.fillet).toBeNull();
  });

  it('a fillet whose tier is hidden shows its real base; a from-empty fillet shows nothing', () => {
    const state = makeState(10, 10);
    // Wrapping mass so the fillet corner is genuinely wrapped at tier 2.
    setTerrain(state, 4, 5, TerrainType.Mountain, 2);
    setTerrain(state, 5, 4, TerrainType.Mountain, 2);
    setTerrain(state, 4, 4, TerrainType.Mountain, 2);
    state.cells[5]![5]!.terrain = {
      type: TerrainType.Mountain, elevation: 2, patchOnly: true, patchBase: 1, corners: FAN_TL,
    };
    const withBase = cellRenderSpec(state, 5, 5, new Set([2]));
    expect(withBase?.base?.tier).toBe(1);
    expect(withBase?.fillet).toBeNull();

    state.cells[5]![5]!.terrain = {
      type: TerrainType.Mountain, elevation: 2, patchOnly: true, patchBase: 0, corners: ['fan', 'empty', 'empty', 'empty'],
    };
    expect(cellRenderSpec(state, 5, 5, new Set([2]))).toBeNull();
  });

  it('backing follows a neighbour to ITS visible tier', () => {
    // Trimmed tier-3 cell whose cut is backed by a tier-2 step; hiding layer 2
    // drops the step's render to tier 1 — the backing colour must follow it.
    const state = makeState(10, 10);
    setTerrain(state, 5, 5, TerrainType.Mountain, 3);
    state.cells[5]![5]!.terrain!.corners = FAN_TL;
    setTerrain(state, 4, 5, TerrainType.Mountain, 2);
    const spec = cellRenderSpec(state, 5, 5, new Set([2]));
    expect(spec?.base?.tier).toBe(3);
    expect(spec?.base?.backing[0]).toEqual({ type: TerrainType.Mountain, elevation: 1 });
  });
});

describe('renderTier', () => {
  it('returns the highest visible layer at or below the elevation', () => {
    expect(renderTier(3, new Set())).toBe(3);
    expect(renderTier(3, new Set([3]))).toBe(2);
    expect(renderTier(3, new Set([3, 2]))).toBe(1);
    expect(renderTier(1, new Set([1, 0]))).toBeNull();
  });
});

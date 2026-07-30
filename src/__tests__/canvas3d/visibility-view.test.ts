/**
 * The visibility view: the 3D mesher renders hidden layers with the SAME peel
 * semantics as 2D by meshing a clamped copy of the state — a truncated stack
 * becomes a full block at its visible tier, a Γ patch drops to its base, a
 * fully hidden cell vanishes. With nothing hidden the live state passes
 * through untouched (identity, zero cost).
 */
import { describe, it, expect } from 'vitest';
import { visibilityView } from '../../canvas/map3d/build/visibility-view';
import { TerrainType } from '../../core/model/types';
import type { GridState } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';

describe('visibilityView', () => {
  it('is the identity when nothing is hidden', () => {
    const s = makeState(10, 10) as GridState;
    setTerrain(s, 2, 2, TerrainType.Mountain, 5);
    expect(visibilityView(s, new Set())).toBe(s);
  });

  it('peels a stack to its highest visible tier as a full block', () => {
    const s = makeState(10, 10) as GridState;
    setTerrain(s, 2, 2, TerrainType.Mountain, 5);
    s.cells[2]![2]!.terrain!.corners = ['fan', 'square', 'square', 'square'];
    const v = visibilityView(s, new Set([5]));
    const t = v.cells[2]![2]!.terrain!;
    expect(t.elevation).toBe(4);
    expect(t.corners, 'stored corners describe the hidden top silhouette').toBeUndefined();
    expect(s.cells[2]![2]!.terrain!.elevation, 'the live state is untouched').toBe(5);
  });

  it('drops a fully hidden cell', () => {
    const s = makeState(10, 10) as GridState;
    setTerrain(s, 3, 3, TerrainType.Water, 0);
    const v = visibilityView(s, new Set([0]));
    expect(v.cells[3]![3]!.terrain).toBeNull();
  });

  it('a Γ patch whose fillet tier is hidden shows its real base', () => {
    const s = makeState(10, 10) as GridState;
    setTerrain(s, 4, 4, TerrainType.Mountain, 3);
    s.cells[4]![4]!.terrain = {
      type: TerrainType.Mountain, elevation: 3, patchOnly: true, patchBase: 2,
      corners: ['fan', 'square', 'square', 'square'],
    };
    const v = visibilityView(s, new Set([3]));
    const t = v.cells[4]![4]!.terrain!;
    expect(t.elevation).toBe(2);
    expect(t.patchOnly).toBeUndefined();
  });
});

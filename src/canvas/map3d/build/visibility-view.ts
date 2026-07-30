/**
 * A GridState as the 3D mesher should see it under layer visibility. The 2D
 * peel semantics live in clampNeighbor (renderer/layers/layer-visibility): a
 * truncated stack renders as a FULL block at its highest visible tier (the
 * stored corners describe the hidden top's silhouette), a Γ patch drops to its
 * real base, a fully hidden cell isn't there. Applying that clamp to every
 * cell yields a state the unchanged chunk mesher renders with exactly the 2D
 * appearance — neighbors included, since they are clamped the same way.
 */
import { clampNeighbor } from '../../map2d/layers/layer-visibility';
import type { GridState, MacroCell } from '../../../core/model/types';

export function visibilityView(state: GridState, hidden: ReadonlySet<number>): GridState {
  if (hidden.size === 0) return state;
  const cells: MacroCell[][] = state.cells.map((row) =>
    row.map((cell) => {
      const t = clampNeighbor(cell.terrain, hidden);
      return t === cell.terrain ? cell : { ...cell, terrain: t ?? null };
    }));
  return { ...state, cells };
}

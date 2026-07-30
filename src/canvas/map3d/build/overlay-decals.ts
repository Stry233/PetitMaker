/**
 * Surface-draped decal geometry for the 3D tool overlay: one flat quad per
 * cell at that cell's standable height plus a small lift (no z-fighting with
 * the surface it annotates), on the grid the tool paints — terrain tools use
 * the micro grid (−0.5 world offset), object tools the macro grid. Pure and
 * three-free; Overlay3D wraps the arrays into a BufferGeometry.
 */
import type { GridState, MacroCoord } from '../../../core/model/types';
import { mapCenterOffset } from '../core/coords';
import { surfaceHeightAt } from '../interaction/pick';

export const DECAL_LIFT = 0.025;

export interface DecalMesh { positions: number[]; index: number[] }

export function cellDecals(state: GridState, cells: readonly MacroCoord[], terrainGrid: boolean): DecalMesh {
  const { width, height } = state.template;
  const off = mapCenterOffset(width, height);
  const shift = terrainGrid ? -0.5 : 0;
  const positions: number[] = [];
  const index: number[] = [];
  for (const { x, y } of cells) {
    // Keep a ring past the map edge drawable (a brush hanging off the border
    // still previews, like 2D), but drop far-off sentinel cells.
    if (x < -2 || y < -2 || x > width + 2 || y > height + 2) continue;
    const x0 = x - off.x + shift, z0 = y - off.z + shift;
    const h = surfaceHeightAt(state, x0 + 0.5, z0 + 0.5) + DECAL_LIFT;
    const base = positions.length / 3;
    positions.push(x0, h, z0, x0 + 1, h, z0, x0 + 1, h, z0 + 1, x0, h, z0 + 1);
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, index };
}

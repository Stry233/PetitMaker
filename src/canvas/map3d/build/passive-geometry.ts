/**
 * Pure geometry for the 3D layer-number overlay: one quad per labeled cell
 * (the same pure label plan the 2D raster uses — chunkNumberCells masks object
 * footprints, hidden layers, ground islands), each at its cell's surface,
 * UV-mapped into the chunk's shared label canvas so a whole chunk renders as
 * ONE textured draw. (The reference grid itself is a flat ground-level line
 * set built by the scene — its fixed world-space position stays stable across
 * all framing, so it reads as an overlay grid, not terrain geometry.)
 */
import { CHUNK_SIZE } from '../../../core/model/constants';
import type { GridState } from '../../../core/model/types';
import { mapCenterOffset } from '../core/coords';
import { surfaceHeightAt } from '../interaction/pick';
import { chunkNumberCells } from '../../map2d/layers/number-cells';

const NUMBER_LIFT = 0.03;

export interface NumberQuads { positions: number[]; uvs: number[]; index: number[] }

/** Per-labeled-cell quads with UVs into a CHUNK_SIZE×CHUNK_SIZE label atlas
 *  (cell (x,y) maps to its own atlas slot; the canvas painter draws each label
 *  into the matching slot). */
export function chunkNumberQuads(state: GridState, cx: number, cy: number, hidden: ReadonlySet<number>): NumberQuads {
  const { width, height } = state.template;
  const off = mapCenterOffset(width, height);
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  for (const { x, y } of chunkNumberCells(state, cx, cy, hidden)) {
    // Terrain grid (−0.5): the 2D raster draws its labels at the terrain-shifted
    // cell, so the number sits on the block it describes.
    const wx = x - off.x - 0.5, wz = y - off.z - 0.5;
    const h = surfaceHeightAt(state, wx + 0.5, wz + 0.5) + NUMBER_LIFT;
    const base = positions.length / 3;
    positions.push(wx, h, wz, wx + 1, h, wz, wx + 1, h, wz + 1, wx, h, wz + 1);
    const u0 = (x - cx * CHUNK_SIZE) / CHUNK_SIZE, v0 = (y - cy * CHUNK_SIZE) / CHUNK_SIZE;
    const du = 1 / CHUNK_SIZE;
    // Canvas textures have a top-left origin; three samples bottom-left — flip V.
    uvs.push(u0, 1 - v0, u0 + du, 1 - v0, u0 + du, 1 - (v0 + du), u0, 1 - (v0 + du));
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, uvs, index };
}

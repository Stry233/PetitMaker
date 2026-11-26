/** The whole map's terrain as the 3D view meshes it: every storage bucket's chunk, joined. */
import type { GridState } from '../../core/model/types';
import { bucketCounts } from '../../core/grid/buckets';
import { buildChunkTerrain } from '../../view/map3d/geometry/terrain-geometry';
import { emptyMesh } from '../../view/map3d/geometry/mesh-emit';
import type { MeshData, TerrainMeshes } from '../../view/map3d/geometry/types';

const KINDS = ['solid', 'ground', 'water', 'fall'] as const;

function append(into: MeshData, part: MeshData): void {
  const base = into.positions.length / 3;
  into.positions.push(...part.positions);
  into.colors.push(...part.colors);
  for (const i of part.index) into.index.push(base + i);
  if (part.uv) (into.uv ??= []).push(...part.uv);
  if (part.alpha) (into.alpha ??= []).push(...part.alpha);
}

export function buildTerrainMeshes(state: GridState): TerrainMeshes {
  const { cols, rows } = bucketCounts(state.template.width, state.template.height);
  const whole: TerrainMeshes = { solid: emptyMesh(), ground: emptyMesh(), water: emptyMesh(), fall: emptyMesh() };
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const chunk = buildChunkTerrain(state, cx, cy);
      for (const kind of KINDS) append(whole[kind], chunk[kind]);
    }
  }
  return whole;
}

/* Capture a framed region of a map into a blueprint body. */
import { CHUNK_SIZE } from '../../core/game/profile';
import { footprintTerrain } from '../../core/grid/footprint';
import { rectsOverlap, type Rect } from '../../core/grid/rect';
import { copyCorners } from '../../core/model/corners';
import { getCell } from '../../core/model/grid-model';
import { isLandmarkItem } from '../../core/model/landmarks';
import { TerrainType, type GridState, type TerrainCell } from '../../core/model/types';
import type { BlueprintBody, BlueprintCell, BlueprintObject } from '../../core/model/blueprint';
import { surfaceElevation } from '../../core/domain/terrain/terrain-surface';
import { objectElevation, objectRect } from '../../state/object-geometry';

/** The longest side a frame may have, in object-grid cells. */
export const BLUEPRINT_MAX_SIDE = 2 * CHUNK_SIZE;

export type CaptureRefusal = 'too-big' | 'too-small' | 'landmark' | 'empty';

/**
 * The body `frame` (whole object-grid cells) holds: every terrain cell it rests on and every object
 * whose whole footprint lies inside it, heights as rises above the lowest ground among those cells
 * (bare ground counts as 0); mountain at that lowest ground is stored as ground (null). A frame overlapping a landmark is refused; annotations are not read.
 */
export function captureBlueprint(state: GridState, frame: Rect): { body: BlueprintBody } | { refusal: CaptureRefusal } {
  if (frame.w < 1 || frame.h < 1) return { refusal: 'too-small' };
  if (frame.w > BLUEPRINT_MAX_SIDE || frame.h > BLUEPRINT_MAX_SIDE) return { refusal: 'too-big' };
  for (const obj of state.objects.values()) {
    if (isLandmarkItem(obj.catalogId) && rectsOverlap(objectRect(obj), frame)) return { refusal: 'landmark' };
  }

  const area = footprintTerrain(frame);
  const terrain: (TerrainCell | null)[] = [];
  let lowest = Infinity;
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const cell = getCell(state.cells, x, y);
      const t = cell?.terrain && cell.terrain.type !== TerrainType.None ? cell.terrain : null;
      terrain.push(t);
      if (cell) lowest = Math.min(lowest, surfaceElevation(t));
    }
  }
  if (!Number.isFinite(lowest)) lowest = 0;

  const objects: BlueprintObject[] = [];
  for (const obj of state.objects.values()) {
    const r = objectRect(obj);
    if (r.x < frame.x || r.y < frame.y || r.x + r.w > frame.x + frame.w || r.y + r.h > frame.y + frame.h) continue;
    objects.push({
      catalogId: obj.catalogId,
      x: r.x - frame.x,
      y: r.y - frame.y,
      rotation: obj.rotation,
      rise: objectElevation(state, obj) - lowest,
      ...(obj.spanLength !== undefined ? { spanLength: obj.spanLength } : null),
      ...(obj.corners ? { corners: copyCorners(obj.corners) } : null),
    });
  }

  // Mountain at the lowest ground is that ground: placement lays the frame's lowest ground as the
  // surface it is dropped on, so it holds nothing to build. Water keeps its entry at any rise.
  const cells = terrain.map((t) => (t && !(t.type === TerrainType.Mountain && t.elevation === lowest) ? bodyCell(t, lowest) : null));
  if (objects.length === 0 && cells.every((c) => c === null)) return { refusal: 'empty' };
  return { body: { w: frame.w, h: frame.h, cells, objects } };
}

function bodyCell(t: TerrainCell, lowest: number): BlueprintCell {
  return {
    type: t.type,
    rise: t.elevation - lowest,
    ...(t.corners ? { corners: copyCorners(t.corners) } : null),
    ...(t.patchOnly ? { patchOnly: true } : null),
    ...(t.patchBase !== undefined ? { patchBase: t.patchBase - lowest } : null),
  };
}

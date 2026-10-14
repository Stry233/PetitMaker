/* The object a placement lays, before any rule has looked at it: the placer's click and ghost and
 * the Help figures' pictured placements build it here. */
import type { CatalogItem, GridState, MacroCoord, PlacedObject, Rotation } from '../../core/model/types';
import { surfaceElevationAt } from '../../state/object-geometry';
import { generateObjectId } from '../../core/model/object-id';
import { planetLandmarkObject } from '../../core/model/landmarks';
import { landmarkSpec } from '../../core/game/profile';

/** `item` at `anchor`, standing on the surface there unless `elevation` says where; `id` names it
 *  (a probe passes a throwaway). A landmark is self-sized: it keeps its fixed id and carries its
 *  profile footprint. */
export function candidateObject(
  item: CatalogItem, anchor: MacroCoord, rotation: Rotation, gs: GridState,
  opts: { id?: string; elevation?: number } = {},
): PlacedObject {
  const elevation = opts.elevation ?? surfaceElevationAt(gs, anchor.x, anchor.y);
  const landmark = landmarkSpec(item.id);
  if (landmark) return { ...planetLandmarkObject(landmark, anchor, rotation), elevation };
  return { id: opts.id ?? generateObjectId(), catalogId: item.id, position: { x: anchor.x, y: anchor.y }, rotation, elevation };
}

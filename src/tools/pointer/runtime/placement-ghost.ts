/** What a placement ghost shows of the objects it places, for every tool that places a set of them
 *  (paste, Paint, blueprint). */
import type { PlacedObject } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { isCoatingItem, isSurfacePrint } from '../../../core/model/traits';
import type { PlacementGhost } from './view-seam';

/** `objects` as a placement ghost draws them: road tiles as the surface they pave, everything else
 *  as a body. */
export function ghostParts(objects: readonly PlacedObject[]): { tiles: PlacedObject[]; members: PlacementGhost[] } {
  const tiles: PlacedObject[] = [];
  const members: PlacementGhost[] = [];
  for (const obj of objects) {
    const item = getCatalogItem(obj.catalogId);
    if (isCoatingItem(item) && !isSurfacePrint(item)) { tiles.push(obj); continue; }
    members.push({
      catalogId: obj.catalogId, x: obj.position.x, y: obj.position.y, rotation: obj.rotation, elevation: obj.elevation,
      ...(obj.spanLength ? { spanLength: obj.spanLength } : null),
    });
  }
  return { tiles, members };
}

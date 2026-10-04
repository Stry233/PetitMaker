import { buildRoadRegions, type RoadRegion } from '../core/edge-cut/road-region';
import type { RoadLookup } from '../core/model/road-lookup';
import type { PlacedObject } from '../core/model/types';

/**
 * What a road surface draws while a group tween carries some of its members. A surface cannot
 * stretch between members on different arcs, so both views draw the standing members as their own
 * connected surfaces at rest and each carried member as a one-tile surface on its own arc, with the
 * material's bands and fade in both cases.
 */
export function standingRoadSurfaces(
  region: RoadRegion, carried: (id: string) => boolean, roads: RoadLookup,
): RoadRegion[] {
  const memberIds = new Set(region.members.map((m) => m.id));
  const tiles = new Map<string, PlacedObject>();
  for (const member of region.members) if (!carried(member.id)) tiles.set(member.id, member);
  if (tiles.size === 0) return [];
  // Foreign cut tiles host the fills the surface feeds into them.
  for (const cell of region.cells) {
    const host = roads(cell.x, cell.y);
    if (host && !memberIds.has(host.id) && !carried(host.id)) tiles.set(host.id, host);
  }
  return buildRoadRegions([...tiles.values()], roads).filter((r) => r.material === region.material
    && r.elevation === region.elevation && r.members.every((m) => memberIds.has(m.id) && !carried(m.id)));
}

/** The one-tile surfaces a carried member draws: its own body and the fills it hosts. */
export function carriedRoadSurfaces(member: PlacedObject, roads: RoadLookup): RoadRegion[] {
  return buildRoadRegions([member], roads);
}

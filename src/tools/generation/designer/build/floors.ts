/**
 * Buildings on the street's own pavement.
 *
 * A building floor is ordinary ground for a road, so a building standing against the network can
 * stand on the street's surface carried beneath it. This runs last and lays nothing outside a
 * footprint, so the walkable network the earlier stages built stays as it was: pavement under a
 * solid is no walk.
 *
 * The preference is `GENERATION_STYLE.pavedFloors`. A building qualifies when its outline meets
 * walkable pavement on its own level along at least `minFrontage` of its edge cells; a qualifying
 * one is paved with probability `share`, decided positionally so it does not depend on the order
 * buildings are visited. A floor is laid whole or not at all, in the material its frontage meets most.
 */
import { GENERATION_STYLE } from '../../../../config/generation-style';
import { cellKey, flatIndex } from '../../../../core/grid/rect';
import { footprintCells } from '../../../../core/grid/footprint';
import { NEIGHBORS4 } from '../../../../core/grid/directions';
import { hash01, mix } from '../../../../core/base/rng';
import { hasTrait } from '../../../../core/model/traits';
import type { PlacedObject } from '../../../../core/model/types';
import { getCatalogItem } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { exposedRoadAt, getObjectIndex } from '../../../../state/object-index';
import { placeFloorTile, removePlaced, type PlaceCtx } from '../../../placement/object';
import type { Scope } from './scope';

export interface FloorOutcome {
  /** Buildings whose frontage qualified them for a paved floor. */
  eligible: number;
  /** Floors laid. */
  paved: number;
  /** Pavement tiles the floors took. */
  tiles: number;
}

/** Salt for the per-building draw, so it shares no stream with any other positional decision. */
const FLOOR_SALT = 0x0f1004;

export function paveFloors(
  place: PlaceCtx, buildings: readonly PlacedObject[], pavable: Uint8Array, scope: Scope,
  { share, minFrontage }: { share: number; minFrontage: number } = GENERATION_STYLE.pavedFloors,
): FloorOutcome {
  const { state } = place;
  const W = state.template.width, H = state.template.height;
  const out: FloorOutcome = { eligible: 0, paved: 0, tiles: 0 };
  for (const building of buildings) {
    const item = getCatalogItem(building.catalogId);
    if (!item || !hasTrait(item, 'coatingSupport')) continue;
    const r = objectRect(building);
    const x0 = Math.floor(r.x), y0 = Math.floor(r.y), x1 = Math.ceil(r.x + r.w), y1 = Math.ceil(r.y + r.h);
    if (!scope.rect(x0, y0, x1 - x0, y1 - y0)) continue;
    const footprint = footprintCells(r.x, r.y, r.w, r.h);
    if (!footprint.every((c) => pavable[flatIndex(c.x, c.y, W)] === 1)) continue;

    // The frontage: walkable pavement on the building's own level beside each edge cell.
    const index = getObjectIndex(state);
    const materials = new Map<string, number>();
    let edge = 0, fronted = 0;
    for (const c of footprint) {
      let onEdge = false, meets = false;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = c.x + dx, ny = c.y + dy;
        if (nx >= x0 && nx < x1 && ny >= y0 && ny < y1) continue;
        onEdge = true;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const road = exposedRoadAt(index, nx, ny);
        if (!road || road.elevation !== building.elevation) continue;
        meets = true;
        materials.set(road.catalogId, (materials.get(road.catalogId) ?? 0) + 1);
      }
      if (onEdge) edge++;
      if (meets) fronted++;
    }
    if (edge === 0 || fronted / edge < minFrontage) continue;
    out.eligible++;
    if (hash01(mix(place.seed, FLOOR_SALT), flatIndex(x0, y0, W)) >= share) continue;

    let material = '';
    let most = 0;
    for (const [id, n] of materials) if (n > most) { material = id; most = n; }
    const laid: PlacedObject[] = [];
    let whole = true;
    for (const c of footprint) {
      if (getObjectIndex(state).roadByCell.has(cellKey(c.x, c.y))) continue;
      const tile = placeFloorTile(place, material, c.x, c.y);
      if (!tile) { whole = false; break; }
      laid.push(tile);
    }
    if (!whole) {
      for (const tile of laid) {
        removePlaced(place, tile);
        place.roads.delete(flatIndex(tile.position.x, tile.position.y, W));
      }
      continue;
    }
    out.paved++;
    out.tiles += laid.length;
  }
  return out;
}

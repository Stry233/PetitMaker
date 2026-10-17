/**
 * Where an object's 3D marks lie (a selection shadow, a flag, a body outline), so each sits on the
 * object's visible geometry: a coating's on the one flat face it draws as, a bridge's on the plane
 * its landings stand on over the water, anything else draped on the terrain each cell of its
 * footprint rests on. Pure and three-free.
 */
import type { GridState, PlacedObject } from '../../../core/model/types';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { isBridge, isCoatingItem } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import { objectElevation, objectRect } from '../../../state/object-geometry';
import { rectsOverlap, type Rect } from '../../../core/grid/rect';
import { isLaidLandmark } from '../../../core/model/landmarks';
import { bridgeDeckY, cellCornerWorld } from './coords';
import { DECAL_LIFT, rectDecals, type DecalMesh } from './overlay-decals';
import { coatingSurfaceY } from './road-mesh';
import { spanCellCentres } from './surface-pieces';
import { surfaceHeightAt } from './pick';

/** One flat quad over `r`, in world space at height `y`. */
function flatRect(state: GridState, r: Rect, y: number): DecalMesh {
  const { x, z } = cellCornerWorld(r.x, r.y, state.template.width, state.template.height, PLACEMENT_GRID);
  return { positions: [x, y, z, x + r.w, y, z, x + r.w, y, z + r.h, x, y, z + r.h], index: [0, 1, 2, 0, 2, 3] };
}

/** The flat plane a flat-bodied object's footprint lies on, or null for one that drapes. */
function flatPlaneY(state: GridState, obj: PlacedObject): number | null {
  const item = getCatalogItem(obj.catalogId);
  if (isCoatingItem(item)) return coatingSurfaceY(state, obj);
  if (isBridge(item)) return bridgeDeckY(objectElevation(state, obj));
  return null;
}

/**
 * `obj`'s footprint as its ground mark: flush with a coating's face (no lift, since that face is
 * already a decal), on a bridge's landing plane, else draped on the terrain each part of the
 * footprint rests on, a decal's lift above it.
 */
export function footprintMark(state: GridState, obj: PlacedObject): DecalMesh {
  const r = objectRect(obj);
  const flat = flatPlaneY(state, obj);
  if (flat !== null) return flatRect(state, r, flat);
  const drape = rectDecals(state, [r], PLACEMENT_GRID);
  return { positions: drape.positions.map((v, i) => (i % 3 === 1 ? v + DECAL_LIFT : v)), index: drape.index };
}

/** The lowest visible surface under `obj`'s footprint: what of its body lies below is in the ground
 *  (a ramp's sunk foot), and an outline of the body leaves it out. */
export function bodyFloorY(state: GridState, obj: PlacedObject): number {
  const r = objectRect(obj);
  let floor = Infinity;
  for (const cz of spanCellCentres(r.y, r.h)) {
    for (const cx of spanCellCentres(r.x, r.w)) {
      const at = cellCornerWorld(cx, cz, state.template.width, state.template.height, PLACEMENT_GRID);
      floor = Math.min(floor, surfaceHeightAt(state, at.x, at.z));
    }
  }
  return floor;
}

/** The flat face an object without a body of its own (a coating) draws as, in world space as a
 *  triangle list: the face its outline traces. */
export function flatBodyTriangles(state: GridState, obj: PlacedObject): number[] {
  const r = objectRect(obj);
  const y = flatPlaneY(state, obj) ?? surfaceHeightAt(state, ...centreOf(state, r));
  const { positions: p } = flatRect(state, r, y);
  return [0, 1, 2, 0, 2, 3].flatMap((i) => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!]);
}

function centreOf(state: GridState, r: Rect): [number, number] {
  const c = cellCornerWorld(r.x + r.w / 2, r.y + r.h / 2, state.template.width, state.template.height, PLACEMENT_GRID);
  return [c.x, c.z];
}

/** Whether `obj` has no body of its own to outline: a coating draws as one flat face, so its outline
 *  is that face's edge (`flatOutline`). */
export function isFlatBody(obj: PlacedObject): boolean {
  return isCoatingItem(getCatalogItem(obj.catalogId));
}

/** The edge of a flat-bodied object's face, a closed path in world space on the face itself. */
export function flatOutline(state: GridState, obj: PlacedObject): [number, number, number][] {
  const p = flatBodyTriangles(state, obj);
  // The face's corners in order: the first triangle's three and the second's last.
  const corner = (i: number): [number, number, number] => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!];
  return [corner(0), corner(1), corner(2), corner(5), corner(0)];
}

/** Whether a laid landmark's footprint overlaps `obj`'s: its model may stand over the object. */
export function underLandmark(state: GridState, obj: PlacedObject): boolean {
  const r = objectRect(obj);
  for (const o of state.objects.values()) if (o.id !== obj.id && isLaidLandmark(o) && rectsOverlap(objectRect(o), r)) return true;
  return false;
}

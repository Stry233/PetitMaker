/** Structural admission shared by map decoding and history restoration. */
import { CORNER_TRIMS, ROTATIONS, TerrainType, type CatalogItem, type Corners, type Rotation } from '../../core/model/types';
import { onItemGrid } from '../../state/object-geometry';
import { ELEVATION_MAX } from '../../core/game/profile';
import { isFiniteNumber } from '../../core/base/guards';
import { isLandmarkItem } from '../../core/model/landmarks';
import { getCatalogItem } from '../../state/catalog';
import { currentCatalogId } from '../../config/catalog/retired-ids';

/** Terrain types a decoded/imported cell may legally carry (None/Mountain/Water). */
const VALID_TERRAIN_TYPES: readonly number[] = [TerrainType.None, TerrainType.Mountain, TerrainType.Water];

export const isValidTerrainType = (t: unknown): t is TerrainType => VALID_TERRAIN_TYPES.includes(t as number);
export const isValidRotation = (r: unknown): r is Rotation => (ROTATIONS as readonly unknown[]).includes(r);

/** An elevation-like field (elevation / patchBase): an integer within [0, ELEVATION_MAX]. */
export const isValidElevation = (e: unknown): e is number =>
  Number.isInteger(e) && (e as number) >= 0 && (e as number) <= ELEVATION_MAX;

/** Four known corner trims. */
export const isValidCorners = (v: unknown): v is Corners =>
  Array.isArray(v) && v.length === 4 && v.every((t) => (CORNER_TRIMS as readonly unknown[]).includes(t));

interface ImportBounds { width: number; height: number }

interface ObjectGeometryInput {
  x: unknown;
  y: unknown;
  rotation: unknown;
  elevation: unknown;
  spanLength?: unknown;
}

/** Coordinates are anchors on the item's grid; span lengths are positive macro-cell counts. */
function isValidObjectGeometry(item: CatalogItem, object: ObjectGeometryInput, bounds?: ImportBounds): boolean {
  const { x, y, rotation, elevation, spanLength } = object;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !onItemGrid(item, x) || !onItemGrid(item, y)) return false;
  if (x < 0 || y < 0 || (bounds && (x >= bounds.width || y >= bounds.height))) return false;
  if (!isValidRotation(rotation) || !isValidElevation(elevation)) return false;
  return spanLength === undefined || (isFiniteNumber(spanLength) && Number.isInteger(spanLength) && spanLength >= 1
    && (!bounds || spanLength <= Math.max(bounds.width, bounds.height)));
}

/** An object record a decoder may place: its current catalog id and item. */
interface AdmittedObject { catalogId: string; item: CatalogItem }

/**
 * The one admission of an object record, in the save's wire shape (`x`, `y`, a corner suffix): a
 * record, a registered non-landmark catalog id (retired ids read as their replacement), a
 * non-landmark id, geometry on the item's grid within `bounds`, and well-typed flags. An absent
 * elevation stands on the ground. Null rejects the record; each decoder settles the id itself.
 */
export function admitSaveObject(raw: unknown, bounds?: ImportBounds): AdmittedObject | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.catalogId !== 'string' || (typeof obj.id === 'string' && isLandmarkItem(obj.id))) return null;
  const catalogId = currentCatalogId(obj.catalogId);
  if (isLandmarkItem(catalogId)) return null;
  const item = getCatalogItem(catalogId);
  if (!item) return null;
  if (obj.patchOnly !== undefined && typeof obj.patchOnly !== 'boolean') return null;
  if (obj.corners !== undefined && typeof obj.corners !== 'string') return null;
  const geometry = { x: obj.x, y: obj.y, rotation: obj.rotation, elevation: obj.elevation === undefined ? 0 : obj.elevation, spanLength: obj.spanLength };
  return isValidObjectGeometry(item, geometry, bounds) ? { catalogId, item } : null;
}

/**
 * PURE object-instance resolver: GridState → Map<ArchetypeKey, ObjectInstance[]>.
 * No three.js. scene.ts turns each group into one InstancedMesh.
 *
 * Transform convention (consistent for every object):
 *  - CENTRE comes from getPlacedObjectSize (the rotated world footprint) so the
 *    proxy sits exactly where the 2D footprint is.
 *  - SCALE comes from the UNROTATED logical dims (width×height, or span×width for
 *    bridges); rotationY then orients it. This avoids double-applying rotation.
 */
import { ItemCategory, type GridState, type PlacedObject, type CatalogItem } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { hasRoadTrimShape } from './terrain-geometry';
import { surfaceY, cellCornerWorld, layerToY, LAYER_HEIGHT } from '../core/coords';
import { objectColor } from '../core/palette';
import { hasModel } from '../models/registry';
import type { ArchetypeKey, ObjectInstance } from '../core/types';

// Yaw per object rotation. The bespoke models front their door on -Z, but the 2D
// convention fronts rotation 0 SOUTH (+Y ↔ +Z world; see buildingGate), so every
// yaw is offset by π to face the same way as 2D — otherwise houses/facilities
// (the only items with a visible front) point the opposite direction. Symmetric
// items (trees, roads, bridges…) are unaffected by the 180°.
const ROT: Record<0 | 90 | 180 | 270, number> = { 0: Math.PI, 90: Math.PI / 2, 180: 0, 270: -Math.PI / 2 };

const ROAD_LIFT = 0.05; // road decal lift above its terrain (enough to clear z-fighting, low enough not to poke over an adjoining ramp)
const RAMP_SINK = 0.07;  // sink the ramp's LOW tip below grade (and grow its height to compensate) so a road meeting it tucks under, never overlaps

/** Y-rotation that points the unit ramp's high end (local +Z) at the world side
 *  the 2D renderer treats as "high": spanAxis y(rot 0/180) ↔ world Z, x(rot 90/270)
 *  ↔ world X; highAtStart (rot 0/90) ⇒ low-coordinate side. Derived to match
 *  object-layer.ts's highAtStart/spanAxis exactly. */
const RAMP_ROT_Y: Record<0 | 90 | 180 | 270, number> = { 0: Math.PI, 90: -Math.PI / 2, 180: 0, 270: Math.PI / 2 };

/** A ramp's vertical drop in layers (heightDrop trait; defaults to 1). */
function rampLayers(item: CatalogItem): number {
  const t = item.traits.find((tr) => tr.type === 'heightDrop');
  return t && t.type === 'heightDrop' ? t.layers : 1;
}

/**
 * Per-item shape override (catalogId → archetype). EMPTY by default — every item
 * renders via its catalog category. This is the one-line hook to give a specific
 * item a distinct shape without touching the resolver. To add a whole new shape
 * family: add a builder + key in object-archetypes.ts, then map to it here or by
 * category.
 */
const ITEM_ARCHETYPE: Partial<Record<string, ArchetypeKey>> = {
  // e.g. 'facility-lighthouse': ItemCategory.Facility,
};

/** The archetype an object renders as — the ONE place object→shape is decided:
 *  an explicit per-item override, else the catalog category, else a flat platform
 *  (off-catalog self-described footprints like the central plaza). */
function archetypeFor(obj: PlacedObject, item: CatalogItem | undefined): ArchetypeKey {
  if (obj.width !== undefined && obj.height !== undefined) return 'platform';
  if (item && ITEM_ARCHETYPE[item.id]) return ITEM_ARCHETYPE[item.id]!;
  return item ? item.category : 'platform';
}

/** Unrotated logical dims (X×Z before rotationY) used for scaling the unit geometry. */
function logicalDims(obj: PlacedObject, item: CatalogItem | undefined): { sx: number; sz: number } {
  if (obj.width !== undefined && obj.height !== undefined) return { sx: obj.width, sz: obj.height };
  if (obj.spanLength && item) return { sx: obj.spanLength, sz: item.width };
  if (item) return { sx: item.width, sz: item.height };
  return { sx: 1, sz: 1 };
}

/**
 * Whether this object's body is meshed by buildRoadTrimMesh instead of riding an instance: a road
 * whose corners hold a recognised edge-cut shape can't use the shared full-square instance geometry.
 * `objectInstance` skips exactly this set, so anything that ANIMATES a body (the 3D group-rotation
 * tween) must offset the trim mesh for these and an instance matrix for everything else — asking the
 * same question here is what keeps the two from disagreeing about who draws a road.
 */
export function isTrimMeshedRoad(obj: PlacedObject): boolean {
  return getCatalogItem(obj.catalogId)?.category === ItemCategory.Road && hasRoadTrimShape(obj.corners);
}

/** Which 3D representation carries an object's body. 'none' means the map holds the object and
 *  neither path draws it, so anything iterating objects (the group-rotation tween) would drop it
 *  without a trace — the miss a caller must surface rather than skip. */
export type BodyRoute = 'instanced' | 'roadTrim' | 'none';

/** The route for one object id (see BodyRoute). Model-side, so a test can assert that every member
 *  of an operation has a body to animate without standing up a WebGL scene. */
export function bodyRoute(state: GridState, id: string): BodyRoute {
  const obj = state.objects.get(id);
  if (!obj) return 'none';
  if (isTrimMeshedRoad(obj)) return 'roadTrim';
  return objectInstance(state, obj) ? 'instanced' : 'none';
}

export function buildObjectInstances(state: GridState): Map<string, ObjectInstance[]> {
  const groups = new Map<string, ObjectInstance[]>();
  for (const obj of state.objects.values()) {
    const resolved = objectInstance(state, obj);
    if (!resolved) continue;
    const list = groups.get(resolved.groupKey);
    if (list) list.push(resolved.inst); else groups.set(resolved.groupKey, [resolved.inst]);
  }
  return groups;
}

/**
 * One object's instance + group. Group keys: 'm:<catalogId>' = a bespoke
 * per-item model (config-driven, scale 1 since the model is authored at the
 * item's footprint); 'a:<archetypeKey>' = a category archetype (scaled to the
 * footprint). Variable-footprint kinds (bridge/ramp/road) always use the
 * scaled archetype, so they never take a fixed-size model. Null = not
 * instanced (a trimmed road is meshed by buildRoadTrimMesh instead).
 */
export function objectInstance(state: GridState, obj: PlacedObject): { groupKey: string; inst: ObjectInstance } | null {
  const { width, height } = state.template;
  const item = getCatalogItem(obj.catalogId);
  // Skip a trim-meshed road so it doesn't ALSO draw as a full square. An UNRECOGNISED corner set
  // stays instanced: better a square tile than a hole in the paved path.
  if (isTrimMeshedRoad(obj)) return null;
  const key = archetypeFor(obj, item);
  // Ramps + bridges CAN be modeled (authored in UNIT span/wedge space): a ramp
  // uses the ramp transform below, a bridge stretches its bespoke geometry across
  // the span (scaleX = spanLength, scaleZ = deck width) just like the archetype.
  // Only roads stay a pure scaling decal.
  const modeled = !!item && hasModel(item.id) && item.category !== ItemCategory.Road;
  const bridgeModel = modeled && item!.category === ItemCategory.Bridge;
  const groupKey = modeled ? `m:${item!.id}` : `a:${key}`;
  const size = getPlacedObjectSize(obj);              // rotated world footprint {w,h}
  const dims = logicalDims(obj, item);                // unrotated scale

  // Centre of the rotated footprint, anchored to the cell grid.
  const corner = cellCornerWorld(obj.position.x, obj.position.y, width, height);
  const center = { x: corner.x + size.w / 2, z: corner.z + size.h / 2 };
  const color = objectColor(obj, item);
  // Icon-sprite items refine to their icon's dominant colour (richer per-item
  // tint); colour-bearing items (roads, plaza) keep their explicit colour.
  const icon = (obj.color || item?.color) ? undefined : item?.icon;

  let inst: ObjectInstance;
  if (item && item.category === ItemCategory.Ramp) {
    // Ramps connect the lower terrain (elevation − drop) up to `elevation`. Sit
    // the unit wedge's base at the LOW surface and stretch it up by the drop, so
    // it rises from layer n−drop to layer n (not floating at n). The 90/270
    // rotations swap the footprint, so the wedge's footprint scale swaps too.
    const layers = rampLayers(item);
    const lowElev = Math.max(0, obj.elevation - layers);
    const swap = obj.rotation === 90 || obj.rotation === 270;
    inst = {
      x: center.x,
      // Tuck the low tip below grade + grow the height to keep the high end at `elevation`, so a
      // road ending at the ramp's base sits cleanly on top of it instead of poking through.
      y: layerToY(lowElev) - RAMP_SINK,
      z: center.z,
      rotationY: RAMP_ROT_Y[obj.rotation],
      scaleX: swap ? size.h : size.w,
      scaleY: layers * LAYER_HEIGHT + RAMP_SINK,
      scaleZ: swap ? size.w : size.h,
      color,
      icon,
    };
  } else {
    // Flat platforms (the central plaza) rest ON the ground regardless of their
    // stored elevation. Roads are decals laid just above the surface (so they
    // don't sink under it). Everything else stands on the VISIBLE surface —
    // surfaceY, which is the slab top at layer 0 and the terrain top above.
    const isRoad = item?.category === ItemCategory.Road;
    const baseY = key === 'platform' ? 0 : surfaceY(obj.elevation) + (isRoad ? ROAD_LIFT : 0);
    inst = {
      x: center.x,
      y: baseY,
      z: center.z,
      rotationY: ROT[obj.rotation],
      // A footprint-authored model → no scaling; a bridge model is authored in
      // UNIT span-space → stretch by (span × deck width); an archetype is a unit
      // shape → scale to the footprint.
      scaleX: bridgeModel ? dims.sx : modeled ? 1 : dims.sx,
      scaleY: 1,
      scaleZ: bridgeModel ? dims.sz : modeled ? 1 : dims.sz,
      color,
      icon,
    };
  }

  return { groupKey, inst };
}

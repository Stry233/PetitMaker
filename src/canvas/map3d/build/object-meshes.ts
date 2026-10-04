/**
 * PURE object-instance resolver: GridState → instance groups keyed by group key
 * ('m:<catalogId>', 'a:<archetypeKey>', 'd:<catalogId>'). No three.js; the scene
 * turns each group into one InstancedMesh.
 *
 * Transform convention (consistent for every object):
 *  - CENTRE comes from getPlacedObjectSize (the rotated world footprint) so the
 *    proxy sits exactly where the 2D footprint is.
 *  - SCALE comes from the UNROTATED logical dims (width×height, or span×width for
 *    bridges); rotationY then orients it. This avoids double-applying rotation.
 *    A self-sized object (the plaza) stores its turned footprint, so it takes no turn.
 */
import { type GridState, type PlacedObject, type CatalogItem, type Rotation } from '../../../core/model/types';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize, objectElevation, isSelfSized } from '../../../state/object-geometry';
import { surfaceY, cellCornerWorld, layerToY, platformTopY, LAYER_HEIGHT, PLATFORM_UNIT_H, SPAN_DECK_CLEARANCE, bridgeDeckY } from '../core/coords';
import { objectColor } from '../core/palette';
import { getDeckSpec, hasModel } from '../models/registry';
import type { ArchetypeKey, ObjectInstance } from '../core/types';
import { isBridge, isCoating, isCoatingItem, isRamp, rampDropLayers } from '../../../core/model/traits';

// Yaw per object rotation. The bespoke models front their door on -Z, but the 2D
// convention fronts rotation 0 SOUTH (+Y ↔ +Z world; see buildingGate), so every
// yaw is offset by π to face the same way as 2D — otherwise houses/facilities
// (the only items with a visible front) point the opposite direction. Symmetric
// items (trees, roads, bridges…) are unaffected by the 180°.
const ROT: Record<Rotation, number> = { 0: Math.PI, 90: Math.PI / 2, 180: 0, 270: -Math.PI / 2 };

const RAMP_SINK = 0.07;  // sink the ramp's LOW tip below grade (and grow its height to compensate) so a road meeting it tucks under, never overlaps

/** Y-rotation that points the unit ramp's high end (local +Z) at the world side
 *  the 2D renderer treats as "high": spanAxis y(rot 0/180) ↔ world Z, x(rot 90/270)
 *  ↔ world X; highAtStart (rot 0/90) ⇒ low-coordinate side. Derived to match
 *  `state/object-geometry.ts:rampOrientation` exactly. */
const RAMP_ROT_Y: Record<Rotation, number> = { 0: Math.PI, 90: -Math.PI / 2, 180: 0, 270: Math.PI / 2 };

/** The archetype an object renders as — the ONE place object→shape is decided:
 *  the catalog category, else a flat platform (off-catalog self-described footprints like the
 *  central plaza). */
function archetypeFor(obj: PlacedObject, item: CatalogItem | undefined): ArchetypeKey {
  if (isSelfSized(obj)) return 'platform';
  return item ? item.category : 'platform';
}

/** Unrotated logical dims (X×Z before rotationY) used for scaling the unit geometry. */
function logicalDims(obj: PlacedObject, item: CatalogItem | undefined): { sx: number; sz: number } {
  if (isSelfSized(obj)) return { sx: obj.width, sz: obj.height };
  if (obj.spanLength && item) return { sx: obj.spanLength, sz: item.width };
  if (item) return { sx: item.width, sz: item.height };
  return { sx: 1, sz: 1 };
}

/**
 * Whether this object's body is meshed by buildRoadTrimMeshes instead of riding an instance: every
 * road is, since a road surface FEATHERS at its boundary (vertex-colour rings no instanced unit
 * box can carry). `objectInstance` skips exactly this set, so anything that ANIMATES a body (the
 * 3D group-rotation tween) must offset the road mesh for these and an instance matrix for
 * everything else — asking the same question here is what keeps the two from disagreeing about
 * who draws a road.
 */
export function isTrimMeshedRoad(obj: PlacedObject): boolean {
  return isCoatingItem(getCatalogItem(obj.catalogId));
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
 * footprint). A modeled ramp or bridge is authored in unit span space and
 * scaled across its span like the archetype. Null = not instanced (a trimmed
 * road is meshed by buildRoadTrimMeshes instead).
 */
export function objectInstance(state: GridState, obj: PlacedObject): { groupKey: string; inst: ObjectInstance } | null {
  const { width, height } = state.template;
  const item = getCatalogItem(obj.catalogId);
  // Roads are meshed by buildRoadTrimMeshes, feather and all — never instanced.
  if (isTrimMeshedRoad(obj)) return null;
  const key = archetypeFor(obj, item);
  // Ramps + bridges CAN be modeled (authored in UNIT span/wedge space): a ramp
  // uses the ramp transform below, a bridge stretches its bespoke geometry across
  // the span (scaleX = spanLength, scaleZ = deck width) just like the archetype.
  // Only roads stay a pure scaling decal.
  const modeled = !!item && hasModel(item.id) && !isCoating(item);
  const bridgeModel = modeled && isBridge(item);
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
  if (item && isRamp(item)) {
    // Ramps connect the lower terrain (elevation − drop) up to `elevation`. Sit
    // the unit wedge's base at the LOW surface and stretch it up by the drop, so
    // it rises from layer n−drop to layer n (not floating at n). The 90/270
    // rotations swap the footprint, so the wedge's footprint scale swaps too.
    const layers = rampDropLayers(item);
    const lowElev = Math.max(0, obj.elevation - layers);
    const swap = obj.rotation === 90 || obj.rotation === 270;
    inst = {
      x: center.x,
      // The low tip tucks under approach roads; the upper landing clears the plateau surface.
      y: layerToY(lowElev) - RAMP_SINK,
      z: center.z,
      rotationY: RAMP_ROT_Y[obj.rotation],
      scaleX: swap ? size.h : size.w,
      scaleY: layers * LAYER_HEIGHT + RAMP_SINK + SPAN_DECK_CLEARANCE,
      scaleZ: swap ? size.w : size.h,
      color,
      icon,
    };
  } else {
    // A platform (the central plaza) is its own plinth: it FILLS from the ground up to
    // the deck at its elevation, where everything else stands ON a surface the terrain
    // provides — surfaceY, the slab top at layer 0 and the terrain top above.
    const platform = key === 'platform';
    const elev = objectElevation(state, obj);
    inst = {
      x: center.x,
      y: platform ? 0 : isBridge(item) ? bridgeDeckY(elev) : surfaceY(elev),
      z: center.z,
      // A self-sized object's width and height are already its turned footprint: its art rests
      // upright, so it takes the unturned yaw.
      rotationY: obj.width !== undefined ? ROT[0] : ROT[obj.rotation],
      // A footprint-authored model → no scaling; a bridge model is authored in
      // UNIT span-space → stretch by (span × deck width); an archetype is a unit
      // shape → scale to the footprint.
      scaleX: bridgeModel ? dims.sx : modeled ? 1 : dims.sx,
      scaleY: platform ? platformTopY(elev) / PLATFORM_UNIT_H : 1,
      scaleZ: bridgeModel ? dims.sz : modeled ? 1 : dims.sz,
      color,
      icon,
    };
  }

  return { groupKey, inst };
}

/**
 * The instance that stands an object's deck parts on its platform, or null when it has none: the
 * item's `deckModel3d` at the deck top of a platform object, turned with the object's rotation and
 * scaled from the footprint it was authored at to the object's unturned one. Group key 'd:<catalogId>'.
 */
export function deckInstance(state: GridState, obj: PlacedObject): { groupKey: string; inst: ObjectInstance } | null {
  const item = getCatalogItem(obj.catalogId);
  const spec = item ? getDeckSpec(item.id) : undefined;
  if (!item || !spec || archetypeFor(obj, item) !== 'platform') return null;
  const { width, height } = state.template;
  const size = getPlacedObjectSize(obj);
  const corner = cellCornerWorld(obj.position.x, obj.position.y, width, height);
  // The stored footprint is the turned one; the parts turn with it from their unturned layout.
  const across = obj.rotation % 180 !== 0;
  const [uw, uh] = across ? [size.h, size.w] : [size.w, size.h];
  return {
    groupKey: `d:${item.id}`,
    inst: {
      x: corner.x + size.w / 2,
      y: platformTopY(objectElevation(state, obj)),
      z: corner.z + size.h / 2,
      rotationY: ROT[obj.rotation] - ROT[0],
      scaleX: uw / spec.footprint[0],
      scaleY: 1,
      scaleZ: uh / spec.footprint[1],
      color: objectColor(obj, item),
    },
  };
}

/** The suffix of the slot that draws an object's deck parts, beside its body's slot. */
const DECK_SLOT = '\u0000deck';

/** The instance slots that may draw object `id`: its body's, then its deck parts'. */
export function objectSlotIds(id: string): readonly [string, string] {
  return [id, `${id}${DECK_SLOT}`];
}

/** The object a slot draws. */
export function slotOwner(slotId: string): string {
  return slotId.endsWith(DECK_SLOT) ? slotId.slice(0, -DECK_SLOT.length) : slotId;
}

/** Every instance that draws `obj`, under the slot it takes: its body, then its deck parts. None for a
 *  trim-meshed road. */
export function objectSlotInstances(state: GridState, obj: PlacedObject): Array<{ slotId: string; groupKey: string; inst: ObjectInstance }> {
  const body = objectInstance(state, obj);
  if (!body) return [];
  const [bodyId, deckId] = objectSlotIds(obj.id);
  const deck = deckInstance(state, obj);
  return [{ slotId: bodyId, ...body }, ...(deck ? [{ slotId: deckId, ...deck }] : [])];
}

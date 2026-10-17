import type { CatalogItem, PlacementTrait } from './types';
import { TERRAIN_GRID_OFFSET } from '../grid/grid-convert';

/** Whether a catalog item carries a placement trait of the given type. The one shared
 *  predicate for `item.traits.some(t => t.type === ...)` (re-implemented across rules,
 *  tools, edge-cut, renderer) — keep the open-coded form out of higher layers. */
export const hasTrait = (item: CatalogItem, type: PlacementTrait['type']): boolean =>
  item.traits.some(t => t.type === type);

/** Whether an item is a surface coating (a road/path) — coated over terrain, never a blocker. */
export const isCoating = (item: CatalogItem): boolean => hasTrait(item, 'surfaceCoating');

/** The trait variant of the given type. */
type TraitOf<T extends PlacementTrait['type']> = Extract<PlacementTrait, { type: T }>;

/** The item's trait of the given type, typed to that variant, or undefined. */
export function findTrait<T extends PlacementTrait['type']>(
  item: { readonly traits: readonly PlacementTrait[] } | undefined | null, type: T,
): TraitOf<T> | undefined {
  return item?.traits.find((t): t is TraitOf<T> => t.type === type);
}

// Behaviour asks these predicates and the category roles below; a category id remains the shelf grouping
// and the item pools drawn from it.

/**
 * What a category's items are to the engines, which ask the role and never the category id: a tall
 * plant that forms a canopy, a low one that covers the ground, a structure people live in, or one
 * that serves them. A crossing or a surface coating says what it is through its placement traits
 * instead. The game's data maps each category to at most one role, and each role to at most one category.
 */
export type CategoryRole = 'canopy' | 'groundcover' | 'home' | 'amenity';

/** Whether a role's items are plants. */
export const isPlantRole = (role: CategoryRole | undefined): boolean => role === 'canopy' || role === 'groundcover';

/** Whether a role's items are structures, lived in or serving. */
export const isStructureRole = (role: CategoryRole | undefined): boolean => role === 'home' || role === 'amenity';

/** Whether the item is a surface coating; false for a missing item. */
export const isCoatingItem = (item: CatalogItem | undefined | null): boolean => !!item && isCoating(item);

/** Whether the item spans water between two flat ends (`waterSpan`). */
export const isBridge = (item: CatalogItem | undefined | null): boolean => !!item && hasTrait(item, 'waterSpan');

/** The longest footprint a span trait lays along its axis: the widest gap plus the near end the
 *  deck rests on. */
export const spanFootprintLength = (span: { max: number }): number => span.max + 1;

/** The longest side any placement of `item` can take, in cells, a bridge at its widest span included. */
export function longestFootprintSide(item: CatalogItem): number {
  const span = findTrait(item, 'waterSpan');
  return Math.max(item.width, item.height, span ? spanFootprintLength(span) : 0);
}

/** Whether the item climbs between two levels (`heightDrop`). */
export const isRamp = (item: CatalogItem | undefined | null): boolean => !!item && hasTrait(item, 'heightDrop');

/** The placement traits that decide their own footprint: a placement carrying one is snapped onto
 *  the site the trait detects as its command resolves (`rules/placement.ts:TRAIT_RESOLVERS`, keyed by
 *  exactly this set), so the position a command carries is a probe anchor, not the footprint. */
const SELF_SNAPPING_TRAITS = ['waterSpan', 'heightDrop'] as const satisfies readonly PlacementTrait['type'][];
export type SelfSnappingTrait = typeof SELF_SNAPPING_TRAITS[number];

/** Whether a trait type is one of `SELF_SNAPPING_TRAITS`. */
export const isSelfSnappingTrait = (type: PlacementTrait['type']): type is SelfSnappingTrait =>
  (SELF_SNAPPING_TRAITS as readonly string[]).includes(type);

/** The ground zones an item's footprint may stand on: its `groundZones` trait, or wholly on buildable
 *  ground for an item without one. */
export function groundZonesOf(item: CatalogItem): Omit<Extract<PlacementTrait, { type: 'groundZones' }>, 'type'> {
  const own = findTrait(item, 'groundZones');
  return own
    ? { onGrass: own.onGrass, onSand: own.onSand, acrossBoundary: own.acrossBoundary }
    : { onGrass: true, onSand: false, acrossBoundary: false };
}

/** Whether the item is a crossing: a bridge or a ramp, which detects its own site and may stand over coatings. */
export const isCrossing = (item: CatalogItem | undefined | null): boolean => isBridge(item) || isRamp(item);

/** The layers a ramp climbs (its `heightDrop`), 1 for an item without one. */
export const rampDropLayers = (item: CatalogItem | undefined | null): number => findTrait(item, 'heightDrop')?.layers ?? 1;

/** How far a ramp's run reaches onto its upper tier, in cells: its footprint covers the part of the
 *  terrain cell at its high end that the terrain grid's offset leaves inside it. */
export const RAMP_UPPER_RUN = -TERRAIN_GRID_OFFSET.x;

/** Placement, overlap validation and coating removal share this support relation. */
export const standsOnCoating = (item: CatalogItem | undefined | null, coating: CatalogItem): boolean =>
  !!item && (hasTrait(item, 'coatingSupport') || (hasTrait(item, 'growsOnPlantable') && hasTrait(coating, 'plantable')));

/** Coatings replace only their own layer; omitted layer is ordinary pavement. */
export const coatingLayer = (item: CatalogItem | undefined | null): number => findTrait(item, 'surfaceCoating')?.layer ?? 0;
export const isSurfacePrint = (item: CatalogItem | undefined | null): boolean => isCoatingItem(item) && coatingLayer(item) > 0;

/** Repainting replaces its own layer; compatible solids preserve the coatings beneath them. */
export const replacesCoating = (item: CatalogItem | undefined | null, coating: CatalogItem): boolean =>
  !isCrossing(item) && !standsOnCoating(item, coating) && (!isCoatingItem(item) || coatingLayer(item) === coatingLayer(coating));

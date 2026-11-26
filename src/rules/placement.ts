/**
 * V-PLACE-TRAIT: Trait-based object placement validation (pre-command).
 *
 * Its resolve step snaps an item whose trait decides its own footprint (`TRAIT_RESOLVERS`: the
 * bridge's span, the ramp's cliff) onto a copy of the command. Validation then runs each trait's
 * validator from `TRAIT_VALIDATORS`, which names every trait type with its own description, against
 * the command as it lands.
 */
import {
  CommandType,
  TerrainType,
  type GridState,
  type MacroCoord,
  type CatalogItem,
  type PlaceObjectCommand,
  type PlacedObject,
  type PlacementTrait,
  type ValidationError,
} from '../core/model/types';
import { getCell } from '../core/model/grid-model';
import { coveredCells, footprintCells } from '../core/grid/footprint';
import { realSurface, surfaceElevation } from '../core/domain/terrain/terrain-surface';
import { getAllItems, getCatalogItem, itemRole } from '../state/catalog';
import { getPlacedObjectSize, objectRect, onItemGrid, placedFootprint } from '../state/object-geometry';
import { entriesNear, getObjectIndex } from '../state/object-index';
import { bridgeSpanHolds, detectBridgeSpan } from '../core/domain/terrain/bridge-span';
import { detectRampSpan, rampSpanHolds } from '../core/domain/terrain/ramp-span';
import { BASE_SUPPORT, PLACEMENT_GRID, TERRAIN_GRID } from '../core/game/profile';
import { BUILDABLE_ZONES, SAND_ZONE, zoneName } from '../core/game/zones';
import { evidenceOn } from '../core/grid/grids';
import { findTrait, isSelfSnappingTrait, RAMP_UPPER_RUN, type SelfSnappingTrait } from '../core/model/traits';
import type { Rect } from '../core/grid/rect';
import type { RuleMessageKey } from './messages';
import { definePreRule, type Fail } from './define';

/** What every trait validator reads: the placement being judged and the cells it covers. */
interface TraitCheck {
  item: CatalogItem;
  cmd: PlaceObjectCommand;
  state: GridState;
  footprint: MacroCoord[];
  pos: MacroCoord;
  fail: Fail;
}

type TraitValidator<K extends PlacementTrait['type']> =
  (trait: Extract<PlacementTrait, { type: K }>, at: TraitCheck) => ValidationError[];

/** The fields a trait that decides its own footprint snaps; null when `object` already stands as
 *  the trait resolves it, or when nothing near it resolves (validation then refuses it). */
type TraitResolver<K extends PlacementTrait['type']> = (
  trait: Extract<PlacementTrait, { type: K }>, item: CatalogItem, object: PlacedObject, state: GridState,
) => Partial<PlacedObject> | null;

/** The traits that resolve a placement before it is judged, one per `SELF_SNAPPING_TRAITS` entry. A resolved object already stands, so
 *  resolving the command a placement landed as lands it again unchanged. */
const TRAIT_RESOLVERS: { [K in SelfSnappingTrait]: TraitResolver<K> } = {
  // A bridge spans two flat ends of equal height across a gap within [min, max]; detection reads
  // the gap cell it is handed and snaps position, rotation, span length and deck elevation.
  waterSpan(trait, item, object, state) {
    if (bridgeSpanHolds(state, object, item.width, trait.min, trait.max)) return null;
    const span = detectBridgeSpan(state, object.position, item.width, trait.min, trait.max);
    return span && { rotation: span.rotation, position: span.position, spanLength: span.spanLength, elevation: span.elevation };
  },
  // A ramp climbs a cliff exactly `layers` high beside the anchor; detection snaps position,
  // rotation and the high end's elevation.
  heightDrop(trait, item, object, state) {
    if (rampSpanHolds(state, object, item.width, item.height, trait.layers)) return null;
    const span = detectRampSpan(state, object.position, item.width, item.height, trait.layers);
    return span && { rotation: span.rotation, position: span.position, elevation: span.elevation };
  },
};

/**
 * The `flat` trait's own test: every cell of the sweep for a `w` x `h` body anchored at `pos` whose
 * surface is water or off `base`. The sweep is the covered footprint plus one cell past the last on
 * each axis (the dual-grid margin), by covered cells rather than `pos` plus an integer offset, so a
 * half-integer anchor never probes a fractional cell. Off-map cells report nothing. A generator that
 * must foresee the refusal asks this.
 */
export function flatSweepOffenders(state: GridState, pos: MacroCoord, w: number, h: number, base: number): MacroCoord[] {
  const xs = coveredCells(pos.x, w, 'x');
  const ys = coveredCells(pos.y, h, 'y');
  const sweepXs = [...xs, xs[xs.length - 1]! + 1];
  const sweepYs = [...ys, ys[ys.length - 1]! + 1];
  const offenders: MacroCoord[] = [];
  for (const cy of sweepYs) {
    for (const cx of sweepXs) {
      const cell = getCell(state.cells, cx, cy);
      if (!cell) continue;
      const surf = realSurface(cell.terrain);
      if (surf?.type === TerrainType.Water || (surf?.elevation ?? 0) !== base) offenders.push({ x: cx, y: cy });
    }
  }
  return offenders;
}

/** Open cells between two footprints, the larger of the two axes' gaps (0 where they touch or
 *  overlap): a diagonal neighbour is as close as a side neighbour. */
function footprintGap(a: Rect, b: Rect): number {
  const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
  const gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
  return Math.max(gx, gy);
}

/** The largest `exclusionRadius` the catalog holds: how far a neighbour's own spacing reaches. */
function widestExclusion(): number {
  let widest = 0;
  for (const i of getAllItems()) widest = Math.max(widest, findTrait(i, 'exclusionRadius')?.radius ?? 0);
  return widest;
}

/**
 * The `exclusionRadius` test: the standing objects (other than `selfId`) that also carry the trait
 * and stand nearer `rect` than the larger radius of the pair, their footprints, and the first pair's
 * message and spacing; null when `item` carries no radius or nothing is too close. A generator that
 * must foresee the refusal asks this.
 */
export function spacingClash(
  state: GridState, item: CatalogItem, rect: Rect, selfId?: string,
): { offenders: MacroCoord[]; message: RuleMessageKey; n: number } | null {
  const own = findTrait(item, 'exclusionRadius');
  if (!own) return null;
  const reach = Math.max(own.radius, widestExclusion());
  const near = entriesNear(getObjectIndex(state), { x: rect.x - reach, y: rect.y - reach, w: rect.w + 2 * reach, h: rect.h + 2 * reach });
  const offenders: MacroCoord[] = [];
  let first: { message: RuleMessageKey; n: number } | null = null;
  for (const e of near) {
    if (!e.item || e.obj.id === selfId) continue;
    const theirs = findTrait(e.item, 'exclusionRadius');
    const need = Math.max(own.radius, theirs?.radius ?? 0);
    if (!theirs || footprintGap(rect, e.rect) >= need) continue;
    offenders.push(...placedFootprint(e.obj));
    first ??= { message: spacingMessage(item, e.item), n: need };
  }
  return first && { offenders, ...first };
}

/** The refusal two spaced items too close give: two homes, a home and a tree, or two of one kind. */
function spacingMessage(a: CatalogItem, b: CatalogItem): RuleMessageKey {
  const roles = new Set([itemRole(a), itemRole(b)]);
  if (roles.size === 1 && roles.has('home')) return 'error.house_too_close';
  if (roles.has('home') && roles.has('canopy')) return 'error.house_tree_too_close';
  return 'error.too_close_same_kind';
}

/** A marker trait read elsewhere, with no placement constraint of its own. */
const passive = (): ValidationError[] => [];

/** A trait's registration: what it means, stated for any reader in plain English with its numbers
 *  read from the profile and its fields by name, and how a placement carrying it is judged. Every
 *  reader of the trait derives from `description`, so it changes with the trait. */
interface TraitEntry<K extends PlacementTrait['type']> {
  description: string;
  validate: TraitValidator<K>;
}

const SAND = zoneName(SAND_ZONE);

const TRAIT_VALIDATORS: { [K in PlacementTrait['type']]: TraitEntry<K> } = {
  flat: {
    description: 'The whole footprint, and one more cell to its right and below, stands at one elevation with no water.',
    validate(_trait, { cmd, state, footprint, pos, fail }) {
      const first = footprint[0];
      if (!first) return [];
      const firstCell = getCell(state.cells, first.x, first.y);
      const baseElev = surfaceElevation(firstCell?.terrain);
      // Use the rotated footprint so the flat check covers the cells the object
      // actually occupies (matching V-ZONE-01 / V-PLACE-OVERLAP). A raw item.width/
      // height read tests a transposed region for a rotated non-square item, letting
      // part of the real footprint sit off a flat surface.
      const { w, h } = getPlacedObjectSize(cmd.object);
      // The offenders may sit outside the footprint: the sweep reaches one cell past it.
      const offenders = flatSweepOffenders(state, pos, w, h, baseElev);
      if (offenders.length > 0) return [fail('error.placement_not_flat', evidenceOn(TERRAIN_GRID, offenders))];
      return [];
    },
  },

  // The resolve step has snapped a bridge or ramp that can stand; one that still does not stands
  // where nothing resolves it.
  waterSpan: {
    description: 'A bridge: it needs two flat ends of equal height with a gap of `min` to `max` cells (water, void or lower ground) between them. Its position, rotation, span and elevation snap to the site, found from the gap cell the placement names.',
    validate(trait, { item, cmd, state, pos, fail }) {
      if (bridgeSpanHolds(state, cmd.object, item.width, trait.min, trait.max)) return [];
      return [fail('error.bridge_invalid', evidenceOn(PLACEMENT_GRID, [pos]))];
    },
  },

  heightDrop: {
    description: `A ramp: it needs an adjacent cliff exactly \`layers\` layers high, and snaps onto it. Its footprint covers ${RAMP_UPPER_RUN} cell of the upper tier; the rest of its length lies on the lower tier.`,
    validate(trait, { item, cmd, state, pos, fail }) {
      if (rampSpanHolds(state, cmd.object, item.width, item.height, trait.layers)) return [];
      return [fail('error.ramp_wrong_height', evidenceOn(PLACEMENT_GRID, [pos]), { messageParams: { n: trait.layers } })];
    },
  },

  surfaceCoating: {
    description: 'A coating laid over the ground: pavement on layer 0, the default, or a transparent surface print on a layer above it. Coatings on different layers coexist, and each cell holds one per layer. Its footprint needs terrain that is not water.',
    validate(_trait, { state, footprint, fail }) {
      const offenders = footprint.filter((coord) => {
        const cell = getCell(state.cells, coord.x, coord.y);
        return !cell || realSurface(cell.terrain)?.type === TerrainType.Water;
      });
      if (offenders.length > 0) return [fail('error.road_needs_terrain', evidenceOn(TERRAIN_GRID, offenders))];
      return [];
    },
  },

  // Support markers consumed by overlap and finished-stroke validation.
  coatingSupport: {
    description: 'A structure that may stand on coatings and keeps them; a coating may also be laid beneath it where it stands.',
    validate: passive,
  },
  plantable: {
    description: 'A coating that an item with growsOnPlantable may stand on.',
    validate: passive,
  },
  growsOnPlantable: {
    description: 'A plant that may stand on a plantable coating and keeps it.',
    validate: passive,
  },

  // Evidence = the footprints of the objects too close.
  exclusionRadius: {
    description: 'Keeps `radius` open cells between its footprint and that of every other item carrying the trait, diagonals included; of two such items the larger radius applies.',
    validate(_trait, { item, cmd, state, fail }) {
      const clash = spacingClash(state, item, objectRect(cmd.object, item), cmd.object.id);
      if (!clash) return [];
      return [fail(clash.message, evidenceOn(PLACEMENT_GRID, clash.offenders), { messageParams: { n: clash.n } })];
    },
  },

  terrainBase: {
    description: `Its footprint counts as part of the ${BASE_SUPPORT.window}x${BASE_SUPPORT.window} base a mountain needs (V-MTN-03), at the layer it stands at; it asks nothing of its own placement.`,
    validate: passive,
  },
  groundZones: {
    description: `The ground its footprint may stand on, which V-ZONE-01 judges: wholly on ${BUILDABLE_ZONES} (\`onGrass\`), wholly on ${SAND} (\`onSand\`), or across the two (\`acrossBoundary\`). An item without the trait stands wholly on ${BUILDABLE_ZONES}.`,
    validate: passive,
  },
  // Read by `state/object-geometry:hasHalfStep`; an item without it is what the fractional-position
  // guard in the rule refuses.
  halfStep: {
    description: 'May anchor on half cells on both axes; an item without the trait anchors on whole cells.',
    validate: passive,
  },
  // Read by the planet session (editor/operations/planet-session).
  footprintTurn: {
    description: 'Turns as a whole footprint about its centre, width and height swapping, while the map it stands on is being shaped as a planet.',
    validate: passive,
  },
};

/** What each placement trait means, in its own words, in the order the traits are registered. */
export const TRAIT_DESCRIPTIONS: ReadonlyMap<PlacementTrait['type'], string> = new Map(
  (Object.keys(TRAIT_VALIDATORS) as PlacementTrait['type'][]).map((type) => [type, TRAIT_VALIDATORS[type].description]),
);

/**
 * The half-cell grid is a trait-granted exception (halfStep, ramps/bridges only): a fractional
 * position on any other item is refused before any trait runs, since an item without the trait
 * never reaches a 'halfStep' validator of its own to catch this itself. The exception is half cells
 * and nothing finer: an anchor off both grids would otherwise reach detection, which reads it as
 * the nearest half and would place somewhere the caller never asked for.
 */
function anchorOnItemGrid(item: CatalogItem, pos: MacroCoord): boolean {
  return onItemGrid(item, pos.x) && onItemGrid(item, pos.y);
}

export const traitPlacementRule = definePreRule({
  id: 'V-PLACE-TRAIT',
  description: 'A placed object must satisfy each placement trait its item carries.',
  appliesTo: [CommandType.PlaceObject],

  resolve(cmd, state) {
    const item = getCatalogItem(cmd.object.catalogId);
    if (!item || !anchorOnItemGrid(item, cmd.object.position)) return cmd;
    let object = cmd.object;
    for (const trait of item.traits) {
      if (!isSelfSnappingTrait(trait.type)) continue;
      const resolver = TRAIT_RESOLVERS[trait.type] as TraitResolver<PlacementTrait['type']>;
      const snap = resolver(trait, item, object, state);
      if (snap) object = { ...object, ...snap };
    }
    return object === cmd.object ? cmd : { ...cmd, object };
  },

  validate(cmd, state, fail) {
    const item = getCatalogItem(cmd.object.catalogId);
    if (!item) return [];

    const pos = cmd.object.position;
    if (!anchorOnItemGrid(item, pos)) return [fail('error.placement_off_grid', evidenceOn(PLACEMENT_GRID, [pos]))];
    const { w, h } = getPlacedObjectSize(cmd.object, item);
    const check: TraitCheck = { item, cmd, state, footprint: footprintCells(pos.x, pos.y, w, h), pos, fail };
    const errors: ValidationError[] = [];
    for (const trait of item.traits) {
      const validate = TRAIT_VALIDATORS[trait.type].validate as (t: PlacementTrait, at: TraitCheck) => ValidationError[];
      errors.push(...validate(trait, check));
    }
    return errors;
  },
});

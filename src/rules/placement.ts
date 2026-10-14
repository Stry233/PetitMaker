/**
 * V-PLACE-TRAIT: Trait-based object placement validation (pre-command).
 *
 * Its resolve step snaps an item whose trait decides its own footprint (`TRAIT_RESOLVERS`: the
 * bridge's span, the ramp's cliff) onto a copy of the command. Validation then runs each trait's
 * validator from `TRAIT_VALIDATORS`, which names every trait type, against the command as it lands.
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
import { getCatalogItem } from '../state/catalog';
import { getPlacedObjectSize, onItemGrid, placedFootprint } from '../state/object-geometry';
import { entriesNear, getObjectIndex } from '../state/object-index';
import { bridgeSpanHolds, detectBridgeSpan } from '../core/domain/terrain/bridge-span';
import { detectRampSpan, rampSpanHolds } from '../core/domain/terrain/ramp-span';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../core/game/profile';
import { evidenceOn } from '../core/grid/grids';
import { isSelfSnappingTrait, type SelfSnappingTrait } from '../core/model/traits';
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

/** A marker trait read elsewhere, with no placement constraint of its own. */
const passive = (): ValidationError[] => [];

const TRAIT_VALIDATORS: { [K in PlacementTrait['type']]: TraitValidator<K> } = {
  flat(_trait, { cmd, state, footprint, pos, fail }) {
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

  noFloat(_trait, { state, footprint, fail }) {
    const offenders = footprint.filter((coord) => {
      const cell = getCell(state.cells, coord.x, coord.y);
      return !cell || !realSurface(cell.terrain);
    });
    if (offenders.length > 0) return [fail('error.floating_block', evidenceOn(TERRAIN_GRID, offenders))];
    return [];
  },

  // The resolve step has snapped a bridge or ramp that can stand; one that still does not stands
  // where nothing resolves it.
  waterSpan(trait, { item, cmd, state, pos, fail }) {
    if (bridgeSpanHolds(state, cmd.object, item.width, trait.min, trait.max)) return [];
    return [fail('error.bridge_invalid', evidenceOn(PLACEMENT_GRID, [pos]))];
  },

  heightDrop(trait, { item, cmd, state, pos, fail }) {
    if (rampSpanHolds(state, cmd.object, item.width, item.height, trait.layers)) return [];
    return [fail('error.ramp_wrong_height', evidenceOn(PLACEMENT_GRID, [pos]), { messageParams: { n: trait.layers } })];
  },

  surfaceCoating(_trait, { state, footprint, fail }) {
    const offenders = footprint.filter((coord) => {
      const cell = getCell(state.cells, coord.x, coord.y);
      return !cell || realSurface(cell.terrain)?.type === TerrainType.Water;
    });
    if (offenders.length > 0) return [fail('error.road_needs_terrain', evidenceOn(TERRAIN_GRID, offenders))];
    return [];
  },

  exclusionRadius(trait, { item, state, pos, fail }) {
    // Evidence = the footprints of every conflicting same-category object — the
    // things that are too close — not the attempted spot. Candidates come from
    // the spatial index over the radius square (anchor distance is Chebyshev,
    // so any conflicting anchor lies inside it).
    const offenders: MacroCoord[] = [];
    const r = trait.radius;
    const near = entriesNear(getObjectIndex(state), { x: pos.x - r, y: pos.y - r, w: 2 * r + 1, h: 2 * r + 1 });
    for (const e of near) {
      if (!e.item || e.item.category !== item.category) continue;
      const dx = Math.abs(pos.x - e.obj.position.x);
      const dy = Math.abs(pos.y - e.obj.position.y);
      if (dx <= r && dy <= r) offenders.push(...placedFootprint(e.obj));
    }
    if (offenders.length > 0) return [fail('error.too_close_same_kind', evidenceOn(PLACEMENT_GRID, offenders))];
    return [];
  },

  // Terrain may use this footprint as a base (base-support).
  terrainBase: passive,
  // Support markers consumed by overlap and finished-stroke validation.
  coatingSupport: passive,
  plantable: passive,
  growsOnPlantable: passive,
  // How the item turns in the planet session (editor/operations/planet-session).
  footprintTurn: passive,
  // Grants the item a half-cell anchor on both axes (state/object-geometry:hasHalfStep); an item
  // without this trait is what the fractional-position guard in the rule refuses.
  halfStep: passive,
};

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
      const validate = TRAIT_VALIDATORS[trait.type] as (t: PlacementTrait, at: TraitCheck) => ValidationError[];
      errors.push(...validate(trait, check));
    }
    return errors;
  },
});

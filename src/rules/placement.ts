/**
 * V-PLACE-TRAIT: Trait-based object placement validation (pre-command).
 *
 * Iterates the catalog item's PlacementTrait list and runs each trait's
 * validator. New traits can be added by extending the switch in validateTrait.
 */
import {
  CellZone,
  CommandType,
  TerrainType,
  type Command,
  type GridState,
  type MacroCoord,
  type PlacementTrait,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { getCell, getFootprint } from '../core/model/grid-model';
import { realSurface, surfaceElevation } from '../core/edge-cut/terrain-silhouette';
import { getCatalogItem } from '../state/catalog';
import { getPlacedObjectSize } from '../state/object-geometry';
import { entriesNear, getObjectIndex } from '../state/object-index';
import { detectBridgeSpan } from '../core/model/bridge-span';

const CARDINAL_OFFSETS: readonly MacroCoord[] = [
  { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 },
];

function validateTrait(
  trait: PlacementTrait,
  cmd: Extract<Command, { type: CommandType.PlaceObject }>,
  state: GridState,
  footprint: MacroCoord[],
): ValidationError[] {
  const pos = cmd.object.position;

  switch (trait.type) {
    case 'flat': {
      const first = footprint[0];
      if (!first) return [];
      const firstCell = getCell(state.cells, first.x, first.y);
      const baseElev = surfaceElevation(firstCell?.terrain);
      // Use the ROTATED footprint so the flat check covers the cells the object
      // actually occupies (matching V-ZONE-01 / V-PLACE-OVERLAP). A raw item.width/
      // height read tests a transposed region for a rotated non-square item, letting
      // part of the real footprint sit off a flat surface.
      const { w, h } = getPlacedObjectSize(cmd.object);

      // Evidence = every cell in the extended sweep whose surface is water or off the
      // anchor's level (the offenders may sit OUTSIDE the footprint — the +1 sweep).
      const offenders: MacroCoord[] = [];
      for (let dy = 0; dy <= h; dy++) {
        for (let dx = 0; dx <= w; dx++) {
          const cx = pos.x + dx, cy = pos.y + dy;
          const cell = getCell(state.cells, cx, cy);
          if (!cell) continue;
          // The plaza is a raised no-build platform, not a cliff the object can
          // float off — skip it so items can sit flush against the plaza. Actual
          // footprint overlap with the plaza object is rejected by V-PLACE-OVERLAP
          // (and terrain over it by V-PLACE-BLOCK). NOTE: at runtime createGrid rewrites
          // Plaza zones to Grass, so this branch is a defensive guard, not the real ban.
          if (cell.zone === CellZone.Plaza) continue;
          const surf = realSurface(cell.terrain);
          if (surf?.type === TerrainType.Water || (surf?.elevation ?? 0) !== baseElev) {
            offenders.push({ x: cx, y: cy });
          }
        }
      }
      if (offenders.length > 0) {
        return [{ ruleId: 'V-PLACE-TRAIT', message: 'error.placement_not_flat', cells: offenders, grid: 'micro', severity: 'error' }];
      }
      return [];
    }

    case 'noFloat': {
      const offenders = footprint.filter((coord) => {
        const cell = getCell(state.cells, coord.x, coord.y);
        return !cell || !realSurface(cell.terrain);
      });
      if (offenders.length > 0) {
        return [{ ruleId: 'V-PLACE-TRAIT', message: 'error.floating_block', cells: offenders, grid: 'micro', severity: 'error' }];
      }
      return [];
    }

    case 'waterSpan': {
      // Bridge: an overpass between two flat ends of EQUAL height, across a gap
      // within [min, max]. The gap below the deck may be water, off-map void, OR
      // lower terrain — water is not required. Auto-detects orientation
      // and snaps position/rotation/spanLength/elevation. (See core/model/bridge-span.)
      const item = getCatalogItem(cmd.object.catalogId);
      const bridgeWidth = item?.width ?? 1;
      const span = detectBridgeSpan(state, pos, bridgeWidth, trait.min, trait.max);
      if (!span) {
        return [{ ruleId: 'V-PLACE-TRAIT', message: 'error.bridge_invalid', cells: [pos], severity: 'error' }];
      }
      cmd.object.rotation = span.rotation;
      cmd.object.position = span.position;
      cmd.object.spanLength = span.spanLength;
      cmd.object.elevation = span.elevation;
      return [];
    }

    case 'heightDrop': {
      const anchorCell = getCell(state.cells, pos.x, pos.y);
      const anchorElev = surfaceElevation(anchorCell?.terrain);
      const item = getCatalogItem(cmd.object.catalogId);
      const spanLen = item?.height ?? 4;
      const perpWidth = item?.width ?? 2;

      for (const off of CARDINAL_OFFSETS) {
        const neighbor = getCell(state.cells, pos.x + off.x, pos.y + off.y);
        if (!neighbor) continue;
        const neighborElev = surfaceElevation(neighbor.terrain);
        if (Math.abs(anchorElev - neighborElev) !== trait.layers) continue;

        const hElev = Math.max(anchorElev, neighborElev);
        const lElev = Math.min(anchorElev, neighborElev);
        const highX = anchorElev >= neighborElev ? pos.x : pos.x + off.x;
        const highY = anchorElev >= neighborElev ? pos.y : pos.y + off.y;
        const slopeDx = anchorElev >= neighborElev ? off.x : -off.x;
        const slopeDy = anchorElev >= neighborElev ? off.y : -off.y;

        // rot=0/90: include high cell (mountain in -HALF_TILE gap direction)
        // rot=180/270: exclude high cell (mountain overlaps naturally)
        let rot: 0 | 90 | 180 | 270;
        let px: number, py: number;
        let highAtStart: boolean;
        if (slopeDy > 0) { rot = 0; px = highX; py = highY; highAtStart = true; }
        else if (slopeDx > 0) { rot = 90; px = highX; py = highY; highAtStart = true; }
        else if (slopeDy < 0) { rot = 180; px = highX; py = highY - spanLen; highAtStart = false; }
        else { rot = 270; px = highX - spanLen; py = highY; highAtStart = false; }

        const isVert = rot === 0 || rot === 180;

        // Validate the terrain UNDER the ramp. Terrain renders at -HALF_TILE (up-left), so every
        // footprint macro cell is visually overlapped by FOUR terrain cells: itself + its +1-right /
        // +1-down / +1-down-right neighbours. Sweep span 0..spanLen and perp 0..perpWidth — the +1
        // bleed on BOTH axes (micro-sampling only one axis would let a mountain micro-block poke in
        // from the un-swept edge). Each swept cell must match the ramp's elevation profile at that span
        // step: the high step (the cliff edge) is hElev, the run below it is lElev. The TRAILING span
        // bleed (si === spanLen) faces the low run for a down-ramp (highAtStart → must stay low) but
        // the HIGH plateau for an up-ramp (the cliff "overlaps naturally") — so both ramp directions
        // require a 1-high end and a spanLen-low end with flat support at each.
        const expectedAt = (si: number): number =>
          si < spanLen ? (highAtStart && si === 0 ? hElev : lElev)
                       : (highAtStart ? lElev : hElev);
        let valid = true;
        for (let si = 0; si <= spanLen && valid; si++) {
          const exp = expectedAt(si);
          for (let wi = 0; wi <= perpWidth && valid; wi++) {
            const tx = isVert ? px + wi : px + si;
            const ty = isVert ? py + si : py + wi;
            // the surface must be LAND at the expected level — water at the right
            // elevation (a lake in the low run, a pool rim as the "cliff") is not support
            const surf = realSurface(getCell(state.cells, tx, ty)?.terrain);
            if (surf?.type === TerrainType.Water || (surf?.elevation ?? 0) !== exp) { valid = false; break; }
          }
        }
        if (!valid) continue;

        cmd.object.rotation = rot;
        cmd.object.position = { x: px, y: py };
        cmd.object.elevation = hElev;
        return [];
      }
      return [{ ruleId: 'V-PLACE-TRAIT', message: 'error.ramp_wrong_height', cells: [pos], severity: 'error' }];
    }

    case 'surfaceCoating': {
      const offenders = footprint.filter((coord) => {
        const cell = getCell(state.cells, coord.x, coord.y);
        return !cell || realSurface(cell.terrain)?.type === TerrainType.Water;
      });
      if (offenders.length > 0) {
        return [{ ruleId: 'V-PLACE-TRAIT', message: 'error.road_needs_terrain', cells: offenders, grid: 'micro', severity: 'error' }];
      }
      return [];
    }

    case 'exclusionRadius': {
      const catalogItem = getCatalogItem(cmd.object.catalogId);
      if (!catalogItem) return [];
      // Evidence = the footprints of every conflicting same-category object — the
      // things that are too close — not the attempted spot. Candidates come from
      // the spatial index over the radius square (anchor distance is Chebyshev,
      // so any conflicting anchor lies inside it).
      const offenders: MacroCoord[] = [];
      const r = trait.radius;
      const near = entriesNear(getObjectIndex(state), { x: pos.x - r, y: pos.y - r, w: 2 * r + 1, h: 2 * r + 1 });
      for (const e of near) {
        if (!e.item || e.item.category !== catalogItem.category) continue;
        const dx = Math.abs(pos.x - e.obj.position.x);
        const dy = Math.abs(pos.y - e.obj.position.y);
        if (dx <= r && dy <= r) {
          const { w, h } = getPlacedObjectSize(e.obj);
          offenders.push(...getFootprint(e.obj.position.x, e.obj.position.y, w, h));
        }
      }
      if (offenders.length > 0) {
        return [{ ruleId: 'V-PLACE-TRAIT', message: 'error.tree_too_close', cells: offenders, grid: 'macro', severity: 'error' }];
      }
      return [];
    }

    case 'terrainBase':
      // Passive marker (terrain may use this footprint as a base — see base-support).
      // It imposes no placement constraint of its own.
      return [];
  }
}

export const traitPlacementRule: PreCommandRule = {
  id: 'V-PLACE-TRAIT',
  agentHint: 'Objects validate their placement traits (see TRAITS below). For flat-trait buildings do NOT guess coordinates near water or slopes — the flat check rejects ANY water or elevation change touching the footprint+1-cell margin, so a house beside a river/lake/cliff you just made will fail; call find_flat_areas (object- and margin-aware) and place at a returned anchor. bridges/ramps auto-snap position/rotation.',
  phase: 'pre-command',
  appliesTo: [CommandType.PlaceObject],

  validate(cmd: Command, state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.PlaceObject) return [];
    const item = getCatalogItem(cmd.object.catalogId);
    if (!item) return [];

    const pos = cmd.object.position;
    const footprint = getFootprint(pos.x, pos.y, item.width, item.height);
    const errors: ValidationError[] = [];
    for (const trait of item.traits) {
      errors.push(...validateTrait(trait, cmd, state, footprint));
    }
    return errors;
  },
};

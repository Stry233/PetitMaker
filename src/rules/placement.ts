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
import { getCell, getFootprint, onHalfGrid, straddledCells } from '../core/model/grid-model';
import { realSurface, surfaceElevation } from '../core/edge-cut/terrain-silhouette';
import { getCatalogItem } from '../state/catalog';
import { coveredCells, footprintCells, getPlacedObjectSize, hasHalfStep } from '../state/object-geometry';
import { entriesNear, getObjectIndex } from '../state/object-index';
import { detectBridgeSpan } from '../core/model/bridge-span';

const CARDINAL_OFFSETS: readonly MacroCoord[] = [
  { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 },
];

/** Where a heightDrop looks for its cliff: each cardinal direction in turn, nearest step first.
 *  A half anchor sits ON a cell boundary, so the half step is what reads the two cells it
 *  divides. From a whole anchor that same step straddles the anchor's own cell, so its min read
 *  can only match when the neighbour is the LOWER one, and then it reports the very numbers the
 *  whole step reports: the whole grid resolves identically either way. */
const RAMP_PROBES: readonly { dx: number; dy: number; dist: number }[] =
  CARDINAL_OFFSETS.flatMap((off) => [0.5, 1].map((dist) => ({ dx: off.x, dy: off.y, dist })));

/** Min-support surface elevation over every cell (x, y) straddles, or null when any of
 *  them is off the map: a probe that reaches the void has no cliff to report, and support
 *  counts only where EVERY straddled cell holds it. */
function straddleElevation(state: GridState, x: number, y: number): number | null {
  const xs = straddledCells(x), ys = straddledCells(y);
  let elev = Infinity;
  for (let cy = ys.lo; cy <= ys.hi; cy++) {
    for (let cx = xs.lo; cx <= xs.hi; cx++) {
      const cell = getCell(state.cells, cx, cy);
      if (!cell) return null;
      elev = Math.min(elev, surfaceElevation(cell.terrain));
    }
  }
  return elev;
}

/** The terrain cells a footprint's span [pos, pos + size) rests on, as an inclusive
 *  range. Terrain renders at −HALF_TILE, so a whole-coordinate span bleeds half a cell
 *  past each end (size + 1 cells) while a half-coordinate one lands exactly on `size`. */
function terrainSpan(pos: number, size: number): { lo: number; hi: number } {
  return { lo: Math.floor(pos + 0.5), hi: Math.ceil(pos + size - 0.5) };
}

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

      // Sweep the covered footprint plus one extra cell past the last on each axis (the
      // dual-grid margin) — covered cells, not pos + integer offset, so a half-integer
      // anchor never probes a fractional cell key.
      const xs = coveredCells(pos.x, w);
      const ys = coveredCells(pos.y, h);
      const sweepXs = [...xs, xs[xs.length - 1]! + 1];
      const sweepYs = [...ys, ys[ys.length - 1]! + 1];

      // Evidence = every cell in the extended sweep whose surface is water or off the
      // anchor's level (the offenders may sit OUTSIDE the footprint — the +1 sweep).
      const offenders: MacroCoord[] = [];
      for (const cy of sweepYs) {
        for (const cx of sweepXs) {
          const cell = getCell(state.cells, cx, cy);
          if (!cell) continue;
          // The plaza is a raised no-build platform, not a cliff the object can
          // float off — skip it so items can sit flush against the plaza. Actual
          // footprint overlap with the plaza object is rejected by V-PLACE-OVERLAP
          // (and terrain over it by V-PLACE-BLOCK). createGrid rewrites Plaza zones to
          // Grass, so a live map reaches this only through a hand-built state.
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
      const anchorElev = straddleElevation(state, pos.x, pos.y) ?? 0;
      const item = getCatalogItem(cmd.object.catalogId);
      const spanLen = item?.height ?? 4;
      const perpWidth = item?.width ?? 2;

      for (const probe of RAMP_PROBES) {
        const neighborElev = straddleElevation(state, pos.x + probe.dx * probe.dist, pos.y + probe.dy * probe.dist);
        if (neighborElev === null) continue;   // off-map: no cliff to read
        if (Math.abs(anchorElev - neighborElev) !== trait.layers) continue;

        const anchorIsHigh = anchorElev >= neighborElev;
        const hElev = Math.max(anchorElev, neighborElev);
        const lElev = Math.min(anchorElev, neighborElev);
        const highX = anchorIsHigh ? pos.x : pos.x + probe.dx * probe.dist;
        const highY = anchorIsHigh ? pos.y : pos.y + probe.dy * probe.dist;
        const slopeDx = anchorIsHigh ? probe.dx : -probe.dx;
        const slopeDy = anchorIsHigh ? probe.dy : -probe.dy;

        // rot=0/90: include high cell (mountain in -HALF_TILE gap direction)
        // rot=180/270: exclude high cell (mountain overlaps naturally)
        //
        // The ALONG coordinate (the ramp's run) always lands on a whole cell — proven for the
        // probe-derived case (a min-support read only ever raises at a step landing on a whole
        // neighbour), but an anchorIsHigh anchor's own position passes through untouched, and a
        // doubly-half hover (both axes snapped to the half grid) can hand this branch a fractional
        // along value directly. Rounded here: `terrainSpan` below reads the SAME cell via
        // floor(v+0.5), so this aligns the stored position with what the sweep actually validated.
        // The ACROSS slot (whichever of px/py this branch does NOT round) keeps its half freedom.
        let rot: 0 | 90 | 180 | 270;
        let px: number, py: number;
        let highAtStart: boolean;
        if (slopeDy > 0) { rot = 0; px = highX; py = Math.round(highY); highAtStart = true; }
        else if (slopeDx > 0) { rot = 90; px = Math.round(highX); py = highY; highAtStart = true; }
        else if (slopeDy < 0) { rot = 180; px = highX; py = Math.round(highY) - spanLen; highAtStart = false; }
        else { rot = 270; px = Math.round(highX) - spanLen; py = highY; highAtStart = false; }

        const isVert = rot === 0 || rot === 180;

        // Validate the terrain UNDER the ramp. Terrain renders at -HALF_TILE (up-left), so a
        // whole-anchored footprint is visually overlapped by one extra cell on each axis, while a
        // half-anchored one lands exactly on the cells it covers — `terrainSpan` answers both. Each
        // swept cell must match the ramp's elevation profile: the cell at the cliff end carries the
        // high plateau, every other one the run below it. That end faces the low run for a down-ramp
        // (highAtStart) and the plateau for an up-ramp (the cliff "overlaps naturally"), so both ramp
        // directions require a 1-high end and a spanLen-low run with flat support at each.
        const along = terrainSpan(isVert ? py : px, spanLen);
        const perp = terrainSpan(isVert ? px : py, perpWidth);
        const highCell = highAtStart ? along.lo : along.hi;
        let valid = true;
        for (let a = along.lo; a <= along.hi && valid; a++) {
          const exp = a === highCell ? hElev : lElev;
          for (let p = perp.lo; p <= perp.hi && valid; p++) {
            const tx = isVert ? p : a;
            const ty = isVert ? a : p;
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

    case 'halfStep':
      // Passive marker: grants the item a half-cell anchor on both axes
      // (state/object-geometry:hasHalfStep). It imposes no placement constraint of its
      // own — an item WITHOUT this trait is what the fractional-position guard below
      // rejects, since such an item's own traits list never reaches this arm.
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
    // The half-cell grid is a trait-granted exception (halfStep, ramps/bridges only) — a
    // fractional position on any other item is refused here, before any trait runs,
    // since an item without the trait never reaches a 'halfStep' case of its own to
    // catch this itself. The exception is HALF cells and nothing finer: an anchor off both
    // grids would otherwise reach detection, which reads it as the nearest half and would
    // place somewhere the caller never asked for.
    const onGrid = hasHalfStep(item)
      ? onHalfGrid(pos.x) && onHalfGrid(pos.y)
      : Number.isInteger(pos.x) && Number.isInteger(pos.y);
    if (!onGrid) {
      return [{ ruleId: 'V-PLACE-TRAIT', message: 'error.placement_off_grid', cells: [pos], severity: 'error' }];
    }
    const footprint = footprintCells(pos.x, pos.y, item.width, item.height);
    const errors: ValidationError[] = [];
    for (const trait of item.traits) {
      errors.push(...validateTrait(trait, cmd, state, footprint));
    }
    return errors;
  },
};

/** Object write tools: place, remove and rotate one object, lay a road, scatter many. */
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import { CommandType, ROTATIONS, type Command, type MacroCoord, type PlacedObject, type Rotation } from '../../core/model/types';
import { rectsOverlap } from '../../core/grid/rect';
import { isBuildableZone } from '../../core/game/zones';
import { makeRng } from '../../core/base/rng';
import { cellSet } from '../../core/grid/grids';
import { getRotatedSize } from '../../core/grid/footprint';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { generateObjectId } from '../../core/model/object-id';
import { findTrait, isSurfacePrint, isCoatingItem, standsOnCoating } from '../../core/model/traits';
import { getCatalogByRole, getCatalogItem, getRoadMaterials, getOfferedItem, itemRole } from '../../state/catalog';
import { roadLookup } from '../../state/object-index';
import { objectRect, placedFootprint, surfaceElevationAt } from '../../state/object-geometry';
import { edgeCutGeneratedRoads } from '../../tools/trim';
import { coatingStripFor, planObjectRotation } from '../../tools/placement';
import { defaultRoadId } from './defaults';
import type { AgentToolDeps } from './deps';
import { clipBuildable, offZoneError, offZoneNote, resolveCells } from './cells';
import { argError, dedupe, formatErrors, geometryError } from './feedback';
import { cellItem, coordProps, corners, rectInput } from './geometry';
import { isBroadBand } from './quality';
import { int, list, obj, oneOf, req, str } from './schema';
import { scanBridgeSites } from './search';
import { objectLine, zoneGlyph } from './serialize';
import { defineTool } from './spec';
import { runStroke, runStrokeBody } from './stroke';
import { BUILDABLE_ZONES } from './game-terms';

const firstTreeId = (): string => getCatalogByRole('canopy')[0]?.id ?? 'tree';

/** A placement command for one catalog item standing on the surface at (x,y), or the refusal. */
export function buildPlaceCmd(
  deps: AgentToolDeps,
  catalogId: string,
  at: MacroCoord,
  rotation: Rotation,
  id?: string,
): Extract<Command, { type: CommandType.PlaceObject }> | string {
  const { x, y } = at;
  const item = getOfferedItem(catalogId);
  if (!item) return `Arguments: unknown catalogId "${catalogId}", use ids from the CATALOG section or get_catalog_item.`;
  const placed: PlacedObject = {
    id: id ?? generateObjectId(),
    catalogId,
    position: { x, y },
    rotation,
    elevation: surfaceElevationAt(deps.getState(), x, y),
  };
  return placeObjectCommand(placed);
}

export const placeObjectTool = defineTool({
  description: 'Place a catalog item with its top-left anchor at (x,y). Ramps snap automatically — aim at a cliff-edge cell. BRIDGES: aim at a GAP cell (water/void, mid-channel) — use the anchors from find_bridge_sites. Returns the final (possibly snapped) placement.',
  input: obj({ catalogId: req(str()), x: req(int()), y: req(int()), rotation: oneOf([...ROTATIONS]) }),
  access: 'write',
  example: () => `catalogId: "${firstTreeId()}", x: 10, y: 10, rotation: 90`,
  run(deps, input) {
    const { catalogId, x, y } = input;
    const rotation = input.rotation ?? 0;
    const cmd = buildPlaceCmd(deps, catalogId, { x: x, y: y }, rotation);
    if (typeof cmd === 'string') return { isError: true, content: cmd };
    // The coatings it replaces are removed in the same transaction as the placement, by the placer's
    // own plan, and only once the placement itself is legal.
    const item = getCatalogItem(catalogId);
    const stripCmds: Command[] = [];
    let cleared = '';
    const state = deps.getState();
    if (deps.getExecutor().getRegistry().validatePreCommand(cmd, state).length === 0) {
      const roads = coatingStripFor(state, cmd.object, item);
      for (const o of roads) stripCmds.push(removeObjectCommand(o));
      if (roads.length) cleared = ` Cleared ${roads.length} road tile(s) it covered that cannot support this object.`;
    }
    // A bridge or ramp resolves its own footprint, so what landed is read off the map.
    const landed = (): PlacedObject => deps.getState().objects.get(cmd.object.id) ?? cmd.object;
    const result = runStroke(deps, [...stripCmds, cmd], () => `Placed ${objectLine(landed())} (position/rotation may have snapped).${cleared}`);
    if (!result.isError) {
      deps.onFlash?.([cellSet(PLACEMENT_GRID, placedFootprint(landed()))]);
      return result;
    }
    // Failure diagnostics: tell the model what is in the way so it never has to
    // burn turns figuring it out (locked plaza, another object, wrong zone…).
    if (item) {
      const state = deps.getState();
      const blockers: string[] = [];
      const footprint = { x, y, ...getRotatedSize(item, rotation) };
      for (const o of state.objects.values()) {
        if (rectsOverlap(footprint, objectRect(o))) {
          blockers.push(`${objectLine(o)}${o.locked ? ' — IMMOVABLE, build elsewhere' : ' — remove_object or clear_area first'}`);
        }
      }
      if (blockers.length > 0) result.content += `\nIn the way:\n${blockers.join('\n')}`;
      const zone = state.cells[y]?.[x]?.zone;
      if (zone !== undefined && !isBuildableZone(zone)) {
        result.content += `\nTarget anchor (${x},${y}) is not on buildable ${BUILDABLE_ZONES} (zone token "${zoneGlyph(zone)}").`;
      }
    }
    // failed bridge placements additionally get concrete alternatives
    const span = findTrait(item, 'waterSpan');
    if (item && span) {
      const sites = scanBridgeSites(deps.getState(), item.width, span, { x, y }, 4);
      result.content += sites.length
        ? `\nNearest LEGAL anchors for ${item.id}: ${sites.map((s) => `(${s.x},${s.y})`).join(' ')} — retry with one of these exact coordinates.`
        : `\nNo legal bridge site anywhere on the map — reshape a water channel to a straight, uniform ${span.min}-${span.max} cell width with flat equal banks first.`;
    }
    return result;
  },
});

export const removeObjectTool = defineTool({
  description: 'Remove a placed object by its id (from get_objects).',
  input: obj({ objectId: req(str()) }),
  access: 'write',
  run(deps, { objectId: id }) {
    const found = deps.getState().objects.get(id);
    if (!found) return { isError: true, content: `No object with id "${id}". Use get_objects.` };
    return runStroke(deps, [removeObjectCommand(found)], () => `Removed ${found.catalogId} (${id}).`);
  },
});

export const rotateObjectTool = defineTool({
  description: 'Rotate an existing rotatable object to an absolute rotation (re-validates placement).',
  input: obj({ objectId: req(str()), rotation: req(oneOf([...ROTATIONS])) }),
  access: 'write',
  example: 'objectId: "<id from get_objects>", rotation: 90',
  async run(deps, { objectId: id, rotation }) {
    const state = deps.getState();
    const found = state.objects.get(id);
    if (!found) return { isError: true, content: `No object with id "${id}".` };
    const item = getCatalogItem(found.catalogId);
    if (!item?.rotatable) return { isError: true, content: `${found.catalogId} is not rotatable.` };
    const exec = deps.getExecutor();
    const { cmd, errors } = planObjectRotation(exec, state, found, rotation);
    if (errors.length > 0) return { isError: true, content: `Rotation failed (object unchanged):\n${formatErrors(errors)}` };
    let failure: string | null = null;
    const stroke = await runStrokeBody(deps, 'the rotation', () => {
      exec.execute(removeObjectCommand(found));
      const placed = exec.execute(cmd);
      if (!placed.success) {
        failure = formatErrors(placed.errors);
        exec.execute(placeObjectCommand(found));
      }
    });
    if ('refusal' in stroke) return stroke.refusal;
    if (failure) return { isError: true, content: `Rotation failed (object unchanged):\n${failure}` };
    return { isError: false, content: `Rotated ${found.catalogId} to ${rotation} degrees.` };
  },
});

export const buildRoadTool = defineTool({
  description: 'Lay a road in one call: places one road tile per cell along a line given as flat x1,y1,x2,y2 (or explicit cells), skipping illegal cells. End-caps and bends are auto-trimmed like the manual road brush (smooth:"off" keeps them square). One undo step. Use instead of placing road cells one by one.',
  input: obj({
    catalogId: oneOf(() => getRoadMaterials().map((i) => i.id), { description: 'Road material (default: the first listed).' }),
    shape: oneOf(['line', 'cells'], { description: 'Path form: "line" strokes x1,y1..x2,y2 at width (bare corners mean the same); "cells" reads the cells array.' }),
    ...coordProps,
    width: int({ min: 1, description: 'Line stroke width (default 1).' }),
    line: obj({ ...corners, width: int({ min: 1 }) }, { description: 'Nested alternative to shape "line".' }),
    cells: list(cellItem),
    smooth: oneOf(['round', 'rect', 'off'], { description: "End-cap/bend trim style (default 'round', the manual brush's Auto Trim)." }),
  }),
  access: 'write',
  example: () => `catalogId: "${defaultRoadId()}", x1: 10, y1: 10, x2: 20, y2: 10`,
  async run(deps, input) {
    const catalogId = input.catalogId ?? defaultRoadId();
    const item = getCatalogItem(catalogId);
    if (!isCoatingItem(item) || isSurfacePrint(item)) {
      return argError(`"${catalogId}" is not a road item, pass a road id from the catalog.`, `catalogId: "${defaultRoadId()}"`);
    }
    const resolvedRoad = resolveCells(input, deps.getState(), 'line');
    if (resolvedRoad.length === 0) return geometryError(input, 'path');
    if (resolvedRoad.length > 400) return argError('road too long for one call (max 400 cells), split it into segments.');
    const { cells, offZone } = clipBuildable(resolvedRoad, deps.getState());
    if (cells.length === 0) return offZoneError();
    const exec = deps.getExecutor();
    const failures: string[] = [];
    let ok = 0;
    const smooth = input.smooth ?? 'round';
    const stroke = await runStrokeBody(deps, 'the road', () => {
      for (const cell of cells) {
        const cmd = buildPlaceCmd(deps, catalogId, { x: cell.x, y: cell.y }, 0);
        if (typeof cmd === 'string') continue;
        const r = exec.execute(cmd);
        if (r.success) ok++;
        else failures.push(formatErrors(r.errors));
      }
      // end-cap/bend trim via the non-interactive road cut; the interactive
      // applyAutoEdgeCut wants a ToolContext a silent stroke has not got
      if (ok > 0 && smooth !== 'off') {
        edgeCutGeneratedRoads({ state: deps.getState(), execute: (c: Command) => exec.execute(c) }, cells, smooth);
      }
    });
    if ('refusal' in stroke) return stroke.refusal;
    const { detail } = stroke;
    if (ok > 0) deps.onFlash?.([cellSet(PLACEMENT_GRID, cells)]);
    let msg = `Laid ${ok}/${cells.length} road cell(s).${offZoneNote(offZone)}`;
    // Said at the moment the crossing is made: the close-out hint arrives when re-routing a whole
    // grid costs more turns than remain, so the lay itself names the four-way it just created.
    if (ok > 0) {
      const roadAtNow = roadLookup(deps.getState());
      const paved = (x: number, y: number) => roadAtNow(x, y) !== null;
      const made = cells.filter((c) => paved(c.x, c.y)
        && paved(c.x + 1, c.y) && paved(c.x - 1, c.y) && paved(c.x, c.y + 1) && paved(c.x, c.y - 1)
        && [paved(c.x + 1, c.y + 1), paved(c.x + 1, c.y - 1), paved(c.x - 1, c.y + 1), paved(c.x - 1, c.y - 1)].filter(Boolean).length <= 1);
      if (made.length > 0) {
        msg += `\nNote: this run crossed another street at ${made.slice(0, 3).map((c) => `(${c.x},${c.y})`).join(' ')}, making a FOUR-WAY junction. Keep it if intended; a T-junction or offset crossing is an optional alternative for an informal route.`;
      }
    }
    if (failures.length > 0) msg += ` Skipped cells:\n${dedupe(failures).slice(0, 2).join('\n')}`;
    if (ok === 0) {
      msg += '\nNo road cells landed. Check the named blockers and the flat placement margin at the route endpoints. Roads can follow level dry ground at supported elevations; use a validated bridge or ramp for a gap. Preserve existing work and repair only the failed segment.';
    }
    return { isError: ok === 0, content: msg, detail };
  },
});

export const scatterObjectsTool = defineTool({
  description: 'Place many items at once. Choose pattern explicitly: "scatter" distributes across the entire area for groves and meadows; "fill" visits cells in row order until count is reached; "grid" uses every step-th cell. For separate flower beds, make one call per small bed rectangle with its intended species and enough count to fill that rectangle. A low count over a large rect makes a partial row, not a compact bed. Illegal spots are skipped. One undo step. Returns counts and placed anchors.',
  input: obj({
    catalogIds: req(list(str(), { description: 'Pool to sample from (ONE id for ordered patterns; mix species only for natural scatter).' })),
    count: req(int({ min: 1, max: 200 })),
    ...coordProps,
    rect: obj(corners, { description: 'Scatter area; the flat corners x1,y1,x2,y2 mean the same.' }),
    pattern: oneOf(['scatter', 'fill', 'grid'], { description: 'scatter = natural arrangement (default); fill = solid row-major fill; grid = a lattice of every step-th cell.' }),
    step: int({ min: 2, max: 6, description: 'Grid pitch for pattern "grid" (default 2: an open lattice).' }),
    spacing: int({ min: 0, description: 'Extra min distance between placed items (default 0; trees already keep their own exclusion radius). Ignored by fill/grid.' }),
  }),
  access: 'write',
  example: () => `catalogIds: ["${firstTreeId()}"], count: 20, x1: 10, y1: 10, x2: 20, y2: 18`,
  async run(deps, input) {
    const { catalogIds: ids, count } = input;
    if (ids.length === 0) {
      return argError('catalogIds must be a non-empty array of item ids from the CATALOG section.', `catalogIds: ["${firstTreeId()}"], count: 20`);
    }
    for (const id of ids) {
      if (!getOfferedItem(id)) return argError(`unknown catalogId "${id}", use ids from the CATALOG section or get_catalog_item.`);
    }
    const state = deps.getState();
    const rect = rectInput(input);
    const resolvedPool = rect ? resolveCells({ rect }, state) : [...deps.getRegion()];
    const { cells: pool, offZone } = clipBuildable(resolvedPool, state);
    if (pool.length === 0) {
      return argError('no area to scatter over, pass the rect corners or have the user select a region first.', 'x1: 10, y1: 10, x2: 20, y2: 18');
    }
    const pattern = input.pattern ?? 'scatter';
    const spacing = pattern === 'scatter' ? input.spacing ?? 0 : 0;
    if (pattern === 'grid') {
      // A lattice anchored at the pool's own top-left, so two adjacent grid calls with the same
      // step line up.
      const step = input.step ?? 2;
      let minX = Infinity, minY = Infinity;
      for (const c of pool) { if (c.x < minX) minX = c.x; if (c.y < minY) minY = c.y; }
      const kept = pool.filter((c) => (c.x - minX) % step === 0 && (c.y - minY) % step === 0);
      pool.length = 0;
      pool.push(...kept);
    }
    // Seeded from the pool's own ground: the same call over the same area replays exactly (a macro,
    // not a dice roll), and a different area draws a different arrangement.
    const rng = makeRng(pool.reduce((h, c) => (h * 31 + c.x * 7 + c.y * 13) | 0, pool.length + count));
    if (pattern === 'scatter') {
      // shuffle (Fisher-Yates) on the seeded stream
      for (let i = pool.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [pool[i], pool[j]] = [pool[j]!, pool[i]!];
      }
    }
    // fill and grid keep resolveCells' row-major order: an ordered pattern lands as drawn.
    const exec = deps.getExecutor();
    const placedAt: MacroCoord[] = [];
    const placed: PlacedObject[] = [];
    const failures: string[] = [];
    // Coated cells are skipped up front rather than placed onto: V-PLACE-COATED is a post-stroke
    // rule, so one edging cell clipping a road would otherwise revert the whole scatter.
    const roadAt = roadLookup(deps.getState());
    let onRoad = 0;
    const stroke = await runStrokeBody(deps, 'the placements', () => {
      for (const cell of pool) {
        if (placedAt.length >= count) break;
        if (spacing > 0 && placedAt.some((p) => Math.abs(p.x - cell.x) <= spacing && Math.abs(p.y - cell.y) <= spacing)) continue;
        const id = rng.pick(ids);
        const road = roadAt(cell.x, cell.y);
        if (road && !standsOnCoating(getCatalogItem(id), getCatalogItem(road.catalogId)!)) { onRoad++; continue; }
        const cmd = buildPlaceCmd(deps, id, { x: cell.x, y: cell.y }, 0);
        if (typeof cmd === 'string') continue;
        const r = exec.execute(cmd);
        if (r.success) { placedAt.push(cell); placed.push(deps.getState().objects.get(cmd.object.id) ?? cmd.object); }
        else failures.push(formatErrors(r.errors));
      }
    });
    if ('refusal' in stroke) return stroke.refusal;
    const { detail } = stroke;
    if (placed.length > 0) deps.onFlash?.([cellSet(PLACEMENT_GRID, placed.flatMap(placedFootprint))]);
    let why = placedAt.length < count && failures.length > 0 ? ` Most common rejections:\n${dedupe(failures).slice(0, 3).join('\n')}` : '';
    if (onRoad > 0) why += `\n${onRoad} cell(s) skipped: they carry a road, and objects cannot stand on one. Edging runs BESIDE a street, so offset the rect off the pavement.`;
    why += offZoneNote(offZone);
    if (placedAt.length === 0) {
      why += '\nNothing placed. Check the named blockers, item footprint and flat placement margin. find_flat_areas can locate dry level ground at the intended elevation. Preserve existing objects; choose a valid site rather than clearing the area blindly.';
    }
    // A broad planting rectangle may be intentional; this note does not require a correction.
    if (pattern === 'fill' && rect && placedAt.length > 0 && ids.every((id) => itemRole(getCatalogItem(id)) === 'groundcover')) {
      const w = Math.abs(rect.x2 - rect.x1) + 1, h = Math.abs(rect.y2 - rect.y1) + 1;
      if (isBroadBand(w, h)) {
        why += `\nNote: the ${w}x${h} planting rectangle forms a broad band. Keep it if that matches the request; narrow edging and broad beds serve different purposes.`;
      }
    }
    return {
      isError: placedAt.length === 0,
      content: `Scattered ${placedAt.length}/${count} object(s) over ${pool.length} candidate cell(s) using ${pattern}.${placedAt.length ? ` Placed anchors: ${placedAt.slice(0, 24).map((p) => `(${p.x},${p.y})`).join(' ')}${placedAt.length > 24 ? ' (first 24)' : ''}.` : ''}${why}`,
      detail,
    };
  },
});

/** Terrain write tools: paint and erase cells, clear an area, trim a corner. */
import { eraseTerrainCommand, mountainLadder, paintTerrainCommand, removeObjectCommand, trimRoadCommand, trimTerrainCommand } from '../../core/model/command-build';
import { TerrainType, type Command, type CornerTrim } from '../../core/model/types';
import { CLEARING_ELEVATION, getCell } from '../../core/model/grid-model';
import { cellKey, regionBounds } from '../../core/grid/rect';
import { footprintCells, terrainCellsUnder } from '../../core/grid/footprint';
import { isCoating } from '../../core/model/traits';
import { getCatalogItem } from '../../state/catalog';
import { cellSet } from '../../core/grid/grids';
import { ELEVATION_MAX, TERRAIN_GRID } from '../../core/game/profile';
import { CORNER_POS, CORNER_COMPASS, SQUARE_CORNERS, copyCorners } from '../../core/model/corners';
import { computeLockedCorners } from '../../core/domain/edge-cut/trim-lock';
import { validateCut } from '../../core/domain/edge-cut/cut-validator';
import { roadLookup } from '../../state/object-index';
import { objectRect } from '../../state/object-geometry';
import { edgeCutGeneratedTerrain } from '../../tools/trim';
import { clearBorderNote, clipBuildable, clipPaintable, clipOccupied, occupiedNote, offZoneError, offZoneNote, resolveCells, restingWholly, terrainUnder } from './cells';
import { argError, geometryError } from './feedback';
import { cellsOrRect, smoothEdges, PAINT_TERRAINS, TRIM_STYLES } from './geometry';
import { bool, int, obj, oneOf, req } from './schema';
import { defineTool } from './spec';
import { runStroke } from './stroke';
import { zoneArea, zoneArg } from './zone-area';
import { BUILDABLE_ZONES, lockedNote } from './game-terms';

const RECT_CALL = 'shape: "rect", x1: 10, y1: 10, x2: 20, y2: 18';

export const paintTerrainTool = defineTool({
  description: `Paint mountain or water under the cells of a shape given as flat coordinates: shape "rect" with x1,y1,x2,y2, "circle", or "picture" (rows of text) for any outline, such as a terrace with bays and spurs or a crescent round a pool. The terrain lies under exactly those cells and reaches half a cell past them on every side, so it is centred where the same rectangle of objects would be; the cells touching it rest partly on it, and the result names the nearest clear ones. For a pond on flat ${BUILDABLE_ZONES}, paint water at elevation 0 only: surrounding ${BUILDABLE_ZONES} contains it; no mountain rim is needed. Mountain auto-builds support tiers 1..elevation (give only the FINAL elevation; mountain elevation ${CLEARING_ELEVATION} clears terrain). Elevated water needs supporting terrain and enclosing banks before this call finishes. Read partial results before continuing.`,
  input: obj({
    ...cellsOrRect,
    ...zoneArg,
    terrain: req(oneOf([...PAINT_TERRAINS])),
    elevation: req(int({ min: 0, max: ELEVATION_MAX, description: 'The final elevation; the game numbers this layer elevation + 1.' })),
    smooth: smoothEdges('Auto-trim the painted edges (rounded chamfer / 45-degree bevel) — use for natural-looking cliffs and banks.'),
  }),
  access: 'write',
  example: `${RECT_CALL}, terrain: "mountain", elevation: 1`,
  run(deps, input) {
    const state = deps.getState();
    const drawn = resolveCells(input, state);
    const zoned = input.zone !== undefined ? zoneArea(state, input.zone, drawn.length ? drawn : undefined) : null;
    if (typeof zoned === 'string') return argError(zoned);
    const asked = zoned ?? drawn;
    if (asked.length === 0) return geometryError(input, 'area');
    if (asked.length > 4000) return argError('too many cells in one call (max 4000), split the edit into smaller areas.');
    const { elevation } = input;
    const zoneClip = clipPaintable(terrainUnder(asked, state), state);
    if (zoneClip.cells.length === 0) return offZoneError();
    const { cells } = clipOccupied(zoneClip.cells, state);
    // Counted in the cells the model named: one whose ground was only partly reachable is not done.
    const inZone = restingWholly(asked, zoneClip.cells, state);
    const done = restingWholly(asked, cells, state);
    const offZone = asked.length - inZone, occupied = inZone - done;
    if (cells.length === 0) return argError(`every remaining cell lies under standing objects. Nothing was changed. Inspect the objects; remove them only if the request permits it. ${lockedNote()}`);
    const type = input.terrain === 'water' ? TerrainType.Water : TerrainType.Mountain;
    const commands: Command[] = type === TerrainType.Mountain && elevation > 1
      ? mountainLadder(cells, (c) => c, () => 0, () => elevation)
      : [paintTerrainCommand(cells, type, elevation)];
    const label = type === TerrainType.Water ? 'water' : 'mountain';
    const { smooth } = input;
    return runStroke(
      deps,
      commands,
      () => `${offZone + occupied > 0 ? 'PARTIAL RESULT: ' : ''}Painted ${label} elev ${elevation} under ${done}/${asked.length} requested cell(s)${smooth ? ', edges smoothed' : ''}.${offZone + occupied > 0 ? '' : clearBorderNote(asked, state)}${offZoneNote(offZone)}${occupiedNote(occupied)}`,
      {
        snapshot: cellSet(TERRAIN_GRID, cells),
        // Non-interactive edge-cut (rounds convex tips/steps, fills empty notches).
        // Uses the generated-* path, not applyAutoEdgeCut: the latter needs a full
        // interactive ToolContext + the renderer's reconcile handling, and driving it
        // from a silent agent stroke leaves detached scene nodes (Pixi _parentID null).
        afterApply: smooth
          ? (exec) => edgeCutGeneratedTerrain({ state: deps.getState(), execute: (c: Command) => exec.execute(c) }, cells, smooth)
          : undefined,
      },
    );
  },
});

export const eraseTerrainTool = defineTool({
  description: 'Clear the terrain (mountain/water) under cells back to flat ground; like paint_terrain it reaches half a cell past them on every side.',
  input: obj({ ...cellsOrRect }),
  access: 'write',
  example: RECT_CALL,
  run(deps, input) {
    const state = deps.getState();
    const asked = resolveCells(input, state);
    if (asked.length === 0) return geometryError(input, 'area');
    const zoneClip = clipBuildable(terrainUnder(asked, state), state);
    if (zoneClip.cells.length === 0) return offZoneError();
    const { cells } = clipOccupied(zoneClip.cells, state);
    if (cells.length === 0) return argError('every remaining cell lies under standing objects; clear_area removes object and terrain together, or aim elsewhere.');
    const inZone = restingWholly(asked, zoneClip.cells, state);
    const done = restingWholly(asked, cells, state);
    return runStroke(
      deps,
      [eraseTerrainCommand(cells)],
      () => `Erased terrain under ${done} cell(s).${offZoneNote(asked.length - inZone)}${occupiedNote(inZone - done)}`,
      { snapshot: cellSet(TERRAIN_GRID, cells) },
    );
  },
});

/** A clear above either count asks for explicit demolition intent. */
const DEMOLISH_OBJECTS = 25;
const DEMOLISH_CELLS = 400;

export const clearAreaTool = defineTool({
  description: `Make room: in ONE step, remove every (non-locked) object touching the given cells AND erase the terrain under them back to flat ${BUILDABLE_ZONES}. Use before reshaping an area instead of removing objects one by one. NEVER answer a refused placement by clearing a district you built — fix the exact cells instead. A clear removing more than ${DEMOLISH_OBJECTS} objects or covering more than ${DEMOLISH_CELLS} cells refuses unless demolish:true acknowledges the scale.`,
  input: obj({ ...cellsOrRect, demolish: bool({ description: `Acknowledge a large demolition (over ${DEMOLISH_OBJECTS} objects or ${DEMOLISH_CELLS} cells).` }) }),
  access: 'wide',
  example: RECT_CALL,
  run(deps, input) {
    const state = deps.getState();
    const resolved = resolveCells(input, state);
    if (resolved.length === 0) return geometryError(input, 'area');
    // A locked object survives the clear: the cells it stands on are skipped rather than letting
    // one plaza-shadow cell refuse the stroke.
    const lockedCells = new Set<string>();
    for (const o of state.objects.values()) {
      if (!o.locked) continue;
      const r = objectRect(o);
      for (const c of footprintCells(r.x, r.y, r.w, r.h)) lockedCells.add(cellKey(c.x, c.y));
    }
    const asked = resolved.filter((c) => !lockedCells.has(cellKey(c.x, c.y)));
    const underLocked = resolved.length - asked.length;
    if (asked.length === 0) return argError('every remaining cell lies under a locked structure, which a clear cannot touch.');
    const zoneClip = clipBuildable(terrainUnder(asked, state), state);
    if (zoneClip.cells.length === 0) return offZoneError();
    const offZone = asked.length - restingWholly(asked, zoneClip.cells, state);
    const clearing = new Set(asked.map((c) => cellKey(c.x, c.y)));
    const commands: Command[] = [];
    // The ground an object left standing rests on stays as it is (V-PLACE-BLOCK).
    const kept = new Set<string>();
    for (const o of state.objects.values()) {
      const r = objectRect(o);
      if (!o.locked && footprintCells(r.x, r.y, r.w, r.h).some((c) => clearing.has(cellKey(c.x, c.y)))) {
        commands.push(removeObjectCommand(o));
        continue;
      }
      const item = getCatalogItem(o.catalogId);
      if (item && isCoating(item)) continue;
      for (const t of terrainCellsUnder(r)) kept.add(cellKey(t.x, t.y));
    }
    const cells = zoneClip.cells.filter((t) => !kept.has(cellKey(t.x, t.y)));
    const removed = commands.length;
    if ((removed > DEMOLISH_OBJECTS || asked.length > DEMOLISH_CELLS) && input.demolish !== true) {
      return {
        isError: true,
        content: `STOP: this would remove ${removed} object(s) over ${asked.length} cell(s) — likely work already built. `
          + 'A refusal is fixed at its own cells, never by clearing the district. If the order genuinely asks for '
          + 'demolition at this scale, call again with demolish: true; otherwise clear only the exact cells you need.',
      };
    }
    if (cells.length > 0) commands.push(eraseTerrainCommand(cells));
    const skipped = underLocked > 0 ? ` ${underLocked} cell(s) under a locked structure were skipped.` : '';
    return runStroke(
      deps,
      commands,
      () => `Cleared ${asked.length} cell(s): removed ${removed} object(s), terrain reset to flat ${BUILDABLE_ZONES}.${offZoneNote(offZone)}${skipped}`,
      { snapshot: cellSet(TERRAIN_GRID, cells) },
    );
  },
});

export const trimCornerTool = defineTool({
  description: "Cosmetic corner trim on the terrain under cell x,y: corner names which corner of that cell's ground is cut, so the TL corner of a pond painted under x1,y1..x2,y2 is x1,y1 with corner TL and its BR corner is x2,y2 with corner BR. Style 'fan' (rounded), 'tri' (45-degree bevel), 'square' (reset), 'empty' (cut away).",
  input: obj({
    x: req(int()),
    y: req(int()),
    corner: req(oneOf([...CORNER_POS])),
    layer: oneOf(['terrain', 'road'], { description: "What to trim at that cell (default 'terrain')." }),
    style: req(oneOf([...TRIM_STYLES])),
  }),
  access: 'write',
  example: 'x: 10, y: 10, corner: "TL", style: "fan"',
  run(deps, input) {
    const { corner, style } = input;
    const layer = input.layer ?? 'terrain';
    const state = deps.getState();
    // A road lies on the cell itself; terrain is the piece under that corner of the cell.
    const under = regionBounds(terrainCellsUnder({ x: input.x, y: input.y, w: 1, h: 1 }))!;
    const { x, y } = layer === 'road' ? input : {
      x: corner === 'TL' || corner === 'BL' ? under.x1 : under.x2,
      y: corner === 'TL' || corner === 'TR' ? under.y1 : under.y2,
    };
    const named = `(${input.x},${input.y})`;
    const cell = getCell(state.cells, x, y);
    const roadObj = layer === 'road' ? roadLookup(state)(x, y) ?? undefined : undefined;
    if (layer === 'terrain' && !cell?.terrain) return { isError: true, content: `No terrain under the ${corner} corner of ${named} to trim.` };
    if (layer === 'road' && !roadObj) return { isError: true, content: `No road at ${named} to trim.` };
    const idx = CORNER_POS.indexOf(corner);
    // The persisted CornerTrim value keeps the frozen compass suffix (TL→'tri-NW', same index).
    const value: CornerTrim = style === 'tri' ? (`tri-${CORNER_COMPASS[idx]}` as CornerTrim) : style;
    const before = layer === 'terrain' ? cell?.terrain?.corners : roadObj?.corners;
    const after = copyCorners(before ?? SQUARE_CORNERS);
    after[idx] = value;
    // same gates as the manual edge-cut tool: structural locks (incl. the
    // waterfall-frame policy) and edge-contact validity
    if (value !== 'square') {
      const roads = roadLookup(state);
      const locked = computeLockedCorners(state, roads, x, y, layer);
      if (locked[idx]) {
        return { isError: true, content: `Corner ${corner} of ${named} is structurally locked (interior corner, water boundary, or waterfall frame) — it must stay square.` };
      }
      if (!validateCut(state, roads, { x, y }, layer, after)) {
        return { isError: true, content: `Trimming ${corner} of ${named} to ${style} would break edge contact with a neighboring block.` };
      }
    }
    return runStroke(
      deps,
      [roadObj ? trimRoadCommand(roadObj, x, y, after) : trimTerrainCommand(x, y, after)],
      () => `Trimmed ${corner} corner of ${named} to ${style}.`,
      // A silhouette-only cut cannot invalidate another cut, so the repair pass is skipped.
      { reconcile: false },
    );
  },
});

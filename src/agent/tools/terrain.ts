/** Terrain write tools: paint and erase cells, clear an area, trim a corner. */
import { eraseTerrainCommand, paintTerrainCommand, removeObjectCommand, trimRoadCommand, trimTerrainCommand } from '../../core/model/command-build';
import { TerrainType, type Command, type CornerTrim } from '../../core/model/types';
import { CLEARING_ELEVATION, getCell } from '../../core/model/grid-model';
import { cellOverlapsRect, cellKey } from '../../core/grid/rect';
import { cellSet } from '../../core/grid/grids';
import { ELEVATION_MAX, PLACEMENT_GRID, TERRAIN_GRID } from '../../core/game/profile';
import { CORNER_POS, CORNER_COMPASS, SQUARE_CORNERS, copyCorners } from '../../core/model/corners';
import { computeLockedCorners } from '../../core/domain/edge-cut/trim-lock';
import { validateCut } from '../../core/domain/edge-cut/cut-validator';
import { roadLookup } from '../../state/object-index';
import { objectRect } from '../../state/object-geometry';
import { edgeCutGeneratedTerrain } from '../../tools/trim';
import { clipBuildable, clipOccupied, occupiedNote, offZoneError, offZoneNote, resolveCells } from './cells';
import { argError, geometryError } from './feedback';
import { cellsOrRect, smoothEdges, PAINT_TERRAINS, TRIM_STYLES } from './geometry';
import { bool, int, obj, oneOf, req } from './schema';
import { defineTool } from './spec';
import { runStroke } from './stroke';
import { BUILDABLE_ZONES, lockedNote } from './game-terms';

const RECT_CALL = 'shape: "rect", x1: 10, y1: 10, x2: 20, y2: 18';

export const paintTerrainTool = defineTool({
  description: `Paint mountain or water using shape + flat coordinates (e.g. shape "rect" with x1,y1,x2,y2). For a pond on flat ${BUILDABLE_ZONES}, paint water at elevation 0 only: surrounding ${BUILDABLE_ZONES} contains it; no mountain rim is needed. Mountain auto-builds support tiers 1..elevation (give only the FINAL elevation; mountain elevation ${CLEARING_ELEVATION} clears terrain). Elevated water needs supporting terrain and enclosing banks before this call finishes. Read partial results before continuing.`,
  input: obj({
    ...cellsOrRect,
    terrain: req(oneOf([...PAINT_TERRAINS])),
    elevation: req(int({ min: 0, max: ELEVATION_MAX, description: 'The final elevation; the game numbers this layer elevation + 1.' })),
    smooth: smoothEdges('Auto-trim the painted edges (rounded chamfer / 45-degree bevel) — use for natural-looking cliffs and banks.'),
  }),
  access: 'write',
  example: `${RECT_CALL}, terrain: "mountain", elevation: 1`,
  run(deps, input) {
    const resolved = resolveCells(input, deps.getState());
    if (resolved.length === 0) return geometryError(input, 'area');
    if (resolved.length > 4000) return argError('too many cells in one call (max 4000), split the edit into smaller areas.');
    const { elevation } = input;
    const zoneClip = clipBuildable(resolved, deps.getState());
    if (zoneClip.cells.length === 0) return offZoneError();
    const { cells, occupied } = clipOccupied(zoneClip.cells, deps.getState());
    const offZone = zoneClip.offZone;
    if (cells.length === 0) return argError(`every remaining cell lies under standing objects. Nothing was changed. Inspect the objects; remove them only if the request permits it. ${lockedNote()}`);
    const type = input.terrain === 'water' ? TerrainType.Water : TerrainType.Mountain;
    const commands: Command[] = [];
    if (type === TerrainType.Mountain && elevation > 1) {
      // cumulative bottom-up tiers, same as generation's planToCommands (satisfies V-MTN-02 by construction)
      for (let L = 1; L <= elevation; L++) {
        commands.push(paintTerrainCommand(cells, type, L));
      }
    } else {
      commands.push(paintTerrainCommand(cells, type, elevation));
    }
    const label = type === TerrainType.Water ? 'water' : 'mountain';
    const { smooth } = input;
    return runStroke(
      deps,
      commands,
      () => `${offZone + occupied > 0 ? 'PARTIAL RESULT: ' : ''}Painted ${label} elev ${elevation} on ${cells.length}/${resolved.length} requested cell(s)${smooth ? ', edges smoothed' : ''}.${offZoneNote(offZone)}${occupiedNote(occupied)}`,
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
  description: 'Clear terrain (mountain/water) back to flat ground on cells.',
  input: obj({ ...cellsOrRect }),
  access: 'write',
  example: RECT_CALL,
  run(deps, input) {
    const resolved = resolveCells(input, deps.getState());
    if (resolved.length === 0) return geometryError(input, 'area');
    const zoneClip = clipBuildable(resolved, deps.getState());
    if (zoneClip.cells.length === 0) return offZoneError();
    const { cells, occupied } = clipOccupied(zoneClip.cells, deps.getState());
    if (cells.length === 0) return argError('every remaining cell lies under standing objects; clear_area removes object and terrain together, or aim elsewhere.');
    return runStroke(
      deps,
      [eraseTerrainCommand(cells)],
      () => `Erased terrain on ${cells.length} cell(s).${offZoneNote(zoneClip.offZone)}${occupiedNote(occupied)}`,
      { snapshot: cellSet(TERRAIN_GRID, cells) },
    );
  },
});

/** A clear above either count asks for explicit demolition intent. */
const DEMOLISH_OBJECTS = 25;
const DEMOLISH_CELLS = 400;

export const clearAreaTool = defineTool({
  description: `Make room: in ONE step, remove every (non-locked) object touching the given cells AND erase the terrain there back to flat ${BUILDABLE_ZONES}. Use before reshaping an area instead of removing objects one by one. NEVER answer a refused placement by clearing a district you built — fix the exact cells instead. A clear removing more than ${DEMOLISH_OBJECTS} objects or covering more than ${DEMOLISH_CELLS} cells refuses unless demolish:true acknowledges the scale.`,
  input: obj({ ...cellsOrRect, demolish: bool({ description: `Acknowledge a large demolition (over ${DEMOLISH_OBJECTS} objects or ${DEMOLISH_CELLS} cells).` }) }),
  access: 'wide',
  example: RECT_CALL,
  run(deps, input) {
    const state = deps.getState();
    const resolved = resolveCells(input, state);
    if (resolved.length === 0) return geometryError(input, 'area');
    const zoneClip = clipBuildable(resolved, state);
    if (zoneClip.cells.length === 0) return offZoneError();
    // A locked object survives the clear, so the ground under it cannot be erased either: those
    // cells are skipped rather than letting one plaza-shadow cell refuse the stroke.
    const lockedRects = [...state.objects.values()].filter((o) => o.locked).map((o) => objectRect(o));
    const cells = zoneClip.cells.filter((c) => !lockedRects.some((r) => cellOverlapsRect(r, c.x, c.y, PLACEMENT_GRID)));
    const underLocked = zoneClip.cells.length - cells.length;
    const offZone = zoneClip.offZone;
    if (cells.length === 0) return argError('every remaining cell lies under a locked structure, which a clear cannot touch.');
    const clearing = new Set(cells.map((c) => cellKey(c.x, c.y)));
    const commands: Command[] = [];
    for (const o of state.objects.values()) {
      if (o.locked) continue;
      const r = objectRect(o);
      let hit = false;
      for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h) && !hit; y++) {
        for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w) && !hit; x++) {
          if (clearing.has(cellKey(x, y))) hit = true;
        }
      }
      if (hit) commands.push(removeObjectCommand(o));
    }
    const removed = commands.length;
    if ((removed > DEMOLISH_OBJECTS || cells.length > DEMOLISH_CELLS) && input.demolish !== true) {
      return {
        isError: true,
        content: `STOP: this would remove ${removed} object(s) over ${cells.length} cell(s) — likely work already built. `
          + 'A refusal is fixed at its own cells, never by clearing the district. If the order genuinely asks for '
          + 'demolition at this scale, call again with demolish: true; otherwise clear only the exact cells you need.',
      };
    }
    commands.push(eraseTerrainCommand(cells));
    const skipped = underLocked > 0 ? ` ${underLocked} cell(s) under a locked structure were skipped.` : '';
    return runStroke(
      deps,
      commands,
      () => `Cleared ${cells.length} cell(s): removed ${removed} object(s), terrain reset to flat ${BUILDABLE_ZONES}.${offZoneNote(offZone)}${skipped}`,
      { snapshot: cellSet(TERRAIN_GRID, cells) },
    );
  },
});

export const trimCornerTool = defineTool({
  description: "Cosmetic corner trim on a terrain cell: style 'fan' (rounded), 'tri' (45-degree bevel), 'square' (reset), 'empty' (cut away).",
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
    const { x, y, corner, style } = input;
    const layer = input.layer ?? 'terrain';
    const state = deps.getState();
    const cell = getCell(state.cells, x, y);
    const roadObj = layer === 'road' ? roadLookup(state)(x, y) ?? undefined : undefined;
    if (layer === 'terrain' && !cell?.terrain) return { isError: true, content: `No terrain at (${x},${y}) to trim.` };
    if (layer === 'road' && !roadObj) return { isError: true, content: `No road at (${x},${y}) to trim.` };
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
        return { isError: true, content: `Corner ${corner} of (${x},${y}) is structurally locked (interior corner, water boundary, or waterfall frame) — it must stay square.` };
      }
      if (!validateCut(state, roads, { x, y }, layer, after)) {
        return { isError: true, content: `Trimming ${corner} of (${x},${y}) to ${style} would break edge contact with a neighboring block.` };
      }
    }
    return runStroke(
      deps,
      [roadObj ? trimRoadCommand(roadObj, x, y, after) : trimTerrainCommand(x, y, after)],
      () => `Trimmed ${corner} corner of (${x},${y}) to ${style}.`,
      // A silhouette-only cut cannot invalidate another cut, so the repair pass is skipped.
      { reconcile: false },
    );
  },
});

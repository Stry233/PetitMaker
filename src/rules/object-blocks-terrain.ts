/**
 * V-PLACE-BLOCK: Terrain paint/erase restrictions around objects (pre-command).
 *
 * A terrain cell is blocked when it overlaps an object's footprint on the terrain
 * micro-grid: terrain occupies the half-tile-shifted micro grid, so the overlap test
 * uses cellShift −0.5 (the dual-grid offset is documented in docs/ARCHITECTURE.md).
 * Mountain paint is ALLOWED over road (surfaceCoating)
 * cells (the road auto-elevates); everything else is blocked by any solid object —
 * including the immutable plaza, which is just a solid object here.
 */
import {
  CommandType,
  TerrainType,
  type Command,
  type GridState,
  type MacroCoord,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { cellOverlapsRect } from '../core/model/grid-model';
import { entriesNear, getObjectIndex } from '../state/object-index';

export const objectBlocksTerrainRule: PreCommandRule = {
  id: 'V-PLACE-BLOCK',
  agentHint: 'Terrain cannot be painted on cells covered by an object footprint — clear_area removes the objects AND the terrain there in one step.',
  phase: 'pre-command',
  appliesTo: [CommandType.PaintTerrain, CommandType.EraseTerrain, CommandType.TrimCorners],

  validate(cmd: Command, state: GridState): ValidationError[] {
    // Cells this command puts terrain on, plus whether it's a mountain (which may rise over a road).
    // A gamma fillet (patchOnly TrimCorners) MATERIALISES a cosmetic terrain patch on its cell, so it can
    // land terrain over an object exactly like a paint — gate it the same way. A plain edge cut only
    // removes/reveals (never adds), and never sits on an object cell (no terrain there), so it's exempt.
    let cells: readonly MacroCoord[];
    let isMountainPaint: boolean;
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      cells = cmd.cells;
      isMountainPaint = cmd.type === CommandType.PaintTerrain && cmd.terrainType === TerrainType.Mountain;
    } else if (cmd.type === CommandType.TrimCorners && cmd.layer === 'terrain' && cmd.patchOnly) {
      cells = [{ x: cmd.x, y: cmd.y }];
      isMountainPaint = cmd.terrainType === TerrainType.Mountain;
    } else {
      return [];
    }

    // Spatial-index candidates per cell: this rule runs once per PaintTerrain
    // command (dozens per brush stroke), and a decorated map holds thousands of
    // objects — only the handful near each cell can possibly block it.
    // Evidence = the BLOCKING OBJECTS' footprints, on the object grid: the cause
    // is the object standing in the way, and a flash on the shifted terrain cell
    // straddles that object's sprite by half a tile and reads as noise.
    const index = getObjectIndex(state);
    const blockers = new Map<number, MacroCoord[]>(); // ord → footprint (each blocker once)
    for (const coord of cells) {
      const near = entriesNear(index, { x: coord.x, y: coord.y, w: 1, h: 1 });
      for (const e of near) {
        if (blockers.has(e.ord)) continue;
        if (!cellOverlapsRect(e.rect, coord.x, coord.y, -0.5)) continue;
        if (isMountainPaint && e.coating) continue; // mountain may rise over a road
        const cells: MacroCoord[] = [];
        for (let y = Math.floor(e.rect.y); y < Math.ceil(e.rect.y + e.rect.h); y++)
          for (let x = Math.floor(e.rect.x); x < Math.ceil(e.rect.x + e.rect.w); x++)
            cells.push({ x, y });
        blockers.set(e.ord, cells);
      }
    }
    if (blockers.size > 0) {
      const cells = [...blockers.keys()].sort((a, b) => a - b).flatMap((ord) => blockers.get(ord)!);
      return [{
        ruleId: 'V-PLACE-BLOCK',
        message: 'error.object_blocks_terrain',
        cells,
        grid: 'macro',
        severity: 'error',
      }];
    }
    return [];
  },
};

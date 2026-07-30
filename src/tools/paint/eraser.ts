import { ToolType } from '../../core/model/types';
import type { MacroCoord, MicroCoord } from '../../core/model/types';
import type { Tool, ToolContext } from '../types';
import type { CursorId } from '../../ui/cursors/cursor-spec';
import { brushCells } from './drawing-tool';
import { showToast } from '../../ui/chrome/Toast';
import { getCell } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { peelCommand } from './terrain-peel';
import { eraseTileCells } from './tile-coating';
import { overlappingCoatings, removeObjectCommand } from '../objects/object-placer';

const ERASER_GHOST_COLOR = 0xff6b6b;

export class EraserTool implements Tool {
  readonly id = ToolType.Eraser;
  readonly cursor: CursorId = 'eraser';

  /**
   * Ask the SAME question the click answers (eraseAt), for the hovered cell: erasing a
   * coating is a RemoveObject per coating, erasing terrain is the peel command.
   *
   * A cell the click SKIPS (bare ground, a hidden layer, no coating) is a no-op, not a refusal:
   * the badge means "this would be refused". Read-only: it validates, never executes.
   */
  canActAt(coord: MacroCoord, ctx: ToolContext): boolean {
    if (useEditorStore.getState().contentType === 'tile') {
      for (const obj of overlappingCoatings(ctx.gridState, [coord])) {
        if (ctx.validateCommand(removeObjectCommand(obj)).length > 0) return false;
      }
      return true;
    }
    const cell = getCell(ctx.gridState.cells, coord.x, coord.y);
    if (!cell?.terrain) return true;
    if (useEditorStore.getState().layerVisibility[cell.terrain.elevation] === false) return true;
    const cmd = peelCommand(coord.x, coord.y, cell);
    return !cmd || ctx.validateCommand(cmd).length === 0;
  }

  private erasing = false;
  private lastCoord: MacroCoord | null = null;
  private strokeStartUndoSize = 0;
  private strokeCells = new Set<string>();

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.erasing = true;
    this.lastCoord = coord;
    this.strokeStartUndoSize = ctx.getUndoStackSize();
    this.strokeCells.clear();
    this.eraseAt(coord, ctx);
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const cells = brushCells(coord.x, coord.y, ctx.brushSize);
    // Tiles/roads are macro-aligned (no offset); only terrain renders on the
    // shifted micro grid, so only it needs the ghost's default terrainGrid.
    const terrainGrid = useEditorStore.getState().contentType !== 'tile';
    ctx.overlay.showGhost(cells, ERASER_GHOST_COLOR, terrainGrid);

    if (this.erasing && (coord.x !== this.lastCoord?.x || coord.y !== this.lastCoord?.y)) {
      this.lastCoord = coord;
      this.eraseAt(coord, ctx);
    }
  }

  onPointerUp(_coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.erasing = false;
    this.lastCoord = null;
    const violations = ctx.commitStroke(this.strokeStartUndoSize);
    if (violations.length > 0) {
      const msg = ctx.t(violations[0]!.message);
      showToast(msg, 'warning');
    }
  }

  onActivate(_ctx: ToolContext): void {
    this.erasing = false;
    this.lastCoord = null;
    this.strokeCells.clear();
  }

  onDeactivate(ctx: ToolContext): void {
    this.erasing = false;
    this.lastCoord = null;
    this.strokeCells.clear();
    ctx.overlay.clearGhost();
  }

  private eraseAt(coord: MacroCoord, ctx: ToolContext): void {
    const cells = brushCells(coord.x, coord.y, ctx.brushSize);
    if (useEditorStore.getState().contentType === 'tile') {
      eraseTileCells(cells, ctx);
      return;
    }
    const { layerVisibility } = useEditorStore.getState();

    for (const c of cells) {
      const key = `${c.x},${c.y}`;
      if (this.strokeCells.has(key)) continue;
      const cell = getCell(ctx.gridState.cells, c.x, c.y);
      if (!cell?.terrain) continue;
      const elev = cell.terrain.elevation;
      if (layerVisibility[elev] === false) continue;
      this.strokeCells.add(key);

      const cmd = peelCommand(c.x, c.y, cell);
      if (cmd) ctx.executeCommand(cmd);
    }
  }
}

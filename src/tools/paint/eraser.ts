import { TerrainType, ToolType } from '../../core/model/types';
import type { MacroCoord, MicroCoord } from '../../core/model/types';
import type { Tool, ToolContext } from '../runtime/types';
import type { PreviewCell } from '../../core/runtime/preview-cell';
import type { CursorId } from '../../core/runtime/cursor-spec';
import { brushCells } from './drawing-tool';
import { dragShapeCells, dragShapeSpans, snapShapeEnd } from './shapes';
import { isConstrainHeld } from '../../core/runtime/modifier-state';
import { showToast } from '../../core/runtime/toast-bus';
import { getCell } from '../../core/model/grid-model';
import type { ContentType } from '../../core/model/edit-mode';
import { peelCommand } from './terrain-peel';
import { eraseTileCells } from './tile-coating';
import { overlappingCoatings, removeObjectCommand } from '../objects/object-placer';

/** The drag shape this gesture lays out, or null for the DAB, which is the default. One reading, so
 *  the press, the ghost and the release agree. */
function dragShape(ctx: ToolContext): 'rect' | 'circle' | null {
  return ctx.eraserShape === 'dot' ? null : ctx.eraserShape;
}

/** The eraser erases its OWN surface: the water eraser acts on water cells only, the mountain
 *  eraser on mountain cells only — each bar's eraser takes back what that bar lays, so reaching
 *  across (a water eraser flattening a mountain, a mountain eraser breaching a pond) cannot
 *  happen by a stray dab. A mismatched cell is a SKIP, not a refusal: the badge stays quiet. */
function erasesHere(type: TerrainType, surface: ContentType): boolean {
  if (surface === 'water') return type === TerrainType.Water;
  if (surface === 'mountain') return type === TerrainType.Mountain;
  return true;
}

/**
 * The eraser, in its three shapes (`ToolContext.eraserShape`).
 *
 * A DAB is press and drag: every cell the brush passes over is taken. The two DRAG shapes are the
 * batch: press at one corner, drag a rectangle or a circle out, and the whole figure is taken on
 * release. They are built by the drawing tool's own `dragShapeCells`, so the eraser takes back
 * exactly the figure the brush lays, and Shift constrains them to a square / a round circle the
 * same way it does there.
 *
 * ONE STROKE EITHER WAY. The dab commits as it travels and the drag commits once on release, but
 * both open at the press and close in `onPointerUp`, so either is a single undo step.
 */
export class EraserTool implements Tool {
  readonly id = ToolType.Eraser;
  terrainGrid(ctx: ToolContext): boolean { return ctx.contentType !== 'tile'; }
  readonly cursor: CursorId = 'eraser';

  /**
   * Ask the SAME question the click answers (eraseAt), for the hovered cell: erasing a
   * coating is a RemoveObject per coating, erasing terrain is the peel command.
   *
   * A cell the click SKIPS (bare ground, a hidden layer, no coating) is a no-op, not a refusal:
   * the badge means "this would be refused". Read-only: it validates, never executes.
   */
  canActAt(coord: MacroCoord, ctx: ToolContext): boolean {
    if (ctx.contentType === 'tile') {
      for (const obj of overlappingCoatings(ctx.gridState, [coord])) {
        if (ctx.validateCommand(removeObjectCommand(obj)).length > 0) return false;
      }
      return true;
    }
    const cell = getCell(ctx.gridState.cells, coord.x, coord.y);
    if (!cell?.terrain) return true;
    if (ctx.layerVisibility[cell.terrain.elevation] === false) return true;
    if (!erasesHere(cell.terrain.type, ctx.contentType)) return true;
    const cmd = peelCommand(coord.x, coord.y, cell, ctx.contentType === 'water');
    return !cmd || ctx.validateCommand(cmd).length === 0;
  }

  /** The eraser's preview card, in the state this cell answers with — the same `canActAt` question
   *  the cursor's refusal badge asks. */
  private card(coord: MacroCoord, ctx: ToolContext): PreviewCell {
    return { icon: 'eraser', valid: this.canActAt(coord, ctx) };
  }

  private erasing = false;
  private lastCoord: MacroCoord | null = null;
  private strokeStartUndoSize = 0;
  private strokeCells = new Set<string>();
  /** Where a drag shape was started, or null for the dab (and between drags). */
  private shapeOrigin: MacroCoord | null = null;

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.erasing = true;
    this.lastCoord = coord;
    this.strokeStartUndoSize = ctx.getUndoStackSize();
    this.strokeCells.clear();
    const shape = dragShape(ctx);
    if (shape) { this.shapeOrigin = coord; return; }  // taken on release, once its extent is known
    this.eraseAt(brushCells(coord.x, coord.y, ctx.brushSize), ctx);
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    // Tiles/roads are macro-aligned (no offset); only terrain renders on the
    // shifted micro grid, so only it needs the ghost's default terrainGrid.
    const terrainGrid = ctx.contentType !== 'tile';
    const shape = dragShape(ctx);

    if (shape && this.shapeOrigin) {
      // Span-native preview, as the drawing tool's own shapes are: a map-size drag never expands to
      // a cell list before it is committed.
      const end = this.shapeEnd(coord, shape);
      ctx.overlay.showGhostSpans(dragShapeSpans(shape, this.shapeOrigin, end), this.card(end, ctx), terrainGrid);
      return;
    }

    ctx.overlay.showGhost(
      shape ? [coord] : brushCells(coord.x, coord.y, ctx.brushSize),
      this.card(coord, ctx), terrainGrid,
    );

    if (this.erasing && (coord.x !== this.lastCoord?.x || coord.y !== this.lastCoord?.y)) {
      this.lastCoord = coord;
      this.eraseAt(brushCells(coord.x, coord.y, ctx.brushSize), ctx);
    }
  }

  onPointerUp(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const shape = dragShape(ctx);
    if (shape && this.shapeOrigin) {
      this.eraseAt(dragShapeCells(shape, this.shapeOrigin, this.shapeEnd(coord, shape), ctx.brushSize), ctx);
      this.shapeOrigin = null;
      ctx.overlay.clearGhost();
    }
    this.erasing = false;
    this.lastCoord = null;
    const violations = ctx.commitStroke(this.strokeStartUndoSize);
    if (violations.length > 0) {
      const msg = ctx.t(violations[0]!.message);
      showToast(msg, 'warning');
    }
  }

  /** Where the drag ends, Shift-constrained to a square / round circle exactly as the drawing
   *  tool's shapes are (`snapShapeEnd`). */
  private shapeEnd(coord: MacroCoord, shape: 'rect' | 'circle'): MacroCoord {
    if (!this.shapeOrigin) return coord;
    return isConstrainHeld() ? snapShapeEnd(this.shapeOrigin, coord, shape) : coord;
  }

  onActivate(_ctx: ToolContext): void {
    this.erasing = false;
    this.lastCoord = null;
    this.shapeOrigin = null;
    this.strokeCells.clear();
  }

  onDeactivate(ctx: ToolContext): void {
    this.erasing = false;
    this.lastCoord = null;
    this.shapeOrigin = null;
    this.strokeCells.clear();
    ctx.overlay.clearGhost();
  }

  /** Take back `cells`. The dab calls this per step of its travel and a drag shape once, with the
   *  whole figure; `strokeCells` is what keeps a cell the dab crosses twice from being asked twice. */
  private eraseAt(cells: MacroCoord[], ctx: ToolContext): void {
    if (ctx.contentType === 'tile') {
      eraseTileCells(cells, ctx);
      return;
    }

    for (const c of cells) {
      const key = `${c.x},${c.y}`;
      if (this.strokeCells.has(key)) continue;
      const cell = getCell(ctx.gridState.cells, c.x, c.y);
      if (!cell?.terrain) continue;
      if (!erasesHere(cell.terrain.type, ctx.contentType)) continue;
      const elev = cell.terrain.elevation;
      if (ctx.layerVisibility[elev] === false) continue;
      this.strokeCells.add(key);

      // The water eraser CONVERTS water into this layer's mountain rather than digging a hole —
      // the probe above asks with the same flag, so the badge and the click cannot drift.
      const cmd = peelCommand(c.x, c.y, cell, ctx.contentType === 'water');
      if (cmd) ctx.executeCommand(cmd);
    }
  }
}

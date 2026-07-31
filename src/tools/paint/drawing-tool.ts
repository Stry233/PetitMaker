import { TerrainType, ToolType } from '../../core/model/types';
import type { MacroCoord, MicroCoord } from '../../core/model/types';
import { getTerrainColor } from '../../core/model/colors';
import { showToast } from '../../core/runtime/toast-bus';
import { reconcileRoadsAfterMountainPaint } from './road-reconcile';
import { line4, expandLine, curveCells, rectCells, circleCells, rectSpans, circleSpans, snapShapeEnd } from './shapes';
import { getCell, cellKey } from '../../core/model/grid-model';
import { ELEVATION_MAX } from '../../core/model/constants';
import type { Tool, ToolContext } from '../types';
import type { CursorId } from '../../core/runtime/cursor-spec';
import { placeTileCell, tileGhostColor } from './tile-coating';
import type { ContentType } from './paint-plan';
import { planPaint, buildFloor, autoStackTarget, waterLayerAt } from './paint-plan';
import { applyAutoEdgeCut } from '../edge-cut/auto-edge-cut';
import { useEditorStore } from '../../state/store';
import { isConstrainHeld } from '../../core/runtime/modifier-state';

export type DrawingMode = 'brush' | 'line' | 'curve' | 'rect' | 'circle';
export type { ContentType } from './paint-plan';

/** The probe asks as if the stroke had not started: a hover is not part of anyone's stroke. */
const FRESH_STROKE: ReadonlySet<string> = new Set<string>();

export function brushCells(cx: number, cy: number, size: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  const offset = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      cells.push({ x: cx - offset + dx, y: cy - offset + dy });
    }
  }
  return cells;
}

export class DrawingTool implements Tool {
  readonly id = ToolType.TerrainBrush;

  /** The material, not the shape: the ghost already shows brush vs line vs rect. */
  get cursor(): CursorId {
    return this.contentType === 'water' ? 'water' : this.contentType === 'tile' ? 'road' : 'mountain';
  }

  /** Ask the SAME question the click answers, or the badge lies: both read `planPaint`. Only the
   *  FIRST command matters — it is the one the click issues from the state the cursor is hovering
   *  over. Read-only: it validates, never executes.
   *
   *  A plan with no commands is a click that would do nothing here (a stack at its cap, a cell
   *  already painted this stroke), which is a no-op rather than a refusal; a plan that REFUSED
   *  the cell (a tile on water) is a refusal even though it issues nothing. */
  canActAt(coord: MacroCoord, ctx: ToolContext): boolean {
    // Water resolves its own layer from the hovered cell (see onPointerDown); ask the same
    // question here via a throwaway clone so the probe never mutates ctx.
    const planCtx = this.contentType === 'water' ? { ...ctx, elevation: waterLayerAt(coord, ctx) } : ctx;
    const plan = planPaint([coord], planCtx, this.contentType, FRESH_STROKE);
    const first = plan.commands[0];
    if (!first) return !plan.refused;
    return ctx.validateCommand(first).length === 0;
  }

  mode: DrawingMode = 'brush';
  contentType: ContentType = 'mountain';

  private painting = false;
  private lastCoord: MacroCoord | null = null;
  private strokeStartUndoSize = 0;
  private curvePoints: MacroCoord[] = [];
  private shapeOrigin: MacroCoord | null = null;
  private strokeCells = new Set<string>();
  private tileStrokeCells = new Set<string>();

  onActivate(_ctx: ToolContext): void {
    this.reset();
  }

  onDeactivate(ctx: ToolContext): void {
    this.reset();
    ctx.overlay.clearGhost();
  }

  onPointerDown(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    this.strokeStartUndoSize = ctx.getUndoStackSize();
    // Start a fresh per-stroke cell record (used for road reconcile + auto
    // edge-trim). Curve collects 3 clicks into one stroke, so only reset on its
    // FIRST point — otherwise each click would wipe the record.
    if (this.mode !== 'curve' || this.curvePoints.length === 0) {
      this.strokeCells.clear();
      this.tileStrokeCells.clear();
      // Water paints at what was clicked, not the panel's selected layer (fixed for the whole
      // stroke, even across a drag or a multi-click shape — only the ORIGIN click decides).
      // Mutate ctx.elevation directly, not just the store: the store round-trips through
      // ToolManager's next refreshCtx, which is too late for THIS command.
      if (this.contentType === 'water') {
        const layer = waterLayerAt(coord, ctx);
        ctx.elevation = layer;
        useEditorStore.getState().setActiveLayer(layer);
      }
    }

    switch (this.mode) {
      case 'brush':
        this.painting = true;
        this.lastCoord = coord;
        this.updateDisplay(coord, ctx);
        this.paintCells(brushCells(coord.x, coord.y, ctx.brushSize), ctx);
        break;

      case 'line':
      case 'rect':
      case 'circle':
        this.shapeOrigin = coord;
        break;

      case 'curve':
        this.curvePoints.push(coord);
        if (this.curvePoints.length === 3) {
          // strokeStartUndoSize was captured at the top of this onPointerDown; no command runs
          // between the 3 curve clicks, so it already marks the stroke start.
          const cells = curveCells(this.curvePoints[0]!, this.curvePoints[1]!, this.curvePoints[2]!, ctx.brushSize);
          this.paintCells(cells, ctx);
          this.curvePoints = [];
          ctx.overlay.clearGhost();
          this.finishStroke(ctx, coord);
        }
        break;
    }
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    const ghostColor = this.getGhostColor(ctx);
    // Terrain renders on the micro-grid (−HALF_TILE); tiles are macro-grid
    // objects with no offset. The ghost must use the matching grid so the
    // preview lands exactly where the surface will be painted.
    const terrainGrid = this.contentType !== 'tile';

    switch (this.mode) {
      case 'brush': {
        ctx.overlay.showGhost(brushCells(coord.x, coord.y, ctx.brushSize), ghostColor, terrainGrid);
        if (this.painting && (coord.x !== this.lastCoord?.x || coord.y !== this.lastCoord?.y)) {
          const from = this.lastCoord;
          this.lastCoord = coord;
          this.updateDisplay(coord, ctx);
          // Fill the WHOLE path between the last sample and this one with a 4-connected line, so a fast drag
          // (sparse pointer samples) stays an edge-connected band — no skipped cells, no diagonal-only links.
          const path = from ? line4(from.x, from.y, coord.x, coord.y) : [coord];
          this.paintCells(expandLine(path, ctx.brushSize), ctx);
        }
        break;
      }

      case 'line':
        if (this.shapeOrigin) {
          const end = isConstrainHeld() ? snapShapeEnd(this.shapeOrigin, coord, 'line') : coord;
          ctx.overlay.showGhost(this.shapeCells('line', this.shapeOrigin, end, ctx.brushSize), ghostColor, terrainGrid);
        } else {
          // Pre-click hover: preview the brush footprint so its size is visible
          // before the line is started (rather than a single cell).
          ctx.overlay.showGhost(brushCells(coord.x, coord.y, ctx.brushSize), ghostColor, terrainGrid);
        }
        break;

      case 'curve':
        if (this.curvePoints.length === 1) {
          // Show straight line preview from start to cursor
          const points = line4(this.curvePoints[0]!.x, this.curvePoints[0]!.y, coord.x, coord.y);
          ctx.overlay.showGhost(expandLine(points, ctx.brushSize), ghostColor, terrainGrid);
        } else if (this.curvePoints.length === 2) {
          // Show curve preview with cursor as control point
          const preview = curveCells(this.curvePoints[0]!, this.curvePoints[1]!, coord, ctx.brushSize);
          ctx.overlay.showGhost(preview, ghostColor, terrainGrid);
        } else {
          // Pre-click hover: preview the brush footprint so its size is visible.
          ctx.overlay.showGhost(brushCells(coord.x, coord.y, ctx.brushSize), ghostColor, terrainGrid);
        }
        break;

      case 'rect':
      case 'circle':
        if (this.shapeOrigin) {
          // Span-native preview: a map-size drag never expands to its cell list
          // (the commit on pointer-up builds the cells once).
          const end = isConstrainHeld() ? snapShapeEnd(this.shapeOrigin, coord, this.mode) : coord;
          const spans = this.mode === 'rect'
            ? rectSpans(this.shapeOrigin, end)
            : circleSpans(this.shapeOrigin, Math.abs(end.x - this.shapeOrigin.x), Math.abs(end.y - this.shapeOrigin.y));
          ctx.overlay.showGhostSpans(spans, ghostColor, terrainGrid);
        } else {
          ctx.overlay.showGhost([coord], ghostColor, terrainGrid);
        }
        break;
    }
  }

  /** The cells a drag shape covers — ONE builder for ghost preview and commit, so
   *  the two can never drift. */
  private shapeCells(mode: 'line' | 'rect' | 'circle', origin: MacroCoord, end: MacroCoord, brushSize: number): MacroCoord[] {
    switch (mode) {
      case 'line': return expandLine(line4(origin.x, origin.y, end.x, end.y), brushSize);
      case 'rect': return rectCells(origin, end);
      case 'circle': return circleCells(origin, Math.abs(end.x - origin.x), Math.abs(end.y - origin.y));
    }
  }

  /** Shared commit path for the three drag shapes (pointer-up). */
  private commitShape(mode: 'line' | 'rect' | 'circle', coord: MacroCoord, ctx: ToolContext): void {
    if (!this.shapeOrigin) return;
    this.strokeStartUndoSize = ctx.getUndoStackSize();
    const end = isConstrainHeld() ? snapShapeEnd(this.shapeOrigin, coord, mode) : coord;
    this.paintCells(this.shapeCells(mode, this.shapeOrigin, end, ctx.brushSize), ctx);
    this.shapeOrigin = null;
    ctx.overlay.clearGhost();
    this.finishStroke(ctx, end);
  }

  onPointerUp(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    switch (this.mode) {
      case 'brush': {
        // Settle the highlight on the LAST PAINTED cell (where the brush actually
        // ended), not the release point — so releasing on fresh ground stays on
        // the floor instead of jumping to a stack the stroke crossed earlier.
        const lastPainted = this.lastCoord ?? coord;
        this.painting = false;
        this.lastCoord = null;
        ctx.overlay.clearGhost();
        this.finishStroke(ctx, lastPainted);
        break;
      }

      case 'line':
      case 'rect':
      case 'circle':
        this.commitShape(this.mode, coord, ctx);
        break;

      default:
        break;
    }
  }

  /** Run the plan. The tile branch goes cell by cell through `placeTileCell`, which strips the
   *  coating it replaces before executing — the one part of a tile click a pure plan cannot hold. */
  private paintCells(cells: MacroCoord[], ctx: ToolContext): void {
    if (this.contentType === 'tile') {
      for (const c of cells) placeTileCell(c, ctx, this.tileStrokeCells);
      return;
    }
    const plan = planPaint(cells, ctx, this.contentType, this.strokeCells);
    // Record the stroke's footprint (road reconcile + auto edge-trim read it) only after planning:
    // the plan must see the heights as they were before this batch, and a cell already in the set
    // is one this stroke has raised already.
    for (const c of cells) this.strokeCells.add(cellKey(c.x, c.y));
    for (const cmd of plan.commands) ctx.executeCommand(cmd);
  }

  private getGhostColor(ctx: ToolContext): number {
    switch (this.contentType) {
      // Ghost previews the colour of the target (selected) layer for mountains.
      case 'mountain': return getTerrainColor(TerrainType.Mountain, buildFloor(ctx));
      case 'water': return getTerrainColor(TerrainType.Water, ctx.elevation);
      case 'tile': return tileGhostColor();
    }
  }

  /** Parse a "x,y" stroke-cell set into MacroCoord[]. */
  private cellsFromSet(set: Set<string>): MacroCoord[] {
    return [...set].map((k) => {
      const [sx, sy] = k.split(',');
      return { x: Number(sx), y: Number(sy) };
    });
  }

  private finishStroke(ctx: ToolContext, focus?: MacroCoord): void {
    if (this.contentType === 'mountain' && this.strokeCells.size > 0) {
      reconcileRoadsAfterMountainPaint(this.cellsFromSet(this.strokeCells), ctx);
    }
    const violations = ctx.commitStroke(this.strokeStartUndoSize);
    if (violations.length > 0) {
      const msg = ctx.t(violations[0]!.message);
      showToast(msg, 'warning');
    }

    // Acknowledge a successful terrain/tile commit with one regional
    // flash over the painted cells (a rejected stroke gets the toast above).
    // Only the discrete shape tools (line/curve/rect/circle) flash — a freehand
    // brush commits continuously, so a per-stroke flash there is just noise.
    // Gate on the stroke actually committing: a fully-rejected stroke (locked
    // layer / illegal cells) pushes nothing, so the undo stack never grows.
    const isTile = this.contentType === 'tile';
    const committed = ctx.getUndoStackSize() > this.strokeStartUndoSize;
    if (violations.length === 0 && committed && this.mode !== 'brush') {
      const painted = this.cellsFromSet(isTile ? this.tileStrokeCells : this.strokeCells);
      if (painted.length > 0) {
        ctx.overlay.flashCommit(painted, { terrainMode: !isTile });
      }
    }

    // Auto edge-trim (post-validation): trim the corners the stroke just exposed
    // on whatever cells survived. The toggle lives in the Build panel.
    // ATOMIC UNDO: the trim/fill commands fold into the last block entry of the
    // stroke, so undo steps are block creations only — never a bare "the shape squared up" step.
    const autoMode = useEditorStore.getState().autoEdgeCut;
    if (autoMode !== 'off') {
      const trimStart = ctx.getUndoStackSize();
      if (isTile) {
        applyAutoEdgeCut(ctx, autoMode, [], this.cellsFromSet(this.tileStrokeCells));
      } else {
        applyAutoEdgeCut(ctx, autoMode, this.cellsFromSet(this.strokeCells), []);
      }
      if (ctx.getUndoStackSize() > trimStart) {
        ctx.collapseHistory(Math.max(this.strokeStartUndoSize, trimStart - 1));
      }
    }

    this.syncDisplayLayer(ctx, focus);
  }

  // Live layer-panel highlight while painting: the auto-stack target under the
  // cursor (mountain only). Non-mountain surfaces clear the override (panel
  // follows the selected layer). Reads the cell BEFORE it's painted this stroke.
  private updateDisplay(coord: MacroCoord, ctx: ToolContext): void {
    if (this.contentType !== 'mountain') { ctx.setDisplayLayer(null); return; }
    const existing = getCell(ctx.gridState.cells, coord.x, coord.y)?.terrain?.elevation ?? 0;
    ctx.setDisplayLayer(autoStackTarget(existing, buildFloor(ctx)));
  }

  // After commit, settle the highlight on what the cell UNDER THE CURSOR actually
  // became, so a capped/reverted stack shows its real height. We use ONLY the
  // final cursor cell (never the stroke maximum), so releasing on fresh ground
  // leaves the panel on the floor instead of jumping up to a crossed-over stack.
  // If that cell isn't usable (reverted/empty), keep the live value from painting.
  private syncDisplayLayer(ctx: ToolContext, focus?: MacroCoord): void {
    if (this.contentType !== 'mountain') { ctx.setDisplayLayer(null); return; }
    if (!focus || !this.strokeCells.has(cellKey(focus.x, focus.y))) return;
    const achieved = getCell(ctx.gridState.cells, focus.x, focus.y)?.terrain?.elevation ?? 0;
    if (achieved > 0) ctx.setDisplayLayer(Math.min(ELEVATION_MAX, achieved));
  }

  private reset(): void {
    this.painting = false;
    this.lastCoord = null;
    this.curvePoints = [];
    this.shapeOrigin = null;
    this.strokeCells.clear();
    this.tileStrokeCells.clear();
  }
}

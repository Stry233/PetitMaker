/**
 * The build brush: freehand, line, rectangle, circle and the curve's anchor chain, laying mountain,
 * water or road. What a stroke laid and its trimming are `stroke-cells.ts`, the ghost's trimmed shape
 * `stroke-preview.ts`, and the layer panel's highlight `display-layer.ts`.
 */
import type { Stroke } from '../../../core/commands/command-executor';
import { paintTrimMode } from './trim-mode';
import { finishPaintStroke } from './stroke-finish';
import { CommandType } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import type { MacroCoord, Command, ValidationError } from '../../../core/model/types';
import { brushCells, splineCells, type DragShapeKind } from '../../../core/grid/shapes';
import { ShapeGesture, type GestureGhost } from './gestures';
import { getCell } from '../../../core/model/grid-model';
import { cellKey, uniqueCells } from '../../../core/grid/rect';
import type { Tool } from '../runtime/types';
import type { CurveToolContext } from './curve-session';
import type { CursorId } from '../../../assets/cursors/cursor-spec';
import { placeTileCell } from './tile-coating';
import { strippableRefusal } from '../../placement/coatings';
import type { ContentType } from './paint-plan';
import type { PreviewCell, PreviewIcon } from '../runtime/view-seam';
import { planPaint } from './paint-plan';
import { StrokePreimage, restoreStroke } from './restore';
import { adjustContext, curveArmingKey } from './curve-session';
import type { CurveAnchor } from '../../../core/base/spline';
import { ruleToast, violationToast } from '../../../i18n/rule-copy';
import type { GridId, GridCell, MapPoint } from '../../../core/grid/grids';
import { CONTENT_GRID } from '../../../state/editing/edit-mode';
import { cellSet } from '../../../core/grid/grids';
import { StrokeCells, laysTiles, liveTrim, squareStroke } from './stroke-cells';
import { FRESH_STROKE, trimOfCells, trimOfSpans } from './stroke-preview';
import { settleStrokeLayer, showDabLayer } from './display-layer';


export type { ContentType } from './paint-plan';

/** The glyph the preview card carries for each surface these brushes lay. A road/tile is the ground
 *  glyph: the design draws one plot-of-land mark for everything laid flat on the ground. */
const CONTENT_ICON: Record<ContentType, PreviewIcon> = {
  mountain: 'mountain',
  water: 'water',
  road: 'ground',
};

export class DrawingTool implements Tool<GridId, CurveToolContext> {
  readonly id = ToolType.TerrainBrush;
  grid(ctx: CurveToolContext): GridId { return CONTENT_GRID[ctx.arming.contentType]; }

  /** The material, not the shape: the ghost already shows brush vs line vs rect. */
  cursor(ctx: CurveToolContext): CursorId {
    return ctx.arming.contentType;
  }

  /** Ask the same question the click answers, or the badge lies: both read `planPaint`. Only the
   *  first command matters — it is the one the click issues from the state the cursor is hovering
   *  over. Read-only: it validates, never executes.
   *
   *  A plan with no commands is a click that would do nothing here (a stack at its cap, a cell
   *  already painted this stroke), which is a no-op rather than a refusal; a plan that refused
   *  the cell (a tile on water) is a refusal even though it issues nothing. */
  canActAt(coord: MacroCoord, ctx: CurveToolContext): boolean {
    const plan = planPaint([coord], ctx, ctx.arming.contentType, FRESH_STROKE);
    const first = plan.commands[0];
    if (!first) return !plan.refused;
    const errors = ctx.validateCommand(first);
    if (errors.length === 0) return true;
    // A tile click strips the coating it covers before placing (placeTileCell), so a refusal
    // that is only the strippable coating's overlap is what the click makes legal — the probe
    // must answer the click's question, not the raw command's.
    return first.type === CommandType.PlaceObject && strippableRefusal(ctx.state, first.object, errors);
  }

  /** The open stroke: begun at each press, and at each curve tweak. */
  private stroke: Stroke | null = null;
  /** The press in progress: a freehand drag, a dragged figure, or the curve's anchor chain. */
  private readonly gesture = new ShapeGesture();
  /** The curve being drawn: a chain of anchors the path runs through (see `splinePath`). */
  private get chain() { return this.gesture.chain; }
  /* ── the adjust phase's bookkeeping ───────────────────────────────────────
   * The map as it stood before the curve, read off the curve's own history: every cell and object
   * it or its auto-trim changed, which `repaintCurve` puts back before laying the curve again. */
  private curvePreimage = new StrokePreimage();
  /** The context the curve was painted with, frozen by `adjustContext`. */
  private curveCtx: CurveToolContext | null = null;
  /** The anchors the map currently reflects. Not the session's — those are already the new ones by
   *  the time a repaint is asked for, so a refusal has nothing to go back to without this. */
  private curveAnchors: CurveAnchor[] = [];
  private readonly laid = new StrokeCells();

  onActivate(ctx: CurveToolContext): void {
    this.reset(ctx);
  }

  onDeactivate(ctx: CurveToolContext): void {
    this.reset(ctx);
    ctx.overlay.clearGhost();
  }

  onPointerDown(coord: GridCell, _point: MapPoint, ctx: CurveToolContext): void {
    // A click anywhere on the map puts the adjust handles away — a press on one never reaches the
    // tool, since they are React elements above the canvas. In curve mode that is all the click
    // does: dismissing is its own act, not the first anchor of the next curve.
    if (ctx.curve.isOpen()) {
      ctx.curve.end();
      if (ctx.arming.shape === 'curve') return;
    }
    this.stroke = ctx.beginStroke();
    // Start a fresh per-stroke cell record (used for road reconcile and auto edge-trim). A curve
    // collects its anchor clicks into one stroke, so only its first point resets the record.
    if (ctx.arming.shape !== 'curve' || this.chain.length === 0) {
      this.laid.clear();
    }

    switch (ctx.arming.shape) {
      case 'free': {
        this.gesture.beginFree(coord);
        showDabLayer(coord, ctx);
        const dab = brushCells(coord.x, coord.y, ctx.arming.brushSize);
        this.paintCells(dab, ctx);
        liveTrim(dab, ctx, this.laid);
        break;
      }

      case 'line':
      case 'rect':
      case 'circle':
        this.gesture.drag.begin(coord);
        break;

      case 'curve':
        this.chain.down(coord);
        if (!this.chain.dragging) this.previewCurve(coord, ctx);
        break;
    }
  }

  onPointerMove(coord: GridCell, _point: MapPoint, ctx: CurveToolContext): void {
    this.showGesture(this.gesture.ghost(coord, ctx.arming.shape, ctx.arming.brushSize, ctx.modifiers.constrain), ctx);
    if (ctx.arming.shape !== 'free') return;
    const dab = this.gesture.sweep(coord, ctx.arming.brushSize);
    if (!dab) return;
    showDabLayer(coord, ctx);
    this.paintCells(dab, ctx);
    liveTrim(dab, ctx, this.laid);
  }

  /** Draw what the gesture shows. Terrain renders on the micro-grid (`TERRAIN_GRID_OFFSET_PX`) and
   *  tiles on the macro grid with no offset, so the ghost uses the stroke's own grid; a dragged
   *  rectangle or circle previews as spans, so a map-size drag never expands to its cell list. */
  private showGesture(shown: GestureGhost, ctx: CurveToolContext): void {
    if ('cells' in shown) { this.ghost(shown.cells, ctx, shown.at); return; }
    ctx.overlay.showGhostSpans(shown.spans, this.card(shown.at, ctx), this.grid(ctx), trimOfSpans(shown.spans, ctx, this.laid.tiles));
  }

  /** The live curve, previewed through the anchors placed so far plus wherever the cursor is. */
  private previewCurve(cursor: MacroCoord, ctx: CurveToolContext): void {
    this.ghost(splineCells([...this.chain.points, cursor], ctx.arming.brushSize), ctx, cursor);
  }

  /** Paint the finished curve, then open the adjust phase on it. */
  private commitCurve(ctx: CurveToolContext, at: MacroCoord): void {
    const anchors = this.chain.points.map((a) => ({ ...a }));
    this.curveCtx = adjustContext(ctx);
    this.curvePreimage = new StrokePreimage();
    // The stroke began at the top of this onPointerDown; no command runs between the curve's
    // clicks, so it already holds the whole curve.
    this.layCurve(anchors, this.curveCtx);
    this.curveAnchors = anchors.map((a) => ({ ...a }));
    this.chain.clear();
    ctx.overlay.clearGhost();
    this.finishStroke(this.curveCtx, at);
    this.curvePreimage.record(this.stroke?.entries() ?? []);

    // The anchors stay on the map so the curve can be tuned. They are not shown while it is being
    // drawn: what matters then is the path, and a handle under the cursor would be in the way of
    // the next click.
    if (anchors.length >= 2) {
      ctx.curve.begin(anchors, {
        width: this.curveCtx.arming.brushSize, grid: this.grid(this.curveCtx), armingKey: curveArmingKey(this.curveCtx.arming),
      }, {
        preview: (next) => this.previewAdjust(next),
        repaint: (next) => this.repaintCurve(next),
        finalize: () => {
          this.curveCtx?.overlay.clearGhost();
          this.curveCtx = null;
          this.curvePreimage = new StrokePreimage();
        },
      });
    }
  }

  /** Paint the curve at these anchors. */
  private layCurve(anchors: readonly CurveAnchor[], ctx: CurveToolContext): void {
    this.paintCells(splineCells(anchors, ctx.arming.brushSize), ctx);
  }

  /**
   * Run a command, and where allowed, retry it cell by cell if it is refused.
   *
   * A batch is refused whole if any one of its cells is: the plan groups a shape into one command
   * per target elevation, so a figure that so much as clips the sea, a landmark or a locked layer
   * would otherwise paint nothing at all. The retry only ever runs on the rejection path, so an
   * ordinary stroke still costs one command.
   */
  private execute(ctx: CurveToolContext, cmd: Command, splitOnRefusal: boolean): void {
    if (ctx.execute(cmd).success || !splitOnRefusal) return;
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      for (const c of cmd.cells) ctx.execute({ ...cmd, cells: [c] });
    }
  }

  /**
   * Did the curve actually reach the map?
   *
   * Not "did the undo stack grow": a paint whose cells are all off-map passes validation (the zone
   * rule skips out-of-bounds rather than erroring) and records an entry that changed nothing. What
   * matters is whether anything is there afterwards.
   */
  private curveLaidAnything(cells: readonly MacroCoord[], ctx: CurveToolContext): boolean {
    if (laysTiles(ctx)) return this.laid.tiles.size > 0;
    return cells.some((c) => getCell(ctx.state.cells, c.x, c.y)?.terrain != null);
  }

  /** Mid-drag: the path the curve would take, as a ghost. The map is not touched until release. */
  private previewAdjust(anchors: readonly CurveAnchor[]): void {
    const ctx = this.curveCtx;
    if (!ctx) return;
    // The map still holds the previous curve: the ghost's trim is planned against the restore.
    this.ghost(splineCells(anchors, ctx.arming.brushSize), ctx, undefined, this.curvePreimage.commands(ctx.state));
  }

  /**
   * One tweak: put the map back and lay the curve again at the new anchors, as one undo entry.
   *
   * Restore-then-relay rather than patching the difference, because the two are not the same
   * picture: a mountain curve stacks on what is under it, so painting over the old path would raise
   * it twice, and a cell the old path covered has to go back to what it held before the curve — not
   * to bare ground. The whole thing is one stroke group, so Ctrl+Z steps back one tweak at a time.
   */
  private repaintCurve(anchors: readonly CurveAnchor[]): void {
    const ctx = this.curveCtx;
    if (!ctx) return;
    const stroke = ctx.beginStroke();
    // Where the anchors were, for the handles to go back to if the tweak is refused.
    const prevAnchors = this.curveAnchors;
    this.stroke = stroke;
    this.laid.clear();
    // A map the rules will not let return to its pre-curve picture keeps the curve it has.
    if (!restoreStroke(ctx, this.curvePreimage)) {
      stroke.rollback();
      ctx.curve.resetAnchors(prevAnchors);
      ctx.overlay.clearGhost();
      return;
    }
    this.layCurve(anchors, ctx);
    // A curve dragged off the map, or onto sea or a landmark, has every command refused or ignored — no
    // post-stroke violation to report, just a stroke that removed the old curve and laid no new one.
    const laidSomething = this.curveLaidAnything(splineCells(anchors, ctx.arming.brushSize), ctx);
    ctx.overlay.clearGhost();   // the map now shows what the ghost was promising
    const violations = this.finishStroke(ctx, anchors[anchors.length - 1]);
    if (violations.length === 0 && laidSomething) {
      this.curveAnchors = anchors.map((a) => ({ ...a }));
      this.curvePreimage.record(stroke.entries());
      return;
    }

    // Refused, one way or the other. Post-stroke, the commit stops reverting as soon as the
    // state is legal, which for a stroke that restores and then re-lays can leave the restore
    // standing and the new curve gone; pre-command, nothing was laid at all. Either way the map has
    // lost the curve while the handles still show the shape that was asked for, so the whole tweak
    // is rolled back exactly and the anchors go back with it: the handles must never describe a
    // curve the map does not have.
    stroke.rollback();
    ctx.curve.resetAnchors(prevAnchors);
  }

  /** Take back the last anchor (Delete/Backspace while drawing). */
  undoPendingStep(ctx: CurveToolContext): boolean {
    if (ctx.arming.shape !== 'curve' || !this.chain.undoStep()) return false;
    if (this.chain.length === 0) ctx.overlay.clearGhost();
    else this.ghost(splineCells(this.chain.points, ctx.arming.brushSize), ctx);
    return true;
  }

  /**
   * Escape. While drawing that abandons the curve, which has painted nothing; during the adjust
   * phase it only puts the handles away, exactly as clicking off the curve does — the curve is real
   * terrain by then, and Escape is not an undo.
   */
  cancelPending(ctx: CurveToolContext): boolean {
    if (ctx.arming.shape === 'curve' && this.chain.length > 0) {
      this.chain.clear();
      ctx.overlay.clearGhost();
      return true;
    }
    if (ctx.curve.isOpen()) { ctx.curve.end(); return true; }
    return false;
  }

  /** Whether a chain of anchors is standing, for a nav tap to put it down. The drawing phase only:
   *  the adjust handles stand over real terrain, and a tap that ended them would be answering a
   *  gesture that is already over. */
  hasPending(ctx: CurveToolContext): boolean {
    return ctx.arming.shape === 'curve' && this.chain.length > 0;
  }

  /** Shared commit path for the three drag shapes (pointer-up). */
  private commitShape(mode: DragShapeKind, coord: MacroCoord, ctx: CurveToolContext): void {
    const figure = this.gesture.releaseFigure(coord, mode, ctx.arming.brushSize, ctx.modifiers.constrain);
    if (!figure) return;
    this.stroke = ctx.beginStroke();
    this.paintCells(figure.cells, ctx);
    ctx.overlay.clearGhost();
    this.finishStroke(ctx, figure.end);
  }

  /** The press never happened: a brush stroke's dabs are taken back without a redo step, a shape
   *  keeps nothing, and a curve keeps the anchors it had before this press. */
  onPointerCancel(ctx: CurveToolContext): void {
    if (this.gesture.endFree()) this.stroke?.rollback();
    this.chain.cancelPress();
    this.gesture.drag.clear();
    if (ctx.arming.shape !== 'curve' || this.chain.length === 0) {
      this.laid.clear();
    }
    ctx.overlay.clearGhost();
  }

  onPointerUp(coord: GridCell, _point: MapPoint, ctx: CurveToolContext): void {
    switch (ctx.arming.shape) {
      case 'free': {
        // Settle the highlight on the last painted cell (where the brush actually
        // ended), not the release point — so releasing on fresh ground stays on
        // the floor instead of jumping to a stack the stroke crossed earlier.
        const lastPainted = this.gesture.endFree() ?? coord;
        ctx.overlay.clearGhost();
        this.finishStroke(ctx, lastPainted);
        break;
      }

      case 'line':
      case 'rect':
      case 'circle':
        this.commitShape(ctx.arming.shape, coord, ctx);
        break;

      case 'curve':
        if (this.chain.up(coord, ctx.eventTime) === 'finish') this.commitCurve(ctx, coord);
        else this.previewCurve(coord, ctx);
        break;

      default:
        break;
    }
  }

  /** Run the plan. The tile branch goes cell by cell through `placeTileCell`, which strips the
   *  coating it replaces before executing — the one part of a tile click a pure plan cannot hold. */
  private paintCells(cells: MacroCoord[], ctx: CurveToolContext): void {
    if (laysTiles(ctx)) {
      for (const c of cells) placeTileCell(c, ctx, this.laid.tiles);
      return;
    }
    const plan = planPaint(cells, ctx, ctx.arming.contentType, this.laid.terrain);
    if (plan.clipped) ctx.reportGroundClipped?.();
    // Record the stroke's footprint (road reconcile + auto edge-trim read it) only after planning:
    // the plan must see the heights as they were before this batch, and a cell already in the set
    // is one this stroke has raised already.
    for (const c of cells) this.laid.terrain.add(cellKey(c.x, c.y));
    // A shape is one deliberate figure, so it lays the part of itself that is legal. The freehand
    // mountain brush keeps its footprint atomic: its cells hold each other up (the ladder), so a
    // dab is a single mark. Water neither stacks nor supports anything, so a dab lays the cells
    // that can hold it and skips the ones the rules refuse. In the planet session a dab also lays
    // what is legal, so a fresh island's coast cells stay ground while its interior rises.
    const splitOnRefusal = ctx.arming.shape !== 'free' || ctx.arming.contentType === 'water' || ctx.arming.groundEditable;
    for (const cmd of plan.commands) this.execute(ctx, cmd, splitOnRefusal);
  }

  /**
   * Draw the ghost, in the shape the stroke will actually leave.
   *
   * With auto-trim on, the committed shape has cut corners and can gain Γ patches in its notches
   * (a road stroke, cut end-caps and bends), so a square ghost promises something the click does
   * not produce. The preview runs the real trim pass (`stroke-preview.ts`).
   */
  private ghost(cells: MacroCoord[], ctx: CurveToolContext, at?: MacroCoord, before: Command[] = []): void {
    ctx.overlay.showGhost(cellSet(this.grid(ctx), cells), this.card(at ?? cells[0], ctx),
      trimOfCells(cells, ctx, before, this.laid.tiles));
  }

  /** The preview card this stroke shows: the glyph of the surface being laid, in the state the
   *  probed cell answers with — the same `canActAt` question the cursor's refusal badge asks, so a
   *  red card and a badged cursor can never disagree. */
  private card(at: MacroCoord | undefined, ctx: CurveToolContext): PreviewCell {
    return {
      icon: CONTENT_ICON[ctx.arming.contentType],
      valid: !at || this.canActAt(at, ctx),
    };
  }

  /** Returns the post-stroke violations, so a caller that must be all-or-nothing can act on them.
   *  Roads riding or refusing the stroke's terrain change are the commit's own reconcile pass. */
  private finishStroke(ctx: CurveToolContext, focus?: MacroCoord): ValidationError[] {
    const stroke = this.stroke;
    if (!stroke) return [];
    const isTile = laysTiles(ctx);
    const cells = this.laid.coords(ctx);
    // A shape the drag cut early can be built against later in the same drag, and the trim keeps
    // the shapes it finds, so the stroke's own cells go back to square before the sweep.
    const { violations, committed, waterLayer, trimmed } = finishPaintStroke(ctx, {
      stroke,
      terrainCells: isTile ? [] : cells,
      tileCells: isTile ? cells : [],
      water: ctx.arming.contentType === 'water',
      trim: paintTrimMode(ctx),
      layerVisibility: ctx.arming.layerVisibility,
      beforeTrim: () => { if (this.laid.liveTrimmed) squareStroke(cells, ctx); },
    });
    // A refused water stroke names the one layer that would take it, where there is exactly one.
    if (violations.length > 0) {
      ctx.notify(waterLayer !== null ? ruleToast(ctx.t, 'error.water_only_layer', { layer: waterLayer }) : violationToast(ctx.t, violations[0]!), 'warning');
    }

    // Acknowledge a successful terrain/tile commit with one regional flash over the painted cells
    // (a rejected stroke gets the toast above). Only the discrete shape tools (line/curve/rect/
    // circle) flash — a freehand brush commits continuously, so a per-stroke flash there is just
    // noise. Gate on the stroke actually committing: a fully-rejected stroke (locked layer /
    // illegal cells) pushes nothing, so the undo stack never grows.
    //
    // After the trim, not before: the flash reads each cell's shape off the map, so running it
    // first would announce square blocks where the stroke left rounded ones — and the trim's own
    // cells join the flash, since the sweep reaches a cell outside the stroke (a block it left
    // newly convex, a notch it closed) and a commit that changed one has to acknowledge it.
    if (violations.length === 0 && committed && ctx.arming.shape !== 'free') {
      const painted = uniqueCells([...this.laid.coords(ctx), ...trimmed]);
      if (painted.length > 0) {
        ctx.overlay.flashCommit([cellSet(this.grid(ctx), painted)]);
      }
    }

    settleStrokeLayer(ctx, focus, this.laid.terrain);
    return violations;
  }

  private reset(ctx: CurveToolContext): void {
    if (ctx.curve.isOpen()) ctx.curve.end();
    this.gesture.clear();
    this.laid.clear();
  }
}

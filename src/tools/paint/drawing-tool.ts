import { CommandType, TerrainType, ToolType } from '../../core/model/types';
import type { MacroCoord, MicroCoord } from '../../core/model/types';
import { showToast } from '../../core/runtime/toast-bus';
import { line4, expandLine, dragShapeCells, dragShapeSpans, snapShapeEnd, splineCells } from './shapes';
import { getCell, cellKey } from '../../core/model/grid-model';
import { ELEVATION_MAX } from '../../core/model/constants';
import type { Command, Corners, TerrainCell } from '../../core/model/types';
import type { RowSpan } from '../../canvas/map2d/layers/ghost-geometry';
import type { Tool, ToolContext } from '../runtime/types';
import type { CursorId } from '../../core/runtime/cursor-spec';
import { placeTileCell, strippableRefusal } from './tile-coating';
import type { ContentType } from './paint-plan';
import type { PreviewCell, PreviewIcon } from '../../core/runtime/preview-cell';
import { planPaint, buildFloor, autoStackTarget, waterLayerAt } from './paint-plan';
import { soleLegalWaterLayer } from './water-layers';
import {
  previewAutoTrim, shapeOfCells, shapeOfSpans, type GhostShape, type TrimmedCell,
} from '../edge-cut/trim-preview';
import { previewRoadTrim } from '../edge-cut/road-trim-preview';
import { applyAutoEdgeCut } from '../edge-cut/auto-edge-cut';
import { reconcileCuts } from '../../core/edge-cut/cut-reconcile';
import { isConstrainHeld } from '../../core/runtime/modifier-state';
import { objectPlacementCommand, removeObjectCommand } from '../objects/object-placer';
import { getCatalogItem } from '../../state/catalog';
import { roadLookup } from '../../state/object-index';
import {
  beginCurveSession, endCurveSession, isCurveSessionOpen, resetCurveAnchors,
} from './curve-session';
import type { CurveAnchor } from './shapes';
import type { PlacedObject, ValidationError } from '../../core/model/types';

export type DrawingMode = 'brush' | 'line' | 'curve' | 'rect' | 'circle';

/** What a curve cell held before the curve reached it: the WHOLE terrain, so a hand-cut corner
 *  beside the path comes back as it was. Null = the cell was bare ground. */
type CellBaseline = {
  type: TerrainType; elevation: number; corners?: Corners; patchOnly?: boolean; patchBase?: number;
} | null;

/** Same cell, to the last corner? Governs whether a restore touches it at all. */
function sameTerrain(a: TerrainCell | null, b: CellBaseline): boolean {
  if (!a || !b) return !a && !b;
  if (a.type !== b.type || a.elevation !== b.elevation || !!a.patchOnly !== !!b.patchOnly) return false;
  if (a.patchBase !== b.patchBase) return false;
  const ac = a.corners, bc = b.corners;
  if (!ac || !bc) return !ac && !bc;
  return ac.every((v, i) => v === bc[i]);
}

/** Two cell lists as one, deduped — the stroke and what its trim pass reached past it. */
function mergeCells(a: readonly MacroCoord[], b: readonly MacroCoord[]): MacroCoord[] {
  const seen = new Set(a.map((c) => cellKey(c.x, c.y)));
  const out = [...a];
  for (const c of b) {
    const k = cellKey(c.x, c.y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** The cell itself plus its 8 neighbours — the reach of the auto-trim pass (`withBorder`). */
const BASELINE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Two clicks on one cell inside this window finish the curve. */
const CURVE_DOUBLE_CLICK_MS = 400;
export type { ContentType } from './paint-plan';

/** The probe asks as if the stroke had not started: a hover is not part of anyone's stroke. */
const FRESH_STROKE: ReadonlySet<string> = new Set<string>();

/** The glyph the preview card carries for each surface these brushes lay. A road/tile is the GROUND
 *  glyph: the design draws one plot-of-land mark for everything laid flat on the ground. */
const CONTENT_ICON: Record<ContentType, PreviewIcon> = {
  mountain: 'mountain',
  water: 'water',
  tile: 'ground',
};


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
  terrainGrid(): boolean { return this.contentType !== 'tile'; }

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
    const plan = planPaint([coord], ctx, this.contentType, FRESH_STROKE);
    const first = plan.commands[0];
    if (!first) return !plan.refused;
    const errors = ctx.validateCommand(first);
    if (errors.length === 0) return true;
    // A tile click STRIPS the coating it covers before placing (placeTileCell), so a refusal
    // that is only the strippable coating's overlap is what the click makes legal — the probe
    // must answer the click's question, not the raw command's.
    return this.contentType === 'tile' && strippableRefusal(ctx.gridState, coord, errors);
  }

  /**
   * The five shape modes and the surface being painted, both written DIRECTLY by the canvas when
   * the Build panel changes (there is no setter call to hook). They are accessors so that either
   * change can put the curve's adjust handles away: a tweak repaints through the tool's CURRENT
   * settings, so handles left over from a curve drawn in another mode would re-lay it as something
   * else — and handles for a curve you have stopped editing are clutter in any case.
   */
  private modeValue: DrawingMode = 'brush';
  private contentValue: ContentType = 'mountain';

  get mode(): DrawingMode { return this.modeValue; }
  set mode(next: DrawingMode) {
    if (next === this.modeValue) return;
    this.modeValue = next;
    if (isCurveSessionOpen()) endCurveSession();
  }

  get contentType(): ContentType { return this.contentValue; }
  set contentType(next: ContentType) {
    if (next === this.contentValue) return;
    this.contentValue = next;
    if (isCurveSessionOpen()) endCurveSession();
  }

  private painting = false;
  private lastCoord: MacroCoord | null = null;
  private strokeStartUndoSize = 0;
  /* ── curve: a chain of anchors the path runs THROUGH ──────────────────────
   * Click to drop one, drag a placed one to move it, double-click to finish. See `splinePath` for
   * why the path interpolates its anchors rather than being pulled toward control points. */
  private curvePoints: CurveAnchor[] = [];
  /* ── the ADJUST phase's bookkeeping ───────────────────────────────────────
   * What each cell held BEFORE the curve first touched it, and which coatings the curve removed or
   * added — everything `repaintCurve` puts back before laying the curve again. */
  private curveBaseline = new Map<string, CellBaseline>();
  /** Whether this stroke has been trimmed as it was drawn (freehand only) — see `squareCorners`. */
  private liveTrimmed = false;
  private curveRemovedCoatings: PlacedObject[] = [];
  private curveAddedCoatings = new Set<string>();
  /** The frozen context the curve was painted with: a shallow copy, so brush size and elevation
   *  stay what they were while the grid and the command closures stay live. */
  private curveCtx: ToolContext | null = null;
  /** The anchors the MAP currently reflects. Not the session's — those are already the new ones by
   *  the time a repaint is asked for, so a refusal has nothing to go back to without this. */
  private curveAnchors: CurveAnchor[] = [];
  /** Index of the anchor the press landed on, and whether it has actually moved. A press on an
   *  anchor is only a DRAG once it travels — until then it is still a click, and which one it is
   *  cannot be known until the release. */
  private dragAnchor: number | null = null;
  private dragMoved = false;
  /** The last curve CLICK (a press that did not turn into a drag), for the double-click test. */
  private lastClick: { coord: MacroCoord; at: number } | null = null;
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
    // A click anywhere on the map puts the adjust handles away — a press ON one never reaches the
    // tool, since they are React elements above the canvas. In curve mode that is ALL the click
    // does: dismissing is its own act, not the first anchor of the next curve. The same check
    // catches a mode switch, which PixiCanvas performs by writing `mode` directly.
    if (isCurveSessionOpen()) {
      endCurveSession();
      if (this.mode === 'curve') return;
    }
    this.strokeStartUndoSize = ctx.getUndoStackSize();
    // Start a fresh per-stroke cell record (used for road reconcile + auto
    // edge-trim). Curve collects 3 clicks into one stroke, so only reset on its
    // FIRST point — otherwise each click would wipe the record.
    if (this.mode !== 'curve' || this.curvePoints.length === 0) {
      this.strokeCells.clear();
      this.tileStrokeCells.clear();
      this.liveTrimmed = false;
    }

    switch (this.mode) {
      case 'brush': {
        this.painting = true;
        this.lastCoord = coord;
        this.updateDisplay(coord, ctx);
        const dab = brushCells(coord.x, coord.y, ctx.brushSize);
        this.paintCells(dab, ctx);
        this.liveTrim(dab, ctx);
        break;
      }

      case 'line':
      case 'rect':
      case 'circle':
        this.shapeOrigin = coord;
        break;

      case 'curve': {
        // A press on an existing anchor is either a drag or a click on it, and which one is not
        // knowable yet — decided on release (see onPointerUp). Either way it must NOT stack a
        // second anchor on the same cell.
        const hit = this.curvePoints.findIndex((a) => a.x === coord.x && a.y === coord.y);
        if (hit >= 0) {
          this.dragAnchor = hit;
          this.dragMoved = false;
          break;
        }
        this.curvePoints.push(coord);
        this.previewCurve(coord, ctx);
        break;
      }
    }
  }

  onPointerMove(coord: MacroCoord, _micro: MicroCoord, ctx: ToolContext): void {
    // Terrain renders on the micro-grid (−HALF_TILE); tiles are macro-grid
    // objects with no offset. The ghost must use the matching grid so the
    // preview lands exactly where the surface will be painted.
    const terrainGrid = this.contentType !== 'tile';

    switch (this.mode) {
      case 'brush': {
        this.ghost(brushCells(coord.x, coord.y, ctx.brushSize), ctx, coord);
        if (this.painting && (coord.x !== this.lastCoord?.x || coord.y !== this.lastCoord?.y)) {
          const from = this.lastCoord;
          this.lastCoord = coord;
          this.updateDisplay(coord, ctx);
          // Fill the WHOLE path between the last sample and this one with a 4-connected line, so a fast drag
          // (sparse pointer samples) stays an edge-connected band — no skipped cells, no diagonal-only links.
          const path = from ? line4(from.x, from.y, coord.x, coord.y) : [coord];
          const dab = expandLine(path, ctx.brushSize);
          this.paintCells(dab, ctx);
          this.liveTrim(dab, ctx);
        }
        break;
      }

      case 'line':
        if (this.shapeOrigin) {
          const end = isConstrainHeld() ? snapShapeEnd(this.shapeOrigin, coord, 'line') : coord;
          this.ghost(dragShapeCells('line', this.shapeOrigin, end, ctx.brushSize), ctx, end);
        } else {
          // Pre-click hover: preview the brush footprint so its size is visible
          // before the line is started (rather than a single cell).
          this.ghost(brushCells(coord.x, coord.y, ctx.brushSize), ctx, coord);
        }
        break;

      case 'curve':
        if (this.dragAnchor !== null) {
          // Editing a placed anchor: the ghost has to show the path the MOVED anchor produces, or
          // the drag is blind — the whole point of being able to adjust one.
          const anchor = this.curvePoints[this.dragAnchor]!;
          if (anchor.x !== coord.x || anchor.y !== coord.y) this.dragMoved = true;
          this.curvePoints[this.dragAnchor] = coord;
          this.ghost(splineCells(this.curvePoints, ctx.brushSize), ctx, coord);
        } else if (this.curvePoints.length > 0) {
          this.previewCurve(coord, ctx);
        } else {
          // Pre-click hover: preview the brush footprint so its size is visible.
          this.ghost(brushCells(coord.x, coord.y, ctx.brushSize), ctx, coord);
        }
        break;

      case 'rect':
      case 'circle':
        if (this.shapeOrigin) {
          // Span-native preview: a map-size drag never expands to its cell list
          // (the commit on pointer-up builds the cells once).
          const end = isConstrainHeld() ? snapShapeEnd(this.shapeOrigin, coord, this.mode) : coord;
          const spans = dragShapeSpans(this.mode, this.shapeOrigin, end);
          ctx.overlay.showGhostSpans(spans, this.card(end, ctx), terrainGrid, this.trimOfSpans(spans, ctx));
        } else {
          this.ghost([coord], ctx, coord);
        }
        break;
    }
  }

  /** The live curve, previewed through the anchors placed so far plus wherever the cursor is. */
  private previewCurve(cursor: MacroCoord, ctx: ToolContext): void {
    this.ghost(splineCells([...this.curvePoints, cursor], ctx.brushSize), ctx, cursor);
  }

  /** Paint the finished curve, then open the ADJUST phase on it. */
  private commitCurve(ctx: ToolContext, at: MacroCoord): void {
    const anchors = this.curvePoints;
    // Frozen: brush size and elevation must stay what the curve was drawn with, while the grid and
    // the command closures stay live. A shallow copy is exactly that split.
    this.curveCtx = { ...ctx };
    this.curveBaseline.clear();
    this.curveRemovedCoatings = [];
    this.curveAddedCoatings.clear();
    // strokeStartUndoSize was captured at the top of this onPointerDown; no command runs between
    // the curve's clicks, so it already marks the stroke start.
    this.layCurve(anchors, this.curveCtx);
    this.curveAnchors = anchors.map((a) => ({ ...a }));
    this.curvePoints = [];
    this.dragAnchor = null;
    this.lastClick = null;
    ctx.overlay.clearGhost();
    this.finishStroke(this.curveCtx, at);

    // The anchors stay on the map so the curve can be tuned. They are NOT shown while it is being
    // drawn: what matters then is the path, and a handle under the cursor would be in the way of
    // the next click.
    if (anchors.length >= 2) {
      beginCurveSession(anchors, { width: this.curveCtx.brushSize, terrainGrid: this.contentType !== 'tile' }, {
        preview: (next) => this.previewAdjust(next),
        repaint: (next) => this.repaintCurve(next),
        finalize: () => {
          this.curveCtx?.overlay.clearGhost();
          this.curveCtx = null;
          this.curveBaseline.clear();
        },
      });
    }
  }

  /**
   * Record what a cell holds now, the first time the curve reaches it — the path AND its 8-neighbour
   * border.
   *
   * The border is not padding. Auto-trim sweeps the stroke plus that border (`withBorder`) and can
   * MATERIALISE a Γ patch on a cell that was empty. A patch is a real cell that reads as standable
   * surface, so one left behind by a tweak is a block nobody placed: they pile up as the curve is
   * dragged around, and they make the base-support rule refuse perfectly good ground next to them.
   *
   * The whole terrain is recorded, corners included, so a hand-cut edge beside the curve comes back
   * as it was rather than squared off.
   */
  private captureBaseline(cells: readonly MacroCoord[], ctx: ToolContext): void {
    for (const c of cells) {
      for (const [dx, dy] of BASELINE_OFFSETS) {
        const x = c.x + dx, y = c.y + dy;
        const key = cellKey(x, y);
        if (this.curveBaseline.has(key)) continue;
        const t = getCell(ctx.gridState.cells, x, y)?.terrain ?? null;
        this.curveBaseline.set(key, t ? {
          type: t.type, elevation: t.elevation,
          corners: t.corners ? ([...t.corners] as Corners) : undefined,
          patchOnly: t.patchOnly, patchBase: t.patchBase,
        } : null);
      }
    }
  }

  /** Every surfaceCoating object on the map right now, by id — the before/after of a tile paint. */
  private coatingSnapshot(ctx: ToolContext): Map<string, PlacedObject> {
    const out = new Map<string, PlacedObject>();
    for (const obj of ctx.gridState.objects.values()) {
      if (getCatalogItem(obj.catalogId)?.traits.some((t) => t.type === 'surfaceCoating')) out.set(obj.id, obj);
    }
    return out;
  }

  /** Paint the curve at these anchors, recording what it displaced so a later tweak can undo it. */
  private layCurve(anchors: readonly CurveAnchor[], ctx: ToolContext): void {
    const cells = splineCells(anchors, ctx.brushSize);
    this.captureBaseline(cells, ctx);
    const before = this.contentType === 'tile' ? this.coatingSnapshot(ctx) : null;
    this.paintCells(cells, ctx);
    if (before) {
      const after = this.coatingSnapshot(ctx);
      for (const [id, obj] of before) if (!after.has(id)) this.curveRemovedCoatings.push(obj);
      for (const id of after.keys()) if (!before.has(id)) this.curveAddedCoatings.add(id);
    }
  }

  /**
   * Run a command, and where allowed, retry it cell by cell if it is refused.
   *
   * A batch is refused WHOLE if any one of its cells is: the plan groups a shape into one command
   * per target elevation, so a figure that so much as clips the sea, the plaza or a locked layer
   * would otherwise paint nothing at all. The retry only ever runs on the rejection path, so an
   * ordinary stroke still costs one command.
   */
  private execute(ctx: ToolContext, cmd: Command, splitOnRefusal: boolean): void {
    if (ctx.executeCommand(cmd).success || !splitOnRefusal) return;
    if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
      for (const c of cmd.cells) ctx.executeCommand({ ...cmd, cells: [c] });
    }
  }

  /**
   * Did the curve actually reach the map?
   *
   * Not "did the undo stack grow": a paint whose cells are ALL off-map passes validation (the zone
   * rule skips out-of-bounds rather than erroring) and records an entry that changed nothing. What
   * matters is whether anything is there afterwards.
   */
  private curveLaidAnything(cells: readonly MacroCoord[], ctx: ToolContext): boolean {
    if (this.contentType === 'tile') return this.tileStrokeCells.size > 0;
    return cells.some((c) => getCell(ctx.gridState.cells, c.x, c.y)?.terrain != null);
  }

  /**
   * The terrain commands that put the curve's cells back to what they held before it — the same
   * list `restoreBaseline` executes, and what the adjust ghost has to run FIRST: the map still
   * holds the previous curve, so a preview taken against it reads corners pinned by mass the tweak
   * is about to remove.
   *
   * Only cells that ACTUALLY CHANGED are included. Most of the border never does, and repainting an
   * untouched neighbour would square a cut the user made by hand.
   */
  private baselineCommands(ctx: ToolContext): Command[] {
    const erase: MacroCoord[] = [];
    const paint = new Map<string, { type: TerrainType; elevation: number; cells: MacroCoord[] }>();
    const recut: { x: number; y: number; base: CellBaseline }[] = [];
    for (const [key, base] of this.curveBaseline) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const now = getCell(ctx.gridState.cells, x, y)?.terrain ?? null;
      if (sameTerrain(now, base)) continue;
      // A Γ patch is a fillet, not a block: it is cleared and then MATERIALISED again below, never
      // painted as a real column.
      if (!base || base.patchOnly) { erase.push({ x, y }); }
      else {
        const k = `${base.type}:${base.elevation}`;
        const group = paint.get(k) ?? { type: base.type, elevation: base.elevation, cells: [] };
        group.cells.push({ x, y });
        paint.set(k, group);
      }
      if (base && (base.corners || base.patchOnly)) recut.push({ x, y, base });
    }
    const out: Command[] = [];
    if (erase.length > 0) out.push({ type: CommandType.EraseTerrain, timestamp: Date.now(), cells: erase });
    for (const g of paint.values()) {
      out.push({
        type: CommandType.PaintTerrain, timestamp: Date.now(),
        cells: g.cells, terrainType: g.type, elevation: g.elevation,
      });
    }
    // Corners and Γ patches last, on the cells that had them: a paint writes a fresh square cell, so
    // the silhouette has to be put back on top of it.
    for (const { x, y, base } of recut) {
      if (!base?.corners && !base?.patchOnly) continue;
      out.push({
        type: CommandType.TrimCorners, timestamp: Date.now(), x, y, layer: 'terrain',
        beforeCorners: getCell(ctx.gridState.cells, x, y)?.terrain?.corners,
        afterCorners: (base.corners ?? ['square', 'square', 'square', 'square']) as Corners,
        patchOnly: base.patchOnly,
        ...(base.patchOnly
          ? { terrainType: base.type, elevation: base.elevation, patchBase: base.patchBase }
          : {}),
      });
    }
    return out;
  }

  /** Put the map back to how it was before the curve, ready for it to be laid again. */
  private restoreBaseline(ctx: ToolContext): void {
    // Coatings first: the curve's own tiles come off, and whatever it displaced goes back.
    for (const id of this.curveAddedCoatings) {
      const obj = ctx.gridState.objects.get(id);
      if (obj) ctx.executeCommand(removeObjectCommand(obj));
    }
    this.curveAddedCoatings.clear();
    for (const obj of this.curveRemovedCoatings) {
      if (!ctx.gridState.objects.has(obj.id)) ctx.executeCommand(objectPlacementCommand(obj));
    }
    this.curveRemovedCoatings = [];

    // Split on refusal, always: the baseline covers every cell the curve ASKED for, forbidden ones
    // included, and one of those in a batch would refuse the whole restore — leaving the old curve
    // standing while the new one is laid over it. A corner command carries one cell, so it never
    // needs splitting.
    for (const cmd of this.baselineCommands(ctx)) {
      this.execute(ctx, cmd, cmd.type !== CommandType.TrimCorners);
    }
  }

  /** Mid-drag: the path the curve would take, as a ghost. The map is not touched until release. */
  private previewAdjust(anchors: readonly CurveAnchor[]): void {
    const ctx = this.curveCtx;
    if (!ctx) return;
    this.ghost(splineCells(anchors, ctx.brushSize), ctx, undefined, this.baselineCommands(ctx));
  }

  /**
   * One tweak: put the map back and lay the curve again at the new anchors, as ONE undo entry.
   *
   * Restore-then-relay rather than patching the difference, because the two are not the same
   * picture: a mountain curve STACKS on what is under it, so painting over the old path would raise
   * it twice, and a cell the old path covered has to go back to what it held before the curve — not
   * to bare ground. The whole thing is one stroke group, so Ctrl+Z steps back one tweak at a time.
   */
  private repaintCurve(anchors: readonly CurveAnchor[]): void {
    const ctx = this.curveCtx;
    if (!ctx) return;
    const start = ctx.getUndoStackSize();
    // Everything needed to put the tweak back if the rules refuse it: where the anchors were, and
    // the bookkeeping that says what the curve currently displaces.
    const prev = {
      anchors: this.curveAnchors,
      baseline: new Map(this.curveBaseline),
      removed: [...this.curveRemovedCoatings],
      added: new Set(this.curveAddedCoatings),
    };
    this.strokeStartUndoSize = start;
    this.strokeCells.clear();
    this.tileStrokeCells.clear();
    this.liveTrimmed = false;
    this.restoreBaseline(ctx);
    this.layCurve(anchors, ctx);
    // A curve dragged off the map, or onto sea or plaza, has every command refused or ignored — no
    // post-stroke violation to report, just a stroke that removed the old curve and laid no new one.
    const laidSomething = this.curveLaidAnything(splineCells(anchors, ctx.brushSize), ctx);
    ctx.overlay.clearGhost();   // the map now shows what the ghost was promising
    const violations = this.finishStroke(ctx, anchors[anchors.length - 1]);
    if (violations.length === 0 && laidSomething) {
      this.curveAnchors = anchors.map((a) => ({ ...a }));
      return;
    }

    // Refused, one way or the other. Post-stroke, `commitStroke` stops reverting as soon as the
    // state is LEGAL, which for a stroke that restores and then re-lays can leave the restore
    // standing and the new curve gone; pre-command, nothing was laid at all. Either way the map has
    // lost the curve while the handles still show the shape that was asked for, so the whole tweak
    // is rolled back exactly and the anchors go back with it: the handles must never describe a
    // curve the map does not have.
    ctx.rollbackTo(start);
    this.curveBaseline = prev.baseline;
    this.curveRemovedCoatings = prev.removed;
    this.curveAddedCoatings = prev.added;
    resetCurveAnchors(prev.anchors);
  }

  /** Take back the last anchor (Delete/Backspace while drawing). */
  undoPendingStep(ctx: ToolContext): boolean {
    if (this.mode !== 'curve' || this.curvePoints.length === 0) return false;
    this.curvePoints.pop();
    this.dragAnchor = null;
    if (this.curvePoints.length === 0) ctx.overlay.clearGhost();
    else this.ghost(splineCells(this.curvePoints, ctx.brushSize), ctx);
    return true;
  }

  /**
   * Escape. While DRAWING that abandons the curve, which has painted nothing; during the ADJUST
   * phase it only puts the handles away, exactly as clicking off the curve does — the curve is real
   * terrain by then, and Escape is not an undo.
   */
  cancelPending(ctx: ToolContext): boolean {
    if (this.mode === 'curve' && this.curvePoints.length > 0) {
      this.curvePoints = [];
      this.dragAnchor = null;
      this.lastClick = null;
      ctx.overlay.clearGhost();
      return true;
    }
    if (isCurveSessionOpen()) { endCurveSession(); return true; }
    return false;
  }

  /** Whether a chain of anchors is standing, for a nav tap to put it down. The DRAWING phase only:
   *  the adjust handles stand over real terrain, and a tap that ended them would be answering a
   *  gesture that is already over. */
  hasPending(): boolean {
    return this.mode === 'curve' && this.curvePoints.length > 0;
  }

  /** Shared commit path for the three drag shapes (pointer-up). */
  private commitShape(mode: 'line' | 'rect' | 'circle', coord: MacroCoord, ctx: ToolContext): void {
    if (!this.shapeOrigin) return;
    this.strokeStartUndoSize = ctx.getUndoStackSize();
    const end = isConstrainHeld() ? snapShapeEnd(this.shapeOrigin, coord, mode) : coord;
    this.paintCells(dragShapeCells(mode, this.shapeOrigin, end, ctx.brushSize), ctx);
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

      case 'curve': {
        const first = this.curvePoints[0];
        if (this.curvePoints.length === 1 && first && (first.x !== coord.x || first.y !== coord.y)) {
          this.curvePoints.push(coord);
          this.lastClick = null;
          this.previewCurve(coord, ctx);
          break;
        }
        if (this.dragAnchor !== null) {
          const moved = this.dragMoved;
          this.dragAnchor = null;
          if (moved) {
            // A drag is not a click: it must not count toward the double-click that finishes.
            this.lastClick = null;
            this.previewCurve(coord, ctx);
            break;
          }
        }
        // A press that did not travel is a CLICK, and it is the RELEASE that says so — recording it
        // on the press would let one click's own release read it as the second of a pair. Two
        // clicks on one cell finish the curve, whether the second landed on empty ground or on the
        // anchor the first one dropped there.
        const prev = this.lastClick;
        if (prev && performance.now() - prev.at <= CURVE_DOUBLE_CLICK_MS
            && prev.coord.x === coord.x && prev.coord.y === coord.y
            && this.curvePoints.length >= 2) {
          this.commitCurve(ctx, coord);
          break;
        }
        this.lastClick = { coord, at: performance.now() };
        this.previewCurve(coord, ctx);
        break;
      }

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
    // A SHAPE is one deliberate figure, so it lays the part of itself that is legal. The freehand
    // MOUNTAIN brush keeps its footprint atomic: its cells hold each other up (the ladder), so a
    // dab is a single mark. Water neither stacks nor supports anything, so a dab lays the cells
    // that can hold it and skips the ones the rules refuse.
    const splitOnRefusal = this.mode !== 'brush' || this.contentType === 'water';
    for (const cmd of plan.commands) this.execute(ctx, cmd, splitOnRefusal);
  }

  /** Put the stroke's own cells back to square, so the final pass derives their shape from the
   *  finished mass rather than from what the drag happened to round on its way through. */
  private squareCorners(cells: readonly MacroCoord[], ctx: ToolContext): void {
    for (const { x, y } of cells) {
      const t = getCell(ctx.gridState.cells, x, y)?.terrain;
      // A Γ patch IS its corners — squaring one leaves a cell that is a patch of nothing. Only a
      // real block's silhouette is the stroke's to re-derive; the trim pass owns the patches.
      if (t?.patchOnly) continue;
      const corners = t?.corners;
      if (!corners || corners.every((c) => c === 'square')) continue;
      ctx.executeCommand({
        type: CommandType.TrimCorners, timestamp: Date.now(), x, y, layer: 'terrain',
        beforeCorners: corners, afterCorners: ['square', 'square', 'square', 'square'],
      });
    }
  }

  /** Put the stroke's own road tiles back to square, the road twin of `squareCorners`. A road's cut
   *  is derived from which sides it connects on, so a tile the drag has since paved past is no
   *  longer the end-cap it was trimmed as. `cutRoads` keeps the cuts it finds, so nothing else would
   *  ever take that end-cap back off. */
  private squareRoads(cells: readonly MacroCoord[], ctx: ToolContext): void {
    const roads = roadLookup(ctx.gridState);
    for (const { x, y } of cells) {
      const road = roads(x, y);
      if (!road?.corners || road.corners.every((c) => c === 'square')) continue;
      ctx.executeCommand({
        type: CommandType.TrimCorners, timestamp: Date.now(), x, y, layer: 'road', objectId: road.id,
        beforeCorners: [...road.corners] as Corners,
        afterCorners: ['square', 'square', 'square', 'square'],
      });
    }
  }

  /** The dab plus the ring around it, and only cells THIS STROKE laid: the next dab lands against
   *  the last one, so a shape derived a moment ago is derived from a different neighbourhood now. */
  private strokeWindow(cells: readonly MacroCoord[], laid: ReadonlySet<string>): MacroCoord[] {
    const window: MacroCoord[] = [];
    const seen = new Set<string>();
    for (const c of cells) {
      for (const [dx, dy] of BASELINE_OFFSETS) {
        const x = c.x + dx, y = c.y + dy, k = cellKey(x, y);
        if (seen.has(k) || !laid.has(k)) continue;
        seen.add(k);
        window.push({ x, y });
      }
    }
    return window;
  }

  /**
   * Trim what a freehand dab just laid, while the drag is still going.
   *
   * The other modes have a ghost to promise the finished shape with; the brush paints as it moves,
   * so without this the stroke reads square under the cursor and only rounds when the button comes
   * up. The stroke-end pass still runs and is still what decides the final shape — it squares the
   * stroke's own cells first (see `finishStroke`), so a corner rounded here and then built against
   * later is re-derived rather than left as it was.
   */
  private liveTrim(cells: MacroCoord[], ctx: ToolContext): void {
    const mode = ctx.autoEdgeCut;
    if (mode === 'off') return;
    this.liveTrimmed = true;

    // A ROAD is a coating on an object rather than a terrain cell, so there are no corners to
    // reconcile and no Γ notch to fill: the trim pass reads the tile's connectivity and picks a
    // canonical state. The squaring is the same obligation as terrain's — the trim keeps the cuts
    // it finds, so an end-cap the drag has since paved past would stay cut in the middle of the road.
    if (this.contentType === 'tile') {
      const window = this.strokeWindow(cells, this.tileStrokeCells);
      this.squareRoads(window, ctx);
      applyAutoEdgeCut(ctx, mode, [], window);
      return;
    }

    const window = this.strokeWindow(cells, this.strokeCells);
    // The same three steps the commit runs, on the window instead of the stroke: repair the cuts the
    // dab invalidated, put the stroke's own corners back to square, derive the shape again. The trim
    // keeps the corners it finds — which is what preserves a hand cut beside a stroke — so without
    // the squaring the drag leaves rounded notches through the middle of its own band; without the
    // repair, a Γ patch made while a cell was still a notch survives the stroke closing around it
    // and the drag ends up a cell richer than the same mass painted in one go.
    reconcileCuts(window, ctx.gridState, { execute: ctx.executeCommand, roadAt: roadLookup(ctx.gridState) });
    this.squareCorners(window, ctx);
    applyAutoEdgeCut(ctx, mode, window, []);
  }

  /**
   * Draw the ghost, in the shape the stroke will actually leave.
   *
   * With auto-trim on, the committed shape has cut corners and can gain Γ patches in its notches
   * (a road stroke, cut end-caps and bends), so a square ghost promises something the click does
   * not produce. The preview runs the real trim pass — see `trimOfShape`.
   */
  private ghost(cells: MacroCoord[], ctx: ToolContext, at?: MacroCoord, before: Command[] = []): void {
    ctx.overlay.showGhost(cells, this.card(at ?? cells[0], ctx), this.contentType !== 'tile',
      this.trimOf(cells, ctx, before));
  }

  /** The preview card this stroke shows: the glyph of the surface being laid, in the state the
   *  probed cell answers with — the same `canActAt` question the cursor's refusal badge asks, so a
   *  red card and a badged cursor can never disagree. */
  private card(at: MacroCoord | undefined, ctx: ToolContext): PreviewCell {
    return {
      icon: CONTENT_ICON[this.contentType],
      valid: !at || this.canActAt(at, ctx),
    };
  }

  /** The same preview for a span-form ghost (rect / circle), which never builds its own cell list:
   *  only the rim of a shape can be trimmed, and that is derivable from the spans directly. */
  private trimOfSpans(spans: readonly RowSpan[], ctx: ToolContext): TrimmedCell[] | undefined {
    if (spans.length === 0) return undefined;
    return this.trimOfShape(shapeOfSpans(spans), ctx, []);
  }

  /** `before` runs on the scratch ahead of the paint — the curve's baseline restore, so an adjust
   *  ghost is not shaped by the curve it is replacing. */
  private trimOf(cells: MacroCoord[], ctx: ToolContext, before: Command[]): TrimmedCell[] | undefined {
    if (cells.length === 0) return undefined;
    return this.trimOfShape(shapeOfCells(cells), ctx, before);
  }

  /**
   * ONE trim payload for the ghost, whichever surface is being laid.
   *
   * Terrain runs the trim pass over a scratch copy of the CELLS; a road is an object, so its
   * preview shadows the coating LOOKUP instead (`previewRoadTrim`). Both run the real
   * `applyAutoEdgeCut` and both come back as `TrimmedCell`s, so a view is handed one payload and
   * the two never drift into two ghosts.
   */
  private trimOfShape(shape: GhostShape, ctx: ToolContext, before: Command[]): TrimmedCell[] | undefined {
    const mode = ctx.autoEdgeCut;
    if (mode === 'off') return undefined;
    if (this.contentType === 'tile') {
      return previewRoadTrim(ctx.gridState, mode, shape, ctx.rules,
        (cells) => planPaint(cells, ctx, 'tile', FRESH_STROKE).commands, this.tileStrokeCells);
    }
    return previewAutoTrim(ctx.gridState, mode, shape, ctx.rules,
      (paint, on) => planPaint(paint, { ...ctx, gridState: on }, this.contentType, FRESH_STROKE).commands,
      before)
      // The trim also reshapes the corners of terrain the stroke lands against. That is a change to
      // the map, not to the shape being placed, and drawing it puts a ghost over ground that is
      // already there. A Γ patch is kept: the stroke's shape genuinely grows into that cell.
      .filter((t) => t.patch || shape.contains(t.x, t.y));
  }

  /** Parse a "x,y" stroke-cell set into MacroCoord[]. */
  private cellsFromSet(set: Set<string>): MacroCoord[] {
    return [...set].map((k) => {
      const [sx, sy] = k.split(',');
      return { x: Number(sx), y: Number(sy) };
    });
  }

  /**
   * What a refused stroke says. The rule's own reason, except where the map leaves the water exactly
   * ONE layer it would stand at: then the refusal names that layer instead, which is the fix the
   * user would otherwise find by trying every layer in turn (a stale armed layer is what puts them
   * there in the first place). Asked of the map as it stands AFTER the revert, since that is the
   * ground the next attempt will be laid on.
   */
  private refusalMessage(ctx: ToolContext, first: ValidationError): string {
    if (this.contentType === 'water') {
      const layer = soleLegalWaterLayer(this.cellsFromSet(this.strokeCells), ctx.gridState, ctx.rules);
      if (layer !== null) return ctx.t('error.water_only_layer', { layer });
    }
    return ctx.t(first.message);
  }

  /** Returns the post-stroke violations, so a caller that must be all-or-nothing can act on them.
   *  Roads riding or refusing the stroke's terrain change are commitStroke's own reconcile pass. */
  private finishStroke(ctx: ToolContext, focus?: MacroCoord): ValidationError[] {
    const violations = ctx.commitStroke(this.strokeStartUndoSize);
    if (violations.length > 0) {
      showToast(this.refusalMessage(ctx, violations[0]!), 'warning');
    }

    const isTile = this.contentType === 'tile';
    const committed = ctx.getUndoStackSize() > this.strokeStartUndoSize;

    // Auto edge-trim (post-validation): trim the corners the stroke just exposed
    // on whatever cells survived. The toggle lives in the Build panel.
    // ATOMIC UNDO: the trim/fill commands fold into the last block entry of the
    // stroke, so undo steps are block creations only — never a bare "the shape squared up" step.
    const autoMode = ctx.autoEdgeCut;
    let trimmed: MacroCoord[] = [];
    if (autoMode !== 'off') {
      const trimStart = ctx.getUndoStackSize();
      // A shape the drag cut early can be built against later in the same drag, and the trim pass
      // keeps the shapes it finds (that is what preserves a hand cut beside the stroke). So the
      // stroke's OWN cells go back to square first and the shape is derived once, from what the
      // stroke actually ended with. Only they are squared: a neighbour's cut is not ours.
      if (isTile) {
        const cells = this.cellsFromSet(this.tileStrokeCells);
        if (this.liveTrimmed) this.squareRoads(cells, ctx);
        trimmed = applyAutoEdgeCut(ctx, autoMode, [], cells);
      } else {
        const cells = this.cellsFromSet(this.strokeCells);
        if (this.liveTrimmed) this.squareCorners(cells, ctx);
        trimmed = applyAutoEdgeCut(ctx, autoMode, cells, []);
      }
      if (ctx.getUndoStackSize() > trimStart) {
        ctx.collapseHistory(Math.max(this.strokeStartUndoSize, trimStart - 1));
      }
    }

    // Acknowledge a successful terrain/tile commit with one regional flash over the painted cells
    // (a rejected stroke gets the toast above). Only the discrete shape tools (line/curve/rect/
    // circle) flash — a freehand brush commits continuously, so a per-stroke flash there is just
    // noise. Gate on the stroke actually committing: a fully-rejected stroke (locked layer /
    // illegal cells) pushes nothing, so the undo stack never grows.
    //
    // AFTER the trim, not before: the flash reads each cell's shape off the map, so running it
    // first would announce square blocks where the stroke left rounded ones — and the trim's OWN
    // cells join the flash, since the sweep reaches a cell outside the stroke (a block it left
    // newly convex, a notch it closed) and a commit that changed one has to acknowledge it.
    if (violations.length === 0 && committed && this.mode !== 'brush') {
      const painted = mergeCells(this.cellsFromSet(isTile ? this.tileStrokeCells : this.strokeCells), trimmed);
      if (painted.length > 0) {
        ctx.overlay.flashCommit(painted, { terrainMode: !isTile });
      }
    }

    this.syncDisplayLayer(ctx, focus);
    return violations;
  }

  // Live layer-panel highlight while painting: the auto-stack target under the
  // cursor (mountain only). Non-mountain surfaces clear the override (panel
  // follows the selected layer). Reads the cell BEFORE it's painted this stroke.
  private updateDisplay(coord: MacroCoord, ctx: ToolContext): void {
    // Water reports where the dab is landing. A HIGHLIGHT, never the build floor: a layer the
    // ground chose must not become the layer the next stroke is pinned to.
    if (this.contentType === 'water') { ctx.setDisplayLayer(waterLayerAt(coord, ctx)); return; }
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
    // Water settles on the layer the cell the stroke ended over is holding, which is where the last
    // dab put its water. Left to the mountain branch below it would clear to the selected layer,
    // and an unpinned stroke's panel would report a floor it never painted at.
    if (this.contentType === 'water') {
      if (focus) ctx.setDisplayLayer(waterLayerAt(focus, ctx));
      return;
    }
    if (this.contentType !== 'mountain') { ctx.setDisplayLayer(null); return; }
    if (!focus || !this.strokeCells.has(cellKey(focus.x, focus.y))) return;
    const achieved = getCell(ctx.gridState.cells, focus.x, focus.y)?.terrain?.elevation ?? 0;
    if (achieved > 0) ctx.setDisplayLayer(Math.min(ELEVATION_MAX, achieved));
  }

  private reset(): void {
    if (isCurveSessionOpen()) endCurveSession();
    this.painting = false;
    this.lastCoord = null;
    this.curvePoints = [];
    this.dragAnchor = null;
    this.lastClick = null;
    this.shapeOrigin = null;
    this.strokeCells.clear();
    this.tileStrokeCells.clear();
    this.liveTrimmed = false;
  }
}

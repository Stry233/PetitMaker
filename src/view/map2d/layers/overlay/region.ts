import { cellEdges, dimensionDrawing } from '../../../../core/model/annotation/dimensions';
import { dimensionBody, type Restroke } from '../annotation-layer';
import { annotationLineCells } from '../../../shared/annotation/annotation-line';
import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE, gridOffsetPx } from '../../geometry/world';
import { hexStringToNumber } from '../../../../core/base/color';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import type { Rect } from '../../../../core/grid/rect';
import type { CellSet } from '../../../../core/grid/grids';
import { regionPulseFactor } from '../../../shared/overlay/region-pulse';
import { boundaryEdges } from '../../../../core/grid/cell-spans';
import { ROUTE_TINT } from '../../../shared/overlay/preview-cell';
import { FRAME_INK } from '../../../../assets/brand-palette';
import type { OverlayHost } from './host';
import { cellRect } from './paint';

/** Review marks: the least screen size of a cell, and the ink edge and yellow line widths, in screen px. */
const REVIEW_MIN_PX = 7;
const REVIEW_EDGE = 4;
const REVIEW_LINE = 2;

/** The buildable region with its dimensions and pulse, the maze route and the review marks. */
export class OverlayRegions {
  constructor(private readonly host: OverlayHost) {}

  readonly buildableGraphics = new PIXI.Graphics();
  private regionDimensions: PIXI.Container | null = null;
  /** The region dimensions' line graphic, which follows the zoom as annotation lines do. */
  private regionRestroke: Restroke[] = [];
  /** Holds the region's width and height dimensions. */
  readonly dimensionSlot = new PIXI.Container();
  readonly routeGraphics = new PIXI.Graphics();
  readonly reviewGraphics = new PIXI.Graphics();
  private review: { cells: CellSet; outline: Rect | null } | null = null;

  showBuildableRegion({ grid, cells }: CellSet, dimensionScale?: number): void {
    this.regionDimensions?.destroy({ children: true });
    this.regionDimensions = null;
    this.regionRestroke = [];
    const bounds = dimensionScale === undefined ? null : cellEdges(cells);
    if (bounds && dimensionScale !== undefined) {
      this.regionDimensions = dimensionBody(dimensionDrawing(bounds, dimensionScale), '#ffffff', {
        inkScale: dimensionScale, lineCells: annotationLineCells(this.host.viewZoom * TILE_SIZE), restroke: this.regionRestroke,
      });
      const at = gridOffsetPx(grid);
      this.regionDimensions.position.set(at.x, at.y);
      this.dimensionSlot.addChild(this.regionDimensions);
    }
    this.host.requestRender();
    if (this.host.disposed) return;
    this.buildableGraphics.clear();

    if (cells.length === 0) return;

    this.buildableGraphics.beginFill(0xffffff, 0.24);
    for (const { x, y } of cells) cellRect(this.buildableGraphics, x, y, grid);
    this.buildableGraphics.endFill();
    const shift = gridOffsetPx(grid);
    const edges = boundaryEdges(cells);
    for (const [width, color, alpha] of [[4, hexStringToNumber(FRAME_INK), 0.55], [1.75, 0xffffff, 0.95]] as const) {
      this.buildableGraphics.lineStyle(width, color, alpha);
      for (const edge of edges) {
        this.buildableGraphics.moveTo(edge.ax * TILE_SIZE + shift.x, edge.ay * TILE_SIZE + shift.y);
        this.buildableGraphics.lineTo(edge.bx * TILE_SIZE + shift.x, edge.by * TILE_SIZE + shift.y);
      }
    }
    this.buildableGraphics.lineStyle();
  }

  clearBuildableRegion(): void {
    this.regionDimensions?.destroy({ children: true });
    this.regionDimensions = null;
    this.regionRestroke = [];
    this.host.requestRender();
    this.endRegionPulse();
    if (!this.host.disposed) this.buildableGraphics.clear();
  }

  private regionPulseAnim: number | null = null;

  /**
   * The standing region dipping once and coming back (`panel.region.pulse`, whose numbers the
   * caller passes in — the registry is the one place a duration is declared).
   *
   * The outline already on the map breathing says why the edit was refused, with nothing new
   * beside it. `sin` puts both ends at rest and the trough in the middle, so the beat has no seam.
   * Under reduced motion it lands on the end state and nothing runs.
   */
  pulseBuildableRegion(durationMs: number, dip: number): void {
    this.endRegionPulse();
    this.host.requestRender();
    if (this.host.disposed || isMotionReduced()) return;
    const start = performance.now();
    const step = () => {
      this.host.requestRender();
      const t = Math.min((performance.now() - start) / durationMs, 1);
      this.buildableGraphics.alpha = regionPulseFactor(t, dip);
      if (t < 1) { this.regionPulseAnim = requestAnimationFrame(step); return; }
      this.endRegionPulse();
    };
    this.regionPulseAnim = requestAnimationFrame(step);
  }

  private endRegionPulse(): void {
    if (this.regionPulseAnim !== null) cancelAnimationFrame(this.regionPulseAnim);
    this.regionPulseAnim = null;
    this.buildableGraphics.alpha = 1;
  }

  /** The cells to check in the route's yellow with an ink edge, and an outline (the landmark's
   *  footprint) drawn alone. Strokes keep their screen width, and a cell drawn smaller than
   *  `REVIEW_MIN_PX` on screen grows about its centre to it, so a lone cell can be found on a
   *  whole-planet view. The outline stands on the placement grid. */
  showCellMarks(cells: CellSet | null, outline: Rect | null): void {
    this.review = cells ? { cells, outline } : null;
    this.drawReview();
  }

  private drawReview(): void {
    this.host.requestRender();
    const g = this.reviewGraphics;
    if (this.host.disposed) return;
    g.clear();
    if (!this.review) return;
    const { cells, outline } = this.review;
    const k = 1 / this.host.viewZoom;
    const side = Math.max(TILE_SIZE, REVIEW_MIN_PX * k);
    const inset = (TILE_SIZE - side) / 2;
    for (const [width, color, alpha] of [[REVIEW_EDGE * k, hexStringToNumber(FRAME_INK), 0.7], [REVIEW_LINE * k, ROUTE_TINT, 1]] as const) {
      g.lineStyle(width, color, alpha);
      if (outline) g.drawRect(outline.x * TILE_SIZE, outline.y * TILE_SIZE, outline.w * TILE_SIZE, outline.h * TILE_SIZE);
    }
    g.lineStyle(REVIEW_LINE * k, hexStringToNumber(FRAME_INK), 0.7);
    g.beginFill(ROUTE_TINT, 0.55);
    const shift = gridOffsetPx(cells.grid);
    for (const { x, y } of cells.cells) g.drawRect(x * TILE_SIZE + inset + shift.x, y * TILE_SIZE + inset + shift.y, side, side);
    g.endFill();
    g.lineStyle();
  }

  /** The maze's answer, in the chosen-card yellow: solid enough to read as a path, translucent
   *  enough that the ground it walks stays visible. */
  showPath({ grid, cells }: CellSet): void {
    this.host.requestRender();
    if (this.host.disposed) return;
    this.routeGraphics.clear();
    if (cells.length === 0) return;
    this.routeGraphics.beginFill(ROUTE_TINT, 0.55);
    for (const { x, y } of cells) cellRect(this.routeGraphics, x, y, grid);
    this.routeGraphics.endFill();
  }

  clearPath(): void {
    this.host.requestRender();
    if (!this.host.disposed) this.routeGraphics.clear();
  }

  /** Redraw what keeps its screen size after a zoom change. */
  rezoom(zoom: number): void {
    if (this.review) this.drawReview();
    for (const restroke of this.regionRestroke) restroke(annotationLineCells(zoom * TILE_SIZE));
  }

  dispose(): void {
    if (this.regionPulseAnim !== null) cancelAnimationFrame(this.regionPulseAnim);
    this.regionPulseAnim = null;
  }
}

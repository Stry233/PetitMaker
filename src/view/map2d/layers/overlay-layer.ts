import * as PIXI from 'pixi.js-legacy';
import type { Corners, PlacedObject, ValidationError } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import type { TrimmedCell } from '../../../tools/trim';
import type { MacroRect } from '../../interaction/marquee';
import type { GhostCell, GhostPaint, PlacementGhost, SelectionOpts } from '../../../tools/pointer/runtime';
import type { CellSet, GridId, MixedCellSet } from '../../../core/grid/grids';
import type { RowSpan } from '../../../core/grid/cell-spans';
import type { PlanetFrame } from '../../../core/model/planet';
import type { OverlayHost } from './overlay/host';
import { OverlayFlashes } from './overlay/flash';
import { OverlayGhosts } from './overlay/ghost';
import { OverlayMarks } from './overlay/marks';
import { OverlayRegions } from './overlay/region';
import { OverlayPlanetFrame } from './overlay/planet-frame';
import { OverlayBand } from './overlay/band';

/**
 * The 2D tool overlay: the view's `ToolOverlay`, drawn by its parts in `overlay/`. Paint order is
 * fixed at construction, whatever is shown first: the region marks lowest, then the planet frame,
 * the flashes and ghosts, the hover box, the band and the selection marks, with the error flash
 * on top of everything. At click time the ghost covers exactly the violating cells, and a flash
 * underneath its fill, outline or sprite reads as no feedback at all. The hover box sits under the
 * selection marks so selecting visibly commits it into them; the band sits under them too, so
 * members already in the group stay legible while dragging over them. Every part reuses its
 * Graphics with clear(), so nothing is re-added above the parts stacked after it.
 */
export class OverlayLayer implements OverlayHost {
  public readonly container = new PIXI.Container();
  viewZoom = 1;
  /** Set by `dispose`: the renderer destroys these Graphics with its app, and a tool or UI teardown
   *  may still call in afterwards. */
  disposed = false;

  private readonly flashes = new OverlayFlashes(this);
  private readonly ghosts = new OverlayGhosts(this).init();
  private readonly marks = new OverlayMarks(this);
  private readonly regions = new OverlayRegions(this);
  private readonly planet = new OverlayPlanetFrame(this);
  private readonly band = new OverlayBand(this);

  /** Opens the owning renderer's render window. */
  constructor(readonly requestRender: () => void) {
    this.planet.planetFrameFlash.alpha = 0;
    this.container.addChild(
      this.regions.buildableGraphics,
      this.regions.routeGraphics,
      this.regions.reviewGraphics,
      this.planet.planetFrameGraphics,
      this.planet.planetFrameFlash,
      this.flashes.commitGraphics,
      this.ghosts.curveGraphics,
      this.ghosts.ghostGraphics,
      this.ghosts.previewIcon,
      this.marks.hoverGraphics,
      this.band.bandGraphics,
      this.marks.selectionGraphics,
      this.marks.selectionFrame,
      this.regions.dimensionSlot,
      this.ghosts.placementSlot,
      this.ghosts.groupSlot,
      this.marks.labelSlot,
      this.flashes.errorGraphics,
    );
  }

  /** Cancels every animation frame the layer holds and turns later calls into no-ops. The renderer
   *  calls it before destroying its app, so no frame outlives the Graphics it draws into. */
  dispose(): void {
    this.disposed = true;
    this.flashes.dispose();
    this.ghosts.dispose();
    this.marks.dispose();
    this.regions.dispose();
    this.planet.endFrameFlash();
  }

  /** Point the flashes at the live grid. */
  setShapeSource(fn: (x: number, y: number) => { corners?: Corners; patchOnly?: boolean } | null): void {
    this.flashes.setShapeSource(fn);
  }

  /** The view's zoom (screen px per world px). Marks keep their screen size, so a real change redraws them. */
  setViewZoom(zoom: number): void {
    if (!(zoom > 0) || Math.abs(zoom - this.viewZoom) / this.viewZoom < 0.03) return;
    this.viewZoom = zoom;
    this.planet.rezoom();
    this.regions.rezoom(zoom);
    this.marks.rezoom();
  }

  flashErrors(errors: ValidationError[]): void { this.flashes.flashErrors(errors); }
  flashCommit(sets: readonly CellSet[], opts: { color?: number } = {}): void { this.flashes.flashCommit(sets, opts); }

  showGhost(set: MixedCellSet, paint: GhostPaint, trim?: readonly TrimmedCell[], losses?: readonly GhostCell[]): void {
    this.ghosts.showGhost(set, paint, trim, losses);
  }
  showGhostSpans(spans: RowSpan[], paint: GhostPaint, grid: GridId, trim?: readonly TrimmedCell[]): void {
    this.ghosts.showGhostSpans(spans, paint, grid, trim);
  }
  showPlacementGhost(ghost: PlacementGhost, valid: boolean): void { this.ghosts.showPlacementGhost(ghost, valid); }
  showGroupPlacementGhost(members: readonly PlacementGhost[], valid: boolean): void { this.ghosts.showGroupPlacementGhost(members, valid); }
  /** A drag's drop preview as placement ghosts: the lone sprite for one object, the group's pool
   *  for several. The ghost sprite keeps the item's own size, the wash carries the snapped span. */
  showObjectMove(destinations: readonly PlacedObject[], valid: boolean): void {
    const ghosts = destinations.map(({ catalogId, position, rotation, elevation }) => ({ catalogId, x: position.x, y: position.y, rotation, elevation }));
    if (ghosts.length === 1) this.ghosts.showPlacementGhost(ghosts[0]!, valid);
    else this.ghosts.showGroupPlacementGhost(ghosts, valid);
  }
  clearGhost(): void { this.ghosts.clearGhost(); }
  showCurveFootprint(set: CellSet): void { this.ghosts.showCurveFootprint(set); }
  clearCurveFootprint(): void { this.ghosts.clearCurveFootprint(); }

  showHover(rect: Rect, grid: GridId): void { this.marks.showHover(rect, grid); }
  clearHover(): void { this.marks.clearHover(); }
  showSelection(rect: Rect, grid: GridId, opts: SelectionOpts = {}): void { this.marks.showSelection(rect, grid, opts); }
  clearSelection(): void { this.marks.clearSelection(); }

  showBuildableRegion(set: CellSet, dimensionScale?: number): void { this.regions.showBuildableRegion(set, dimensionScale); }
  clearBuildableRegion(): void { this.regions.clearBuildableRegion(); }
  pulseBuildableRegion(durationMs: number, dip: number): void { this.regions.pulseBuildableRegion(durationMs, dip); }
  showCellMarks(cells: CellSet | null, outline: Rect | null): void { this.regions.showCellMarks(cells, outline); }
  showPath(set: CellSet): void { this.regions.showPath(set); }
  clearPath(): void { this.regions.clearPath(); }

  showFrame(frame: PlanetFrame | null): void { this.planet.showFrame(frame); }
  flashFrame(durationMs: number): void { this.planet.flashFrame(durationMs); }
  /** Ends a running frame flash. */
  endFrameFlash(): void { this.planet.endFrameFlash(); }

  showBand(rect: MacroRect): void { this.band.showBand(rect); }
  clearBand(): void { this.band.clearBand(); }
}

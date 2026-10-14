import type { GlQuality } from '../../../platform/device/device-quality';
import * as THREE from 'three';
import { MoveOrigins3D } from './move-origins';
import type { GridState, ValidationError } from '../../../core/model/types';
import type { GhostCell, GhostPaint, PlacementGhost, ToolOverlay, SelectionOpts } from '../../../tools/pointer/runtime';
import type { MacroRect } from '../../interaction/marquee';
import type { RowSpan } from '../../../core/grid/cell-spans';
import type { TrimmedCell } from '../../../tools/trim';
import { type CellSet, type GridId, type MixedCellSet } from '../../../core/grid/grids';
import type { PlacedObject } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import type { OverlayHost3D } from './overlay/host';
import { BoxMaterials } from './overlay/paint';
import { OverlayGhosts3D } from './overlay/ghost';
import { Boxes3D } from './overlay/boxes';
import { OverlayFlashes3D } from './overlay/flash';
import { OverlayRegions3D } from './overlay/region';

/** What the 3D overlay reads from the scene that holds it. */
export interface Overlay3DDeps {
  /** The map the decals drape over (the scene's peel view while layers are hidden). */
  state(): GridState;
  requestRender(): void;
  /** The rendered body box of a placed object, which selection marks fit. */
  objectBox?(id: string): THREE.Box3 | null;
  nowMs?(): number;
  /** Shows the moved objects at their destinations while a move preview runs. */
  moveObjects?(destinations: readonly PlacedObject[]): void;
  /** The camera and canvas rect the move origins' screen-space outlines project through. */
  camera?: THREE.Camera;
  viewport?(): { width: number; height: number };
  modelQuality?(): GlQuality;
}

/**
 * The 3D ToolOverlay: every piece of tool feedback the 2D OverlayLayer draws,
 * as surface-draped decals in one scene group. Ghost updates are rAF-coalesced
 * (flush() runs once per rendered frame — a pointer stroke calls showGhost per
 * move); flashes decay through tick(). Colors arrive as the same 0xRRGGBB
 * numbers the 2D overlay uses, so validity tints match across views.
 */
export class OverlayLayer3D implements ToolOverlay, OverlayHost3D {
  readonly group = new THREE.Group();
  readonly mats = new BoxMaterials();

  private moveOrigins: MoveOrigins3D | null = null;
  private isMoving = false;

  private readonly regions: OverlayRegions3D;
  private readonly ghosts = new OverlayGhosts3D(this);
  private readonly boxes = new Boxes3D(this);
  private readonly flashes = new OverlayFlashes3D(this);

  readonly state = (): GridState => this.deps.state();
  readonly requestRender = (): void => this.deps.requestRender();
  readonly objectBox = (id: string): THREE.Box3 | null => this.deps.objectBox?.(id) ?? null;
  readonly nowMs = (): number => this.deps.nowMs?.() ?? performance.now();
  readonly modelQuality = (): GlQuality => this.deps.modelQuality?.() ?? 'full';
  private moveObjects(destinations: readonly PlacedObject[]): void { this.deps.moveObjects?.(destinations); }

  constructor(private readonly deps: Overlay3DDeps) {
    this.regions = new OverlayRegions3D(this);
    this.group.add(this.regions.regionDimensions.group);
    this.group.renderOrder = 50; // over terrain and water, under nothing that matters
  }

  moving(): boolean {
    return this.isMoving;
  }

  showGhost(set: MixedCellSet, paint: GhostPaint, trim?: readonly TrimmedCell[], losses?: readonly GhostCell[]): void {
    this.ghosts.showGhost(set, paint, trim, losses);
  }

  showGhostSpans(spans: RowSpan[], paint: GhostPaint, grid: GridId, trim?: readonly TrimmedCell[]): void {
    this.ghosts.showGhostSpans(spans, paint, grid, trim);
  }

  showObjectMove(destinations: readonly PlacedObject[], _valid: boolean): void {
    this.moveOrigins ??= new MoveOrigins3D(this.group, this.deps.camera, this.deps.viewport, this.nowMs, this.modelQuality);
    this.moveOrigins.show(this.state(), destinations.map(obj => obj.id));
    this.isMoving = true;
    this.ghosts.hideBodies();
    this.clearHover();
    this.boxes.setShadowsVisible(false);
    this.moveObjects(destinations);
    this.requestRender();
  }

  clearGhost(): void {
    this.moveOrigins?.clear();
    if (this.isMoving) {
      this.isMoving = false;
      this.moveObjects([]);
      this.boxes.setShadowsVisible(true);
    }
    this.ghosts.clearGhost();
    this.requestRender();
  }

  showPlacementGhost(ghost: PlacementGhost, valid: boolean): void {
    this.ghosts.showPlacementGhost(ghost, valid);
  }

  showGroupPlacementGhost(members: readonly PlacementGhost[], valid: boolean): void {
    this.ghosts.showGroupPlacementGhost(members, valid);
  }

  /** Consume the pending selection and ghost updates — called once per rendered frame. */
  flush(): void {
    this.moveOrigins?.update();
    this.boxes.flush();
    this.ghosts.flush();
  }

  showSelection(rect: Rect, grid: GridId, opts: SelectionOpts = {}): void { this.boxes.showSelection(rect, grid, opts); }
  showObjectSelection(objectId: string, append = false): void { this.boxes.showObjectSelection(objectId, append); }
  /** The members the last flush could draw no selection for: the map no longer holds them. */
  unresolvedSelections(): readonly string[] { return this.boxes.unresolvedSelections(); }
  clearSelection(): void { this.boxes.clearSelection(); }
  showHover(rect: Rect, grid: GridId): void { this.boxes.showHover(rect, grid); }
  clearHover(): void { this.boxes.clearHover(); }
  showBand(rect: MacroRect): void { this.boxes.showBand(rect); }
  clearBand(): void { this.boxes.clearBand(); }

  flashCommit(sets: readonly CellSet[], opts: { color?: number } = {}): void { this.flashes.flashCommit(sets, opts); }
  flashErrors(errors: ValidationError[]): void { this.flashes.flashErrors(errors); }

  /** Advance flash decay, the move origins' fade and the region pulse; true while any runs (keeps
   *  the render window open, like a canvas animation). */
  tick(): boolean {
    const fading = this.moveOrigins?.tick() ?? false;
    const pulsing = this.regions.stepRegionPulse() || fading;
    return this.flashes.tick() || pulsing;
  }

  showBuildableRegion(set: CellSet, dimensionScale?: number): void { this.regions.showBuildableRegion(set, dimensionScale); }
  /** Re-bake the buildable drape over the terrain as it stands now; the scene calls this whenever cells change. */
  refreshBuildable(): void { this.regions.refreshBuildable(); }
  pulseBuildableRegion(durationMs: number, dip: number): void { this.regions.pulseBuildableRegion(durationMs, dip); }
  clearBuildableRegion(): void { this.regions.clearBuildableRegion(); }
  showCurveFootprint(set: CellSet): void { this.ghosts.showCurveFootprint(set); }
  clearCurveFootprint(): void { this.ghosts.clearCurveFootprint(); }
  showPath(set: CellSet): void { this.regions.showPath(set); }
  clearPath(): void { this.regions.clearPath(); }

  dispose(): void {
    this.moveOrigins?.dispose();
    this.moveOrigins = null;
    if (this.isMoving) this.moveObjects([]);
    this.isMoving = false;
    this.ghosts.dispose();
    this.clearGhost();
    this.flush();
    this.clearSelection();
    this.clearHover();
    this.clearBand();
    this.clearBuildableRegion();
    this.regions.regionDimensions.dispose();
    this.clearPath();
    this.flashes.dispose();
    this.mats.dispose();
    this.ghosts.disposeMaterials();
  }
}

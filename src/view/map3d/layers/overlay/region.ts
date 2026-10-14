import { cellEdges, dimensionDrawing } from '../../../../core/model/annotation/dimensions';
import { AnnotationLayer3D } from '../annotation-layer';
import * as THREE from 'three';
import { regionPulseFactor } from '../../../shared/overlay/region-pulse';
import { cellDecals } from '../../geometry/overlay-decals';
import { cellSet, type CellSet } from '../../../../core/grid/grids';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { ROUTE_TINT } from '../../../shared/overlay/preview-cell';
import { gridOffset } from '../../../../core/grid/grid-convert';
import type { OverlayHost3D } from './host';
import { makeMat, toGeo } from './paint';

/** The buildable region drape with its dimensions and pulse, and the maze route. */
export class OverlayRegions3D {
  constructor(private readonly host: OverlayHost3D) {}

  private buildable: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  /** What the buildable drape was last asked to show. Kept because the decal is baked at each cell's
   *  surface height, so a generation under it leaves the mesh describing terrain that is gone. */
  private buildableAsk: { cells: CellSet; dimensionScale?: number } | null = null;
  readonly regionDimensions = new AnnotationLayer3D();

  showBuildableRegion(set: CellSet, dimensionScale?: number): void {
    this.dropBuildableRegion();
    const { grid, cells } = set;
    this.buildableAsk = { cells: cellSet(grid, [...cells]), dimensionScale };
    const bounds = dimensionScale === undefined ? null : cellEdges(cells);
    if (bounds && dimensionScale !== undefined) {
      const offset = gridOffset(grid);
      const shifted = { left: bounds.left + offset.x, right: bounds.right + offset.x, top: bounds.top + offset.y, bottom: bounds.bottom + offset.y };
      this.regionDimensions.update(this.host.state(), null, { draft: null, tagLabel: () => '', dimensions: dimensionDrawing(shifted, dimensionScale) });
    } else this.regionDimensions.update(this.host.state(), null, { draft: null, tagLabel: () => '' });
    const data = cellDecals(this.host.state(), cells, grid);
    if (!data.positions.length) return;
    const geo = toGeo(data);
    // White, as the 2D view draws it, and for the reason the 2D view can ignore: this decal tints
    // the terrain it lies on, and the terrain is eight greens plus a green grass zone. A green tint
    // over green changes almost nothing, so the region a person had just painted was invisible over
    // exactly the surface they were most likely to paint it on. White lightens whatever is under it.
    const mat = makeMat(0xffffff, 0.25);
    const mesh = new THREE.Mesh(geo, mat);
    this.host.group.add(mesh);
    this.buildable = { mesh, geo, mat };
    this.host.requestRender();
  }

  /**
   * Re-bake the buildable drape over the terrain as it stands now.
   *
   * The decal carries a height per cell, read when it was built, so anything that changes the
   * surface under a painted region — a generation above all — leaves it floating at the old
   * elevation until the region is shown again. The scene calls this whenever cells change.
   */
  refreshBuildable(): void {
    const ask = this.buildableAsk;
    if (!ask) return;
    this.showBuildableRegion(ask.cells, ask.dimensionScale);
  }

  /** The pulse in flight: when it started, how long it runs and how far the drape dips. */
  private regionPulse: { bornMs: number; lifeMs: number; dip: number; base: number } | null = null;

  /**
   * The standing region drape breathing once (`panel.region.pulse`; the numbers come from the
   * caller, since the registry is where a duration is declared). The 2D view's own note explains
   * why it is a dip and not a new mark.
   *
   * Driven from `tick()` rather than from an rAF of its own: this scene renders on demand, and an
   * animation outside the loop that keeps the window open would paint into frames nobody drew.
   */
  pulseBuildableRegion(durationMs: number, dip: number): void {
    const drape = this.buildable;
    this.endRegionPulse();
    if (!drape || isMotionReduced()) return;
    this.regionPulse = { bornMs: this.host.nowMs(), lifeMs: durationMs, dip, base: drape.mat.opacity };
    this.host.requestRender();
  }

  stepRegionPulse(): boolean {
    const p = this.regionPulse;
    if (!p) return false;
    const drape = this.buildable;
    if (!drape) { this.regionPulse = null; return false; }
    const t = Math.min((this.host.nowMs() - p.bornMs) / p.lifeMs, 1);
    drape.mat.opacity = p.base * regionPulseFactor(t, p.dip);
    if (t < 1) return true;
    drape.mat.opacity = p.base;
    this.regionPulse = null;
    return false;
  }

  private endRegionPulse(): void {
    const p = this.regionPulse;
    if (p && this.buildable) this.buildable.mat.opacity = p.base;
    this.regionPulse = null;
  }

  clearBuildableRegion(): void {
    this.regionDimensions.update(this.host.state(), null, { draft: null, tagLabel: () => '' });
    this.dropBuildableRegion();
    this.host.requestRender();
  }

  private dropBuildableRegion(): void {
    this.endRegionPulse();
    this.buildableAsk = null;
    if (!this.buildable) return;
    this.host.group.remove(this.buildable.mesh);
    this.buildable.geo.dispose();
    this.buildable.mat.dispose();
    this.buildable = null;
    this.host.requestRender();
  }

  private route: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;

  /** The maze's answer, in the 2D view's own yellow. Its own decal, so it stands beside the
   *  buildable-region drape without either replacing the other. */
  showPath({ grid, cells }: CellSet): void {
    this.clearPath();
    const data = cellDecals(this.host.state(), cells, grid);
    if (!data.positions.length) return;
    const geo = toGeo(data);
    const mat = makeMat(ROUTE_TINT, 0.55);
    const mesh = new THREE.Mesh(geo, mat);
    this.host.group.add(mesh);
    this.route = { mesh, geo, mat };
    this.host.requestRender();
  }

  clearPath(): void {
    if (!this.route) return;
    this.host.group.remove(this.route.mesh);
    this.route.geo.dispose();
    this.route.mat.dispose();
    this.route = null;
    this.host.requestRender();
  }
}

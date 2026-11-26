/**
 * White flow arrows at waterfall faces, the 3D twin of the 2D indicator pass, riding each face's
 * water surface. The faces are scanned again only when an edit can change them
 * (`shared/terrain/waterfall-arrows.ts:WaterfallFaceWatch`); one material serves the layer's life.
 */
import * as THREE from 'three';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { TERRAIN_GRID_OFFSET } from '../../../core/grid/grid-convert';
import { getCell } from '../../../core/model/grid-model';
import { WATERFALL_ARROW_LOOK, WaterfallFaceWatch, waterfallArrowTriangles } from '../../shared/terrain/waterfall-arrows';
import { toPlainGeometry } from '../draw/mesh-upload';
import { mapCenterOffset } from '../geometry/coords';
import { surfaceHeightAt } from '../geometry/pick';

/** How far an arrow floats over its water surface, in world units. */
const ARROW_LIFT = 0.05;

export class WaterfallArrows {
  readonly group = new THREE.Group();
  private readonly watch = new WaterfallFaceWatch();
  private readonly material = new THREE.MeshBasicMaterial({
    color: WATERFALL_ARROW_LOOK.color, transparent: true, opacity: WATERFALL_ARROW_LOOK.alpha,
    side: THREE.DoubleSide, depthWrite: false,
  });
  private readonly mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
  /** Edited cells since the last flush, each batch as the edit named it, and how many cells they hold. */
  private edited: (readonly MacroCoord[])[] = [];
  private editedCount = 0;
  /** The faces must be scanned again whatever was edited: nothing drawn yet, or the meshed map changed wholesale. */
  private stale = true;

  constructor() {
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** Notes terrain cells an edit changed; the next flush asks whether they can change the faces. A paused
   *  scene flushes only on resume, so past a map's worth of cells the scan is owed outright, costing no
   *  more than testing them. */
  cellsChanged(cells: readonly MacroCoord[], state: GridState): void {
    if (this.stale || !cells.length) return;
    this.edited.push(cells);
    this.editedCount += cells.length;
    if (this.editedCount > state.template.width * state.template.height) this.invalidate();
  }

  /** Owes a scan whatever was edited: the map the arrows are drawn from changed as a whole. */
  invalidate(): void {
    this.stale = true;
    this.edited = [];
    this.editedCount = 0;
  }

  /** Brings the arrows up to date with `state`, the map the terrain is meshed from: they are scanned and
   *  drawn again only when owed or when the edited cells can change the faces. */
  flush(state: GridState, hiddenLayers: ReadonlySet<number>): void {
    const edited = this.edited;
    this.edited = [];
    this.editedCount = 0;
    if (!this.stale && !edited.some((cells) => this.watch.touchedBy(cells, state))) return;
    this.stale = false;
    this.watch.scan(state);
    this.draw(state, hiddenLayers);
  }

  private draw(state: GridState, hiddenLayers: ReadonlySet<number>): void {
    const { width, height } = state.template;
    const off = mapCenterOffset(width, height);
    const shown = (x: number, y: number): boolean => {
      const t = getCell(state.cells, x, y)?.terrain;
      return !!t && !hiddenLayers.has(t.elevation);
    };
    const positions: number[] = [];
    // Terrain-grid cells to world: the grid's offset, then the map centred on the origin.
    const wx = (v: number): number => v + TERRAIN_GRID_OFFSET.x - off.x;
    const wz = (v: number): number => v + TERRAIN_GRID_OFFSET.y - off.z;
    for (const { cell, points: p } of waterfallArrowTriangles(this.watch.faces, shown)) {
      const h = surfaceHeightAt(state, wx(cell.x + 0.5), wz(cell.y + 0.5)) + ARROW_LIFT;
      positions.push(wx(p[0]), h, wz(p[1]), wx(p[2]), h, wz(p[3]), wx(p[4]), h, wz(p[5]));
    }
    this.mesh.geometry.dispose();
    this.mesh.geometry = toPlainGeometry({ positions });
    this.mesh.visible = positions.length > 0;
  }

  /** Frees the arrows' geometry and material. */
  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.group.clear();
  }
}

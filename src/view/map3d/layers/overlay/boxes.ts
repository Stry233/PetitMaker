import { hexStringToNumber } from '../../../../core/base/color';
import * as THREE from 'three';
import { setHoverTarget } from '../../../hover-target';
import type { SelectionOpts } from '../../../../tools/pointer/runtime';
import type { MacroRect } from '../../../interaction/marquee';
import { rectDecals, DECAL_LIFT, type DecalMesh } from '../../geometry/overlay-decals';
import { spanCellCentres } from '../../geometry/surface-pieces';
import { surfaceHeightAt } from '../../geometry/pick';
import { cellCornerWorld } from '../../geometry/coords';
import type { GridId } from '../../../../core/grid/grids';
import { BAND_COLOR } from '../../../shared/overlay/preview-cell';
import type { Rect } from '../../../../core/grid/rect';
import { MAP_TEXT, MAP_INK } from '../../../../assets/brand-palette';
import { PLACEMENT_GRID } from '../../../../core/game/profile';
import type { OverlayHost3D } from './host';
import { toGeo } from './paint';
import { footprintMark } from '../../geometry/object-marks';

/** A selected terrain cell's box: the map-label ink. */
const SELECTION_CREAM = hexStringToNumber(MAP_TEXT);
/** The ground shadow under a hovered or selected item: the glyph ink. */
const GROUND_SHADOW = hexStringToNumber(MAP_INK);
const SHADOW_FILL = 0.34;
const SHADOW_EDGE = 0.8;
/** Past this many selected members only the interface's marks are drawn. */
const SHADOW_LIMIT = 200;

/** Selection, hover and band boxes: flat footprint boxes and draped ground shadows. */
export class Boxes3D {
  constructor(private readonly host: OverlayHost3D) {}

  private band: { mesh: THREE.Mesh; edge: THREE.LineSegments } | null = null;

  /** Objects are marked in screen space by the interface, over their projected bodies. A regular body
   *  (`exact`: a terrain cell, a lone road) is marked by its exact box draped on its surface. */
  showSelection({ x, y, w, h }: Rect, grid: GridId, { exact = false }: SelectionOpts = {}): void {
    this.clearTerrainSelection();
    if (exact) this.terrainSelection = this.makeBox({ x, y, w, h }, grid, { color: SELECTION_CREAM, fillA: 0.18, edgeA: 1 });
  }

  private terrainSelection: { mesh: THREE.Mesh; edge: THREE.LineSegments } | null = null;
  private selectionShadows: { mesh: THREE.Mesh; edge: THREE.LineSegments }[] = [];

  private clearTerrainSelection(): void {
    if (this.terrainSelection) this.dropBox(this.terrainSelection);
    this.terrainSelection = null;
  }

  /** Recorded so a member the map no longer holds is reported (see `unresolvedSelections`). */
  showObjectSelection(objectId: string, append = false): void {
    // Deferred to flush(): selection repaints ride objects-changed, whose handlers can run before
    // the scene updated the instance.
    if (!append) this.clearSelection();
    this.pendingSelectionIds.push(objectId);
    this.host.requestRender();
  }

  private pendingSelectionIds: string[] = [];

  /** Ids the last flush could draw no selection for: the map no longer holds them. A representation
   *  without an instanced body is not one of these — it falls back to its footprint box. */
  private unresolved: string[] = [];

  /** The misses from the last flush (see `unresolved`). A miss is a member the view showed nothing
   *  for, so it is reported rather than swallowed. */
  unresolvedSelections(): readonly string[] {
    return this.unresolved;
  }

  clearSelection(): void {
    this.pendingSelectionIds = [];
    this.unresolved = [];
    this.clearTerrainSelection();
    for (const shadow of this.selectionShadows) this.dropBox(shadow);
    this.selectionShadows = [];
  }

  private lastHoverKey = '';
  private hover: { mesh: THREE.Mesh; edge: THREE.LineSegments } | null = null;

  /** The hover preview: a shadow over the target's footprint, draped on the ground so it shows the
   *  area the item stands on, on every tier a footprint across a step lies on. The interface outlines
   *  an object's projected body around it. Keyed so a stationary hover (pointermove fires per pixel)
   *  does not rebuild geometry; the drape rides in the key, so a terrain edit under a still cursor
   *  still rebuilds. */
  showHover({ x, y, w, h }: Rect, grid: GridId): void {
    setHoverTarget({ x, y, w, h, grid });
    const drape = rectDecals(this.host.state(), [{ x, y, w, h }], grid);
    const key = `${grid}:${drape.positions.join(',')}`;
    if (this.hover && key === this.lastHoverKey) return;
    this.lastHoverKey = key;
    if (this.hover) this.dropBox(this.hover);
    this.hover = this.makeShadow(drape, GROUND_SHADOW, SHADOW_FILL, SHADOW_EDGE);
  }

  clearHover(): void {
    setHoverTarget(null);
    if (this.hover) this.dropBox(this.hover);
    this.hover = null;
  }

  /** The Ctrl+drag rubber band: surface-draped box geometry, so it drapes over terrain. On the
   *  placement grid, since a band only selects objects. */
  showBand(rect: MacroRect): void {
    this.clearBand();
    this.band = this.makeBox(rect, PLACEMENT_GRID, { color: BAND_COLOR, fillA: 0.08, edgeA: 0.7 });
  }

  clearBand(): void {
    if (this.band) this.dropBox(this.band);
    this.band = null;
  }

  /** Show or hide the selected members' ground shadows; a move preview hides them. */
  setShadowsVisible(visible: boolean): void {
    for (const shadow of this.selectionShadows) shadow.mesh.visible = shadow.edge.visible = visible;
  }

  /** Draw the selection shadows asked for since the last frame. */
  flush(): void {
    if (this.pendingSelectionIds.length) {
      const ids = this.pendingSelectionIds;
      this.pendingSelectionIds = [];
      this.unresolved = [];
      const state = this.host.state();
      for (const id of ids) {
        const obj = state.objects.get(id);
        if (!obj) { if (!this.host.objectBox(id)) this.unresolved.push(id); continue; }
        // A selected item keeps its footprint shadow on the ground, so its placement area stays in view.
        if (this.selectionShadows.length < SHADOW_LIMIT) {
          // On the object's own ground mark (`footprintMark`), which carries its height already.
          const shadow = this.makeShadow(footprintMark(state, obj), GROUND_SHADOW, SHADOW_FILL, SHADOW_EDGE, 0);
          shadow.mesh.visible = shadow.edge.visible = !this.host.moving();
          this.selectionShadows.push(shadow);
        }
      }
    }
  }

  /** A footprint box: translucent fill + a brighter outline, one flat rect at the footprint's
   *  tallest surface so it never sinks into a hill — a box bounds what is under it, so unlike a
   *  drape it does not follow a trimmed corner down.
   *
   *  The height is sampled at the centre of each cell the box actually covers
   *  (`spanCellCentres`), which is not the same set of points as stepping in whole cells from the
   *  box's own — possibly fractional — origin. */
  private surfaceTop(x: number, y: number, w: number, h: number, grid: GridId): number {
    const s = this.host.state();
    let top = 0;
    for (const cz of spanCellCentres(y, h)) {
      for (const cx of spanCellCentres(x, w)) {
        const at = cellCornerWorld(cx, cz, s.template.width, s.template.height, grid);
        top = Math.max(top, surfaceHeightAt(s, at.x, at.z));
      }
    }
    return top;
  }

  private makeBox(
    rect: { x: number; y: number; w: number; h: number }, grid: GridId, look: { color: number; fillA: number; edgeA: number },
    top = this.surfaceTop(rect.x, rect.y, rect.w, rect.h, grid),
  ) {
    const { x, y, w, h } = rect;
    const { color, fillA, edgeA } = look;
    const s = this.host.state();
    const { x: x0, z: z0 } = cellCornerWorld(x, y, s.template.width, s.template.height, grid);
    const yTop = top + DECAL_LIFT * 2;
    const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
    geo.translate(x0 + w / 2, yTop, z0 + h / 2);
    const mesh = new THREE.Mesh(geo, this.host.mats.fill(color, fillA));
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edge = new THREE.LineSegments(edgeGeo, this.host.mats.edge(color, edgeA));
    this.host.group.add(mesh, edge);
    this.host.requestRender();
    return { mesh, edge };
  }

  /** A footprint shadow (`footprintShadow`) over `drape`, lifted by `lift`, in the shared box paint. */
  private makeShadow(drape: DecalMesh, color: number, fillA: number, edgeA: number, lift = DECAL_LIFT) {
    const { fill, rim } = footprintShadow(drape, lift);
    const mesh = new THREE.Mesh(fill, this.host.mats.fill(color, fillA));
    const edge = new THREE.LineSegments(rim, this.host.mats.edge(color, edgeA));
    this.host.group.add(mesh, edge);
    this.host.requestRender();
    return { mesh, edge };
  }

  /** Geometry is per box and goes; the materials are the shared ones from `boxMats` and stay. */
  private dropBox(box: { mesh: THREE.Mesh; edge: THREE.LineSegments }): void {
    this.host.group.remove(box.mesh, box.edge);
    box.mesh.geometry.dispose();
    box.edge.geometry.dispose();
    this.host.requestRender();
  }
}

/** A footprint shadow over `drape` (a surface drape, `rectDecals`, or an object's ground mark,
 *  `geometry/object-marks.ts:footprintMark`), lifted by `lift` (a box's height over the cell washes
 *  for a bare drape, none for a mark already seated), with its outline along the footprint's own
 *  edge at each piece's height: the ground mark of a hovered, selected or flagged object. */
export function footprintShadow(drape: DecalMesh, lift = DECAL_LIFT): { fill: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  const p = drape.positions.map((v, i) => (i % 3 === 1 ? v + lift : v));
  const fill = toGeo({ positions: p, index: drape.index });
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    x0 = Math.min(x0, p[i]!); x1 = Math.max(x1, p[i]!);
    z0 = Math.min(z0, p[i + 2]!); z1 = Math.max(z1, p[i + 2]!);
  }
  const onEdge = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  const edges: number[] = [];
  // Each piece is one axis-aligned quad, four vertices in order; an edge of it on the footprint's
  // boundary is part of the outline.
  for (let q = 0; q < p.length; q += 12) {
    for (let i = 0; i < 4; i++) {
      const a = q + i * 3, b = q + ((i + 1) % 4) * 3;
      const ax = p[a]!, az = p[a + 2]!, bx = p[b]!, bz = p[b + 2]!;
      const along = (ax === bx && (onEdge(ax, x0) || onEdge(ax, x1))) || (az === bz && (onEdge(az, z0) || onEdge(az, z1)));
      if (along) edges.push(ax, p[a + 1]!, az, bx, p[b + 1]!, bz);
    }
  }
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  return { fill, rim };
}

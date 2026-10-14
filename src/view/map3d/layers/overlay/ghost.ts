import { getCatalogItem } from '../../../../state/catalog';
import { isRamp, isBridge } from '../../../../core/model/traits';
import * as THREE from 'three';
import type { MacroCoord, Rotation } from '../../../../core/model/types';
import type { GhostCell, GhostPaint, GhostRequest, PlacementGhost, PlacementWash, PreviewCell, PreviewIcon } from '../../../../tools/pointer/runtime';
import { GHOST_WASH_ALPHA, ghostPlan } from '../../../shared/overlay/ghost-geometry';
import type { TrimmedCell } from '../../../../tools/trim';
import { cellDecals, joinDecals, DECAL_LIFT, type DecalTrim } from '../../geometry/overlay-decals';
import { surfaceHeightAt } from '../../geometry/pick';
import { cellCornerWorld } from '../../geometry/coords';
import { groupByGrid, spanCells, type RowSpan } from '../../../../core/grid/cell-spans';
import { cellGrid, type CellSet, type GridId, type MixedCellSet } from '../../../../core/grid/grids';
import { CURVE_FOOTPRINT, isPreviewCell, washColor, previewDots, previewIconRect, previewPalette, type PreviewPalette, ROUTE_TINT } from '../../../shared/overlay/preview-cell';
import { HATCH_CELLS, previewHatchCanvas, previewIconCanvas } from '../../../shared/overlay/preview-cell-raster';
import { objectInstance } from '../../geometry/object-meshes';
import { groupModelGeometry } from '../../models/build-model';
import { archetypeGeometry } from '../../models/object-archetypes';
import { cellsBounds, cellKey } from '../../../../core/grid/rect';
import type { ArchetypeKey } from '../../geometry/types';
import { cellCentre } from '../../../../core/grid/grid-convert';
import type { OverlayHost3D } from './host';
import { makeMat, toGeo } from './paint';
import { GHOST_LOSS } from '../../../shared/viewport/view-constants';

/** Ghost depth and colour occupy orders 1 and 2. Ordinary decals stay at 0 so the
 *  pre-pass cannot erase them. Move previews use the solid scene instances. */
interface GhostBody { mesh: THREE.Mesh; depth: THREE.Mesh }
const GHOST_DEPTH_ORDER = 1;
const GHOST_COLOR_ORDER = 2;

/** Textures are cached for the page's life, shared by every overlay: a ghost rebuilds on every pointer move, and a
 *  re-uploaded canvas per move is a texture upload per move. Materials are still per-flush (they are
 *  disposed with the ghost), and disposing one leaves its texture alone. */
const cardTextures = new Map<string, THREE.CanvasTexture | null>();

function cardTexture(key: string, make: () => HTMLCanvasElement | null): THREE.CanvasTexture | null {
  const hit = cardTextures.get(key);
  if (hit !== undefined) return hit;
  const canvas = make();
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) tex.colorSpace = THREE.SRGBColorSpace;
  cardTextures.set(key, tex);
  return tex;
}

function iconTexture(icon: PreviewIcon): THREE.CanvasTexture | null {
  return cardTexture(`icon:${icon}`, () => previewIconCanvas(icon));
}

/** The refused state's stripe tile, mapped in world units (see `cardBackground`). */
function hatchTexture(palette: PreviewPalette): THREE.CanvasTexture | null {
  const tex = cardTexture(`hatch:${palette.bg}:${palette.hatch}`, () => previewHatchCanvas(palette));
  if (tex) { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; }
  return tex;
}

/**
 * The card's background material for one flush, plus the world-space UVs its stripes need.
 *
 * The drape is one polygon soup at many heights, so the stripes cannot ride a per-cell quad's own
 * UVs: each vertex takes its texture coordinate from where it stands (x, z over the tile's 3-cell
 * span), which is what keeps one continuous 45-degree pattern across a footprint whatever the
 * terrain under it does. The tile carries the flat colour too, so this is one pass, not two.
 */
function cardBackground(palette: PreviewPalette, geo: THREE.BufferGeometry): THREE.MeshBasicMaterial {
  const tex = palette.hatch === undefined ? null : hatchTexture(palette);
  if (!tex) return makeMat(palette.bg, palette.bgAlpha);
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / HATCH_CELLS;
    // A CanvasTexture is flipped, so v runs against z — the bars would mirror to the other diagonal.
    uv[i * 2 + 1] = -pos.getZ(i) / HATCH_CELLS;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: palette.bgAlpha, side: THREE.DoubleSide, depthWrite: false,
  });
  return mat;
}

/** Placement ghosts: the draped cell wash or preview card a shape would leave, translucent item bodies standing over it, and the editable curve footprint. */
export class OverlayGhosts3D {
  constructor(private readonly host: OverlayHost3D) {}

  private curveFootprint: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  private pendingGhost: GhostRequest | null = null;
  private ghost: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  /** The `losses` half of the ghost: its own body, its own material, disposed alongside `ghost`. */
  private lossGhost: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;

  showGhost({ grid, cells }: MixedCellSet, paint: GhostPaint, trim?: readonly TrimmedCell[], losses?: readonly GhostCell[]): void {
    this.pendingGhost = { kind: 'cells', cells, paint, grid, trim, losses };
    this.host.requestRender();
  }

  showGhostSpans(spans: RowSpan[], paint: GhostPaint, grid: GridId, trim?: readonly TrimmedCell[]): void {
    this.pendingGhost = { kind: 'spans', spans, paint, grid, trim };
    this.host.requestRender();
  }

  /** The hovered item's actual mesh, translucent + validity-tinted, standing at
   *  the hover cell — the cell decals underneath carry the exact footprint. */
  showPlacementGhost({ catalogId, x, y, rotation, elevation, spanLength }: PlacementGhost, valid: boolean): void {
    this.placementGhost ??= this.makeGhostBody();
    if (!this.paintGhostMesh(this.placementGhost, { catalogId, x, y, rotation, elevation, spanLength }, valid)) {
      this.dropPlacementGhost();
    }
    this.host.requestRender();
  }

  private placementGhost: GhostBody | null = null;
  private ghostMat: { valid?: THREE.MeshBasicMaterial; invalid?: THREE.MeshBasicMaterial } = {};
  private spanGhostMat: { valid?: THREE.MeshLambertMaterial; invalid?: THREE.MeshLambertMaterial } = {};
  private ghostDepthMat: THREE.MeshBasicMaterial | null = null;

  private ghostMaterial(valid: boolean): THREE.MeshBasicMaterial {
    if (!this.ghostMat.valid) {
      // Warm yellow, not green: the ghost is a flat-colour mesh, and a green one disappears
      // against the mountain strata it most often previews over (a ramp against a high cliff).
      // Same family as the route drape.
      this.ghostMat.valid = makeMat(ROUTE_TINT, 0.55);
      this.ghostMat.invalid = makeMat(GHOST_LOSS, 0.55);
    }
    return valid ? this.ghostMat.valid! : this.ghostMat.invalid!;
  }

  private spanGhostMaterial(valid: boolean): THREE.MeshLambertMaterial {
    if (!this.spanGhostMat.valid) {
      const options = { vertexColors: true, flatShading: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide };
      this.spanGhostMat.valid = new THREE.MeshLambertMaterial(options);
      this.spanGhostMat.invalid = new THREE.MeshLambertMaterial({ ...options, color: GHOST_LOSS });
    }
    return valid ? this.spanGhostMat.valid! : this.spanGhostMat.invalid!;
  }

  /** The pre-pass material: writes depth, no colour. `transparent` keeps it in the transparent
   *  queue, where renderOrder decides its place rather than the opaque queue's front-to-back z —
   *  the opaque queue runs before every decal and would punch the wash out from under a body. */
  private ghostDepthMaterial(): THREE.MeshBasicMaterial {
    this.ghostDepthMat ??= new THREE.MeshBasicMaterial({
      transparent: true, colorWrite: false, depthWrite: true, side: THREE.DoubleSide,
    });
    return this.ghostDepthMat;
  }

  /** One ghost body, added to the overlay group. The pre-pass is a child of the colour mesh, so a
   *  single transform drives both and hiding the body hides its depth with it. */
  private makeGhostBody(): GhostBody {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMaterial(true));
    mesh.renderOrder = GHOST_COLOR_ORDER;
    const depth = new THREE.Mesh(mesh.geometry, this.ghostDepthMaterial());
    depth.renderOrder = GHOST_DEPTH_ORDER;
    mesh.add(depth);
    this.host.group.add(mesh);
    return { mesh, depth };
  }

  /** Resolve `catalogId`'s body at (x, y, rotation, elevation) onto ghost body `b`. Returns false
   *  (and hides `b`) when the item has no instanced/modeled body — the caller then falls back to
   *  just the cell wash. Shared by the single hover ghost and each member of the group drag ghost. */
  private paintGhostMesh(
    b: GhostBody, ghost: { catalogId: string; x: number; y: number; rotation: number; elevation: number; spanLength?: number },
    valid: boolean,
  ): boolean {
    const { catalogId, x, y, rotation, elevation, spanLength } = ghost;
    const m = b.mesh;
    const resolved = objectInstance(this.host.state(), {
      id: '__ghost__', catalogId, position: { x, y },
      rotation: (rotation as Rotation), elevation, spanLength,
    });
    if (!resolved) return false;
    const isModel = resolved.groupKey.startsWith('m:');
    const geo = isModel ? groupModelGeometry(resolved.groupKey, this.host.modelQuality()) : archetypeGeometry(resolved.groupKey.slice(2) as ArchetypeKey);
    if (!geo) return false;
    m.geometry = geo; // shared caches own the geometry — never disposed here
    b.depth.geometry = geo;
    const item = getCatalogItem(catalogId);
    m.material = isModel && (isRamp(item) || isBridge(item)) ? this.spanGhostMaterial(valid) : this.ghostMaterial(valid);
    const inst = resolved.inst;
    m.position.set(inst.x, inst.y, inst.z);
    m.rotation.set(0, inst.rotationY, 0);
    m.scale.set(inst.scaleX, inst.scaleY, inst.scaleZ);
    m.visible = true;
    return true;
  }

  private dropPlacementGhost(): void {
    if (!this.placementGhost) return;
    this.placementGhost.mesh.visible = false;
    this.host.requestRender();
  }

  /** Pool of bodies for the group drag ghost — one per member, reused across pointer moves so a
   *  40-member drag doesn't allocate/dispose 40 meshes per sample. */
  private groupGhosts: GhostBody[] = [];

  showGroupPlacementGhost(members: readonly PlacementGhost[], valid: boolean): void {
    while (this.groupGhosts.length > members.length) {
      this.host.group.remove(this.groupGhosts.pop()!.mesh);
    }
    while (this.groupGhosts.length < members.length) {
      this.groupGhosts.push(this.makeGhostBody());
    }
    for (let i = 0; i < members.length; i++) {
      const mem = members[i]!;
      const body = this.groupGhosts[i]!;
      body.mesh.visible = this.paintGhostMesh(body, { catalogId: mem.catalogId, x: mem.x, y: mem.y, rotation: mem.rotation, elevation: mem.elevation }, valid);
    }
    this.host.requestRender();
  }

  private clearGroupPlacementGhost(): void {
    if (this.groupGhosts.length === 0) return;
    for (const b of this.groupGhosts) this.host.group.remove(b.mesh);
    this.groupGhosts = [];
    this.host.requestRender();
  }

  /** Hide the placement and group drag ghost bodies. */
  hideBodies(): void {
    this.dropPlacementGhost();
    this.clearGroupPlacementGhost();
  }

  /** Drop the pending cell ghost and the bodies. */
  clearGhost(): void {
    this.pendingGhost = { kind: 'clear' };
    this.hideBodies();
  }

  /** Consume the pending ghost update — called once per rendered frame. */
  flush(): void {
    const pending = this.pendingGhost;
    if (!pending) return;
    this.pendingGhost = null;
    this.dropCard();
    if (this.ghost) {
      this.host.group.remove(this.ghost.mesh);
      this.ghost.geo.dispose();
      this.ghost.mat.dispose();
      this.ghost = null;
    }
    if (this.lossGhost) {
      this.host.group.remove(this.lossGhost.mesh);
      this.lossGhost.geo.dispose();
      this.lossGhost.mat.dispose();
      this.lossGhost = null;
    }
    if (pending.kind === 'clear') return;
    // Cells naming another grid drape as their own footprint; the trim and the card are the
    // ghost's own grid's, as in 2D.
    const onOwn = (c: GhostCell): boolean => cellGrid(c, pending.grid) === pending.grid;
    const plan = ghostPlan(pending.kind === 'cells' ? pending.cells : [], pending.grid, pending.trim ?? []);
    const cells = pending.kind === 'cells' ? plan.own : spanCells(pending.spans);
    const { across } = plan;
    const trim: DecalTrim[] = plan.trim.map((t) => ({ x: t.x, y: t.y, patch: t.patch, road: t.road, corners: t.corners }));
    if (pending.kind === 'cells' && pending.losses && pending.losses.length > 0) {
      const lossData = joinDecals(
        cellDecals(this.host.state(), pending.losses.filter(onOwn), pending.grid),
        ...[...groupByGrid(pending.losses.filter((c) => !onOwn(c)), pending.grid)].map(([grid, part]) => cellDecals(this.host.state(), part, grid)),
      );
      if (lossData.positions.length) {
        const geo = toGeo(lossData);
        const mat = makeMat(GHOST_LOSS, GHOST_WASH_ALPHA.map3d);
        const mesh = new THREE.Mesh(geo, mat);
        this.host.group.add(mesh);
        this.lossGhost = { mesh, geo, mat };
      }
    }
    const acrossGroups = [...groupByGrid(across, pending.grid)];
    const data = joinDecals(
      cellDecals(this.host.state(), cells, pending.grid, trim), ...acrossGroups.map(([grid, part]) => cellDecals(this.host.state(), part, grid))
    );
    if (!data.positions.length) return;
    const geo = toGeo(data);
    // The preview card or a placement wash: the same two paints the 2D overlay answers to.
    const card = isPreviewCell(pending.paint) ? pending.paint : null;
    const palette = card ? previewPalette(card) : null;
    const mat = palette ? cardBackground(palette, geo) : makeMat(washColor(pending.paint as PlacementWash), GHOST_WASH_ALPHA.map3d);
    const mesh = new THREE.Mesh(geo, mat);
    this.host.group.add(mesh);
    this.ghost = { mesh, geo, mat };
    if (card && palette) this.buildCard(cells, pending.grid, card, palette);
    if (card && palette) for (const [grid, part] of acrossGroups) this.buildCard(part, grid, card, palette, false);
  }

  /** The card's parts that do not stretch with the footprint: its four corner dots, its outline and
   *  its centre glyph. Each is draped at the surface height where it stands, so the card follows a
   *  slope the way the background decal does. */
  private card: Array<THREE.Mesh | THREE.LineSegments> = [];

  private dropCard(): void {
    for (const part of this.card) {
      this.host.group.remove(part);
      part.geometry.dispose();
    }
    this.card = [];
  }

  /** Without `marks` only the outline is drawn, for cells on the other grid beside the card. */
  private buildCard(
    cells: readonly MacroCoord[], grid: GridId, card: PreviewCell, palette: PreviewPalette, marks = true,
  ): void {
    const bounds = cellsBounds(cells);
    if (!bounds) return;
    const s = this.host.state();
    const wx = (cx: number): number => cellCornerWorld(cx, 0, s.template.width, s.template.height, grid).x;
    const wz = (cy: number): number => cellCornerWorld(0, cy, s.template.width, s.template.height, grid).z;
    const surface = (cx: number, cy: number): number => surfaceHeightAt(s, wx(cx), wz(cy));
    const add = (part: THREE.Mesh | THREE.LineSegments): void => {
      this.host.group.add(part);
      this.card.push(part);
    };

    for (const dot of marks ? previewDots(bounds) : []) {
      const geo = new THREE.CircleGeometry(dot.r, 12).rotateX(-Math.PI / 2);
      geo.translate(wx(dot.x), surface(dot.x, dot.y) + DECAL_LIFT * 2, wz(dot.y));
      add(new THREE.Mesh(geo, this.host.mats.fill(palette.line, 1)));
    }

    // The footprint's own rim: a cell edge whose neighbour is outside the shape, at that cell's
    // height — the 2D card's inset line, as far as a one-pixel line can carry it.
    const inSet = new Set(cells.map((c) => cellKey(c.x, c.y)));
    const rim: number[] = [];
    for (const c of cells) {
      const mid = cellCentre(c);
      const y = surface(mid.x, mid.y) + DECAL_LIFT * 2;
      const x0 = wx(c.x), z0 = wz(c.y);
      if (!inSet.has(cellKey(c.x, c.y - 1))) rim.push(x0, y, z0, x0 + 1, y, z0);
      if (!inSet.has(cellKey(c.x, c.y + 1))) rim.push(x0, y, z0 + 1, x0 + 1, y, z0 + 1);
      if (!inSet.has(cellKey(c.x - 1, c.y))) rim.push(x0, y, z0, x0, y, z0 + 1);
      if (!inSet.has(cellKey(c.x + 1, c.y))) rim.push(x0 + 1, y, z0, x0 + 1, y, z0 + 1);
    }
    if (rim.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
      add(new THREE.LineSegments(geo, this.host.mats.edge(palette.line, 1)));
    }

    if (!marks || !card.icon) return;
    const tex = iconTexture(card.icon);
    if (!tex) return;
    const rect = previewIconRect(bounds, card.icon);
    const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
    // The tallest surface under the footprint, sampled at a stride: a glyph at the centre cell's own
    // height sinks into any block beside it, and a map-sized drag shape must not cost a sample a cell.
    let top = surface(cx, cy);
    const stride = Math.max(1, Math.floor(cells.length / 256));
    for (let i = 0; i < cells.length; i += stride) {
      const mid = cellCentre(cells[i]!);
      top = Math.max(top, surface(mid.x, mid.y));
    }
    const geo = new THREE.PlaneGeometry(rect.w, rect.h).rotateX(-Math.PI / 2);
    geo.translate(wx(cx), top + DECAL_LIFT * 3, wz(cy));
    add(new THREE.Mesh(geo, this.iconMaterial(tex)));
  }

  private iconMats = new Map<THREE.Texture, THREE.MeshBasicMaterial>();

  /** One material per glyph, kept for the overlay's life (see `BoxMaterials` for why a per-move material
   *  is the expensive shape here). */
  private iconMaterial(tex: THREE.CanvasTexture): THREE.MeshBasicMaterial {
    let mat = this.iconMats.get(tex);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      });
      this.iconMats.set(tex, mat);
    }
    return mat;
  }

  showCurveFootprint({ grid, cells }: CellSet): void {
    this.clearCurveFootprint();
    const data = cellDecals(this.host.state(), cells, grid);
    if (!data.positions.length) return;
    const geo = toGeo(data), mat = makeMat(CURVE_FOOTPRINT.color, CURVE_FOOTPRINT.alpha);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'curve-footprint';
    this.host.group.add(mesh);
    this.curveFootprint = { mesh, geo, mat };
    this.host.requestRender();
  }

  clearCurveFootprint(): void {
    if (!this.curveFootprint) return;
    const { mesh, geo, mat } = this.curveFootprint;
    this.host.group.remove(mesh); geo.dispose(); mat.dispose();
    this.curveFootprint = null;
    this.host.requestRender();
  }

  dispose(): void {
    this.clearCurveFootprint();
    if (this.placementGhost) {
      this.host.group.remove(this.placementGhost.mesh);
      this.placementGhost = null;
    }
    this.ghostMat.valid?.dispose();
    this.ghostMat.invalid?.dispose();
    this.ghostDepthMat?.dispose();
    this.spanGhostMat.valid?.dispose();
    this.spanGhostMat.invalid?.dispose();
  }

  /** Release the glyph materials; the overlay's last step. */
  disposeMaterials(): void {
    for (const mat of this.iconMats.values()) mat.dispose();
    this.iconMats.clear();
  }
}

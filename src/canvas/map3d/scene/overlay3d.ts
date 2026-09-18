/**
 * The 3D ToolOverlay: every piece of tool feedback the 2D OverlayLayer draws,
 * as surface-draped decals in one scene group. Ghost updates are rAF-coalesced
 * (flush() runs once per rendered frame — a pointer stroke calls showGhost per
 * move); flashes decay through tick(). Colors arrive as the same 0xRRGGBB
 * numbers the 2D overlay uses, so validity tints match across views.
 */
import * as THREE from 'three';
import { MoveOrigins3D } from './move-origins';
import type { Corners, GridState, MacroCoord, ValidationError } from '../../../core/model/types';
import type { ToolOverlay } from '../../view-projection';
import type { MacroRect } from '../../interaction/marquee';
import { filletOnly, type RowSpan } from '../../map2d/layers/ghost-geometry';
import type { TrimmedCell } from '../../../tools/edge-cut';
import { cellDecals, rectDecals, DECAL_LIFT, type DecalTrim } from '../build/overlay-decals';
import { spanCellCentres } from '../build/surface-pieces';
import { surfaceHeightAt } from '../interaction/pick';
import { mapCenterOffset } from '../core/coords';
import { resolveErrorFlashCells, resolveErrorFlashRects, errorFlashSignature, shouldFlashErrors, flashDecay, type ErrorFlashGate, type ErrorFlashRect } from '../../map2d/layers/error-flash';
import { isMotionReduced } from '../../map2d/motion-state';
import { animConfig } from '../../../core/runtime/anim-config';
import {
  CURVE_FOOTPRINT, boundsOfCells, isPreviewCell, previewDots, previewIconRect, previewPalette,
  type GhostPaint, type PreviewCell, type PreviewIcon, type PreviewPalette,
} from '../../../core/runtime/preview-cell';
import { HATCH_CELLS, previewHatchCanvas, previewIconCanvas } from '../../preview-cell-raster';
import { objectInstance } from '../build/object-meshes';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { modelGeometry } from '../models/build-model';
import { archetypeGeometry } from '../build/object-archetypes';
import { type PlacedObject } from '../../../core/model/types';
import type { ArchetypeKey } from '../core/types';

type PendingGhost =
  | { kind: 'cells'; cells: MacroCoord[]; paint: GhostPaint; terrainGrid: boolean; trim?: readonly TrimmedCell[]; losses?: readonly MacroCoord[] }
  | { kind: 'spans'; spans: RowSpan[]; paint: GhostPaint; terrainGrid: boolean; trim?: readonly TrimmedCell[] }
  | { kind: 'clear' };

/** A ghost's `losses` wash: the same warning red `ghostMaterial(false)` already uses for an invalid
 *  placement, so one tint means one thing across the whole overlay. */
const GHOST_LOSS = 0xe2574c;

interface Flash { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial; bornMs: number; lifeMs: number; peak: number }

/** Ghost depth and colour occupy orders 1 and 2. Ordinary decals stay at 0 so the
 *  pre-pass cannot erase them. Move previews use the solid scene instances. */
interface GhostBody { mesh: THREE.Mesh; depth: THREE.Mesh }
const GHOST_DEPTH_ORDER = 1;
const GHOST_COLOR_ORDER = 2;

function makeMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  mat.color.setHex(color).convertSRGBToLinear();
  return mat;
}

function toGeo(m: { positions: number[]; index: number[] }): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  geo.setIndex(m.index);
  return geo;
}

/** Textures are cached for the overlay's life: a ghost rebuilds on every pointer move, and a
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

/** The refused state's stripe tile, mapped in WORLD units (see `cardBackground`). */
function hatchTexture(palette: PreviewPalette): THREE.CanvasTexture | null {
  const tex = cardTexture(`hatch:${palette.bg}:${palette.hatch}`, () => previewHatchCanvas(palette));
  if (tex) { tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping; }
  return tex;
}

/**
 * The card's background material for one flush, plus the world-space UVs its stripes need.
 *
 * The drape is one polygon soup at many heights, so the stripes cannot ride a per-cell quad's own
 * UVs: each vertex takes its texture coordinate from where it STANDS (x, z over the tile's 3-cell
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

export class Overlay3D implements ToolOverlay {
  readonly group = new THREE.Group();

  private moveOrigins: MoveOrigins3D | null = null;
  private moving = false;

  private curveFootprint: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  private pendingGhost: PendingGhost | null = null;
  private ghost: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  /** The `losses` half of the ghost: its own body, its own material, disposed alongside `ghost`. */
  private lossGhost: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  // One box per SELECTED member: a group selection appends into this array.
  private selection: Array<{ mesh: THREE.Mesh; edge: THREE.LineSegments }> = [];
  private hover: { mesh: THREE.Mesh; edge: THREE.LineSegments } | null = null;
  private band: { mesh: THREE.Mesh; edge: THREE.LineSegments } | null = null;
  private buildable: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  /** What the buildable drape was last asked to show. Kept because the decal is baked at each cell's
   *  SURFACE HEIGHT, so a generation under it leaves the mesh describing terrain that is gone. */
  private buildableAsk: { cells: MacroCoord[]; terrainMode: boolean } | null = null;
  private flashes: Flash[] = [];
  private errorGate: ErrorFlashGate | null = null;
  /**
   * BOX PAINT IS CACHED, one material per colour+opacity, and a box never disposes one.
   *
   * three deletes a program the moment its last referencing material is disposed, and links it
   * again the next time something wears it — and the hover box is destroyed and rebuilt on every
   * pointer move, so a per-box material re-links the outline shader that often. On a software
   * rasterizer that link is over a second (the whole orbit sweep's shader cost was three
   * compilations of ONE line shader, each preceded by this dispose). Colour and opacity are
   * per-ROLE constants here — hover, band, selection, footprint — so one material per role paints
   * every box that wears it, and the cache lives as long as the overlay.
   */
  private boxMats = new Map<string, THREE.Material>();

  constructor(
    private state: () => GridState,
    private requestRender: () => void,
    private objectBox: (id: string) => THREE.Box3 | null = () => null,
    private nowMs: () => number = () => performance.now(),
    private moveObjects: (destinations: readonly PlacedObject[]) => void = () => {},
    private camera?: THREE.Camera,
    private viewport?: () => { width: number; height: number },
  ) {
    this.group.renderOrder = 50; // over terrain and water, under nothing that matters
  }

  // ── ghost (rAF-coalesced) ──────────────────────────────────────────────────

  showGhost(cells: MacroCoord[], paint: GhostPaint, terrainGrid = true, trim?: readonly TrimmedCell[], losses?: readonly MacroCoord[]): void {
    this.pendingGhost = { kind: 'cells', cells, paint, terrainGrid, trim, losses };
    this.requestRender();
  }

  showGhostSpans(spans: RowSpan[], paint: GhostPaint, terrainGrid = true, trim?: readonly TrimmedCell[]): void {
    this.pendingGhost = { kind: 'spans', spans, paint, terrainGrid, trim };
    this.requestRender();
  }

  showObjectMove(destinations: readonly PlacedObject[], _valid: boolean): void {
    this.moveOrigins ??= new MoveOrigins3D(this.group, this.camera, this.viewport, this.nowMs);
    this.moveOrigins.show(this.state(), destinations.map(obj => obj.id));
    this.moving = true;
    this.dropPlacementGhost();
    this.clearGroupPlacementGhost();
    this.clearHover();
    for (const box of this.selection) { box.mesh.visible = false; box.edge.visible = false; }
    this.moveObjects(destinations);
    this.requestRender();
  }

  clearGhost(): void {
    this.moveOrigins?.clear();
    if (this.moving) {
      this.moving = false;
      this.moveObjects([]);
      for (const box of this.selection) { box.mesh.visible = true; box.edge.visible = true; }
    }
    this.pendingGhost = { kind: 'clear' };
    this.dropPlacementGhost();
    this.clearGroupPlacementGhost();
    this.requestRender();
  }

  /** The hovered item's actual mesh, translucent + validity-tinted, standing at
   *  the hover cell — the cell decals underneath carry the exact footprint. */
  showPlacementGhost(catalogId: string, x: number, y: number, rotation: number, valid: boolean, elevation: number): void {
    this.placementGhost ??= this.makeGhostBody();
    if (!this.paintGhostMesh(this.placementGhost, catalogId, x, y, rotation, elevation, valid)) {
      this.dropPlacementGhost();
    }
    this.requestRender();
  }

  private placementGhost: GhostBody | null = null;
  private ghostMat: { valid?: THREE.MeshBasicMaterial; invalid?: THREE.MeshBasicMaterial } = {};
  private ghostDepthMat: THREE.MeshBasicMaterial | null = null;

  private ghostMaterial(valid: boolean): THREE.MeshBasicMaterial {
    if (!this.ghostMat.valid) {
      // Warm yellow, not green: the ghost is a flat-colour mesh, and a green one disappears
      // against the mountain strata it most often previews over (a ramp against a high cliff).
      // Same family as the route drape, warmer than the 0xffb347 selection amber.
      this.ghostMat.valid = makeMat(0xffd75e, 0.55);
      this.ghostMat.invalid = makeMat(0xe2574c, 0.55);
    }
    return valid ? this.ghostMat.valid! : this.ghostMat.invalid!;
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

  /** One ghost body, added to the overlay group. The pre-pass is a CHILD of the colour mesh, so a
   *  single transform drives both and hiding the body hides its depth with it. */
  private makeGhostBody(): GhostBody {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMaterial(true));
    mesh.renderOrder = GHOST_COLOR_ORDER;
    const depth = new THREE.Mesh(mesh.geometry, this.ghostDepthMaterial());
    depth.renderOrder = GHOST_DEPTH_ORDER;
    mesh.add(depth);
    this.group.add(mesh);
    return { mesh, depth };
  }

  /** Resolve `catalogId`'s body at (x, y, rotation, elevation) onto ghost body `b`. Returns false
   *  (and hides `b`) when the item has no instanced/modeled body — the caller then falls back to
   *  just the cell wash. Shared by the single hover ghost and each member of the group drag ghost. */
  private paintGhostMesh(
    b: GhostBody, catalogId: string, x: number, y: number, rotation: number, elevation: number, valid: boolean,
  ): boolean {
    const m = b.mesh;
    const resolved = objectInstance(this.state(), {
      id: '__ghost__', catalogId, position: { x, y },
      rotation: (rotation as PlacedObject['rotation']), elevation,
    });
    if (!resolved) return false;
    const isModel = resolved.groupKey.startsWith('m:');
    const geo = isModel ? modelGeometry(resolved.groupKey.slice(2)) : archetypeGeometry(resolved.groupKey.slice(2) as ArchetypeKey);
    if (!geo) return false;
    m.geometry = geo; // shared caches own the geometry — never disposed here
    b.depth.geometry = geo;
    m.material = this.ghostMaterial(valid); // cached per validity: a tint switch swaps, never builds
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
    this.requestRender();
  }

  /** Pool of bodies for the group drag ghost — one per member, reused across pointer moves so a
   *  40-member drag doesn't allocate/dispose 40 meshes per sample. */
  private groupGhosts: GhostBody[] = [];

  showGroupPlacementGhost(
    members: Array<{ catalogId: string; x: number; y: number; rotation: number; elevation: number }>,
    valid: boolean,
  ): void {
    while (this.groupGhosts.length > members.length) {
      this.group.remove(this.groupGhosts.pop()!.mesh);
    }
    while (this.groupGhosts.length < members.length) {
      this.groupGhosts.push(this.makeGhostBody());
    }
    for (let i = 0; i < members.length; i++) {
      const mem = members[i]!;
      const body = this.groupGhosts[i]!;
      body.mesh.visible = this.paintGhostMesh(body, mem.catalogId, mem.x, mem.y, mem.rotation, mem.elevation, valid);
    }
    this.requestRender();
  }

  private clearGroupPlacementGhost(): void {
    if (this.groupGhosts.length === 0) return;
    for (const b of this.groupGhosts) this.group.remove(b.mesh);
    this.groupGhosts = [];
    this.requestRender();
  }

  /** Consume the pending ghost update — called once per rendered frame. */
  flush(): void {
    this.moveOrigins?.update();
    if (this.pendingSelectionIds.length) {
      const ids = this.pendingSelectionIds;
      this.pendingSelectionIds = [];
      this.unresolved = [];
      for (const id of ids) this.buildObjectSelection(id);
    }
    if (this.moving) {
      for (const box of this.selection) { box.mesh.visible = false; box.edge.visible = false; }
    }
    const pending = this.pendingGhost;
    if (!pending) return;
    this.pendingGhost = null;
    this.dropCard();
    if (this.ghost) {
      this.group.remove(this.ghost.mesh);
      this.ghost.geo.dispose();
      this.ghost.mat.dispose();
      this.ghost = null;
    }
    if (this.lossGhost) {
      this.group.remove(this.lossGhost.mesh);
      this.lossGhost.geo.dispose();
      this.lossGhost.mat.dispose();
      this.lossGhost = null;
    }
    if (pending.kind === 'clear') return;
    const cells = pending.kind === 'cells' ? pending.cells : spanCells(pending.spans);
    // Only what the stroke ADDS: a Γ patch's square quadrants are the block underneath it, so they
    // belong to no ghost (the same reduction the 2D overlay makes before it draws). That reduction
    // is TERRAIN's: a road's tokens are not quadrants, and turning its 'square' markers into 'empty'
    // would leave a state `roadCanonicalPoly` does not recognise, quietly degrading the tile to a
    // plain square rather than failing. Branch before it, as 2D does.
    const trim: DecalTrim[] = (pending.trim ?? []).map((t) => ({
      x: t.x, y: t.y, patch: t.patch, road: t.road,
      corners: t.road ? t.corners : (filletOnly(t.corners, t.patch) as Corners),
    }));
    if (pending.kind === 'cells' && pending.losses && pending.losses.length > 0) {
      const lossData = cellDecals(this.state(), pending.losses, pending.terrainGrid);
      if (lossData.positions.length) {
        const geo = toGeo(lossData);
        const mat = makeMat(GHOST_LOSS, 0.4);
        const mesh = new THREE.Mesh(geo, mat);
        this.group.add(mesh);
        this.lossGhost = { mesh, geo, mat };
      }
    }
    const data = cellDecals(this.state(), cells, pending.terrainGrid, trim);
    if (!data.positions.length) return;
    const geo = toGeo(data);
    // The preview CARD or a plain wash — the same two paints the 2D overlay answers to.
    const card = isPreviewCell(pending.paint) ? pending.paint : null;
    const palette = card ? previewPalette(card) : null;
    const mat = palette ? cardBackground(palette, geo) : makeMat(pending.paint as number, 0.4);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.ghost = { mesh, geo, mat };
    if (card && palette) this.buildCard(cells, pending.terrainGrid, card, palette);
  }

  /** The card's parts that do NOT stretch with the footprint: its four corner dots, its outline and
   *  its centre glyph. Each is draped at the surface height where it stands, so the card follows a
   *  slope the way the background decal does. */
  private card: Array<THREE.Mesh | THREE.LineSegments> = [];

  private dropCard(): void {
    for (const part of this.card) {
      this.group.remove(part);
      part.geometry.dispose();
    }
    this.card = [];
  }

  private buildCard(
    cells: readonly MacroCoord[], terrainGrid: boolean, card: PreviewCell, palette: PreviewPalette,
  ): void {
    const bounds = boundsOfCells(cells);
    if (!bounds) return;
    const s = this.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    const shift = terrainGrid ? -0.5 : 0;
    const wx = (cx: number): number => cx - off.x + shift;
    const wz = (cy: number): number => cy - off.z + shift;
    const surface = (cx: number, cy: number): number => surfaceHeightAt(s, wx(cx), wz(cy));
    const add = (part: THREE.Mesh | THREE.LineSegments): void => {
      this.group.add(part);
      this.card.push(part);
    };

    for (const dot of previewDots(bounds)) {
      const geo = new THREE.CircleGeometry(dot.r, 12).rotateX(-Math.PI / 2);
      geo.translate(wx(dot.x), surface(dot.x, dot.y) + DECAL_LIFT * 2, wz(dot.y));
      add(new THREE.Mesh(geo, this.boxFill(palette.line, 1)));
    }

    // The footprint's own rim: a cell edge whose neighbour is outside the shape, at that cell's
    // height — the 2D card's inset line, as far as a one-pixel line can carry it.
    const inSet = new Set(cells.map((c) => `${c.x},${c.y}`));
    const rim: number[] = [];
    for (const c of cells) {
      const y = surface(c.x + 0.5, c.y + 0.5) + DECAL_LIFT * 2;
      const x0 = wx(c.x), z0 = wz(c.y);
      if (!inSet.has(`${c.x},${c.y - 1}`)) rim.push(x0, y, z0, x0 + 1, y, z0);
      if (!inSet.has(`${c.x},${c.y + 1}`)) rim.push(x0, y, z0 + 1, x0 + 1, y, z0 + 1);
      if (!inSet.has(`${c.x - 1},${c.y}`)) rim.push(x0, y, z0, x0, y, z0 + 1);
      if (!inSet.has(`${c.x + 1},${c.y}`)) rim.push(x0 + 1, y, z0, x0 + 1, y, z0 + 1);
    }
    if (rim.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
      add(new THREE.LineSegments(geo, this.boxEdge(palette.line, 1)));
    }

    if (!card.icon) return;
    const tex = iconTexture(card.icon);
    if (!tex) return;
    const rect = previewIconRect(bounds, card.icon);
    const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
    // The TALLEST surface under the footprint, sampled at a stride: a glyph at the centre cell's own
    // height sinks into any block beside it, and a map-sized drag shape must not cost a sample a cell.
    let top = surface(cx, cy);
    const stride = Math.max(1, Math.floor(cells.length / 256));
    for (let i = 0; i < cells.length; i += stride) {
      const c = cells[i]!;
      top = Math.max(top, surface(c.x + 0.5, c.y + 0.5));
    }
    const geo = new THREE.PlaneGeometry(rect.w, rect.h).rotateX(-Math.PI / 2);
    geo.translate(wx(cx), top + DECAL_LIFT * 3, wz(cy));
    add(new THREE.Mesh(geo, this.iconMaterial(tex)));
  }

  private iconMats = new Map<THREE.Texture, THREE.MeshBasicMaterial>();

  /** One material per glyph, kept for the overlay's life (see `boxMats` for why a per-move material
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

  // ── selection / hover boxes ────────────────────────────────────────────────

  /** `append` pushes this box onto the group instead of replacing it (see the ToolOverlay
   *  contract). Only ever true here for a footprint fallback, since terrain never multi-selects. */
  showSelection(x: number, y: number, w = 1, h = 1, _elevation?: number, terrainMode = false, append = false): void {
    if (!append) this.clearSelection();
    this.selection.push(this.makeBox(x, y, w, h, terrainMode, 0xffb347, 0.18, 0.95));
  }

  /** The selection ring as a wireframe around the object's rendered BODY — bounding the mesh, not the
   *  ground footprint. An object with no instanced body (a trimmed road, meshed into the road-trim
   *  mesh) falls back to its MODEL footprint box, so no representation split can cost it a ring. */
  showObjectSelection(objectId: string, append = false): void {
    // Deferred to flush(): selection repaints ride objects-changed, whose
    // handlers can run BEFORE the scene updated the instance — computing now
    // would bound the stale transform. Clearing the OLD boxes needs no fresh instance data, so
    // only the new ones wait.
    if (!append) this.clearSelection();
    this.pendingSelectionIds.push(objectId);
    this.requestRender();
  }

  private pendingSelectionIds: string[] = [];

  /** Ids the last flush could draw NO selection for: the map no longer holds them. A representation
   *  without an instanced body is not one of these — it falls back to its footprint box. */
  private unresolved: string[] = [];

  /** The misses from the last flush (see `unresolved`). A miss is a member the view showed nothing
   *  for, so it is reported rather than swallowed. */
  unresolvedSelections(): readonly string[] {
    return this.unresolved;
  }

  /** The shared fill / outline material for a box role (see `boxMats`). */
  private boxFill(color: number, opacity: number): THREE.MeshBasicMaterial {
    const key = `fill:${color}:${opacity}`;
    let mat = this.boxMats.get(key) as THREE.MeshBasicMaterial | undefined;
    if (!mat) { mat = makeMat(color, opacity); this.boxMats.set(key, mat); }
    return mat;
  }

  private boxEdge(color: number, opacity: number): THREE.LineBasicMaterial {
    const key = `edge:${color}:${opacity}`;
    let mat = this.boxMats.get(key) as THREE.LineBasicMaterial | undefined;
    if (!mat) {
      mat = new THREE.LineBasicMaterial({ transparent: true, opacity });
      mat.color.setHex(color).convertSRGBToLinear();
      this.boxMats.set(key, mat);
    }
    return mat;
  }

  private buildObjectSelection(objectId: string): void {
    const box = this.objectBox(objectId);
    if (!box) {
      // No instanced body: bound the MODEL footprint instead (state/object-geometry is the catalog-aware
      // authority), which is also what the 2D view rings.
      const obj = this.state().objects.get(objectId);
      if (!obj) { this.unresolved.push(objectId); return; }
      const size = getPlacedObjectSize(obj);
      this.selection.push(this.makeBox(obj.position.x, obj.position.y, size.w, size.h, false, 0xffb347, 0.18, 0.95));
      return;
    }
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const geo = new THREE.BoxGeometry(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05));
    geo.translate(center.x, center.y, center.z);
    const edgeGeo = new THREE.EdgesGeometry(geo);
    geo.dispose();
    const edge = new THREE.LineSegments(edgeGeo, this.boxEdge(0xffb347, 0.95));
    const fillMat = this.boxFill(0xffb347, 0.06);
    const fill = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05)).translate(center.x, center.y, center.z), fillMat);
    this.group.add(fill, edge);
    this.selection.push({ mesh: fill, edge });
    this.requestRender();
  }

  clearSelection(): void {
    this.pendingSelectionIds = [];
    this.unresolved = [];
    for (const box of this.selection) this.dropBox(box);
    this.selection = [];
  }

  private lastHoverKey = '';

  /** Keyed so a stationary hover — pointermove fires per pixel — doesn't rebuild geometry. The
   *  sampled surface top rides in the key, so a terrain edit under a still cursor still rebuilds. */
  showHover(x: number, y: number, w = 1, h = 1, terrainMode = false): void {
    const top = this.surfaceTop(x, y, w, h, terrainMode);
    const key = `${x},${y},${w},${h},${terrainMode ? 1 : 0},${top}`;
    if (this.hover && key === this.lastHoverKey) return;
    this.lastHoverKey = key;
    this.clearHover();
    this.hover = this.makeBox(x, y, w, h, terrainMode, 0xf5f5f5, 0.08, 0.5, top);
  }

  clearHover(): void {
    if (this.hover) this.dropBox(this.hover);
    this.hover = null;
  }

  /** The Ctrl+drag rubber band: the same surface-draped box geometry as hover/selection, so it
   *  drapes over terrain identically. No terrainMode shift, since a band only selects objects. */
  showBand(rect: MacroRect): void {
    this.clearBand();
    this.band = this.makeBox(rect.x, rect.y, rect.w, rect.h, false, 0x4da6ff, 0.08, 0.7);
  }

  clearBand(): void {
    if (this.band) this.dropBox(this.band);
    this.band = null;
  }

  /** A footprint box: translucent fill + a brighter outline, ONE flat rect at the footprint's
   *  tallest surface so it never sinks into a hill — a box bounds what is under it, so unlike a
   *  drape it does not follow a trimmed corner down.
   *
   *  The height is sampled at the CENTRE of each cell the box actually covers
   *  (`spanCellCentres`), which is not the same set of points as stepping in whole cells from the
   *  box's own — possibly fractional — origin. */
  private surfaceTop(x: number, y: number, w: number, h: number, terrainMode: boolean): number {
    const s = this.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    const shift = terrainMode ? -0.5 : 0;
    let top = 0;
    for (const cz of spanCellCentres(y, h)) {
      for (const cx of spanCellCentres(x, w)) {
        top = Math.max(top, surfaceHeightAt(s, cx - off.x + shift, cz - off.z + shift));
      }
    }
    return top;
  }

  private makeBox(x: number, y: number, w: number, h: number, terrainMode: boolean, color: number, fillA: number, edgeA: number, top = this.surfaceTop(x, y, w, h, terrainMode)) {
    const s = this.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    const shift = terrainMode ? -0.5 : 0;
    const x0 = x - off.x + shift, z0 = y - off.z + shift;
    const yTop = top + DECAL_LIFT * 2;
    const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
    geo.translate(x0 + w / 2, yTop, z0 + h / 2);
    const mesh = new THREE.Mesh(geo, this.boxFill(color, fillA));
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edge = new THREE.LineSegments(edgeGeo, this.boxEdge(color, edgeA));
    this.group.add(mesh, edge);
    this.requestRender();
    return { mesh, edge };
  }

  /** Geometry is per box and goes; the materials are the shared ones from `boxMats` and stay. */
  private dropBox(box: { mesh: THREE.Mesh; edge: THREE.LineSegments }): void {
    this.group.remove(box.mesh, box.edge);
    box.mesh.geometry.dispose();
    box.edge.geometry.dispose();
    this.requestRender();
  }

  // ── flashes (commit + error) ───────────────────────────────────────────────

  flashCommit(cells: readonly (MacroCoord & { micro?: boolean })[], opts: { color?: number; terrainMode?: boolean } = {}): void {
    // Matches the 2D policy exactly: the commit beat is DECORATIVE confirmation (the cells already
    // show their committed state), so reduced motion skips it. Error flashes below are essential
    // evidence and are never suppressed, only rate-limited.
    if (isMotionReduced() || cells.length === 0) return;
    const cfg = animConfig.flash.commit;
    const fallback = opts.terrainMode ?? true; // the terrain grid, as 2D states it — see OverlayLayer.flashCommit
    // A cell may name its own grid — one undo step can hold a terrain change and an object change,
    // which drape half a cell apart — so each grid gets its own decal.
    for (const micro of [true, false]) {
      const part = cells.filter((c) => (c.micro ?? fallback) === micro);
      if (part.length) {
        this.spawnFlash(part.map((c) => ({ x: c.x, y: c.y })), opts.color ?? cfg.color, micro, cfg.durationMs, cfg.peakAlpha);
      }
    }
  }

  /** The evidence contract: flash the offending cells, same resolve + repeat-
   *  violation cooldown gate as the 2D overlay. */
  flashErrors(errors: ValidationError[], terrainMode: boolean): void {
    const cells = resolveErrorFlashCells(errors, terrainMode);
    const rects = resolveErrorFlashRects(errors, terrainMode);
    if (!cells.length && !rects.length) return;
    const sig = errorFlashSignature(cells, rects);
    const now = this.nowMs();
    if (!shouldFlashErrors(this.errorGate, sig, now, animConfig.flash.errorRepeatCooldownMs)) return;
    this.errorGate = { sig, at: now };
    // Evidence carries its own grid (an object blocking a terrain paint
    // flashes on the macro grid even when the command was micro) — split and
    // drape each set on its grid. A BODY (`rects`) is draped whole, the same exact footprint
    // the 2D overlay fills, rather than as the cells it touches.
    const err = animConfig.flash.error;
    for (const micro of [true, false]) {
      const part = cells.filter((c) => c.micro === micro);
      if (part.length) this.spawnFlash(part.map((c) => ({ x: c.x, y: c.y })), err.color, micro, err.durationMs, err.peakAlpha);
      const bodies = rects.filter((r) => r.micro === micro);
      if (bodies.length) this.spawnFlash(bodies, err.color, micro, err.durationMs, err.peakAlpha);
    }
  }

  private spawnFlash(
    shapes: MacroCoord[] | readonly ErrorFlashRect[], color: number, terrainGrid: boolean, lifeMs: number, peak: number,
  ): void {
    const state = this.state();
    const data = isRectList(shapes)
      ? rectDecals(state, shapes, terrainGrid)
      : cellDecals(state, shapes, terrainGrid);
    if (!data.positions.length) return;
    const geo = toGeo(data);
    const mat = makeMat(color, peak);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.flashes.push({ mesh, geo, mat, bornMs: this.nowMs(), lifeMs, peak });
    this.requestRender();
  }

  /** Advance flash decay; true while any flash is alive (keeps the render
   *  window open, like a canvas animation). */
  tick(): boolean {
    const fading = this.moveOrigins?.tick() ?? false;
    const pulsing = this.stepRegionPulse() || fading;
    if (this.flashes.length === 0) return pulsing;
    const now = this.nowMs();
    this.flashes = this.flashes.filter((f) => {
      const age = (now - f.bornMs) / f.lifeMs;
      if (age >= 1) {
        this.group.remove(f.mesh);
        f.geo.dispose();
        f.mat.dispose();
        return false;
      }
      // The 2D flash curve exactly (shared flashDecay): one smooth beat, peak → 0 as (1 − t²).
      f.mat.opacity = flashDecay(f.peak, age);
      return true;
    });
    return this.flashes.length > 0 || pulsing;
  }

  // ── buildable region ───────────────────────────────────────────────────────

  showBuildableRegion(cells: MacroCoord[], terrainMode: boolean): void {
    this.clearBuildableRegion();
    this.buildableAsk = { cells: [...cells], terrainMode };
    const data = cellDecals(this.state(), cells, terrainMode);
    if (!data.positions.length) return;
    const geo = toGeo(data);
    // WHITE, as the 2D view draws it, and for the reason the 2D view can ignore: this decal tints
    // the terrain it lies on, and the terrain is eight greens plus a green grass zone. A green tint
    // over green changes almost nothing, so the region a person had just painted was invisible over
    // exactly the surface they were most likely to paint it on. White lightens whatever is under it.
    const mat = makeMat(0xffffff, 0.25);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.buildable = { mesh, geo, mat };
    this.requestRender();
  }

  /**
   * Re-bake the buildable drape over the terrain as it stands NOW.
   *
   * The decal carries a height per cell, read when it was built, so anything that changes the
   * surface under a painted region — a generation above all — leaves it floating at the old
   * elevation until the region is shown again. The scene calls this whenever cells change.
   */
  refreshBuildable(): void {
    const ask = this.buildableAsk;
    if (!ask) return;
    this.showBuildableRegion(ask.cells, ask.terrainMode);
  }

  /** The pulse in flight: when it started, how long it runs and how far the drape dips. */
  private regionPulse: { bornMs: number; lifeMs: number; dip: number; base: number } | null = null;

  /**
   * The standing region drape breathing once (`panel.region.pulse`; the numbers come from the
   * caller, since the registry is where a duration is declared). The 2D view's own note explains
   * why it is a dip and not a new mark.
   *
   * Driven from `tick()` rather than from an rAF of its own: this scene renders ON DEMAND, and an
   * animation outside the loop that keeps the window open would paint into frames nobody drew.
   */
  pulseBuildableRegion(durationMs: number, dip: number): void {
    const drape = this.buildable;
    this.endRegionPulse();
    if (!drape || isMotionReduced()) return;
    this.regionPulse = { bornMs: this.nowMs(), lifeMs: durationMs, dip, base: drape.mat.opacity };
    this.requestRender();
  }

  private stepRegionPulse(): boolean {
    const p = this.regionPulse;
    if (!p) return false;
    const drape = this.buildable;
    if (!drape) { this.regionPulse = null; return false; }
    const t = Math.min((this.nowMs() - p.bornMs) / p.lifeMs, 1);
    drape.mat.opacity = p.base * (1 - p.dip * Math.sin(Math.PI * t));
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
    this.endRegionPulse();
    this.buildableAsk = null;
    if (!this.buildable) return;
    this.group.remove(this.buildable.mesh);
    this.buildable.geo.dispose();
    this.buildable.mat.dispose();
    this.buildable = null;
    this.requestRender();
  }

  // ── maze route ─────────────────────────────────────────────────────────────

  private route: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;

  showCurveFootprint(cells: MacroCoord[], terrainGrid: boolean): void {
    this.clearCurveFootprint();
    const data = cellDecals(this.state(), cells, terrainGrid);
    if (!data.positions.length) return;
    const geo = toGeo(data), mat = makeMat(CURVE_FOOTPRINT.color, CURVE_FOOTPRINT.alpha);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'curve-footprint';
    this.group.add(mesh);
    this.curveFootprint = { mesh, geo, mat };
    this.requestRender();
  }

  clearCurveFootprint(): void {
    if (!this.curveFootprint) return;
    const { mesh, geo, mat } = this.curveFootprint;
    this.group.remove(mesh); geo.dispose(); mat.dispose();
    this.curveFootprint = null;
    this.requestRender();
  }

  /** The maze's answer, in the 2D view's own yellow, on the TERRAIN grid — the walls stand at the
   *  −HALF_TILE offset here too, so the corridor floor between them is the shifted rect. Its own
   *  decal, so it stands beside the buildable-region drape without either replacing the other. */
  showRoute(cells: MacroCoord[]): void {
    this.clearRoute();
    const data = cellDecals(this.state(), cells, true);
    if (!data.positions.length) return;
    const geo = toGeo(data);
    const mat = makeMat(0xffd75e, 0.55);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.route = { mesh, geo, mat };
    this.requestRender();
  }

  clearRoute(): void {
    if (!this.route) return;
    this.group.remove(this.route.mesh);
    this.route.geo.dispose();
    this.route.mat.dispose();
    this.route = null;
    this.requestRender();
  }

  dispose(): void {
    this.clearCurveFootprint();
    this.moveOrigins?.dispose();
    this.moveOrigins = null;
    if (this.moving) this.moveObjects([]);
    this.moving = false;
    if (this.placementGhost) {
      this.group.remove(this.placementGhost.mesh);
      this.placementGhost = null;
    }
    this.ghostMat.valid?.dispose();
    this.ghostMat.invalid?.dispose();
    this.ghostDepthMat?.dispose();
    this.clearGhost();
    this.flush();
    this.clearSelection();
    this.clearHover();
    this.clearBand();
    this.clearBuildableRegion();
    this.clearRoute();
    for (const f of this.flashes) {
      this.group.remove(f.mesh);
      f.geo.dispose();
      f.mat.dispose();
    }
    this.flashes = [];
    for (const mat of this.boxMats.values()) mat.dispose();
    this.boxMats.clear();
    for (const mat of this.iconMats.values()) mat.dispose();
    this.iconMats.clear();
  }
}

/** Which of `spawnFlash`'s two shape forms it was handed: a body carries an extent, a cell does not. */
function isRectList(shapes: MacroCoord[] | readonly ErrorFlashRect[]): shapes is readonly ErrorFlashRect[] {
  return shapes.length > 0 && 'w' in shapes[0]!;
}

/** Expand merged row spans back to cells (3D drapes per cell — heights vary). */
function spanCells(spans: readonly RowSpan[]): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const s of spans) {
    for (let i = 0; i < s.w; i++) out.push({ x: s.x + i, y: s.y });
  }
  return out;
}

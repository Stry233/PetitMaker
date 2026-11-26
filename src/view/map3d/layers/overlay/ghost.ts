import { getCatalogItem } from '../../../../state/catalog';
import { isRamp, isBridge } from '../../../../core/model/traits';
import * as THREE from 'three';
import { type GridState, type MacroCoord, type PlacedObject, type Rotation } from '../../../../core/model/types';
import type { GhostBlock, GhostCell, GhostPrior, GhostGround, GhostPaint, GhostRequest, PlacementGhost, PlacementPaint, PreviewCell, PreviewIcon } from '../../../../tools/pointer/runtime';
import { edgeInsideSide, GHOST_WASH_ALPHA, ghostOutline, ghostPlan } from '../../../shared/overlay/ghost-geometry';
import type { TrimmedCell } from '../../../../tools/trim';
import { cellDecals, joinDecals, DECAL_LIFT, type DecalMesh, type DecalTrim } from '../../geometry/overlay-decals';
import { surfaceHeightAt } from '../../geometry/pick';
import { GROUND_SLAB_Y, cellCornerWorld, surfaceY, waterSurfaceY } from '../../geometry/coords';
import { PLACEMENT_GRID } from '../../../../core/game/profile';
import { emptyMesh, quad } from '../../geometry/mesh-emit';
import { zoneColor } from '../../draw/palette';
import type { MeshData } from '../../geometry/types';
import { boundaryEdges, groupByGrid, spanCells, spanMembership, type EdgeSegment, type RowSpan } from '../../../../core/grid/cell-spans';
import { cellGrid, type CellSet, type GridId, type MixedCellSet } from '../../../../core/grid/grids';
import { CURVE_FOOTPRINT, isPreviewCell, previewDots, previewIconRect, previewPalette, type PreviewPalette } from '../../../shared/overlay/preview-cell';
import { HATCH_CELLS, previewHatchCanvas, previewIconCanvas } from '../../../shared/overlay/preview-cell-raster';
import { objectInstance } from '../../geometry/object-meshes';
import { groupModelGeometry } from '../../models/build-model';
import { archetypeGeometry } from '../../models/object-archetypes';
import { cellsBounds, cellKey } from '../../../../core/grid/rect';
import type { ArchetypeKey } from '../../geometry/types';
import { cellCentre, gridSize } from '../../../../core/grid/grid-convert';
import type { OverlayHost3D } from './host';
import { makeMat } from './paint';
import { toPlainGeometry } from '../../draw/mesh-upload';
import { GHOST_LOOK, GHOST_LOSS, ghostTint } from '../../../shared/viewport/view-constants';
import { scratchGrid } from '../../../../core/model/grid-model';
import { buildCellBlocks } from '../../geometry/terrain-geometry';
import { animConfig } from '../../../shared/motion/anim-config';
import { flipScale, groupEase } from '../../../shared/motion/group-arc';
import type { FlipAxes } from '../../../../tools/objects';
import { isMotionReduced } from '../../../../platform/channels/motion-state';
import { toGeometry } from '../../draw/mesh-upload';
import { ribbonStrips } from '../../geometry/ink-path';
import { RoadSurfaces3D } from '../road-surfaces';
import { roadGhost } from '../../../shared/road/region-cache';
import { clipMeshToRects, type GroundRect } from '../../geometry/mesh-clip';
import type { RoadLookup } from '../../../../core/model/road-lookup';
import { roadLookup } from '../../../../state/object-index';

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

/** A placement ghost's materials, one per state, kept for the overlay's life: a ghost repaints on
 *  every pointer move, and a material made per move is a program link per move. */
function ghostMaterial(color: number, vertexColors: boolean): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    vertexColors, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity: GHOST_LOOK.opacity, depthWrite: false,
  });
  mat.color.setHex(color).convertSRGBToLinear();
  return mat;
}

/** How far a water block's ghost rises from the recessed waterline the mesher draws it at to the
 *  ground the water fills, which the map still holds and would hide it under. */
const WATER_GHOST_RISE = surfaceY(0) - waterSurfaceY(0) + DECAL_LIFT;

/**
 * Placement ghosts: what a placement lays drawn as the real thing at the ghost's opacity (terrain
 * blocks through the terrain mesher, road tiles through the road surfaces, item models standing
 * over their footprints), a refused one tinted and washed in the loss red, each outlined round its
 * footprint; the draped preview card a tool shows where it acts; and the editable curve footprint.
 */
export class OverlayGhosts3D {
  constructor(private readonly host: OverlayHost3D) {}

  private curveFootprint: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  private pendingGhost: GhostRequest | null = null;
  /** A refused placement's wash over its footprint, in the overlay's shared fill material. */
  private refusedWash: THREE.Mesh | null = null;
  /** The card's draped background. */
  private ghost: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  /** The `losses` half of the ghost: its own body, its own material, disposed alongside `ghost`. */
  private lossGhost: { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } | null = null;
  private readonly mats = new Map<string, THREE.Material>();

  showGhost({ grid, cells }: MixedCellSet, paint: GhostPaint, trim?: readonly TrimmedCell[], losses?: readonly GhostCell[]): void {
    this.pendingGhost = { kind: 'cells', cells, paint, grid, trim, losses };
    this.host.requestRender();
  }

  showGhostSpans(spans: RowSpan[], paint: GhostPaint, grid: GridId, trim?: readonly TrimmedCell[]): void {
    this.pendingGhost = { kind: 'spans', spans, paint, grid, trim };
    this.host.requestRender();
  }

  /** The hovered item's own model, translucent and tinted when refused, standing at the hover cell
   *  over the footprint outline. */
  showPlacementGhost({ catalogId, x, y, rotation, elevation, spanLength }: PlacementGhost, valid: boolean): void {
    this.placementGhost ??= this.makeGhostBody();
    if (!this.paintGhostMesh(this.placementGhost, { catalogId, x, y, rotation, elevation, spanLength }, valid)) {
      this.dropPlacementGhost();
    }
    this.host.requestRender();
  }

  private placementGhost: GhostBody | null = null;
  private ghostDepthMat: THREE.MeshBasicMaterial | null = null;

  /** A cached material under `key`, made by `make` the first time. */
  private cached<M extends THREE.Material>(key: string, make: () => M): M {
    let mat = this.mats.get(key) as M | undefined;
    if (!mat) { mat = make(); this.mats.set(key, mat); }
    return mat;
  }

  /** A body's colour pass: a model's own vertex colours, or an archetype's colour, as `valid` draws them. */
  private bodyMaterial(valid: boolean, rgb: readonly [number, number, number] | null): THREE.MeshLambertMaterial {
    if (!rgb) return this.cached(`model:${valid}`, () => ghostMaterial(ghostTint(valid), true));
    const hex = new THREE.Color(rgb[0], rgb[1], rgb[2]).getHex();
    return this.cached(`body:${hex}:${valid}`, () => {
      const mat = ghostMaterial(0xffffff, false);
      mat.color.setRGB(rgb[0], rgb[1], rgb[2]).lerp(new THREE.Color().setHex(GHOST_LOSS).convertSRGBToLinear(), valid ? 0 : GHOST_LOOK.refusedTint);
      return mat;
    });
  }

  /** Terrain blocks' paint: the mesher's own colours, through a depth test that loses every tie, so
   *  a face the map already draws in the same place (a column's lower strata) keeps the map's. */
  private blockMaterial(valid: boolean): THREE.MeshLambertMaterial {
    return this.cached(`block:${valid}`, () => {
      const mat = ghostMaterial(ghostTint(valid), true);
      mat.depthFunc = THREE.LessDepth;
      return mat;
    });
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

  /** Terrain blocks' pre-pass: writes depth pushed back a hair, so the colour pass still draws the
   *  body's nearest surface while it loses every tie with the map's own faces (`blockMaterial`), and
   *  every face behind that surface, a back wall or a block behind another, draws nothing. */
  private blockDepthMaterial(): THREE.MeshBasicMaterial {
    return this.cached('block-depth', () => new THREE.MeshBasicMaterial({
      transparent: true, colorWrite: false, depthWrite: true, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
  }

  /** A terrain body's mesh at the colour order, with its depth pre-pass as a child sharing its geometry. */
  private blockMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = GHOST_COLOR_ORDER;
    const depth = new THREE.Mesh(geo, this.blockDepthMaterial());
    depth.renderOrder = GHOST_DEPTH_ORDER;
    mesh.add(depth);
    return mesh;
  }

  /** One ghost body, added to the overlay group. The pre-pass is a child of the colour mesh, so a
   *  single transform drives both and hiding the body hides its depth with it. */
  private makeGhostBody(): GhostBody {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.bodyMaterial(true, null));
    mesh.renderOrder = GHOST_COLOR_ORDER;
    const depth = new THREE.Mesh(mesh.geometry, this.ghostDepthMaterial());
    depth.renderOrder = GHOST_DEPTH_ORDER;
    mesh.add(depth);
    this.host.group.add(mesh);
    return { mesh, depth };
  }

  /** Resolve `catalogId`'s body at (x, y, rotation, elevation) onto ghost body `b`. Returns false
   *  (and hides `b`) when the item has no instanced/modeled body — the caller then falls back to
   *  just the footprint. Shared by the single hover ghost and each member of the group ghost. */
  private paintGhostMesh(
    b: GhostBody, ghost: { catalogId: string; x: number; y: number; rotation: number; elevation: number; spanLength?: number },
    valid: boolean, onBuilt = false,
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
    const inst = resolved.inst;
    m.material = this.bodyMaterial(valid, isModel ? null : inst.color);
    // A body on terrain the same ghost builds stands on that terrain, which the map does not hold yet;
    // a ramp or a bridge already stands at its own elevation.
    const standsAt = onBuilt && !isRamp(item) && !isBridge(item) ? surfaceY(elevation) : inst.y;
    m.position.set(inst.x, standsAt, inst.z);
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

  /** Pool of bodies for the group ghost — one per member, reused across pointer moves so a
   *  40-member drag doesn't allocate/dispose 40 meshes per sample. */
  private groupGhosts: GhostBody[] = [];

  showGroupPlacementGhost(members: readonly PlacementGhost[], valid: boolean, onBuilt = false): void {
    while (this.groupGhosts.length > members.length) {
      this.host.group.remove(this.groupGhosts.pop()!.mesh);
    }
    while (this.groupGhosts.length < members.length) {
      this.groupGhosts.push(this.makeGhostBody());
    }
    for (let i = 0; i < members.length; i++) {
      const mem = members[i]!;
      const body = this.groupGhosts[i]!;
      const ghost = { catalogId: mem.catalogId, x: mem.x, y: mem.y, rotation: mem.rotation, elevation: mem.elevation, spanLength: mem.spanLength };
      body.mesh.visible = this.paintGhostMesh(body, ghost, valid, onBuilt);
    }
    this.host.requestRender();
  }

  private clearGroupPlacementGhost(): void {
    if (this.groupGhosts.length === 0) return;
    for (const b of this.groupGhosts) this.host.group.remove(b.mesh);
    this.groupGhosts = [];
    this.host.requestRender();
  }

  /** Hide the placement and group ghost bodies. */
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
    this.dropLay();
    if (this.refusedWash) {
      this.host.group.remove(this.refusedWash);
      this.refusedWash.geometry.dispose();
      this.refusedWash = null;
    }
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
        const geo = toPlainGeometry(lossData);
        const mat = makeMat(GHOST_LOSS, GHOST_WASH_ALPHA.map3d);
        const mesh = new THREE.Mesh(geo, mat);
        this.host.group.add(mesh);
        this.lossGhost = { mesh, geo, mat };
      }
    }
    const acrossGroups = [...groupByGrid(across, pending.grid)];
    const footprint = (): DecalMesh => joinDecals(
      cellDecals(this.host.state(), cells, pending.grid, trim), ...acrossGroups.map(([grid, part]) => cellDecals(this.host.state(), part, grid)),
    );
    if (!isPreviewCell(pending.paint)) {
      this.buildPlacement(pending, pending.paint, { cells, across: acrossGroups, trim: plan.trim, footprint });
      return;
    }
    const data = footprint();
    if (!data.positions.length) return;
    const geo = toPlainGeometry(data);
    const card = pending.paint;
    const palette = previewPalette(card);
    const mat = cardBackground(palette, geo);
    const mesh = new THREE.Mesh(geo, mat);
    this.host.group.add(mesh);
    this.ghost = { mesh, geo, mat };
    this.buildCard(cells, pending.grid, card, palette);
    for (const [grid, part] of acrossGroups) this.buildCard(part, grid, card, palette, false);
  }

  /* ── a placement ─────────────────────────────────────────────────────────── */

  /** The lay meshes (solid, water, waterfall blocks and turned ground), reused across moves; their geometry is the
   *  ghost's own, rebuilt per flush. */
  private blockMeshes: (THREE.Mesh | undefined)[] = [];
  /** The road surfaces each road ghost look draws through (`roadSurfaces`), each with its own materials. */
  private roads: { valid?: RoadSurfaces3D; refused?: RoadSurfaces3D; beside?: RoadSurfaces3D } = {};
  /** The outline ribbons, rebuilt per flush. */
  private outline: THREE.Mesh[] = [];
  /** Each road ghost's own object version, so no cache keyed on one mistakes it for another map. */
  private roadGhostVersion = 0;
  /** The lookup the last road ghost's surfaces read. */
  private roadLookup: RoadLookup | undefined;

  /**
   * What a placement lays, as the real thing: its blocks through the terrain mesher over a scratch
   * of the map holding them, its road tiles through the road surfaces; when refused, the footprint
   * washed in the loss red; and its outline, at the height each edge's cell will stand at.
   */
  private buildPlacement(
    pending: Exclude<GhostRequest, { kind: 'clear' }>, paint: PlacementPaint,
    parts: { cells: readonly MacroCoord[]; across: [GridId, GhostCell[]][]; trim: readonly TrimmedCell[]; footprint: () => DecalMesh },
  ): void {
    const live = this.host.state();
    if (paint.ground?.length) this.paintGround(live, paint.ground, paint.valid);
    const built = paint.blocks?.length ? this.paintBlocks(live, paint.blocks, paint.valid) : live;
    if (paint.tiles?.length) this.paintRoads(live, paint.tiles, paint.valid);
    if (!paint.valid) {
      const data = parts.footprint();
      if (data.positions.length) {
        const mesh = new THREE.Mesh(toPlainGeometry(data), this.host.mats.fill(GHOST_LOSS, GHOST_LOOK.refusedWash));
        this.host.group.add(mesh);
        this.refusedWash = mesh;
      }
    }
    // An edge stands at the taller of the map and what the ghost builds there, read just inside it.
    const height = (wx: number, wz: number): number => Math.max(surfaceHeightAt(live, wx, wz), surfaceHeightAt(built, wx, wz));
    const own = pending.kind === 'spans'
      ? { edges: ghostOutline({ spans: pending.spans }, parts.trim), inside: spanMembership(pending.spans) }
      : { edges: ghostOutline({ cells: parts.cells }, parts.trim), inside: memberOf(parts.cells) };
    const paths = edgePaths(live, own.edges, pending.grid, own.inside, height);
    for (const [grid, part] of parts.across) paths.push(...edgePaths(live, boundaryEdges(part), grid, memberOf(part), height));
    const { outline } = GHOST_LOOK;
    const strokes: ReadonlyArray<readonly [number, number, number]> = paint.valid
      ? [[outline.halo, 0x000000, 0.35], [outline.valid, 0xffffff, 0.9]]
      : [[outline.refused, GHOST_LOSS, 1]];
    // Ahead of the bodies' depth pre-pass, so the outline shows through a translucent model; the
    // two strokes tie on order and depth, so they draw in creation order, the core over the halo.
    for (const [width, color, alpha] of strokes) {
      const ribbon = ribbonStrips(paths, width);
      if (!ribbon) continue;
      const mesh = new THREE.Mesh(toPlainGeometry(ribbon), this.host.mats.fill(color, alpha));
      this.host.group.add(mesh);
      this.outline.push(mesh);
    }
  }

  /** The blocks through the terrain mesher, read against the map with the blocks laid on a scratch
   *  of it, which it returns; water rises to the ground it fills. */
  private paintBlocks(live: GridState, blocks: readonly GhostBlock[], valid: boolean): GridState {
    const built = scratchGrid(live, blocks);
    for (const b of blocks) {
      const cell = built.cells[b.y]?.[b.x];
      if (cell) cell.terrain = b.terrain;
    }
    const meshes = buildCellBlocks(built, blocks);
    const mat = this.blockMaterial(valid);
    [meshes.solid, meshes.water, meshes.fall].forEach((data, i) => this.showLayMesh(i, data, mat, i === 0 ? 0 : WATER_GHOST_RISE));
    return built;
  }

  private turning: { body: THREE.Group; born: number; sweepRad: number; flip: FlipAxes | undefined; release: (() => void) | undefined } | null = null;

  /** The turning body of a placement turned a quarter: `blocks`, as the map now holds them, through the
   *  terrain mesher as the ghost draws them, swung in from the pose before the turn about `pivot` (cells
   *  of the placement grid) on the group rotation's clock; a flipped one opens out from its mirror
   *  across `flip`'s axes on the flip's clock. Reduced motion draws nothing. */
  turnBlocks(blocks: readonly GhostBlock[], prior: readonly GhostPrior[], pivot: MacroCoord, sweepDeg: number, flip?: FlipAxes): void {
    if (isMotionReduced() || blocks.length === 0) return;
    this.endTurn();
    const live = this.host.state();
    const built = scratchGrid(live, blocks);
    for (const b of blocks) {
      const cell = built.cells[b.y]?.[b.x];
      if (cell) cell.terrain = b.terrain;
    }
    const meshes = buildCellBlocks(built, blocks);
    const { width, height } = live.template;
    const centre = cellCornerWorld(pivot.x, pivot.y, width, height, PLACEMENT_GRID);
    const body = new THREE.Group();
    body.position.set(centre.x, 0, centre.z);
    const mat = this.blockMaterial(true);
    [meshes.solid, meshes.water, meshes.fall].forEach((data, i) => {
      if (!data.positions.length) return;
      const mesh = this.blockMesh(toGeometry(data, 'turning body'), mat);
      mesh.position.set(-centre.x, i === 0 ? 0 : WATER_GHOST_RISE, -centre.z);
      body.add(mesh);
    });
    this.host.group.add(body);
    // The landed cells show as they stood before the placement until the turn ends.
    this.turning = { body, born: performance.now(), sweepRad: (sweepDeg * Math.PI) / 180, flip, release: this.host.holdTerrain(prior) };
    this.host.requestRender();
  }

  /** Advances the turning body; true while it runs. */
  tickTurn(): boolean {
    const turn = this.turning;
    if (!turn) return false;
    const t = Math.min((performance.now() - turn.born) / animConfig.groupRotation.durationMs, 1);
    if (turn.flip) {
      // Terrain is mirrored for real, so the body takes the signed scale (three flips the face winding of a mirrored body).
      const k = flipScale(groupEase(t));
      turn.body.scale.set(turn.flip.x ? k : 1, 1, turn.flip.y ? k : 1);
    } else {
      turn.body.rotation.y = turn.sweepRad * (1 - groupEase(t));
    }
    if (t >= 1) { this.endTurn(); return false; }
    return true;
  }

  private endTurn(): void {
    if (!this.turning) return;
    const { body, release } = this.turning;
    release?.();
    this.host.group.remove(body);
    for (const mesh of body.children) (mesh as THREE.Mesh).geometry.dispose();
    this.turning = null;
    this.host.requestRender();
  }

  /** One of the lay meshes (solid, water, waterfall, ground), its geometry this flush's, at `y`. */
  private showLayMesh(slot: number, data: MeshData, mat: THREE.Material, y: number): void {
    if (!data.positions.length) return;
    let mesh = this.blockMeshes[slot];
    if (!mesh) {
      mesh = this.blockMesh(new THREE.BufferGeometry(), mat);
      this.blockMeshes[slot] = mesh;
    }
    setBodyGeometry(mesh, toGeometry(data, 'placement ghost'));
    mesh.material = mat;
    mesh.position.y = y;
    this.host.group.add(mesh);
  }

  /** Ground a placement turns, as the land slab in its zone's colour, on the grid zones lie on. */
  private paintGround(live: GridState, ground: readonly GhostGround[], valid: boolean): void {
    const data = emptyMesh();
    const { width, height } = live.template;
    for (const g of ground) {
      const { x, z } = cellCornerWorld(g.x, g.y, width, height, PLACEMENT_GRID);
      quad(data, [[x, GROUND_SLAB_Y, z], [x, GROUND_SLAB_Y, z + 1], [x + 1, GROUND_SLAB_Y, z + 1], [x + 1, GROUND_SLAB_Y, z]], zoneColor(g.zone));
    }
    this.showLayMesh(3, data, this.blockMaterial(valid), DECAL_LIFT);
  }

  /** The road surfaces one look draws through: `refused` cut to the ghost's own cells, `beside` to
   *  the road tiles it joins, which keep their own colours. */
  private roadSurfaces(key: 'valid' | 'refused' | 'beside'): RoadSurfaces3D {
    const tint = ghostTint(key !== 'refused');
    return this.roads[key] ??= new RoadSurfaces3D({
      scene: this.host.group, state: () => this.host.state(), hiddenLayers: () => NO_LAYERS,
      maxAnisotropy: () => 1, disposed: () => false, requestRender: () => this.host.requestRender(),
      rebuildOwed: () => this.host.requestRender(),
      roads: (state) => this.roadLookup ?? roadLookup(state),
      ...(key === 'valid' ? {} : { clip: (mesh: MeshData) => clipMeshToRects(mesh, key === 'refused' ? this.roadCells.own : this.roadCells.beside) }),
      paint: (mat) => {
        mat.opacity = GHOST_LOOK.opacity;
        mat.color.multiply(new THREE.Color().setHex(tint).convertSRGBToLinear());
      },
    });
  }

  /** The cells the last road ghost's surfaces are cut to: its own tiles and those it joins. */
  private roadCells: { own: GroundRect[]; beside: GroundRect[] } = { own: [], beside: [] };

  /** The road tiles through the road surfaces the map draws, joined to the roads beside them; a
   *  refused ghost tints only its own tiles. */
  private paintRoads(live: GridState, tiles: readonly PlacedObject[], valid: boolean): void {
    const ghost = roadGhost(live, tiles, --this.roadGhostVersion);
    this.roadLookup = ghost.roads;
    if (valid) { this.roadSurfaces('valid').rebuild(undefined, ghost.state); return; }
    const { width, height } = live.template;
    const rect = (o: PlacedObject): GroundRect => {
      const { x, z } = cellCornerWorld(o.position.x, o.position.y, width, height, PLACEMENT_GRID);
      return { x0: x, z0: z, x1: x + 1, z1: z + 1 };
    };
    this.roadCells = { own: tiles.map(rect), beside: ghost.beside.map(rect) };
    this.roadSurfaces('refused').rebuild(undefined, ghost.state);
    if (ghost.beside.length) this.roadSurfaces('beside').rebuild(undefined, ghost.state);
  }

  /** Take down what the last placement laid and its outline. */
  private dropLay(): void {
    for (const mesh of this.blockMeshes) {
      if (!mesh?.parent) continue;
      this.host.group.remove(mesh);
      mesh.geometry.dispose();
      setBodyGeometry(mesh, new THREE.BufferGeometry());
    }
    for (const roads of Object.values(this.roads)) {
      roads.rebuild(undefined, { ...this.host.state(), objects: NO_OBJECTS, objectsVersion: --this.roadGhostVersion });
    }
    for (const mesh of this.outline) {
      this.host.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.outline = [];
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
    // Positions below are in the grid's cells; the dots and the glyph keep their size in map cells.
    const size = gridSize(grid);
    const wx = (cx: number): number => cellCornerWorld(cx, 0, s.template.width, s.template.height, grid).x;
    const wz = (cy: number): number => cellCornerWorld(0, cy, s.template.width, s.template.height, grid).z;
    const surface = (cx: number, cy: number): number => surfaceHeightAt(s, wx(cx), wz(cy));
    const add = (part: THREE.Mesh | THREE.LineSegments): void => {
      this.host.group.add(part);
      this.card.push(part);
    };

    const mapBounds = { x: bounds.x * size, y: bounds.y * size, w: bounds.w * size, h: bounds.h * size };
    for (const dot of marks ? previewDots(mapBounds) : []) {
      const geo = new THREE.CircleGeometry(dot.r, 12).rotateX(-Math.PI / 2);
      const dx = dot.x / size, dy = dot.y / size;
      geo.translate(wx(dx), surface(dx, dy) + DECAL_LIFT * 2, wz(dy));
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
      const x1 = x0 + size, z1 = z0 + size;
      if (!inSet.has(cellKey(c.x, c.y - 1))) rim.push(x0, y, z0, x1, y, z0);
      if (!inSet.has(cellKey(c.x, c.y + 1))) rim.push(x0, y, z1, x1, y, z1);
      if (!inSet.has(cellKey(c.x - 1, c.y))) rim.push(x0, y, z0, x0, y, z1);
      if (!inSet.has(cellKey(c.x + 1, c.y))) rim.push(x1, y, z0, x1, y, z1);
    }
    if (rim.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3));
      add(new THREE.LineSegments(geo, this.host.mats.edge(palette.line, 1)));
    }

    if (!marks || !card.icon) return;
    const tex = iconTexture(card.icon);
    if (!tex) return;
    const rect = previewIconRect(mapBounds, card.icon);
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
    const geo = toPlainGeometry(data), mat = makeMat(CURVE_FOOTPRINT.color, CURVE_FOOTPRINT.alpha);
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
    this.dropLay();
    if (this.placementGhost) {
      this.host.group.remove(this.placementGhost.mesh);
      this.placementGhost = null;
    }
    this.endTurn();
    for (const roads of Object.values(this.roads)) roads.dispose();
    this.roads = {};
    for (const mat of this.mats.values()) mat.dispose();
    this.mats.clear();
    this.ghostDepthMat?.dispose();
  }

  /** Release the glyph materials; the overlay's last step. */
  disposeMaterials(): void {
    for (const mat of this.iconMats.values()) mat.dispose();
    this.iconMats.clear();
  }
}

const NO_LAYERS: ReadonlySet<number> = new Set();
/** Never written: an empty road ghost's objects. */
const NO_OBJECTS = new Map<string, PlacedObject>();

/** `geo` on a terrain body's mesh and on its depth pre-pass. */
function setBodyGeometry(mesh: THREE.Mesh, geo: THREE.BufferGeometry): void {
  mesh.geometry = geo;
  for (const child of mesh.children) (child as THREE.Mesh).geometry = geo;
}

/** Membership of `cells`, for an outline to find the inside of its edges. */
function memberOf(cells: readonly { x: number; y: number }[]): (x: number, y: number) => boolean {
  return spanMembership(cells.map((c) => ({ x: c.x, y: c.y, w: 1 })));
}

/**
 * Outline edges on `grid` as draped world paths, one per edge: each at `height` read a quarter cell
 * inside it, on whichever side `inside` holds (a cut corner's diagonal lies within one cell, so
 * either side reads it).
 */
function edgePaths(
  state: GridState, edges: readonly EdgeSegment[], grid: GridId, inside: (x: number, y: number) => boolean,
  height: (wx: number, wz: number) => number,
): Array<Array<[number, number, number]>> {
  const { width, height: mapH } = state.template;
  const world = (x: number, y: number) => cellCornerWorld(x, y, width, mapH, grid);
  return edges.map((e) => {
    const { nx, ny, ahead } = edgeInsideSide(e, inside);
    const toward = ahead ? 0.25 : -0.25;
    const at = world((e.ax + e.bx) / 2 + nx * toward, (e.ay + e.by) / 2 + ny * toward);
    const y = height(at.x, at.z) + DECAL_LIFT * 2;
    const a = world(e.ax, e.ay), b = world(e.bx, e.by);
    return [[a.x, y, a.z], [b.x, y, b.z]];
  });
}

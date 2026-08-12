/**
 * The 3D ToolOverlay: every piece of tool feedback the 2D OverlayLayer draws,
 * as surface-draped decals in one scene group. Ghost updates are rAF-coalesced
 * (flush() runs once per rendered frame — a pointer stroke calls showGhost per
 * move); flashes decay through tick(). Colors arrive as the same 0xRRGGBB
 * numbers the 2D overlay uses, so validity tints match across views.
 */
import * as THREE from 'three';
import type { Corners, GridState, MacroCoord, ValidationError } from '../../../core/model/types';
import type { ToolOverlay } from '../../view-projection';
import type { MacroRect } from '../../interaction/marquee';
import { filletOnly, type RowSpan } from '../../map2d/layers/ghost-geometry';
import type { TrimmedCell } from '../../../tools/edge-cut/trim-preview';
import { cellDecals, DECAL_LIFT, type DecalTrim } from '../build/overlay-decals';
import { surfaceHeightAt } from '../interaction/pick';
import { mapCenterOffset } from '../core/coords';
import { resolveErrorFlashCells, errorFlashSignature, shouldFlashErrors, flashDecay, type ErrorFlashGate } from '../../map2d/layers/error-flash';
import { isMotionReduced } from '../../map2d/motion-state';
import { animConfig } from '../../../core/runtime/anim-config';
import { objectInstance } from '../build/object-meshes';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { modelGeometry } from '../models/build-model';
import { archetypeGeometry } from '../build/object-archetypes';
import { type PlacedObject } from '../../../core/model/types';
import type { ArchetypeKey } from '../core/types';

type PendingGhost =
  | { kind: 'cells'; cells: MacroCoord[]; color: number; terrainGrid: boolean; trim?: readonly TrimmedCell[]; losses?: readonly MacroCoord[] }
  | { kind: 'spans'; spans: RowSpan[]; color: number; terrainGrid: boolean; trim?: readonly TrimmedCell[] }
  | { kind: 'clear' };

/** A ghost's `losses` wash: the same warning red `ghostMaterial(false)` already uses for an invalid
 *  placement, so one tint means one thing across the whole overlay. */
const GHOST_LOSS = 0xe2574c;

interface Flash { mesh: THREE.Mesh; geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial; bornMs: number; lifeMs: number; peak: number }

/** A ghost body is TWO meshes over one geometry: a depth-only pre-pass and the translucent colour
 *  pass that tests against it. Without the pre-pass every part of a merged model blends separately,
 *  so a trunk shows through its canopy and a post through its deck — the silhouette must read as one
 *  body, not as a stack of parts.
 *
 *  RENDER-ORDER INVARIANT for everything in `group`: the ghost body owns 1 and 2, and EVERY other
 *  object added to the group must stay at 0. A Group's own renderOrder becomes the shared groupOrder
 *  of its whole subtree, so the children sort purely by their own number — anything given 1 or more
 *  draws after the pre-pass and is depth-clipped by it wherever the ghost body stands, silently. The
 *  decals, boxes, flashes, buildable wash and route all sit at 0 for that reason, which is also what
 *  keeps the pre-pass from punching the footprint wash out from under a wide canopy.
 *  Pinned by `__tests__/canvas3d/ghost-depth-prepass.test.ts`. */
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

export class Overlay3D implements ToolOverlay {
  readonly group = new THREE.Group();

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

  constructor(
    private state: () => GridState,
    private requestRender: () => void,
    private objectBox: (id: string) => THREE.Box3 | null = () => null,
    private nowMs: () => number = () => performance.now(),
  ) {
    this.group.renderOrder = 50; // over terrain and water, under nothing that matters
  }

  // ── ghost (rAF-coalesced) ──────────────────────────────────────────────────

  showGhost(cells: MacroCoord[], color: number, terrainGrid = true, trim?: readonly TrimmedCell[], losses?: readonly MacroCoord[]): void {
    this.pendingGhost = { kind: 'cells', cells, color, terrainGrid, trim, losses };
    this.requestRender();
  }

  showGhostSpans(spans: RowSpan[], color: number, terrainGrid = true, trim?: readonly TrimmedCell[]): void {
    this.pendingGhost = { kind: 'spans', spans, color, terrainGrid, trim };
    this.requestRender();
  }

  clearGhost(): void {
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
    if (this.pendingSelectionIds.length) {
      const ids = this.pendingSelectionIds;
      this.pendingSelectionIds = [];
      this.unresolved = [];
      for (const id of ids) this.buildObjectSelection(id);
    }
    const pending = this.pendingGhost;
    if (!pending) return;
    this.pendingGhost = null;
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
    const mat = makeMat(pending.color, 0.4);
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.ghost = { mesh, geo, mat };
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
    const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
    edgeMat.color.setHex(0xffb347).convertSRGBToLinear();
    const edge = new THREE.LineSegments(edgeGeo, edgeMat);
    const fillMat = makeMat(0xffb347, 0.06);
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

  showHover(x: number, y: number, w = 1, h = 1, terrainMode = false): void {
    this.clearHover();
    this.hover = this.makeBox(x, y, w, h, terrainMode, 0xf5f5f5, 0.08, 0.5);
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

  /** A footprint box: translucent fill + a brighter outline, draped at the
   *  footprint's tallest surface so it never sinks into a hill. */
  private makeBox(x: number, y: number, w: number, h: number, terrainMode: boolean, color: number, fillA: number, edgeA: number) {
    const s = this.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    const shift = terrainMode ? -0.5 : 0;
    const x0 = x - off.x + shift, z0 = y - off.z + shift;
    let top = 0;
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) top = Math.max(top, surfaceHeightAt(s, x0 + cx + 0.5, z0 + cy + 0.5));
    }
    const yTop = top + DECAL_LIFT * 2;
    const geo = new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
    geo.translate(x0 + w / 2, yTop, z0 + h / 2);
    const mesh = new THREE.Mesh(geo, makeMat(color, fillA));
    const edgeGeo = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: edgeA });
    edgeMat.color.setHex(color).convertSRGBToLinear();
    const edge = new THREE.LineSegments(edgeGeo, edgeMat);
    this.group.add(mesh, edge);
    this.requestRender();
    return { mesh, edge };
  }

  private dropBox(box: { mesh: THREE.Mesh; edge: THREE.LineSegments }): void {
    this.group.remove(box.mesh, box.edge);
    box.mesh.geometry.dispose();
    (box.mesh.material as THREE.Material).dispose();
    box.edge.geometry.dispose();
    (box.edge.material as THREE.Material).dispose();
    this.requestRender();
  }

  // ── flashes (commit + error) ───────────────────────────────────────────────

  flashCommit(cells: MacroCoord[], opts: { color?: number; terrainMode?: boolean } = {}): void {
    // Matches the 2D policy exactly: the commit beat is DECORATIVE confirmation (the cells already
    // show their committed state), so reduced motion skips it. Error flashes below are essential
    // evidence and are never suppressed, only rate-limited.
    if (isMotionReduced() || cells.length === 0) return;
    const cfg = animConfig.flash.commit;
    this.spawnFlash(cells, opts.color ?? cfg.color, opts.terrainMode ?? true, cfg.durationMs, cfg.peakAlpha);
  }

  /** The evidence contract: flash the offending cells, same resolve + repeat-
   *  violation cooldown gate as the 2D overlay. */
  flashErrors(errors: ValidationError[], terrainMode: boolean): void {
    const cells = resolveErrorFlashCells(errors, terrainMode);
    if (!cells.length) return;
    const sig = errorFlashSignature(cells);
    const now = this.nowMs();
    if (!shouldFlashErrors(this.errorGate, sig, now, animConfig.flash.errorRepeatCooldownMs)) return;
    this.errorGate = { sig, at: now };
    // Evidence cells carry their own grid (an object blocking a terrain paint
    // flashes on the macro grid even when the command was micro) — split and
    // drape each set on its grid.
    const micro = cells.filter((c) => c.micro);
    const macro = cells.filter((c) => !c.micro);
    const err = animConfig.flash.error;
    if (micro.length) this.spawnFlash(micro.map((c) => ({ x: c.x, y: c.y })), err.color, true, err.durationMs, err.peakAlpha);
    if (macro.length) this.spawnFlash(macro.map((c) => ({ x: c.x, y: c.y })), err.color, false, err.durationMs, err.peakAlpha);
  }

  private spawnFlash(cells: MacroCoord[], color: number, terrainGrid: boolean, lifeMs: number, peak: number): void {
    const data = cellDecals(this.state(), cells, terrainGrid);
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
    if (this.flashes.length === 0) return false;
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
    return this.flashes.length > 0;
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

  clearBuildableRegion(): void {
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
  }
}

/** Expand merged row spans back to cells (3D drapes per cell — heights vary). */
function spanCells(spans: readonly RowSpan[]): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const s of spans) {
    for (let i = 0; i < s.w; i++) out.push({ x: s.x + i, y: s.y });
  }
  return out;
}

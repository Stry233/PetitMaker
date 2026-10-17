/*
 * The plan-notes layer in the 3D view: zone washes as surface-draped decals
 * with a dashed outline riding each cell's own top, route arrows draped per sample, and text as
 * camera-facing captions. Measurement numbers lie in the map plane and follow its perspective.
 *
 * Rebuilt whole per ask (the legend's own pattern: geometries disposed, materials and textures
 * cached by role) and re-draped with the terrain flush — heights are baked into the vertices, so
 * ground that moved under a note must re-drape it, exactly as the buildable region does. A flush
 * re-drapes only the notes whose geometry lies over a remeshed chunk, moving each rebuilt part's
 * geometry into the object already standing: three breaks equal-order draw ties by object id, so
 * keeping the objects keeps the draw order a whole rebuild gives. Selection outlines follow the
 * same terrain geometry; endpoint controls use the active projection.
 */
import * as THREE from 'three';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { chipTextSize, routeWidth, zoneCellSet, zoneGrid, zoneHalfCells, zoneHasCaption, type AnnotationsState, type ChipNote, type MapAnnotation, type RouteNote, type ZoneNote } from '../../../core/model/annotations';
import { isAnnotationInk } from '../../../config/annotation-palette';
import { annotationInkScale, INK_CELLS } from '../../../core/model/annotation/text-metrics';
import { routeSamples, zoneLabelAnchor } from '../../../core/model/annotation/geometry';
import type { AnnotationDrawBase } from '../../shared/annotation/draw-options';
import { cellEdges, dimensionDrawing, measureDrawing, type DimensionDrawing } from '../../../core/model/annotation/dimensions';
import { cellCornerWorld } from '../geometry/coords';
import { densify, drapeHeights, labelPlaneHeight, ribbonStrips, worldPt } from '../geometry/ink-path';
import { paintChipLabel, paintDimensionLabel, paintZoneCaption, rasterNoteLabel, type LabelPainter } from '../draw/note-label-raster';
import { cellDecals, DECAL_LIFT } from '../geometry/overlay-decals';
import { surfaceHeightAt } from '../geometry/pick';
import { gridSize } from '../../../core/grid/grid-convert';
import {
  ANNOTATION_LINE, annotationDashes, annotationLineCells, annotationLineColor, dashRuns, zoneBorderPaths,
} from '../../shared/annotation/annotation-line';
import { HALF_GRID, PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import { cellKey } from '../../../core/grid/rect';
import { bucketSpan } from '../../../core/grid/buckets';

const OUTLINE_LIFT = DECAL_LIFT * 2;
const ROUTE_LIFT = 0.07;
/** The 3D wash is a pastel plate rather than the 2D layer's thin tint: this view's ground is
 *  textured, side-lit, part-shadowed and changes colour per terrace, so a low-alpha tint takes a
 *  different apparent colour on every surface it crosses and the "one colour, one region" cue
 *  dies. Pulling the colour toward white and raising the alpha keeps the region one readable
 *  pastel wherever it runs, while the ground still shows through. */
const WASH_ALPHA = 0.55;
const WASH_ALPHA_INK = 0.6;
const WASH_WHITEN = 0.25;
/** A billboard stands a little taller than its lettering, for the chip plate and the ink outline. */
const BILLBOARD_PAD = 1.3;
/** The whole ink is a step larger than its 2D twin (words, borders and routes alike): the oblique
 *  view and the camera's rest distance compress a world unit against what the 2D fit gives a
 *  cell, and this keeps the two views' ink at one proportion at the default framing. */
const INK_3D_BOOST = 1.5;

/**
 * Planning ink draws over the scene, whatever stands in front of it — no depth test, high render
 * order, because that is what the 2D layer is: a sheet above the map's objects. A depth test
 * would hide a route behind every tree it passes and break a zone's border against the houses in
 * it, which reads as a rendering fault rather than occlusion.
 */
const ORDER = { wash: 90, outlineHalo: 91, outline: 92, select: 97, routeHalo: 93, route: 94, headHalo: 95, head: 96, label: 100 } as const;
const OUTLINE_ORDERS = { halo: ORDER.outlineHalo, line: ORDER.outline } as const;

export interface AnnotationLayer3DOpts extends AnnotationDrawBase {
  /** Transient editing dimensions share the annotation lettering and drape. */
  dimensions?: DimensionDrawing;
}

/** One note's parts in creation order, and the world-plane box its geometry covers. */
interface NoteParts {
  parts: THREE.Object3D[];
  minX: number; minZ: number; maxX: number; maxZ: number;
}

/** How far past a note's own geometry its drape reads the ground, in world units (one cell). */
const DRAPE_REACH = 1;

const emptyParts = (): NoteParts => ({ parts: [], minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity });

/** The box `parts` gains from `o`: every vertex of a ribbon or decal, a label's own extent. */
function cover(parts: NoteParts, o: THREE.Object3D): void {
  const take = (x: number, z: number): void => {
    if (x < parts.minX) parts.minX = x;
    if (x > parts.maxX) parts.maxX = x;
    if (z < parts.minZ) parts.minZ = z;
    if (z > parts.maxZ) parts.maxZ = z;
  };
  const geometry = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if ((o as THREE.Sprite).isSprite || geometry?.type === 'PlaneGeometry') {
    const half = Math.max(o.scale.x, o.scale.y, ...(geometry?.type === 'PlaneGeometry'
      ? [(geometry as THREE.PlaneGeometry).parameters.width, (geometry as THREE.PlaneGeometry).parameters.height] : [])) / 2;
    take(o.position.x - half, o.position.z - half);
    take(o.position.x + half, o.position.z + half);
    return;
  }
  const position = geometry?.getAttribute('position');
  if (!position) return;
  for (let i = 0; i < position.count; i++) take(position.getX(i), position.getZ(i));
}

/** Whether `next` is `old` rebuilt over other ground: the same kind of object, material and order. */
function sameShape(old: readonly THREE.Object3D[], next: readonly THREE.Object3D[]): boolean {
  return old.length === next.length && old.every((o, i) => {
    const n = next[i]!;
    return o.type === n.type && o.renderOrder === n.renderOrder
      && (o as THREE.Mesh).material === (n as THREE.Mesh).material;
  });
}

export class AnnotationLayer3D {
  readonly group = new THREE.Group();
  private mats = new Map<string, THREE.Material>();
  private labels = new Map<string, THREE.Sprite>();
  private textures = new Map<string, THREE.CanvasTexture>();
  private lastData: AnnotationsState | null = null;
  private lastOpts: AnnotationLayer3DOpts = { draft: null, tagLabel: () => '' };
  /** Each note's parts from the last build, keyed by its place in the ask (the editing dimensions
   *  under `dimensions`). */
  private notes = new Map<string, NoteParts>();
  /** Where the parts being built go: the standing notes on a build, a scratch map on a re-drape,
   *  whose parts are never added to the group. */
  private building: { notes: Map<string, NoteParts>; standing: boolean } = { notes: this.notes, standing: true };
  private sink: NoteParts | null = null;

  /** The map's ink scale, refreshed per build: one cell is one world unit here, so the shared
   *  cell-unit metrics apply directly. */
  private ink = 1;

  update(state: GridState, data: AnnotationsState | null, opts: AnnotationLayer3DOpts): void {
    this.lastData = data;
    this.lastOpts = opts;
    this.ink = annotationInkScale(state.template) * INK_3D_BOOST;
    this.clear();
    this.group.visible = data?.visible !== false;
    if (!this.group.visible) return;
    const usedTex = new Set<string>();
    this.build(state, null, usedTex);
    for (const [key, tex] of this.textures) {
      if (usedTex.has(key)) continue;
      this.textures.delete(key);
      tex.dispose();
      const mat = this.mats.get(`label:${key}`);
      if (mat) { this.mats.delete(`label:${key}`); mat.dispose(); }
    }
  }

  /** Builds the parts of the notes `only` names (every note when null) of the last ask, in the one
   *  order a whole build creates them in: zones, routes, then lettering and dimensions. */
  private build(state: GridState, only: ReadonlySet<string> | null, usedTex: Set<string>): void {
    const opts = this.lastOpts;
    const items: MapAnnotation[] = [...(this.lastData?.items ?? [])];
    if (opts.draft) items.push(opts.draft);
    const picked = new Set(opts.selectionIds ?? []);
    const into = (key: string): boolean => {
      if (only && !only.has(key)) return false;
      const { notes } = this.building;
      let parts = notes.get(key);
      if (!parts) { parts = emptyParts(); notes.set(key, parts); }
      this.sink = parts;
      return true;
    };
    items.forEach((n, i) => { if (n.kind === 'zone' && into(`${i}`)) this.buildZone(state, n, picked.has(n.id)); });
    items.forEach((n, i) => { if (n.kind === 'route' && into(`${i}`)) this.buildRoute(state, n, picked.has(n.id)); });
    items.forEach((n, i) => {
      if (!into(`${i}`)) return;
      if (n.kind === 'zone') this.buildZoneLabel(state, n, n.tag ? opts.tagLabel(n.tag) : '', usedTex);
      else if (n.kind === 'chip') this.buildChip(state, n, opts.tagLabel(n.tag), usedTex, picked.has(n.id));
      const baseInk = this.ink / INK_3D_BOOST;
      if (n.kind === 'measure') this.buildDimensions(state, measureDrawing(n.points, baseInk, n.flipped), n.color, usedTex, picked.has(n.id));
      if (n.kind === 'zone' && opts.zoneDimensions !== false && (picked.has(n.id) || n === opts.draft)) {
        const bounds = cellEdges(n.cells, zoneGrid(n));
        if (bounds) this.buildDimensions(state, dimensionDrawing(bounds, baseInk), n.color, usedTex);
      }
    });
    if (opts.dimensions && into('dimensions')) this.buildDimensions(state, opts.dimensions, '#ffffff', usedTex);
    this.sink = null;
  }

  /**
   * Re-drape the last ask over ground that moved, called with the terrain flush. `chunks` names the
   * remeshed buckets: only the notes whose geometry, widened by the drape's reach, meets one of
   * them are rebuilt, and each rebuilt part's geometry moves into the part already standing. A
   * rebuild that comes out in another shape (a part gained or lost) falls back to a whole build, as
   * does a refresh without `chunks`.
   */
  refresh(state: GridState, chunks?: ReadonlySet<string>): void {
    if (!this.lastData && !this.lastOpts.draft && !this.lastOpts.dimensions) return;
    if (!chunks || !this.group.visible) { this.update(state, this.lastData, this.lastOpts); return; }
    const { width, height } = state.template;
    const boxes = [...chunks].map((key) => {
      const [cx, cy] = key.split(',').map(Number);
      const span = bucketSpan(cx!, cy!, width, height);
      const lo = cellCornerWorld(span.x0, span.y0, width, height, TERRAIN_GRID);
      const hi = cellCornerWorld(span.x1, span.y1, width, height, TERRAIN_GRID);
      return { x0: lo.x - DRAPE_REACH, z0: lo.z - DRAPE_REACH, x1: hi.x + DRAPE_REACH, z1: hi.z + DRAPE_REACH };
    });
    const touched = new Set<string>();
    for (const [key, n] of this.notes) {
      if (boxes.some((b) => n.minX <= b.x1 && n.maxX >= b.x0 && n.minZ <= b.z1 && n.maxZ >= b.z0)) touched.add(key);
    }
    if (touched.size === 0) return;
    const fresh = new Map<string, NoteParts>();
    this.building = { notes: fresh, standing: false };
    try {
      this.build(state, touched, new Set());
    } finally {
      this.building = { notes: this.notes, standing: true };
    }
    for (const key of touched) {
      if (sameShape(this.notes.get(key)!.parts, fresh.get(key)?.parts ?? [])) continue;
      for (const n of fresh.values()) for (const o of n.parts) if (!(o as THREE.Sprite).isSprite) (o as THREE.Mesh).geometry.dispose();
      this.update(state, this.lastData, this.lastOpts);
      return;
    }
    for (const key of touched) {
      const standing = this.notes.get(key)!;
      const next = fresh.get(key)!;
      next.parts.forEach((n, i) => {
        const o = standing.parts[i]!;
        if (!(o as THREE.Sprite).isSprite) {
          (o as THREE.Mesh).geometry.dispose();
          (o as THREE.Mesh).geometry = (n as THREE.Mesh).geometry;
        }
        o.position.copy(n.position);
        o.scale.copy(n.scale);
        o.rotation.copy(n.rotation);
      });
      this.notes.set(key, { ...next, parts: standing.parts });
    }
  }

  labelBox(
    id: string, camera: THREE.PerspectiveCamera, rect: { left: number; top: number; width: number; height: number },
  ): { x: number; y: number; w: number; h: number } | null {
    const sprite = this.labels.get(id);
    if (!this.group.visible || !sprite) return null;
    const position = sprite.position.clone().applyMatrix4(camera.matrixWorldInverse);
    if (position.z >= -camera.near) return null;
    // Sprite vertices are offset in camera space, with the raster's bottom at center.y = 0.
    const corner = (x: number, y: number) => new THREE.Vector3(
      position.x + (x - sprite.center.x) * sprite.scale.x,
      position.y + (y - sprite.center.y) * sprite.scale.y, position.z,
    ).applyMatrix4(camera.projectionMatrix);
    const lower = corner(0, 0), upper = corner(1, 1);
    return {
      x: rect.left + (lower.x + 1) * rect.width / 2,
      y: rect.top + (1 - upper.y) * rect.height / 2,
      w: (upper.x - lower.x) * rect.width / 2,
      h: (upper.y - lower.y) * rect.height / 2,
    };
  }

  pickLabel(x: number, y: number, camera: THREE.PerspectiveCamera, rect: { left: number; top: number; width: number; height: number }): string | null {
    let picked: string | null = null, nearest = -Infinity;
    for (const [id, sprite] of this.labels) {
      const box = this.labelBox(id, camera, rect);
      if (!box || x < box.x - 3 || x > box.x + box.w + 3 || y < box.y - 3 || y > box.y + box.h + 3) continue;
      const depth = sprite.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
      if (depth >= nearest) { nearest = depth; picked = id; }
    }
    return picked;
  }

  /** Forget every baked label so the next build rasterises afresh — called once the app's own
   *  fonts land, since a texture baked against the fallback face keeps its shapes forever. */
  dropBakes(): void {
    for (const [key, tex] of this.textures) {
      tex.dispose();
      const mat = this.mats.get(`label:${key}`);
      if (mat) { this.mats.delete(`label:${key}`); mat.dispose(); }
    }
    this.textures.clear();
  }

  dispose(): void {
    this.clear();
    for (const [, mat] of this.mats) mat.dispose();
    this.mats.clear();
    for (const [, tex] of this.textures) tex.dispose();
    this.textures.clear();
  }

  /** Geometries are per-build and go; materials and textures stay in their caches. A Sprite is
   *  skipped: every THREE.Sprite draws one module-shared quad, which is nobody's to dispose. */
  private clear(): void {
    this.labels.clear();
    this.notes.clear();
    this.group.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) return;
      (o as THREE.Mesh).geometry?.dispose();
    });
    this.group.clear();
  }

  /** The share of each material's own opacity the layer draws at: 1 for the notes, less for a note
   *  ghost. Each material keeps its own opacity as `userData.opacity`. */
  private strength = 1;

  /** Draws every part at `strength` of its own opacity, the cached materials and any built later. */
  setStrength(strength: number): void {
    this.strength = strength;
    for (const mat of this.mats.values()) mat.opacity = (mat.userData.opacity as number) * strength;
  }

  /** Caches `mat` under `key`, at the layer's strength. */
  private keep(key: string, mat: THREE.Material): void {
    mat.userData.opacity = mat.opacity;
    mat.opacity *= this.strength;
    this.mats.set(key, mat);
  }

  /** A built part joins the note being built, and the group unless it is a re-drape's. */
  private add(o: THREE.Object3D): void {
    if (this.sink) { this.sink.parts.push(o); cover(this.sink, o); }
    if (this.building.standing) this.group.add(o);
  }

  private washMat(color: string): THREE.Material {
    const key = `wash:${color}`;
    let mat = this.mats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color('#FFFFFF'), WASH_WHITEN),
        transparent: true,
        opacity: isAnnotationInk(color) ? WASH_ALPHA_INK : WASH_ALPHA,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      this.keep(key, mat);
    }
    return mat;
  }

  private buildZone(state: GridState, zone: ZoneNote, selected = false): void {
    const toWorld = (x: number, y: number) => cellCornerWorld(x, y, state.template.width, state.template.height, PLACEMENT_GRID);
    const decal = cellDecals(state, zone.cells, zoneGrid(zone));
    // The wash covers the cell tops; a zone spanning terraces would read as strips with bare
    // ground-coloured walls between them, so the wall faces between two zone cells wear the wash
    // too and the region reads whole. Only interior steps: the rim is the outline's to mark.
    // Placement cells cover [x, x + 1) and terrain cells [x - 0.5, x + 0.5), so a terrace step runs
    // through the middle of a placement cell, and a ground step along an edge two of them share:
    // both are edges between two of the zone's half-grid cells. Each half-cell length takes its own
    // wall, as the ground on each side of it belongs to a different terrain row.
    const half = zoneHalfCells(zone);
    const set = zoneCellSet(half);
    const wall = (a: { x: number; z: number }, b: { x: number; z: number }, y0: number, y1: number): void => {
      const { x: ax, z: az } = a, { x: bx, z: bz } = b;
      const base = decal.positions.length / 3;
      decal.positions.push(ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz);
      decal.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    /** A wall along the half-cell length from (ax, az) in direction (ux, uz), wherever the ground
     *  on its two sides stands at different heights. Grid coordinates. */
    const step = (ax: number, az: number, ux: number, uz: number): void => {
      const { x: mx, z: mz } = toWorld(ax + ux * 0.25, az + uz * 0.25);
      const h1 = surfaceHeightAt(state, mx - uz * 0.25, mz - ux * 0.25);
      const h2 = surfaceHeightAt(state, mx + uz * 0.25, mz + ux * 0.25);
      if (Math.abs(h1 - h2) < 0.05) return;
      const a = toWorld(ax, az), b = toWorld(ax + ux * 0.5, az + uz * 0.5);
      wall(a, b, Math.min(h1, h2), Math.max(h1, h2) + DECAL_LIFT);
    };
    const side = gridSize(HALF_GRID);
    for (const c of half) {
      const x = c.x * side, y = c.y * side;
      if (set.has(cellKey(c.x + 1, c.y))) step(x + side, y, 0, 1);
      if (set.has(cellKey(c.x, c.y + 1))) step(x, y + side, 1, 0);
    }
    if (decal.positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(decal.positions, 3));
      geo.setIndex(decal.index);
      const wash = new THREE.Mesh(geo, this.washMat(zone.color));
      wash.renderOrder = ORDER.wash;
      this.add(wash);
    }
    // The border: the same closed paths the 2D view strokes (`zoneBorderPaths`, inset so the line
    // lies in its own cells, where a taller neighbour's wall cannot clip it), as one continuous
    // ribbon per outline. Each point's height is read at the point, so the drape follows each
    // terrace it crosses.
    const w = this.lineWidth();
    const paths = zoneBorderPaths(zone.cells, w, zoneGrid(zone))
      .map((path) => drapeHeights(state, densify(path.map(([x, y]) => worldPt(state, x, y))), [0, 0.8], w / 2, OUTLINE_LIFT));
    this.inkRibbons(paths, zone.color, w, OUTLINE_ORDERS);
    if (selected) this.selectionRibbons(paths, w);
  }

  /**
   * A route draws as a draped ribbon, never a THREE.Line: WebGL rasterises a line at one pixel
   * whatever its material asks, so the arrow's shaft was a hairline beside a cone that scaled with
   * the map. The ribbon carries the drawn width itself — flat quads along the samples, each dash
   * its own run — at the same `INK_CELLS.route` the 2D stroke uses.
   */
  private buildRoute(state: GridState, route: RouteNote, selected = false): void {
    if (route.points.length < 2) return;
    const samples = densify(routeSamples(route.points).map(([x, y]) => worldPt(state, x, y)));
    const L = ANNOTATION_LINE;
    const width = this.lineWidth() * routeWidth(route);
    const pts: Array<[number, number, number]> = drapeHeights(state, samples, [0, 0.8, -0.8], width / 2, ROUTE_LIFT);
    // The annotation line over its halo, then a flat two-layer arrowhead sized in line widths.
    this.inkRibbons([pts], route.color, width, { halo: ORDER.routeHalo, line: ORDER.route }, { dashes: route.dashed ? annotationDashes(width) : null });
    const n = pts.length;
    const tip = pts[n - 1]!;
    const back = pts[Math.max(0, n - 4)]!;
    const ang = Math.atan2(tip[2] - back[2], tip[0] - back[0]);
    if (!Number.isFinite(ang)) return;
    const head = (size: number, y: number, mat: THREE.Material, order: number): void => {
      const tri = new THREE.BufferGeometry();
      tri.setAttribute('position', new THREE.Float32BufferAttribute([
        tip[0] + Math.cos(ang) * size * 0.9, y, tip[2] + Math.sin(ang) * size * 0.9,
        tip[0] + Math.cos(ang + 2.5) * size, y, tip[2] + Math.sin(ang + 2.5) * size,
        tip[0] + Math.cos(ang - 2.5) * size, y, tip[2] + Math.sin(ang - 2.5) * size,
      ], 3));
      tri.setIndex([0, 1, 2]);
      const m = new THREE.Mesh(tri, mat);
      m.renderOrder = order;
      this.add(m);
    };
    head(width * (L.arrowHead + L.halo.scale - 1), tip[1] + 0.004, this.inkMat(), ORDER.headHalo);
    head(width * L.arrowHead, tip[1] + 0.01, this.edgeMat(route.color), ORDER.head);
    if (selected) {
      this.selectionRibbons([pts], width);
      // The 2D mark: a white disc with an ink rim on every waypoint, where the grab would land.
      for (const wp of route.points) {
        const [wx, wz] = worldPt(state, wp.x, wp.y);
        const y = surfaceHeightAt(state, wx, wz) + ROUTE_LIFT + 0.02;
        this.disc({ x: wx, y, z: wz }, width * (L.selection.dot + (L.halo.scale - 1) / 2), this.inkMat(), ORDER.select);
        this.disc({ x: wx, y: y + 0.004, z: wz }, width * L.selection.dot, this.selectMat(), ORDER.select);
      }
    }
  }

  /** A flat fan disc on the ground — the 3D spelling of a drawn dot. */
  private disc(centre: { x: number; y: number; z: number }, r: number, mat: THREE.Material, order: number): void {
    const { x, y, z } = centre;
    const geo = new THREE.BufferGeometry();
    const positions: number[] = [x, y, z];
    const index: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      positions.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
      if (i > 0) index.push(0, i, i + 1);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = order;
    this.add(m);
  }

  /** The selection mark over a line `width` wide: a white line over a dark rim. */
  private selectionRibbons(paths: Array<Array<[number, number, number]>>, width: number): void {
    const S = ANNOTATION_LINE.selection;
    for (const [scale, material, order] of [[S.rim, this.inkMat(), ORDER.select], [1, this.selectMat(), ORDER.select + 1]] as const) {
      const geometry = ribbonGeometry(paths, width * S.width * scale);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = order;
      this.add(mesh);
    }
  }

  /** The selection's white, shared with the 2D mark (alpha 0.9). */
  private selectMat(): THREE.Material {
    let mat = this.mats.get('select');
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color('#FFFFFF'),
        transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      });
      this.keep('select', mat);
    }
    return mat;
  }

  /** The annotation line's own colour and alpha. */
  private edgeMat(color: string, depthTest = false): THREE.Material {
    const shown = annotationLineColor(color);
    const key = `edge:${shown}:${depthTest}`;
    let mat = this.mats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(shown),
        transparent: true, opacity: ANNOTATION_LINE.alpha, side: THREE.DoubleSide, depthWrite: false, depthTest,
      });
      this.keep(key, mat);
    }
    return mat;
  }

  /** The annotation line's halo. */
  private inkMat(depthTest = false): THREE.Material {
    const key = `ink:${depthTest}`;
    let mat = this.mats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(ANNOTATION_LINE.halo.color),
        transparent: true, opacity: ANNOTATION_LINE.halo.alpha, side: THREE.DoubleSide, depthWrite: false, depthTest,
      });
      this.keep(key, mat);
    }
    return mat;
  }

  /** The width every 3D annotation line takes. Ribbons are baked into world geometry, so it is the
   *  2D width at the reference cell size, with the view's own ink boost. */
  private lineWidth(): number {
    return annotationLineCells(ANNOTATION_LINE.refCellPx) * INK_3D_BOOST;
  }

  /** The annotation line along `paths`: its halo just below, then the line in the note's colour.
   *  `dashes` gives the dashed variant. */
  private inkRibbons(
    paths: Array<Array<[number, number, number]>>, color: string, width: number, orders: { halo: number; line: number },
    style: { dashes?: { dash: number; gap: number } | null; depthTest?: boolean } = {},
  ): void {
    const { dashes = null, depthTest = false } = style;
    const { halo: haloOrder, line: order } = orders;
    const runs = paths.flatMap((path) => dashRuns(path, dashes));
    const lower = runs.map((run) => run.map(([x, y, z]) => [x, y - 0.012, z] as [number, number, number]));
    for (const [geometry, material, renderOrder] of [
      [ribbonGeometry(lower, width * ANNOTATION_LINE.halo.scale), this.inkMat(depthTest), haloOrder],
      [ribbonGeometry(runs, width), this.edgeMat(color, depthTest), order],
    ] as const) {
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = renderOrder;
      this.add(mesh);
    }
  }

  private buildZoneLabel(state: GridState, zone: ZoneNote, label: string, used: Set<string>): void {
    if (!zoneHasCaption(zone, label)) return;
    const withNum = zone.num > 0;
    const key = `zone:${this.ink}:${zone.color}:${zone.size ?? 'm'}:${withNum ? zone.num : ''}:${label}`;
    const at = zoneLabelAnchor(zone.cells, zoneGrid(zone));
    const worldH = INK_CELLS.zoneLabel[chipTextSize(zone.size ?? 'm')] * this.ink * BILLBOARD_PAD;
    const sprite = this.addLabel(state, { key, at, worldH }, used, (ctx, h) => paintZoneCaption(ctx, h, label, zone.num, zone.color));
    if (sprite && this.building.standing) this.labels.set(zone.id, sprite);
  }

  private buildDimensions(state: GridState, drawing: DimensionDrawing, color: string, used: Set<string>, selected = false): void {
    const width = this.lineWidth();
    const paths = (lines: DimensionDrawing['lines']) => lines.map(line => drapeHeights(state,
      densify(line.map(p => worldPt(state, p.x, p.y))), [0], width / 2, ROUTE_LIFT));
    // Dashes are cut in widths of the ribbon they cut, so they shrink with it toward the far end of
    // the view and stay apart wherever the line can be seen.
    this.inkRibbons(paths(drawing.guides), color, width, OUTLINE_ORDERS, { dashes: annotationDashes(width), depthTest: true });
    this.inkRibbons(paths(drawing.lines), color, width, OUTLINE_ORDERS, { depthTest: true });
    if (selected) this.selectionRibbons(paths(drawing.guides.slice(0, 4)), width);
    for (const { at, value } of drawing.labels) {
      const text = String(value);
      const label = { key: `dimension:${this.ink}:${text}`, at, worldH: 0.7 * this.ink, flat: true };
      this.addLabel(state, label, used, (ctx, h) => paintDimensionLabel(ctx, h, text));
    }
  }

  private buildChip(state: GridState, note: ChipNote, label: string, used: Set<string>, selected: boolean): void {
    if (!label) return;
    const key = `chip:${this.ink}:${note.color}:${note.size}:${label}:${selected}`;
    const worldH = INK_CELLS.text[note.size] * this.ink * BILLBOARD_PAD;
    const sprite = this.addLabel(state, { key, at: { x: note.x, y: note.y }, worldH }, used, (ctx, h) => paintChipLabel(ctx, h, label, note.color, selected));
    if (sprite && this.building.standing) this.labels.set(note.id, sprite);
  }

  /** Labels share a cropped text raster; dimensions lie in the map plane while captions face the camera. */
  private addLabel(
    state: GridState,
    label: { key: string; at: MacroCoord; worldH: number; flat?: boolean },
    used: Set<string>,
    paint: LabelPainter,
  ): THREE.Sprite | undefined {
    const { key, at, worldH, flat = false } = label;
    used.add(key);
    let tex = this.textures.get(key);
    if (!tex) {
      const canvas = rasterNoteLabel(worldH, paint);
      if (!canvas) return;
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.textures.set(key, tex);
    }
    const matKey = `label:${key}`;
    let mat = this.mats.get(matKey);
    if (!mat) {
      mat = flat
        ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide })
        : new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
      this.keep(matKey, mat);
    }
    const [wx, wz] = worldPt(state, at.x, at.y);
    const img = tex.image as HTMLCanvasElement;
    const worldW = worldH * (img.width / img.height);
    if (flat) {
      const label = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
      label.rotation.x = -Math.PI / 2;
      label.renderOrder = ORDER.label;
      label.position.set(wx, labelPlaneHeight(state, wx, wz, worldW, worldH) + ROUTE_LIFT, wz);
      this.add(label);
      return;
    }
    const sprite = new THREE.Sprite(mat as THREE.SpriteMaterial);
    sprite.renderOrder = ORDER.label;
    sprite.scale.set(worldW, worldH, 1);
    // Anchored by its foot, so the word stands on the ground instead of sinking through a slope.
    sprite.center.set(0.5, 0);
    sprite.position.set(wx, surfaceHeightAt(state, wx, wz) + OUTLINE_LIFT, wz);
    this.add(sprite);
    return sprite;
  }
}

/** The ribbon strips along `paths` as one geometry, or null when nothing draws. */
function ribbonGeometry(
  paths: ReadonlyArray<ReadonlyArray<[number, number, number]>>,
  width: number,
): THREE.BufferGeometry | null {
  const strips = ribbonStrips(paths, width);
  if (!strips) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(strips.positions, 3));
  geo.setIndex(strips.index);
  return geo;
}

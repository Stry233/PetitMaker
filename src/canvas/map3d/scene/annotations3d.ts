/*
 * annotations3d.ts — the plan-notes layer in the 3D view: zone washes as surface-draped decals
 * with a dashed outline riding each cell's own top, route arrows draped per sample, and text as
 * camera-facing billboards, so a word never lies stretched across a slope.
 *
 * Rebuilt WHOLE per ask (the legend's own pattern: geometries disposed, materials and textures
 * cached by role) and re-baked with the terrain flush — heights are baked into the vertices, so
 * ground that moved under a note must re-drape it, exactly as the buildable region does. Selection
 * is not marked here: the floating editor anchors over the selected note through `cellToScreen`,
 * and the 2D view is where fine selection work lives.
 */
import * as THREE from 'three';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import type { GridState, MacroCoord } from '../../../core/model/types';
import {
  ANNOTATION_INK, annotationInkScale, INK_CELLS, textApproxHeightCells, textApproxWidthCells, loopInwardNormals, roundedZoneLoops, zoneCornerRadius, ZONE_GRID_SHIFT, routeSamples, zoneCellSet, zoneDashCells,
  zoneCentroid,
  type AnnotationsState, type MapAnnotation, type RouteNote, type TextNote, type ZoneNote,
} from '../../../core/model/annotations';
import { mapCenterOffset } from '../core/coords';
import { cellDecals, DECAL_LIFT } from '../build/overlay-decals';
import { surfaceHeightAt } from '../interaction/pick';

const OUTLINE_LIFT = DECAL_LIFT * 2;
const ROUTE_LIFT = 0.07;
/** The 3D wash is a PASTEL PLATE rather than the 2D layer's thin tint: this view's ground is
 *  textured, side-lit, part-shadowed and changes colour per terrace, so a low-alpha tint takes a
 *  different apparent colour on every surface it crosses and the "one colour, one region" cue
 *  dies. Pulling the colour toward white and raising the alpha keeps the region one readable
 *  pastel wherever it runs, while the ground still shows through. */
const WASH_ALPHA = 0.55;
const WASH_ALPHA_INK = 0.6;
const WASH_WHITEN = 0.25;
/** A billboard stands a little taller than its lettering, for the chip plate and the ink outline. */
const BILLBOARD_PAD = 1.3;
/** The WHOLE ink is a step larger than its 2D twin — words, borders, routes alike, so the two
 *  views keep one set of proportions: the oblique view and the camera's rest distance compress a
 *  world unit against what the 2D fit gives a cell, measured side by side at the default framing. */
const INK_3D_BOOST = 1.5;

/**
 * PLANNING INK DRAWS OVER THE SCENE, whatever stands in front of it — no depth test, high render
 * order — because that is what the 2D layer is: a sheet above the map's objects. Depth-tested,
 * a route vanished behind every tree it passed and a zone's border broke against the houses
 * standing in it, which read as rendering faults rather than occlusion.
 */
const ORDER = { wash: 90, outlineHalo: 91, outline: 92, select: 97, routeHalo: 93, route: 94, headHalo: 95, head: 96, label: 100 } as const;
/** The canvas raster behind a billboard, px per world unit — crisp at the fly-in's framing. */
const TEX_PX_PER_UNIT = 96;
const INK = '#43413F';
const MAP_TEXT = '#FFFEE3';

export interface Annotations3DOpts {
  draft: MapAnnotation | null;
  /** The selected notes' ids — marked HERE too: 2D shows a selection the 3D view must not deny. */
  selection?: readonly string[];
}

const isInk = (color: string): boolean => color.toLowerCase() === ANNOTATION_INK.toLowerCase();

/** Points every `step` cells along a path — a drape's height is read PER POINT, so a long straight
 *  edge sampled only at its ends would run its ribbon on a slope between two terraces instead of
 *  stepping with the ground, which is what read as the border fragmenting on complex terrain. */
function densify(pts: ReadonlyArray<[number, number]>, step = 0.4): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[i + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Drape heights that read the ink's WIDTH, not just its centerline: at a cliff lip a centerline
 * sample leaves half the ribbon hanging across the wall at the lower height (or smearing down its
 * face), so each point takes the tallest ground under its cross-section — the ink rides the
 * terrain's silhouette the way a laid sticker would. `probes` are signed fractions of `halfW`
 * along the path's left-hand perpendicular (a zone loop's interior side); the route probes both.
 */
function drapeHeights(
  state: GridState,
  pts: ReadonlyArray<[number, number]>,
  probes: readonly number[],
  halfW: number,
  lift: number,
): Array<[number, number, number]> {
  return pts.map(([x, z], i) => {
    const [qx, qz] = pts[Math.max(i - 1, 0)]!;
    const [px, pz] = pts[Math.min(i + 1, pts.length - 1)]!;
    const dx = px - qx, dz = pz - qz;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * halfW;
    const nz = (dx / len) * halfW;
    let h = -Infinity;
    for (const k of probes) h = Math.max(h, surfaceHeightAt(state, x + nx * k, z + nz * k));
    return [x, h + lift, z];
  });
}

export class Annotations3D {
  readonly group = new THREE.Group();
  private mats = new Map<string, THREE.Material>();
  private textures = new Map<string, THREE.CanvasTexture>();
  private lastData: AnnotationsState | null = null;
  private lastOpts: Annotations3DOpts = { draft: null };

  /** The map's ink scale, refreshed per build: one cell is one world unit here, so the shared
   *  cell-unit metrics apply directly. */
  private ink = 1;

  update(state: GridState, data: AnnotationsState | null, opts: Annotations3DOpts): void {
    this.lastData = data;
    this.lastOpts = opts;
    this.ink = annotationInkScale(state.template) * INK_3D_BOOST;
    this.clear();
    this.group.visible = data?.visible !== false;
    if (!this.group.visible) return;
    const items: MapAnnotation[] = [...(data?.items ?? [])];
    if (opts.draft) items.push(opts.draft);
    const usedTex = new Set<string>();
    const picked = new Set(opts.selection ?? []);
    for (const n of items) if (n.kind === 'zone') this.buildZone(state, n, picked.has(n.id));
    for (const n of items) if (n.kind === 'route') this.buildRoute(state, n, picked.has(n.id));
    for (const n of items) if (n.kind === 'text' && picked.has(n.id)) this.buildTextSelection(state, n);
    for (const n of items) {
      if (n.kind === 'zone') this.buildZoneLabel(state, n, usedTex);
      else if (n.kind === 'text') this.buildText(state, n, usedTex);
    }
    for (const [key, tex] of this.textures) {
      if (usedTex.has(key)) continue;
      this.textures.delete(key);
      tex.dispose();
      const mat = this.mats.get(`sprite:${key}`);
      if (mat) { this.mats.delete(`sprite:${key}`); mat.dispose(); }
    }
  }

  /** Re-drape the last ask over ground that moved — called with the terrain flush. */
  refresh(state: GridState): void {
    if (!this.lastData && !this.lastOpts.draft) return;
    this.update(state, this.lastData, this.lastOpts);
  }

  /** Forget every baked label so the next build rasterises afresh — called once the app's own
   *  fonts land, since a texture baked against the fallback face keeps its shapes forever. */
  dropBakes(): void {
    for (const [key, tex] of this.textures) {
      tex.dispose();
      const mat = this.mats.get(`sprite:${key}`);
      if (mat) { this.mats.delete(`sprite:${key}`); mat.dispose(); }
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
    this.group.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) return;
      (o as THREE.Mesh).geometry?.dispose();
    });
    this.group.clear();
  }

  private washMat(color: string): THREE.Material {
    const key = `wash:${color}`;
    let mat = this.mats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).lerp(new THREE.Color('#FFFFFF'), WASH_WHITEN),
        transparent: true,
        opacity: isInk(color) ? WASH_ALPHA_INK : WASH_ALPHA,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      this.mats.set(key, mat);
    }
    return mat;
  }

  private buildZone(state: GridState, zone: ZoneNote, selected = false): void {
    const off = mapCenterOffset(state.template.width, state.template.height);
    const decal = cellDecals(state, zone.cells, true);
    // The wash covers the cell TOPS; a zone spanning terraces would read as strips with bare
    // ground-coloured walls between them, so the wall faces BETWEEN two zone cells wear the wash
    // too and the region reads whole. Only interior steps: the rim is the outline's to mark.
    const set = zoneCellSet(zone.cells);
    const wall = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number): void => {
      const base = decal.positions.length / 3;
      decal.positions.push(ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz);
      decal.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    for (const c of zone.cells) {
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        if (!set.has(`${c.x + dx},${c.y + dy}`)) continue;
        const h1 = surfaceHeightAt(state, c.x - off.x, c.y - off.z);
        const h2 = surfaceHeightAt(state, c.x + dx - off.x, c.y + dy - off.z);
        if (Math.abs(h1 - h2) < 0.05) continue;
        const lo = Math.min(h1, h2), hi = Math.max(h1, h2) + DECAL_LIFT;
        // The shared edge of the two DRAWN cells (each is centred on its own coord).
        if (dx === 1) wall(c.x + 0.5 - off.x, c.y - 0.5 - off.z, c.x + 0.5 - off.x, c.y + 0.5 - off.z, lo, hi);
        else wall(c.x - 0.5 - off.x, c.y + 0.5 - off.z, c.x + 0.5 - off.x, c.y + 0.5 - off.z, lo, hi);
      }
    }
    if (decal.positions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(decal.positions, 3));
      geo.setIndex(decal.index);
      const wash = new THREE.Mesh(geo, this.washMat(zone.color));
      wash.renderOrder = ORDER.wash;
      this.group.add(wash);
    }
    // The outline: the SAME rounded dashed loop the 2D view traces (`roundedZoneLoops`), as
    // RIBBON quads at the drawn width (a THREE.Line is one pixel whatever is asked). Each sampled
    // point is INSET along the loop's inward normal by half the ribbon plus a hair, and its height
    // is read at the inset point — the line stays inside its own cells, so a taller neighbour's
    // wall cannot clip it into broken dark edges on stepped ground, and the drape follows each
    // terrace it crosses.
    const w = INK_CELLS.outline * this.ink;
    // Capped below the corner rounding a unit-step edge can hold (the l/2 clamp in
    // `roundedZoneLoops` bottoms out at 0.5): an inset past the local corner radius turns the
    // offset loop inside out there and the ribbon folds into a bowtie at every turn.
    const inset = Math.min(w / 2 + 0.02, 0.34);
    const paths: Array<Array<[number, number, number]>> = [];
    for (const loop of roundedZoneLoops(zone.cells, zoneCornerRadius(this.ink))) {
      const normals = loopInwardNormals(loop);
      const flat = loop.map(([x, y], i) => {
        const [nx, ny] = normals[i]!;
        return [x + ZONE_GRID_SHIFT - off.x + nx * inset, y + ZONE_GRID_SHIFT - off.z + ny * inset] as [number, number];
      });
      paths.push(drapeHeights(state, densify(flat), [0, 0.8], w / 2, OUTLINE_LIFT));
    }
    // The lettering-ink halo the route wears, under the dashes: over side-lit, part-shadowed
    // ground the bare colour loses its figure against the terrain (worst where the tint is near
    // the grass), and the dark rim is what keeps the border reading as drawn ink.
    const dashes = zoneDashCells(this.ink);
    const lower = paths.map((path) => path.map(([x, y, z]) => [x, y - 0.012, z] as [number, number, number]));
    const halo = ribbonGeometry(lower, w * 1.45, dashes);
    if (halo) {
      const m = new THREE.Mesh(halo, this.inkMat());
      m.renderOrder = ORDER.outlineHalo;
      this.group.add(m);
    }
    const geo = ribbonGeometry(paths, w, dashes);
    if (geo) {
      const outline = new THREE.Mesh(geo, this.edgeMat(zone.color));
      outline.renderOrder = ORDER.outline;
      this.group.add(outline);
    }
    if (selected) {
      // The 2D layer's own mark: a white dash at half width riding the coloured one.
      const upper = paths.map((path) => path.map(([x, y, z]) => [x, y + 0.006, z] as [number, number, number]));
      const mark = ribbonGeometry(upper, w * 0.5, dashes);
      if (mark) {
        const m = new THREE.Mesh(mark, this.selectMat());
        m.renderOrder = ORDER.select;
        this.group.add(m);
      }
    }
  }

  /**
   * A route draws as a draped RIBBON, never a THREE.Line: WebGL rasterises a line at one pixel
   * whatever its material asks, so the arrow's shaft was a hairline beside a cone that scaled with
   * the map. The ribbon carries the drawn width itself — flat quads along the samples, each dash
   * its own run — at the same `INK_CELLS.route` the 2D stroke uses.
   */
  private buildRoute(state: GridState, route: RouteNote, selected = false): void {
    if (route.points.length < 2) return;
    const off = mapCenterOffset(state.template.width, state.template.height);
    const samples = densify(routeSamples(route.points).map(([x, y]) => [x - off.x, y - off.z] as [number, number]));
    const width = INK_CELLS.route * this.ink;
    const pts: Array<[number, number, number]> = drapeHeights(state, samples, [0, 0.8, -0.8], width / 2, ROUTE_LIFT);
    // Match the 2D route with a lower ink halo, a colored ribbon and a flat two-layer arrowhead.
    const dashes = route.dashed ? { dash: width * 2.4, gap: width * 2 } : null;
    const lower: Array<[number, number, number]> = pts.map(([x, y, z]) => [x, y - 0.012, z]);
    const halo = ribbonGeometry([lower], width * 1.77, dashes);
    if (halo) {
      const m = new THREE.Mesh(halo, this.inkMat());
      m.renderOrder = ORDER.routeHalo;
      this.group.add(m);
    }
    const geo = ribbonGeometry([pts], width, dashes);
    if (geo) {
      const m = new THREE.Mesh(geo, this.washMatSolid(route.color));
      m.renderOrder = ORDER.route;
      this.group.add(m);
    }
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
      this.group.add(m);
    };
    head(width * 2.2 + width * 0.6, tip[1] + 0.004, this.inkMat(), ORDER.headHalo);
    head(width * 2.2, tip[1] + 0.01, this.washMatSolid(route.color), ORDER.head);
    if (selected) {
      // The 2D mark: a white disc with an ink rim on every waypoint, where the grab would land.
      for (const wp of route.points) {
        const wx = wp.x - off.x, wz = wp.y - off.z;
        const y = surfaceHeightAt(state, wx, wz) + ROUTE_LIFT + 0.02;
        this.disc(wx, y, wz, width * 1.15, this.inkMat(), ORDER.select);
        this.disc(wx, y + 0.004, wz, width, this.selectMat(), ORDER.select);
      }
    }
  }

  /** A flat fan disc on the ground — the 3D spelling of a drawn dot. */
  private disc(x: number, y: number, z: number, r: number, mat: THREE.Material, order: number): void {
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
    this.group.add(m);
  }

  /** A selected TEXT note's mark: the 2D layer's dashed white box, draped around the word. */
  private buildTextSelection(state: GridState, note: TextNote): void {
    const off = mapCenterOffset(state.template.width, state.template.height);
    const hw = textApproxWidthCells(note, this.ink) / 2 + 0.3;
    const hh = textApproxHeightCells(note, this.ink) / 2 + 0.3;
    const corners: Array<[number, number]> = [
      [note.x - hw - off.x, note.y - hh - off.z], [note.x + hw - off.x, note.y - hh - off.z],
      [note.x + hw - off.x, note.y + hh - off.z], [note.x - hw - off.x, note.y + hh - off.z],
      [note.x - hw - off.x, note.y - hh - off.z],
    ];
    const lw = INK_CELLS.outline * this.ink * 0.5;
    const path = drapeHeights(state, densify(corners), [0], lw / 2, OUTLINE_LIFT + 0.01);
    const geo = ribbonGeometry([path], lw, { dash: lw * 4, gap: lw * 3.3 });
    if (geo) {
      const m = new THREE.Mesh(geo, this.selectMat());
      m.renderOrder = ORDER.select;
      this.group.add(m);
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
      this.mats.set('select', mat);
    }
    return mat;
  }

  private edgeMat(color: string): THREE.Material {
    const shown = isInk(color) ? '#FFFFFF' : color;
    const key = `edge:${shown}`;
    let mat = this.mats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(shown),
        transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      });
      this.mats.set(key, mat);
    }
    return mat;
  }

  /** The lettering ink under a route — the map-label treatment's dark edge, as a ribbon. */
  private inkMat(): THREE.Material {
    let mat = this.mats.get('ink');
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(INK),
        transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false, depthTest: false,
      });
      this.mats.set('ink', mat);
    }
    return mat;
  }

  private washMatSolid(color: string): THREE.Material {
    const shown = isInk(color) ? '#FFFFFF' : color;
    const key = `solid:${shown}`;
    let mat = this.mats.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(shown),
        side: THREE.DoubleSide, transparent: true, depthWrite: false, depthTest: false,
      });
      this.mats.set(key, mat);
    }
    return mat;
  }

  private buildZoneLabel(state: GridState, zone: ZoneNote, used: Set<string>): void {
    const withNum = zone.num > 0;
    if (!withNum && !zone.name) return;
    const key = `zone:${this.ink}:${zone.color}:${zone.size ?? 'm'}:${withNum ? zone.num : ''}:${zone.name}`;
    const at = zoneCentroid(zone.cells);
    this.addBillboard(state, key, at, INK_CELLS.zoneLabel[zone.size ?? 'm'] * this.ink * BILLBOARD_PAD, used, (ctx, h) => {
      const fs = h * 0.52;
      ctx.font = `800 ${fs}px ${APP_FONT_FAMILY}`;
      const nameW = zone.name ? ctx.measureText(zone.name).width : 0;
      const numR = withNum ? fs * 0.62 : 0;
      const total = (withNum ? numR * 2 + (zone.name ? 8 : 0) : 0) + nameW;
      let x = 8;
      const cy = h / 2;
      if (withNum) {
        ctx.fillStyle = isInk(zone.color) ? '#8A9BAE' : zone.color;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x + numR, cy, numR, 0, 7);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${fs * 0.68}px ${APP_FONT_FAMILY}`;
        ctx.fillText(String(zone.num), x + numR, cy + fs * 0.04);
        x += numR * 2 + (zone.name ? 8 : 0);
      }
      if (zone.name) {
        ctx.font = `800 ${fs}px ${APP_FONT_FAMILY}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = INK;
        ctx.lineWidth = fs * 0.16;
        ctx.strokeText(zone.name, x, cy);
        ctx.fillStyle = MAP_TEXT;
        ctx.fillText(zone.name, x, cy);
      }
      return total + 16;
    });
  }

  private buildText(state: GridState, note: TextNote, used: Set<string>): void {
    if (!note.text) return;
    const key = `text:${this.ink}:${note.color}:${note.style}:${note.size}:${note.text}`;
    this.addBillboard(state, key, { x: note.x, y: note.y }, INK_CELLS.text[note.size] * this.ink * BILLBOARD_PAD, used, (ctx, h) => {
      const fs = h * (note.style === 'chip' ? 0.5 : 0.58);
      ctx.font = `800 ${fs}px ${APP_FONT_FAMILY}`;
      const w = ctx.measureText(note.text).width;
      const cy = h / 2;
      if (note.style === 'chip') {
        const padX = fs * 0.5;
        const chipH = fs * 1.6;
        ctx.fillStyle = note.color;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 2;
        roundRect(ctx, 4, cy - chipH / 2, w + padX * 2, chipH, chipH * 0.36);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isInk(note.color) ? INK : '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(note.text, 4 + padX, cy + fs * 0.05);
        return w + padX * 2 + 8;
      }
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = INK;
      ctx.lineWidth = fs * 0.15;
      ctx.strokeText(note.text, 8, cy);
      ctx.fillStyle = isInk(note.color) ? MAP_TEXT : note.color;
      ctx.fillText(note.text, 8, cy);
      return w + 16;
    });
  }

  /** One camera-facing sprite: `paint` draws into a canvas of height `worldH * TEX_PX_PER_UNIT`
   *  and answers the width it used, which sizes both the canvas crop and the sprite's own scale. */
  private addBillboard(
    state: GridState,
    key: string,
    at: MacroCoord,
    worldH: number,
    used: Set<string>,
    paint: (ctx: CanvasRenderingContext2D, hPx: number) => number,
  ): void {
    used.add(key);
    let tex = this.textures.get(key);
    if (!tex) {
      // ONE paint, then a pixel crop: measured on one canvas and drawn on another, a font that
      // finished loading between the two paints clipped the label mid-glyph.
      // Resolution is bounded by capping the RASTER height, never by truncating the width: a big
      // map's ink scale is several world units of lettering, and a width cap cuts glyphs off.
      const hPx = Math.round(Math.min(worldH * TEX_PX_PER_UNIT, 360));
      const wide = document.createElement('canvas');
      wide.width = 2048;
      wide.height = hPx;
      const wctx = wide.getContext('2d');
      if (!wctx) return;
      const wPx = Math.ceil(Math.min(2048, Math.max(8, paint(wctx, hPx))));
      const canvas = document.createElement('canvas');
      canvas.width = wPx;
      canvas.height = hPx;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(wide, 0, 0);
      tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.textures.set(key, tex);
    }
    const matKey = `sprite:${key}`;
    let mat = this.mats.get(matKey) as THREE.SpriteMaterial | undefined;
    if (!mat) {
      mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
      this.mats.set(matKey, mat);
    }
    const off = mapCenterOffset(state.template.width, state.template.height);
    const wx = at.x - off.x;
    const wz = at.y - off.z;
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = ORDER.label;
    const img = tex.image as HTMLCanvasElement;
    sprite.scale.set(worldH * (img.width / img.height), worldH, 1);
    // Anchored by its FOOT, so the word stands on the ground instead of sinking through a slope.
    sprite.center.set(0.5, 0);
    sprite.position.set(wx, surfaceHeightAt(state, wx, wz) + OUTLINE_LIFT, wz);
    this.group.add(sprite);
  }
}

/**
 * Draped ribbon strips along sampled paths, `width` across in XZ, one strip per dash run
 * (`null` = solid). Joints share MITERED vertices — the joint's across-vector is the mean of the
 * neighbouring segments' perpendiculars, scaled to keep the drawn width — so a bend is one
 * continuous surface instead of per-segment quads opening wedge gaps at every corner sample. Each
 * open run ends in a semicircular cap, the round line caps the 2D stroke draws. Every path lands
 * in ONE geometry, so a zone's whole outline is one draw.
 */
function ribbonGeometry(
  paths: ReadonlyArray<ReadonlyArray<[number, number, number]>>,
  width: number,
  dashes: { dash: number; gap: number } | null,
): THREE.BufferGeometry | null {
  const half = width / 2;
  const positions: number[] = [];
  const index: number[] = [];
  const push = (x: number, y: number, z: number): number => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const cap = (p: [number, number, number], dirX: number, dirZ: number): void => {
    // A fan over the half-disc past the run's end; its base chord is the strip's own end line.
    const a0 = Math.atan2(dirZ, dirX) - Math.PI / 2;
    const c = push(p[0], p[1], p[2]);
    let prev = -1;
    for (let i = 0; i <= 4; i++) {
      const ang = a0 + (Math.PI * i) / 4;
      const v = push(p[0] + Math.cos(ang) * half, p[1], p[2] + Math.sin(ang) * half);
      if (prev >= 0) index.push(c, prev, v);
      prev = v;
    }
  };
  const strip = (run: ReadonlyArray<[number, number, number]>): void => {
    if (run.length < 2) return;
    // Per-segment unit perpendiculars in XZ, skipping zero-length steps.
    const perps: Array<[number, number]> = [];
    for (let i = 1; i < run.length; i++) {
      const dx = run[i]![0] - run[i - 1]![0];
      const dz = run[i]![2] - run[i - 1]![2];
      const len = Math.hypot(dx, dz);
      perps.push(len < 1e-6 ? perps[perps.length - 1] ?? [0, 0] : [-dz / len, dx / len]);
    }
    let prevA = -1, prevB = -1;
    for (let i = 0; i < run.length; i++) {
      const n1 = perps[Math.max(0, i - 1)]!;
      const n2 = perps[Math.min(perps.length - 1, i)]!;
      let mx = n1[0] + n2[0];
      let mz = n1[1] + n2[1];
      const mlen = Math.hypot(mx, mz);
      if (mlen < 1e-6) { mx = n2[0]; mz = n2[1]; } else { mx /= mlen; mz /= mlen; }
      // Widen the joint so the drawn width holds through the bend; clamped TIGHT — the corner
      // sampling keeps real joints under a few degrees, so anything sharper is a degenerate
      // sample, and letting the miter chase it throws a barb off the border.
      const scale = half / Math.max(0.85, mx * n2[0] + mz * n2[1]);
      const p = run[i]!;
      const a = push(p[0] + mx * scale, p[1], p[2] + mz * scale);
      const b = push(p[0] - mx * scale, p[1], p[2] - mz * scale);
      if (prevA >= 0) index.push(prevA, a, prevB, prevB, a, b);
      prevA = a;
      prevB = b;
    }
    const first = run[0]!, last = run[run.length - 1]!;
    const closed = Math.hypot(first[0] - last[0], first[2] - last[2]) < 1e-6;
    if (closed) return;
    const p0 = perps[0]!, pn = perps[perps.length - 1]!;
    cap(first, -p0[1], p0[0]);   // facing back along the first segment
    cap(last, pn[1], -pn[0]);    // facing on along the last segment
  };
  const lerp = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (const pts of paths) {
    if (pts.length < 2) continue;
    if (!dashes) {
      strip(pts);
      continue;
    }
    // The same arc-length walk the 2D dash makes, cutting the path into pen-down runs. The pen
    // restarts per path, so every outline edge begins on a dash.
    let penDown = true;
    let remaining = dashes.dash;
    let run: Array<[number, number, number]> = [pts[0]!];
    for (let i = 1; i < pts.length; i++) {
      let a = pts[i - 1]!;
      const b = pts[i]!;
      let seg = Math.hypot(b[0] - a[0], b[2] - a[2]);
      while (seg > remaining) {
        const cut = lerp(a, b, remaining / seg);
        if (penDown) { run.push(cut); strip(run); run = []; }
        else run = [cut];
        penDown = !penDown;
        a = cut;
        seg -= remaining;
        remaining = penDown ? dashes.dash : dashes.gap;
      }
      if (penDown) run.push(b);
      remaining -= seg;
    }
    if (penDown) strip(run);
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  return geo;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

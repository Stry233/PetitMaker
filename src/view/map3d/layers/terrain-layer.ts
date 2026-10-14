/**
 * The terrain as per-chunk meshes, rebuilt chunk by chunk when cells change, and the sea frame
 * around the map. Chunks are independent scene objects, so an edit costs only its dirty ring and
 * three's per-mesh frustum culling applies chunk-wise.
 */
import * as THREE from 'three';
import type { GridState, MapTemplate } from '../../../core/model/types';
import { BUCKET_SIZE, bucketCounts } from '../../../core/grid/buckets';
import { chunkKey } from '../../../core/grid/rect';
import { chunkNumberCells, setNumberLabelStyle, drawNumberLabel } from '../../shared/terrain/number-cells';
import { buildChunkTerrain, buildSeaFrame } from '../geometry/terrain-geometry';
import { chunkNumberQuads } from '../geometry/passive-geometry';
import type { MeshData } from '../geometry/types';
import { waterColor } from '../draw/palette';
import { softenSeaEdge } from '../draw/sea-edge';
import { toGeometry } from '../draw/mesh-upload';
import { addGridOverlay, addLabelFade, type GridUniforms } from '../draw/grid-drape';

/** One terrain chunk's live scene objects. */
interface TerrainChunk {
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  numbers: { mesh: THREE.Mesh; tex: THREE.CanvasTexture } | null;
}

/** Where along the cascade pattern a waterfall face is shaded (see shadeFall). */
const FALL_PHASE = 0;

/**
 * The cascade shading, three layers deep so a fall reads as water rather than one flat blue face:
 * broad sheets set the large-scale flow, fine streaks ride on top (both squared/cubed so the base
 * stays deep, never a white flash), and a splash band brightens the bottom of the drop where the
 * water lands. Painted into the fall mesh's colour buffer as it is built, which is why
 * `FALL_SEGMENTS` subdivides the face: the pattern varies down the drop. `deep` and `foam` are
 * linear colours.
 *
 * `FALL_PHASE` shifts the pattern along the face. Any value draws the same kind of cascade — the
 * shading is a function of the vertex's own position, so the phase moves the streaks rather than
 * changing what they are.
 */
export function shadeFall(geo: THREE.BufferGeometry, deep: readonly [number, number, number], foam: readonly [number, number, number]): void {
  const [dr, dg, db] = deep;
  const [fr, fg, fb] = foam;
  const t1 = FALL_PHASE * 0.18; // sheets
  const t2 = FALL_PHASE * 0.34; // streaks + splash
  const pos = (geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
  const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
  const arr = colAttr.array as Float32Array;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const px = pos[i * 3]!, py = pos[i * 3 + 1]!;
    const s1 = Math.sin(py * 5.5 + px * 3.1 + t1);
    const sheet = s1 > 0 ? s1 * s1 : 0;
    const s2 = Math.sin(py * 13 + px * 8.7 + t2 + 1.7);
    const streak = s2 > 0 ? s2 * s2 * s2 : 0;
    const base = Math.max(0, 1 - py / 0.35);
    const splash = base * base * (0.5 + 0.2 * Math.sin(px * 7 + t2 * 1.3));
    let k = 0.1 + 0.26 * sheet + 0.22 * streak + 0.5 * splash;
    if (k > 1) k = 1;
    arr[i * 3] = dr + (fr - dr) * k;
    arr[i * 3 + 1] = dg + (fg - dg) * k;
    arr[i * 3 + 2] = db + (fb - db) * k;
  }
  colAttr.needsUpdate = true;
}

/** What the chunks read from the scene that holds them. */
export interface TerrainChunksHost {
  readonly scene: THREE.Scene;
  /** The state the mesher consumes: the live map, or its peel view while layers are hidden. */
  meshState(): GridState;
  hiddenLayers(): ReadonlySet<number>;
  /** Whether the layer-number labels are drawn. */
  numbersShown(): boolean;
  readonly gridUniforms: GridUniforms;
}

export class TerrainLayer3D {
  readonly opaqueMat: THREE.MeshLambertMaterial;
  readonly wetMat: THREE.MeshLambertMaterial;
  /** Chunk keys an edit dirtied; `flush` remeshes them. */
  readonly dirty = new Set<string>();
  private readonly chunks = new Map<string, TerrainChunk>();
  private fallDeep: [number, number, number] = [0, 0, 0];   // linear deep-water colour
  private fallFoam: [number, number, number] = [1, 1, 1];   // linear foam colour
  private readonly disposables: { dispose(): void }[] = [];

  constructor(private readonly host: TerrainChunksHost) {
    this.opaqueMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    this.wetMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  }

  /** Drapes the reference grid onto both terrain materials and takes the waterfall colours from
   *  the water palette. */
  drape(): void {
    addGridOverlay(this.opaqueMat, this.host.gridUniforms);
    addGridOverlay(this.wetMat, this.host.gridUniforms);
    const wc = waterColor();
    const deep = new THREE.Color().setRGB(wc[0], wc[1], wc[2], THREE.SRGBColorSpace);
    const foam = new THREE.Color().setRGB(Math.min(1, wc[0] + 0.22), Math.min(1, wc[1] + 0.22), Math.min(1, wc[2] + 0.22), THREE.SRGBColorSpace);
    this.fallDeep = [deep.r, deep.g, deep.b];
    this.fallFoam = [foam.r, foam.g, foam.b];
  }

  /** Meshes every chunk of `state`, then the sea frame around it. */
  buildAll(state: GridState): void {
    const { cols: chunksX, rows: chunksY } = bucketCounts(state.template.width, state.template.height);
    for (let cy = 0; cy < chunksY; cy++) {
      for (let cx = 0; cx < chunksX; cx++) this.rebuildChunk(cx, cy);
    }
    const sea = buildSeaFrame(state);
    for (const [data, baseMaterial] of [[sea.ground, this.opaqueMat], [sea.water, this.wetMat]] as const) {
      if (!data.positions.length) continue;
      const material = baseMaterial.clone();
      addGridOverlay(material, this.host.gridUniforms);
      softenSeaEdge(material, state.template);
      const geometry = toGeometry(data, 'sea frame');
      this.disposables.push(geometry, material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.receiveShadow = baseMaterial === this.opaqueMat;
      // Draw the fading seabed before water chunks blend and write their depth.
      if (baseMaterial === this.opaqueMat) mesh.renderOrder = -1;
      this.host.scene.add(mesh);
    }
  }

  dirtyAll(template: MapTemplate): void {
    const { cols, rows } = bucketCounts(template.width, template.height);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) this.dirty.add(chunkKey(cx, cy));
    }
  }

  /** Remeshes every dirtied chunk; returns whether there were any. */
  flush(): boolean {
    if (this.dirty.size === 0) return false;
    for (const key of this.dirty) {
      const [cx, cy] = key.split(',').map(Number);
      this.rebuildChunk(cx!, cy!);
    }
    this.dirty.clear();
    return true;
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) {
      for (const geo of chunk.geometries) geo.dispose();
    }
    this.chunks.clear();
    this.opaqueMat.dispose();
    this.wetMat.dispose();
    for (const d of this.disposables) d.dispose();
  }

  /** (Re)meshes one terrain chunk from the mesh state, replacing its previous meshes. */
  private rebuildChunk(cx: number, cy: number): void {
    const { scene } = this.host;
    const key = chunkKey(cx, cy);
    const prev = this.chunks.get(key);
    if (prev) {
      for (const mesh of prev.meshes) scene.remove(mesh);
      if (prev.numbers) {
        scene.remove(prev.numbers.mesh);
        (prev.numbers.mesh.material as THREE.Material).dispose();
        prev.numbers.tex.dispose();
      }
      for (const geo of prev.geometries) geo.dispose();
      this.chunks.delete(key);
    }
    const { solid, ground, water, fall } = buildChunkTerrain(this.host.meshState(), cx, cy);
    const entry: TerrainChunk = { meshes: [], geometries: [], numbers: null };
    const addOpaque = (data: MeshData) => {
      if (!data.positions.length) return;
      const geo = toGeometry(data, import.meta.env.DEV ? `terrain chunk ${cx},${cy}` : '');
      const mesh = new THREE.Mesh(geo, this.opaqueMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      entry.meshes.push(mesh);
      entry.geometries.push(geo);
    };
    addOpaque(solid);
    addOpaque(ground);
    if (water.positions.length) {
      // Translucent water: no shadow cast/receive (avoids transparency artifacts).
      const geo = toGeometry(water, import.meta.env.DEV ? `water chunk ${cx},${cy}` : '');
      const mesh = new THREE.Mesh(geo, this.wetMat);
      scene.add(mesh);
      entry.meshes.push(mesh);
      entry.geometries.push(geo);
    }
    if (fall.positions.length) {
      // Waterfall / pond-cliff faces: the cascade shading, painted into the colour buffer once.
      const geo = toGeometry(fall, import.meta.env.DEV ? `waterfall chunk ${cx},${cy}` : '');
      shadeFall(geo, this.fallDeep, this.fallFoam);
      const mesh = new THREE.Mesh(geo, this.wetMat);
      scene.add(mesh);
      entry.meshes.push(mesh);
      entry.geometries.push(geo);
    }
    this.attachNumbers(entry, cx, cy);
    if (entry.meshes.length || entry.numbers) this.chunks.set(key, entry);
  }

  /** The chunk's layer-number quads, rebuilt with it so they always drape the current surface.
   *  Built only while their setting is on; a toggle marks every chunk dirty. */
  private attachNumbers(entry: TerrainChunk, cx: number, cy: number): void {
    if (!this.host.numbersShown()) return;
    const quads = chunkNumberQuads(this.host.meshState(), cx, cy, this.host.hiddenLayers());
    if (!quads.positions.length) return;
    const canvas = this.paintNumberAtlas(cx, cy);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(quads.positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(quads.uvs, 2));
    geo.setIndex(quads.index);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    addLabelFade(mat, this.host.gridUniforms.uGridPixelRatio); // smooth density LOD, the same window the draped grid fades on
    const mesh = new THREE.Mesh(geo, mat);
    this.host.scene.add(mesh);
    entry.numbers = { mesh, tex };
    entry.geometries.push(geo);
  }

  /** The chunk's label atlas: each cell's elevation drawn into its own slot, mirroring the 2D
   *  number raster's look (bold white on a dark outline). */
  private paintNumberAtlas(cx: number, cy: number): HTMLCanvasElement {
    // One 64px slot per cell — the label repeats the 2D raster exactly: bold
    // 14px monospace, bottom-left corner, white over a black outline.
    const SLOT = 64;
    const canvas = document.createElement('canvas');
    canvas.width = BUCKET_SIZE * SLOT;
    canvas.height = BUCKET_SIZE * SLOT;
    const ctx2d = canvas.getContext('2d')!;
    setNumberLabelStyle(ctx2d);
    for (const { x, y, label } of chunkNumberCells(this.host.meshState(), cx, cy, this.host.hiddenLayers())) {
      const px = (x - cx * BUCKET_SIZE) * SLOT + 3;
      const py = (y - cy * BUCKET_SIZE) * SLOT + SLOT - 3;
      drawNumberLabel(ctx2d, label, px, py);
    }
    return canvas;
  }
}

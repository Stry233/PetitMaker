/**
 * Every road surface as flat decal meshes, one per road material present, each wearing that
 * material's tile art or pattern. Rebuilt whole when any road changes: the trimmed set is small,
 * and a rebuild costs far less than tracking it per chunk.
 */
import * as THREE from 'three';
import type { GridState } from '../../../core/model/types';
import { coatingLayer } from '../../../core/model/traits';
import { roadPatternKey, roadPatternRepeat } from '../../shared/road/pattern';
import { getCatalogItem } from '../../../state/catalog';
import { iconUrl } from '../../../assets/icon-urls';
import { roadTileCanvas } from '../../shared/road/tile-texture';
import { roadMaterialTexture } from '../../shared/road/material-texture';
import { buildRoadTrimMeshes, RoadTrimCache, type RoadTrimPart } from '../geometry/road-mesh';
import { softenRoadEdge } from '../draw/road-edge';
import { toGeometry } from '../draw/mesh-upload';

/** What the road surfaces read from the scene that holds them. */
export interface RoadSurfacesHost {
  readonly scene: THREE.Scene;
  /** The live map. */
  state(): GridState;
  hiddenLayers(): ReadonlySet<number>;
  /** The anisotropic filtering the renderer supports, for ground seen at glancing angles. */
  maxAnisotropy(): number;
  /** True once the scene is torn down; art that decodes later is dropped. */
  disposed(): boolean;
  requestRender(): void;
  /** Owes a rebuild, which the scene runs once per rendered frame. */
  rebuildOwed(): void;
}

export class RoadSurfaces3D {
  /** The plain decal material; a material with art draws through a tinted or textured clone. */
  readonly material: THREE.MeshLambertMaterial;
  private meshes: THREE.Mesh[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  /** Regions and band triangulations reused across road rebuilds, tween frames and move previews. */
  private readonly cache = new RoadTrimCache(() => this.onArtLoaded());
  /** The per-material road materials, keyed `<catalogId>:<pattern>:tex|flat`. A textured
   *  surface's vertex colours are white, so the stand-in used while the art decodes must carry the
   *  item's hex itself; the two are separate cache entries, and the textured one wins once it exists. */
  private readonly tileMats = new Map<string, THREE.MeshLambertMaterial>();
  private readonly disposables: { dispose(): void }[] = [];

  constructor(private readonly host: RoadSurfacesHost) {
    // The road decal composites over the terrain by per-vertex alpha (the feather fades to the
    // ground as it actually renders, and two fades crossing blend instead of z-fighting), so it is
    // transparent and never writes depth — it lies a hair above a surface the depth buffer already
    // holds. No grid injection: the draped grid lives in the terrain material, so it stops at a
    // road's own surface.
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true, flatShading: true, side: THREE.DoubleSide, transparent: true, depthWrite: false,
    });
    softenRoadEdge(this.material);
  }

  /** Rebuilds the surfaces of `state` (the live map by default). `offsets` displaces named roads
   *  on the ground plane: the group-rotation tween's per-frame arc for a road that has no instance
   *  matrix to back-date. */
  rebuild(offsets?: ReadonlyMap<string, { dx: number; dz: number }>, state = this.host.state()): void {
    for (const mesh of this.meshes) this.host.scene.remove(mesh);
    for (const geo of this.geometries) geo.dispose(); // the materials are cached per material, not per rebuild
    this.meshes = [];
    this.geometries = [];
    for (const part of buildRoadTrimMeshes(state, this.host.hiddenLayers(), offsets, this.cache)) {
      const geo = toGeometry(part.mesh, 'road trim');
      const mesh = new THREE.Mesh(geo, this.materialFor(part));
      mesh.renderOrder = coatingLayer(getCatalogItem(part.material));
      // A flat decal on the surface casts no shadow of its own — and the shadow depth pass ignores
      // vertex alpha, so letting it cast would print the feather's full square silhouette.
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.host.scene.add(mesh);
      this.meshes.push(mesh);
      this.geometries.push(geo);
    }
  }

  dispose(): void {
    for (const geo of this.geometries) geo.dispose();
    this.geometries = [];
    this.meshes = [];
    this.material.dispose();
    for (const d of this.disposables) d.dispose();
  }

  /**
   * The material one road material's surfaces draw with: its tile art repeat-wrapped across the
   * decal's grid UVs, or — until that art has decoded, and for a road that has no art at all — the
   * plain vertex-coloured decal material. The stand-in for a textured material is a tinted clone,
   * since the builder leaves those vertices white for the art to colour.
   */
  private materialFor(part: RoadTrimPart): THREE.MeshLambertMaterial {
    if (!part.icon && !part.pattern) return this.material;
    const url = part.icon ? iconUrl(part.icon) : undefined;
    const canvas = part.pattern ? roadMaterialTexture(part.pattern) : url ? roadTileCanvas(url, this.onArtLoaded) : undefined;
    const key = `${part.material}:${roadPatternKey(part.pattern)}:${canvas ? 'tex' : 'flat'}`;
    const hit = this.tileMats.get(key);
    if (hit) return hit;
    const mat = this.material.clone();
    softenRoadEdge(mat);
    if (canvas) {
      const tex = new THREE.CanvasTexture(canvas);
      if (part.pattern) roadMaterialTexture(part.pattern, () => {
        if (this.host.disposed()) return;
        tex.needsUpdate = true;
        this.host.requestRender();
      });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping; // the crop is power-of-two, so repeat is legal on WebGL1 too
      // A road decal's v is its world Z (geometry/road-mesh:fillGridUvs), so v grows south,
      // the direction a canvas row index grows. three.js uploads a CanvasTexture flipped by
      // default, which would sample the tile bottom-up and hand the 3D view a vertically mirrored
      // pattern — visible on any asymmetric path (a herringbone's chevrons point the other way).
      // The label atlas solves the same thing on the UV side (geometry/passive-geometry emits 1 - v);
      // here the texture is ours alone, so it is one property rather than a term in the geometry.
      tex.flipY = false;
      tex.repeat.setScalar(1 / roadPatternRepeat(part.pattern));
      tex.colorSpace = THREE.SRGBColorSpace;
      // A ground plane is seen at glancing angles almost everywhere; without this the tiling
      // pattern aliases into a shimmer well before the horizon.
      tex.anisotropy = this.host.maxAnisotropy();
      mat.map = tex;
      this.disposables.push(tex);
    } else {
      const hex = getCatalogItem(part.material)?.color;
      if (hex) mat.color.setStyle(hex, THREE.SRGBColorSpace);
    }
    this.disposables.push(mat);
    this.tileMats.set(key, mat);
    return mat;
  }

  /** A path's tile art has decoded: the surfaces already standing were built with the stand-in
   *  material, and only a rebuild swaps them onto the textured one. Owed the way an edit owes it,
   *  so however many materials land together they cost one rebuild. */
  private onArtLoaded = (): void => {
    if (this.host.disposed()) return; // the view was torn down while its art was still loading
    this.host.rebuildOwed();
    this.host.requestRender();
  };
}

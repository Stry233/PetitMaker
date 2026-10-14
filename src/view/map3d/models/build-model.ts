/**
 * Renders a declarative ModelSpec into one merged, vertex-coloured
 * THREE.BufferGeometry — the generic engine behind every per-item 3D model.
 * Primitives are unit shapes (footprint within [-0.5,0.5]², base at y=0, height 1)
 * scaled/rotated/translated per part, tinted with baked linear vertex colours, and
 * merged. The result is normalised so its lowest point rests on the ground.
 *
 * This is the only three.js file under models/; the registry + specs stay pure data.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelPart, ModelSpec } from '../../../config/catalog/model-spec';
import { getDeckSpec, getSpec } from './registry';
import { LAYER_HEIGHT } from '../geometry/coords';
import { PERSISTENT_GROUND } from '../draw/proximity-fade';
import { getCatalogItem } from '../../../state/catalog';
import { ELEVATION_COLORS } from '../../../core/model/palette';
import type { GlQuality } from '../../../platform/device/device-quality';

/** A square gable roof: triangular cross-section (ridge along local X), base y=0..1. */
function gable(): THREE.BufferGeometry {
  const p = [
    -0.5, 0, -0.5,  -0.5, 0, 0.5,  -0.5, 1, 0,   // 0,1,2  left triangle (x=-0.5)
    0.5, 0, -0.5,   0.5, 0, 0.5,   0.5, 1, 0,    // 3,4,5  right triangle (x=+0.5)
  ];
  const idx = [
    0, 1, 2, 3, 5, 4,                  // gable ends
    0, 3, 4, 0, 4, 1,                  // bottom
    1, 4, 5, 1, 5, 2,                  // slope +z
    0, 2, 5, 0, 5, 3,                  // slope -z
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  return g;
}

/** A ramp wedge rising toward +Z, base y=0..1. */
function wedge(): THREE.BufferGeometry {
  const p = [
    -0.5, 0, -0.5,  0.5, 0, -0.5,  -0.5, 0, 0.5,  0.5, 0, 0.5,  -0.5, 1, 0.5,  0.5, 1, 0.5,
  ];
  const idx = [0, 1, 5, 0, 5, 4, 0, 2, 3, 0, 3, 1, 2, 4, 5, 2, 5, 3, 0, 2, 4, 1, 5, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  return g;
}

/** Unit primitive: footprint within [-0.5,0.5]², base at y=0, height 1.
 *  `taper` shrinks a cylinder's top radius (1 = straight; <1 = a frustum, e.g. a
 *  trunk flaring out at the base). `detail` subdivides a sphere's icosphere
 *  (0 = 20-face low-poly, 1 = 80, … — rounder canopies that still read low-poly). */
function unit(
  spec: { shape: ModelPart['shape']; seg: number; taper: number; detail: number; mesh?: ModelPart['mesh'] }, quality: GlQuality = 'full',
): THREE.BufferGeometry {
  const { shape, seg, taper, detail, mesh } = spec;
  switch (shape) {
    case 'mesh': {
      if (!mesh) throw new Error('An authored mesh requires vertices and triangles');
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(mesh.vertices.flat(), 3));
      g.setIndex(mesh.triangles.flat());
      return g;
    }
    case 'box': return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    case 'cylinder': return new THREE.CylinderGeometry(0.5 * taper, 0.5, 1, seg).translate(0, 0.5, 0);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, seg).translate(0, 0.5, 0);
    case 'sphere': return new THREE.IcosahedronGeometry(0.5, detail).translate(0, 0.5, 0);
    case 'leaf': {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0, -0.5, 0.45, 0, 0, 1, 0, 0.5, 0.45, 0, 0, 0.45, 0.5, 0, 0.45, -0.5,
      ], 3));
      g.setIndex([0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0, 0, 1, 5, 1, 2, 5, 2, 3, 5, 3, 0, 5]);
      return g;
    }
    case 'petal': {
      const g = new THREE.BufferGeometry();
      const edge: [number, number][] = quality === 'lite'
        ? [[0, 0], [-0.5, 0.65], [-0.32, 0.91], [0, 1], [0.32, 0.91], [0.5, 0.65]]
        : [[0, 0], [-0.42, 0.25], [-0.5, 0.65], [-0.32, 0.91], [0, 1], [0.32, 0.91], [0.5, 0.65], [0.42, 0.25]];
      const n = edge.length;
      const positions = [...edge.flatMap(([x, y]) => [x, y, 0]), 0, 0.5, 0.5, 0, 0.5, -0.5];
      const indices = edge.flatMap((_, i) => [i, n, (i + 1) % n, i, (i + 1) % n, n + 1]);
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setIndex(indices);
      return g;
    }
    case 'pyramid': return new THREE.ConeGeometry(0.5, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    case 'prism': return gable();
    case 'wedge': return wedge();
  }
}

const RAD = Math.PI / 180;

function buildPart(part: ModelPart, quality: GlQuality = 'full', elevation = 1): THREE.BufferGeometry {
  let g = unit({ shape: part.shape, seg: part.seg ?? 8, taper: part.taper ?? 1, detail: part.detail ?? 0, mesh: part.mesh }, quality);
  g.scale(part.size[0], part.size[1], part.size[2]);
  // Rotation order is Z then X then Y (tilt a part outward/over, then orient it):
  // a splayed leaf is rotZ/rotX off vertical, rotY swings it around the plant.
  if (part.rotZ) g.rotateZ(part.rotZ * RAD);
  if (part.rotX) g.rotateX(part.rotX * RAD);
  if (part.rotY) g.rotateY(part.rotY * RAD);
  g.translate(part.pos[0], part.pos[1], part.pos[2]);
  // Normalise to non-indexed + position/normal/colour only, so all parts merge cleanly.
  if (g.index) {
    const indexed = g;
    g = indexed.toNonIndexed();
    indexed.dispose();
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new THREE.Color().setStyle(part.color, THREE.SRGBColorSpace); // sRGB hex → linear working space
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  const gradient = part.terrainGradient;
  const terrain = (offset: number) => new THREE.Color(ELEVATION_COLORS[Math.max(0, elevation + offset)] ?? ELEVATION_COLORS[0]!);
  const low = gradient ? terrain(gradient.layers[0]) : c.clone();
  const high = gradient ? terrain(gradient.layers[1]) : c.clone();
  const position = g.getAttribute('position');
  for (let i = 0; i < n; i++) {
    const t = gradient ? THREE.MathUtils.clamp((position.getY(i) - gradient.heights[0]) / (gradient.heights[1] - gradient.heights[0]), 0, 1) : 0;
    c.copy(low).lerp(high, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Build calibrated geometry with its authored contact plane on the supporting ground. */
export function buildModel(spec: ModelSpec, footprint?: { width: number; height: number }, quality: GlQuality = 'full', elevation = 1): THREE.BufferGeometry {
  if (spec.fitToFootprint && (!footprint || spec.heightInLayers === undefined)) {
    throw new Error('A footprint-fitted model requires catalog dimensions and a terrain-layer height');
  }
  // Full bounds own calibration and contact planes, even when decoration is omitted.
  const bounds = new THREE.Box3();
  const parts: THREE.BufferGeometry[] = [];
  const fadeGroups = new Map<string, THREE.Box3>();
  const fadeRanges: { name: string | false; count: number }[] = [];
  const grouped = spec.parts.some(part => part.proximityGroup !== undefined);
  for (const part of spec.parts) {
    const full = buildPart(part, 'full', elevation);
    full.computeBoundingBox();
    bounds.union(full.boundingBox!);
    const name = part.proximityGroup ?? 'object';
    if (grouped && name !== false) {
      const group = fadeGroups.get(name) ?? new THREE.Box3();
      group.union(full.boundingBox!);
      fadeGroups.set(name, group);
    }
    const before = parts.length;
    if (quality === 'lite' && (part.fullOnly || part.shape === 'petal')) {
      full.dispose();
      if (!part.fullOnly) parts.push(buildPart(part, quality, elevation));
    } else parts.push(full);
    if (grouped && parts.length > before) fadeRanges.push({ name, count: parts[parts.length - 1]!.getAttribute('position').count });
  }
  if (!parts.length) throw new Error('A model requires a structural part at every quality');
  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts)!;
  if (parts.length > 1) for (const part of parts) part.dispose();
  merged.computeBoundingBox();
  const transform = new THREE.Matrix4();
  const translate = (x: number, y: number, z: number) => {
    merged.translate(x, y, z);
    transform.premultiply(new THREE.Matrix4().makeTranslation(x, y, z));
  };
  const resize = (x: number, y: number, z: number) => {
    merged.scale(x, y, z);
    transform.premultiply(new THREE.Matrix4().makeScale(x, y, z));
  };
  const groundY = spec.groundY ?? bounds.min.y;
  if (Math.abs(groundY) > 1e-6) {
    translate(0, -groundY, 0);
    bounds.translate(new THREE.Vector3(0, -groundY, 0));
  }
  if (spec.fitToFootprint) {
    const fit = typeof spec.fitToFootprint === 'object' ? spec.fitToFootprint : null;
    const [insetX, insetZ] = fit?.inset ?? [0, 0];
    const scaleX = (footprint!.width - 2 * insetX) / (bounds.max.x - bounds.min.x);
    const scaleY = spec.heightInLayers! * LAYER_HEIGHT / (bounds.max.y - bounds.min.y);
    const scaleZ = (footprint!.height - 2 * insetZ) / (bounds.max.z - bounds.min.z);
    const horizontalScale = Math.min(scaleX, scaleZ);
    const [alignX, alignZ] = fit?.align ?? [0, 0];
    const offsetX = alignX * (footprint!.width - 2 * insetX - (bounds.max.x - bounds.min.x) * horizontalScale) / 2;
    const offsetZ = alignZ * (footprint!.height - 2 * insetZ - (bounds.max.z - bounds.min.z) * horizontalScale) / 2;
    translate(-(bounds.min.x + bounds.max.x) / 2, 0, -(bounds.min.z + bounds.max.z) / 2);
    resize(fit ? horizontalScale : scaleX, scaleY, fit ? horizontalScale : scaleZ);
    if (alignX || alignZ) translate(offsetX, 0, offsetZ);
  } else if (spec.heightInLayers !== undefined) {
    const height = bounds.max.y - bounds.min.y;
    const scale = spec.heightInLayers * LAYER_HEIGHT / height;
    const horizontalScale = spec.heightScale === 'vertical' ? 1 : scale;
    resize(horizontalScale, scale, horizontalScale);
  }
  if (grouped) {
    const groups = new Map<string, THREE.Vector4>();
    for (const [name, box] of fadeGroups) {
      box.applyMatrix4(transform);
      const center = box.getCenter(new THREE.Vector3());
      groups.set(name, new THREE.Vector4(center.x, center.y, center.z, box.getSize(new THREE.Vector3()).length() / 2));
    }
    const data = new Float32Array(merged.getAttribute('position').count * 4);
    let offset = 0;
    for (const { name, count } of fadeRanges) {
      const fade = name === false ? new THREE.Vector4(0, 0, 0, PERSISTENT_GROUND) : groups.get(name)!;
      for (let i = 0; i < count; i++) { fade.toArray(data, offset); offset += 4; }
    }
    merged.setAttribute('aObjFade', new THREE.BufferAttribute(data, 4));
  }
  return merged;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Cached geometry for a modeled item, or null if it has no spec (caller falls
 *  back to the category archetype). */
export function modelGeometry(catalogId: string, quality: GlQuality = 'full', elevation = 1): THREE.BufferGeometry | null {
  const key = `${quality}:${catalogId}:${elevation}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const spec = getSpec(catalogId);
  if (!spec) return null;
  const g = buildModel(spec, getCatalogItem(catalogId), quality, elevation);
  cache.set(key, g);
  return g;
}

const deckCache = new Map<string, THREE.BufferGeometry>();

/** Cached geometry for the parts an item stands on its deck, or null if it declares none. */
export function deckGeometry(catalogId: string, quality: GlQuality = 'full'): THREE.BufferGeometry | null {
  const key = `${quality}:${catalogId}`;
  const hit = deckCache.get(key);
  if (hit) return hit;
  const spec = getDeckSpec(catalogId);
  if (!spec) return null;
  const g = buildModel(spec, undefined, quality);
  deckCache.set(key, g);
  return g;
}

/** Dispose all cached model geometries; scenes release them through `cache-lease.ts`. */
export function disposeModels(): void {
  for (const g of cache.values()) g.dispose();
  for (const g of deckCache.values()) g.dispose();
  cache.clear();
  deckCache.clear();
}

/** Resolve a model instance group's optional terrain-palette variant. */
export function groupModelGeometry(groupKey: string, quality: GlQuality): THREE.BufferGeometry | null {
  const [, catalogId, elevation] = groupKey.split(':');
  return modelGeometry(catalogId!, quality, elevation === undefined ? 1 : Number(elevation));
}

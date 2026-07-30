/**
 * Renders a declarative ModelSpec into ONE merged, vertex-coloured
 * THREE.BufferGeometry — the generic engine behind every per-item 3D model.
 * Primitives are unit shapes (footprint within [-0.5,0.5]², base at y=0, height 1)
 * scaled/rotated/translated per part, tinted with baked LINEAR vertex colours, and
 * merged. The result is normalised so its lowest point rests on the ground.
 *
 * This is the ONLY three.js file under models/; the registry + specs stay pure data.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ModelPart, ModelSpec } from '../../../core/model/model-spec';
import { getSpec } from './registry';

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
 *  `taper` shrinks a cylinder's TOP radius (1 = straight; <1 = a frustum, e.g. a
 *  trunk flaring out at the base). `detail` subdivides a sphere's icosphere
 *  (0 = 20-face low-poly, 1 = 80, … — rounder canopies that still read low-poly). */
function unit(shape: ModelPart['shape'], seg: number, taper: number, detail: number): THREE.BufferGeometry {
  switch (shape) {
    case 'box': return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    case 'cylinder': return new THREE.CylinderGeometry(0.5 * taper, 0.5, 1, seg).translate(0, 0.5, 0);
    case 'cone': return new THREE.ConeGeometry(0.5, 1, seg).translate(0, 0.5, 0);
    case 'sphere': return new THREE.IcosahedronGeometry(0.5, detail).translate(0, 0.5, 0);
    case 'pyramid': return new THREE.ConeGeometry(0.5, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);
    case 'prism': return gable();
    case 'wedge': return wedge();
  }
}

const RAD = Math.PI / 180;

function buildPart(part: ModelPart): THREE.BufferGeometry {
  let g = unit(part.shape, part.seg ?? 8, part.taper ?? 1, part.detail ?? 0);
  g.scale(part.size[0], part.size[1], part.size[2]);
  // Rotation order is Z then X then Y (tilt a part outward/over, then orient it):
  // a splayed leaf is rotZ/rotX off vertical, rotY swings it around the plant.
  if (part.rotZ) g.rotateZ(part.rotZ * RAD);
  if (part.rotX) g.rotateX(part.rotX * RAD);
  if (part.rotY) g.rotateY(part.rotY * RAD);
  g.translate(part.pos[0], part.pos[1], part.pos[2]);
  // Normalise to non-indexed + position/normal/colour only, so all parts merge cleanly.
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const c = new THREE.Color().setStyle(part.color, THREE.SRGBColorSpace); // sRGB hex → linear working space
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Build the merged geometry for a spec, dropped so its base rests on the ground. */
export function buildModel(spec: ModelSpec): THREE.BufferGeometry {
  const parts = spec.parts.map(buildPart);
  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts)!;
  merged.computeBoundingBox();
  const minY = merged.boundingBox!.min.y;
  if (Math.abs(minY) > 1e-6) merged.translate(0, -minY, 0);
  return merged;
}

const cache = new Map<string, THREE.BufferGeometry>();

/** Cached geometry for a modeled item, or null if it has no spec (caller falls
 *  back to the category archetype). */
export function modelGeometry(catalogId: string): THREE.BufferGeometry | null {
  const hit = cache.get(catalogId);
  if (hit) return hit;
  const spec = getSpec(catalogId);
  if (!spec) return null;
  const g = buildModel(spec);
  cache.set(catalogId, g);
  return g;
}

/** Dispose all cached model geometries (call on scene teardown). */
export function disposeModels(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

/** A built `MeshData` as a three.js geometry the scene can draw. */
import * as THREE from 'three';
import { assertFinite } from '../geometry/finite';
import type { MeshData } from '../geometry/types';

/** `source` names the mesh in the development-only finiteness check. */
export function toGeometry(m: MeshData, source: string): THREE.BufferGeometry {
  if (import.meta.env.DEV) assertFinite(source, m.positions);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  // The builders emit sRGB colours; convert to the renderer's linear working
  // space so colour-managed output reproduces them at full (2D-matching) vibrance
  // instead of washing them out. A mesh carrying per-vertex alpha (the road
  // decal's feather) gets a 4-component colour attribute, which is what makes
  // three.js sample the alpha in the shader.
  const stride = m.alpha ? 4 : 3;
  const lin = new Float32Array((m.colors.length / 3) * stride);
  const c = new THREE.Color();
  for (let i = 0, v = 0; i < m.colors.length; i += 3, v++) {
    c.setRGB(m.colors[i]!, m.colors[i + 1]!, m.colors[i + 2]!, THREE.SRGBColorSpace);
    lin[v * stride] = c.r; lin[v * stride + 1] = c.g; lin[v * stride + 2] = c.b;
    if (m.alpha) lin[v * stride + 3] = m.alpha[v]!;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(lin, stride));
  if (m.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
  g.setIndex(m.index);
  if (m.alpha) {
    // The alpha-fading mesh is the flat road decal: its normal is +Y everywhere by construction.
    // Computing normals instead NaNs the vertices whose triangles are all zero-area (a ring
    // segment that does not fade), and each NaN flares its vertex's sample pure white.
    const up = new Float32Array(m.positions.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(up, 3));
  } else {
    g.computeVertexNormals();
  }
  return g;
}

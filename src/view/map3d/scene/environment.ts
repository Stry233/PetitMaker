/** The 3D view's sky, fog colour, lights and shadow frustum. */
import * as THREE from 'three';
import { IS_LITE } from '../../../platform/build/edition';
import { maxRenderScale } from '../../../platform/device/device-quality';
import type { MapBounds } from '../camera/controls';

const SKY_TOP = '#cfe9fb';   // soft sky blue
export const HORIZON = '#dfeede';   // pale green-cream haze where land meets sky (also the fog colour)

/** A vertical sky→horizon gradient as a scene-background texture. */
function gradientTexture(top: string, bottom: string): THREE.Texture {
  const cnv = document.createElement('canvas');
  cnv.width = 2; cnv.height = 256;
  const ctx = cnv.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** The sky as a scene background; the caller owns its disposal. */
export function skyBackground(): THREE.Texture {
  return gradientTexture(SKY_TOP, HORIZON);
}

/** Adds the hemisphere fill and the sun to `scene`; returns the sun, which casts the shadows. */
export function addLights(scene: THREE.Scene): THREE.DirectionalLight {
  // Bright sky/ground fill keeps every face vivid (shadows stay soft, not muddy);
  // a warm directional adds low-poly definition + casts the contact shadows.
  const hemi = new THREE.HemisphereLight(0xffffff, 0xcdd8c0, 1.45);
  const sun = new THREE.DirectionalLight(0xfff6e6, 0.9);
  sun.position.set(6, 12, 8);
  scene.add(hemi, sun);
  return sun;
}

/** Configures the sun to cast soft shadows across the whole map (ortho frustum sized to the bounds). */
export function setupShadows(scene: THREE.Scene, sun: THREE.DirectionalLight, b: MapBounds): void {
  sun.castShadow = true;
  const r = Math.max(b.halfX, b.halfZ) * 1.25 + 2;
  sun.position.set((b.centerX ?? 0) + r * 0.7, r * 1.6 + b.maxY, (b.centerZ ?? 0) + r * 0.55);
  sun.target.position.set(b.centerX ?? 0, 0, b.centerZ ?? 0);
  scene.add(sun.target);
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
  cam.near = 0.5; cam.far = r * 4 + b.maxY * 2;
  cam.updateProjectionMatrix();
  // The shadow map spans the whole map, so a small object gets few texels and its contact reads as
  // a vague, slightly-detached blob (the object looks to float). The map is frozen after the first
  // frame (autoUpdate off), so a bigger map is a one-time cost — use 4096² on capable devices for a
  // crisper contact; low-end stays 2048². normalBias pins the shadow to the object's base (kills the
  // peter-pan gap between object and shadow that reads as floating).
  const shadowRes = IS_LITE ? 1024 : maxRenderScale() >= 2 ? 4096 : 2048;
  sun.shadow.mapSize.set(shadowRes, shadowRes);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
}

/**
 * The constrained orbit camera: a pleasant tilt range (never under the map), clamped dolly
 * distances, and a whole-map framing on open.
 *
 * OrbitControls is held for its STATE, not its input. Both 3D views drive the camera through the
 * scene's verbs (`canvas/interaction/camera-gestures` maps the pointer to them), so `enabled` is
 * false wherever there is a user and the controls' own button map, drag speeds and damping never
 * run. What the rest of the scene reads from it is the orbit target and the polar/distance clamps.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MapTemplate } from '../../../core/model/types';
import { isGrassZone } from '../../../core/model/grid-model';

export interface MapBounds {
  /** Half-extents of the map in world units (X, Z) and its max world height (Y). */
  halfX: number;
  halfZ: number;
  maxY: number;
  centerX?: number;
  centerZ?: number;
}

/** Frame the main land with a one-cell margin; the outer beach and sea may extend off screen. */
export function islandBounds(template: MapTemplate, maxY: number): MapBounds {
  let left = template.width, top = template.height, right = 0, bottom = 0;
  for (let y = 0; y < template.height; y++) for (let x = 0; x < template.width; x++) {
    const zone = template.zones[y]?.[x];
    if (zone === undefined || !isGrassZone(zone)) continue;
    left = Math.min(left, x); top = Math.min(top, y);
    right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
  }
  if (right <= left || bottom <= top) return { halfX: template.width / 2, halfZ: template.height / 2, maxY };
  left = Math.max(0, left - 1); top = Math.max(0, top - 1);
  right = Math.min(template.width, right + 1); bottom = Math.min(template.height, bottom + 1);
  return {
    halfX: (right - left) / 2, halfZ: (bottom - top) / 2, maxY,
    centerX: (left + right - template.width) / 2,
    centerZ: (top + bottom - template.height) / 2,
  };
}

export function makeCamera(aspect: number): THREE.PerspectiveCamera {
  // A wider FOV reads as "standing in the world" rather than a far telephoto god-view.
  // near 0.5: depth precision scales with the near plane, and thin geometry (a flower
  // above the ground slab) shimmers at map-viewing distances with a nearer plane; the
  // proximity fade fully dissolves anything inside ~0.9 units, so nothing is lost.
  const cam = new THREE.PerspectiveCamera(55, aspect, 0.5, 1500);
  cam.position.set(0, 6, 12);
  return cam;
}

export function makeControls(camera: THREE.PerspectiveCamera, dom: HTMLElement): OrbitControls {
  const c = new OrbitControls(camera, dom);
  c.minPolarAngle = 0.45;              // keep some downward tilt (no straight-down god-view)
  c.maxPolarAngle = 1.52;              // ~87°: can sweep right down to eye-level across the land
  return c;
}

/** Looking from +Z keeps columns left to right and rows top to bottom, matching 2D.
 *  The fly-in and export shot distances scale from this resting camera offset. */
export function frameBounds(camera: THREE.PerspectiveCamera, controls: OrbitControls, b: MapBounds): void {
  // Aim a little above the ground so the eye rests on the landscape, not the sky.
  const centerY = Math.max(b.maxY * 0.3, 0.4);
  const centerX = b.centerX ?? 0, centerZ = b.centerZ ?? 0;
  controls.target.set(centerX, centerY, centerZ);
  const elevation = Math.atan2(0.46, 0.72 * Math.SQRT2);
  const sin = Math.sin(elevation), cos = Math.cos(elevation);
  const tanY = Math.tan((camera.fov * Math.PI) / 360) * 0.92;
  const tanX = tanY * camera.aspect;
  // Fit the island's near and far corners, leaving four percent of the viewport on each side.
  let dist = 2;
  for (const y of [0, b.maxY]) {
    for (const z of [-b.halfZ, b.halfZ]) {
      const dy = y - centerY;
      const depth = dy * sin + z * cos;
      const up = dy * cos - z * sin;
      dist = Math.max(dist, depth + b.halfX / tanX, depth + Math.abs(up) / tanY);
    }
  }
  controls.minDistance = dist * 0.10;  // close enough for detail work (readable labels)
  controls.maxDistance = dist * 1.9;
  camera.position.set(centerX, centerY + dist * sin, centerZ + dist * cos);
  controls.update();
}

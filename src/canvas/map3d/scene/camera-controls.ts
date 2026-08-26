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

export interface MapBounds {
  /** Half-extents of the map in world units (X, Z) and its max world height (Y). */
  halfX: number;
  halfZ: number;
  maxY: number;
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

/** Frame the map from a LOW, CLOSE hero angle — immersive (in-world), not top-down.
 *  The camera sits low and near so the terrain rises around the viewer; orbiting
 *  sweeps the horizon rather than looking down from orbit.
 *
 *  SQUARE ON, THE WAY THE 2D VIEW OPENS. The two views are one editor over one map, so switching
 *  between them must not turn the island: 2D lays out column 1 through 11 left to right and rows A
 *  through I top to bottom, and a 3D view opening on the corner between them makes a person who
 *  knew where they were find it again.
 *
 *  A cell's column is world X and its row is world Z (`core/coords`), so the yaw that reproduces the
 *  2D layout puts the camera on +Z looking toward the origin: +X falls to the right of the screen
 *  and +Z toward the bottom, which is the letters down the left and the numbers along the bottom.
 *  It is a yaw and nothing else: the whole horizontal reach sits on Z, and the framing distance and
 *  the tilt are untouched by it. Both matter beyond the look, since the fly-in starts from a
 *  multiple of the resting offset and every export shot's `dist` is a multiple of the resting
 *  radius. */
export function frameBounds(camera: THREE.PerspectiveCamera, controls: OrbitControls, b: MapBounds): void {
  // Aim a little above the ground so the eye rests on the landscape, not the sky.
  const centerY = Math.max(b.maxY * 0.3, 0.4);
  controls.target.set(0, centerY, 0);
  const radius = Math.max(b.halfX, b.halfZ, 2);
  const fov = (camera.fov * Math.PI) / 180;
  // Close framing: just enough to see the island, no big pull-back.
  const dist = (radius / Math.tan(fov / 2)) * 1.02 + b.maxY * 0.4;
  controls.minDistance = dist * 0.10;  // close enough for detail work (readable labels)
  controls.maxDistance = dist * 1.9;
  // Low hero angle: height well under the horizontal reach → ~65° from vertical. The reach is 0.72
  // of the framing distance on each of two horizontal axes (hence √2), placed entirely on Z.
  const horiz = dist * 0.72 * Math.SQRT2;
  camera.position.set(0, dist * 0.46 + centerY, horiz);
  controls.update();
}

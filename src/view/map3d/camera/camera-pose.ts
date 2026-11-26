/**
 * The 3D camera's pose in saved terms: the intro fly-in's start, the pose a scene reports, and the
 * view a still reproduces. Pure, so the scene camera and the captures read the same math.
 */
import { clamp as clampN } from '../../../core/base/math';
import type { CameraAngle } from '../../../state/view-camera';

/** Inverse of the scene camera's applyCameraAngle position math: an offset vector (camera − target) plus
 *  the scene's base distance → a CameraAngle. tx/tz are the target's offset from the scene center.
 *  Used by MapRenderer3D.getCurrentAngle so the export 3D-shots editor can read back "Use this view". */
function angleFromOffset(offset: WorldPoint, baseDist: number, tx = 0, tz = 0): CameraAngle {
  const { x: dx, y: dy, z: dz } = offset;
  const r = Math.hypot(dx, dy, dz) || 1e-6;
  const az = (Math.atan2(dx, dz) * 180) / Math.PI;
  const el = (Math.asin(clampN(dy / r, -1, 1)) * 180) / Math.PI;
  const dist = baseDist > 0 ? r / baseDist : 1;
  return { az, el, dist, tx, tz };
}

/** A world-space point — the three-free shape of THREE.Vector3, so the scene passes its camera and
 *  orbit-target vectors straight into the helpers below. */
export interface WorldPoint { x: number; y: number; z: number }

/** What a live view of a map showed in part of its canvas, for a still of exactly that part from a
 *  scene of the same map: the camera's place and the point it looked at in world terms, the canvas's
 *  width over its height, and the part as shares of the canvas's width and height from its top left. */
export interface SeenView {
  eye: WorldPoint;
  target: WorldPoint;
  aspect: number;
  part: { x: number; y: number; w: number; h: number };
}

/** Offset from the orbit target to the camera's fly-in start pose, given its resting offset: 2.2x
 *  further out along the resting direction plus 0.4x the resting radius in height, so the map opens
 *  small in the fog. Magnitude is ~2.4x the resting radius — a distance no dolly clamp allows and no
 *  user can choose, which is what makes a mid-intro camera read (see reportedCameraAngle) wrong. */
export function introStartOffset(dx: number, dy: number, dz: number): WorldPoint {
  const r = Math.hypot(dx, dy, dz);
  const out = r > 0 ? 2.2 : 0;
  return { x: dx * out, y: dy * out + (r || 1) * 0.4, z: dz * out };
}

/** The camera pose to report (io/storage/autosave's 3D camera, the export editor's "use this view"): the
 *  live pose once the intro fly-in is done, the resting frame while it is still in flight. A camera
 *  can sit at the fly-in start indefinitely — pausing the hidden 3D view freezes the intro
 *  mid-flight — and the resting frame is where the fly-in is heading, so it is the pose the user is
 *  at. `rest*` are the scene's introTo/introTarget, which also define the unit of `dist`. */
export function reportedCameraAngle(
  cam: WorldPoint,
  target: WorldPoint,
  restCam: WorldPoint,
  restTarget: WorldPoint,
  introActive: boolean,
): CameraAngle {
  const c = introActive ? restCam : cam;
  const t = introActive ? restTarget : target;
  const baseDist = Math.hypot(restCam.x - restTarget.x, restCam.y - restTarget.y, restCam.z - restTarget.z);
  return angleFromOffset({ x: c.x - t.x, y: c.y - t.y, z: c.z - t.z }, baseDist, t.x - restTarget.x, t.z - restTarget.z);
}

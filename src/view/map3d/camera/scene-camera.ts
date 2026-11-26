/**
 * The 3D view's camera: the perspective camera and its orbit controls, the fly-in intro, the
 * toolkit glides, the drag and dolly inertia, and the camera verbs the pointer machine and the
 * shot editor drive. The controls store target and clamp state; in editor mode they process no
 * input of their own.
 */
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GridState, MapTemplate } from '../../../core/model/types';
import { TerrainType } from '../../../core/model/types';
import { solidTopOf } from '../../../core/domain/terrain/terrain-surface';
import { ELEVATION_MAX } from '../../../core/game/profile';
import { mapFrame } from '../../../core/grid/map-chunks';
import { clamp } from '../../../core/base/math';
import type { CameraAngle } from '../../../state/view-camera';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import type { ScreenBox, ViewCamera } from '../../../tools/pointer/runtime';
import type { Rect } from '../../../core/grid/rect';
import { viewportRect } from '../../../platform/device/viewport-space';
import { animConfig, easeOutCubic } from '../../shared/motion/anim-config';
import { ZOOM_STEP, TURN_RAD_PER_PX, TURN_STEP_PX } from '../../shared/viewport/view-constants';
import { introStartOffset, reportedCameraAngle, type SeenView, type WorldPoint } from './camera-pose';
import { mapCenterOffset } from '../geometry/coords';
import { makeCamera, makeControls, frameBounds, type MapBounds } from './controls';
import { CameraInertia } from './inertia';
import { CameraRestDetector } from './rest';

/** Max mountain height present, for camera framing. */
export function maxHeight(state: GridState): number {
  let top = 0;
  for (const row of state.cells) {
    for (const cell of row) {
      if (cell?.terrain?.type === TerrainType.Mountain) {
        // a Γ patch's fillet renders at its elevation tier even though its structural support is lower
        top = Math.max(top, cell.terrain.patchOnly ? cell.terrain.elevation : solidTopOf(cell.terrain, TerrainType.Mountain));
      }
    }
  }
  return Math.min(top, ELEVATION_MAX);
}

/** What the camera reads from the scene that holds it. */
interface SceneCameraHost {
  requestRender(): void;
  /** Tells the chrome anchored to the map that the view moved. */
  viewportChanged(): void;
  /** The live map's template, which bounds the pan. */
  template(): MapTemplate;
  /** The view's css height, which scales a pan's screen px to the ground. */
  viewHeight(): number;
}

export class SceneCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  // Camera intro fly-in: the whole map glides from a far framing (small in the fog) down to its
  // resting frame, so the atmosphere does the work. introActive gates it; the controls are paused
  // until it finishes.
  introActive = false;
  private introStartMs = 0;
  private introFrom = new THREE.Vector3();
  private introTo = new THREE.Vector3();
  private introTarget = new THREE.Vector3();
  // Toolkit camera moves (zoom / tilt / fit buttons) glide instead of snapping —
  // a short eased tween of the camera position + orbit target, ticked in the loop.
  // (Wheel/pinch zoom stays instant/responsive; only the buttons tween.)
  camTween: {
    startMs: number; dur: number;
    fromPos: THREE.Vector3; toPos: THREE.Vector3;
    fromTgt: THREE.Vector3; toTgt: THREE.Vector3;
  } | null = null;
  private readonly rest = new CameraRestDetector();
  private verbs: ViewCamera | null = null;
  private readonly inertia = new CameraInertia();
  private inertiaMode: 'orbit' | 'pan' = 'pan';
  /**
   * The dolly's own accumulator. It holds the log of the pending distance factor, because a dolly
   * composes by multiplication and the accumulator adds: log turns "1.15 then 1.15" into one
   * additive 2x0.14 that drains to the same place. Its floor is therefore in log units, not pixels
   * (0.0008 is under a tenth of a percent of distance), and it follows a little slower than a drag
   * — a wheel notch is a discrete event with no hand to keep up with, so it can afford to glide.
   */
  private readonly zoomInertia = new CameraInertia({ minTravel: 0.0008, followTau: 90 });

  constructor(aspect: number, private readonly dom: HTMLElement, private readonly host: SceneCameraHost) {
    this.camera = makeCamera(aspect);
    this.controls = makeControls(this.camera, dom);
    this.controls.addEventListener('change', host.requestRender);
  }

  /** Frames `bounds` as the resting view, which also sets the controls' dolly range. */
  frame(bounds: MapBounds): void {
    frameBounds(this.camera, this.controls, bounds);
  }

  /** Records the current pose as the resting frame, then (when `animate`) starts the fly-in from
   *  far out: higher and pulled back, so the map sits small in the fog. The controls do not update
   *  until it lands. */
  beginIntro(animate: boolean): void {
    this.introTarget.copy(this.controls.target);
    this.introTo.copy(this.camera.position);
    const start = introStartOffset(
      this.introTo.x - this.introTarget.x,
      this.introTo.y - this.introTarget.y,
      this.introTo.z - this.introTarget.z,
    );
    this.introFrom.set(this.introTarget.x + start.x, this.introTarget.y + start.y, this.introTarget.z + start.z);
    // Reduced motion: no fly-in at all. The camera simply stays at the resting frame captured
    // above (introTo), controls stay live, and nothing glides.
    if (animate) {
      this.camera.position.copy(this.introFrom);
      this.camera.lookAt(this.introTarget);
      this.introActive = true;
      this.introStartMs = performance.now();
    }
  }

  /** Pose the camera at a CameraAngle (getCurrentAngle's inverse) without capturing — the live
   *  editor's restore path (a saved 3D camera lands here instead of behind an image capture).
   *  Cancels the intro fly-in: landing where the user left off is the point of a restore, so
   *  flying somewhere else first would undo it (the export-angle preview shares this math and
   *  always wants the intro out of the way too).
   *
   *  The distance is clamped into the controls' own dolly range: a save whose camera was read
   *  mid-intro (see reportedCameraAngle) holds a `dist` of ~2.4, past anything the controls allow,
   *  and restoring one verbatim lands the user out in the fog. */
  applyCameraAngle(angle: CameraAngle): void {
    this.introActive = false;
    const baseDist = this.introTo.distanceTo(this.introTarget);
    const tgt = this.introTarget.clone();
    tgt.x += angle.tx ?? 0; tgt.z += angle.tz ?? 0;
    const dist = clamp(baseDist * angle.dist, this.controls.minDistance, this.controls.maxDistance);
    const az = (angle.az * Math.PI) / 180, el = (angle.el * Math.PI) / 180;
    const cosEl = Math.cos(el);
    this.camera.position.set(tgt.x + dist * cosEl * Math.sin(az), tgt.y + dist * Math.sin(el), tgt.z + dist * cosEl * Math.cos(az));
    this.camera.lookAt(tgt);
    this.controls.target.copy(tgt);
    this.controls.update();
    this.host.requestRender();
  }

  /** Takes `other`'s pose exactly, as a scene over the same template drawn in its place: the same
   *  position and orbit target in the world, with no fly-in or glide left running. */
  adopt(other: SceneCamera): void {
    this.introActive = false;
    this.camTween = null;
    this.cancelGlides();
    this.camera.position.copy(other.introActive ? other.introTo : other.camera.position);
    this.controls.target.copy(other.introActive ? other.introTarget : other.controls.target);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.host.requestRender();
  }

  /** The current camera framing as a CameraAngle — the inverse of applyCameraAngle. Reads the live
   *  OrbitControls target + camera position, so the export 3D-shots editor can capture whatever the
   *  user orbited to ("Use this view"), and io/storage/autosave persists what the user is looking at. While
   *  the intro fly-in is in flight it reports the resting frame instead (see reportedCameraAngle). */
  getCurrentAngle(): CameraAngle {
    return reportedCameraAngle(this.camera.position, this.controls.target, this.introTo, this.introTarget, this.introActive);
  }

  /** The camera's place and the point it looks at in world terms, the resting frame's while the
   *  fly-in is in flight, as `getCurrentAngle` reads them. */
  pose(): { eye: WorldPoint; target: WorldPoint } {
    const eye = this.introActive ? this.introTo : this.camera.position;
    const target = this.introActive ? this.introTarget : this.controls.target;
    return { eye: { x: eye.x, y: eye.y, z: eye.z }, target: { x: target.x, y: target.y, z: target.z } };
  }

  /** Poses the camera where `seen` was seen from, with that view's part of its canvas filling this
   *  one; the controls' clamps are left out, since another scene's range held the pose. Returns the
   *  undo of the part, which leaves the pose. */
  showSeen(seen: SeenView): () => void {
    this.introActive = false;
    const { eye, target, aspect, part } = seen;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.controls.target.set(target.x, target.y, target.z);
    this.camera.lookAt(this.controls.target);
    const own = this.camera.aspect;
    this.camera.aspect = aspect;
    this.camera.setViewOffset(aspect, 1, part.x * aspect, part.y, part.w * aspect, part.h);
    this.camera.updateProjectionMatrix();
    return () => {
      this.camera.clearViewOffset();
      this.camera.aspect = own;
      this.camera.updateProjectionMatrix();
    };
  }

  /**
   * End the fly-in now, at its resting frame. Safe to call when no intro is running.
   *
   * Called by the camera verbs as well as the export path: the intro holds the controls dark for
   * its whole duration, so a user who reaches for the camera during it would otherwise be ignored
   * until it finished. A hand on the camera is the request to stop watching.
   */
  landIntro(): void {
    if (!this.introActive) return;
    // Snap the camera directly to its resting position and target (introTo = resting camera pos,
    // introTarget = resting orbit target).
    this.camera.position.copy(this.introTo);
    this.camera.lookAt(this.introTarget);
    this.controls.target.copy(this.introTarget);
    this.controls.update();
    this.introActive = false;
  }

  /** Glide the camera from the far framing to its resting frame (whole-map fly-in). Time-based, so
   *  it takes the same wall time at any refresh rate. */
  animateIntro(): void {
    const t = (performance.now() - this.introStartMs) / animConfig.intro3d.durationMs;
    if (t >= 1) {
      this.landIntro();
      return;
    }
    this.camera.position.lerpVectors(this.introFrom, this.introTo, easeOutCubic(t));
    this.camera.lookAt(this.introTarget);
  }

  /**
   * One loop frame of the controls while neither the intro nor a glide drives the camera; null
   * while one does. A camera glide decays exponentially, so it approaches rest without reaching
   * it, and every one of those frames re-antialiases all thin silhouettes (strobing borders on
   * small models). Once the detector sees visual rest, the controls' update is skipped so the pose
   * truly freezes. The detector is fed the pose every frame and is purely observational: motion
   * from any source (a gesture, the glide, key pan, a view change — all of which write the camera
   * directly) unfreezes it by itself. `more` asks the loop for further frames; `moving` says the
   * pose is not at rest.
   */
  followControls(): { more: boolean; moving: boolean } | null {
    if (this.introActive || this.camTween) return null; // intro/tween drive the camera directly; controls resume after
    const more = !this.rest.isResting() && this.controls.update();
    const restingNow = this.rest.update(this.camera.position.toArray(), this.camera.quaternion.toArray(), this.controls.getDistance());
    return { more, moving: !restingNow };
  }

  /** The camera verbs on their own, without the editing overlay. The shot editor drives the same
   *  camera through the same gestures and never needs ghosts or rings. */
  cameraVerbs(): ViewCamera {
    if (!this.verbs) {
      this.verbs = {
        pan: (dx, dy) => this.dragCamera('pan', dx, dy),
        // Both eased through the zoom accumulator, so a notch reads as a short glide rather than a
        // jump and a run of them adds up into one continuous move — the same treatment the orbit
        // verb gets.
        zoomStep: (dir) => this.dollyEased(ZOOM_STEP.notch.map3d ** -dir),
        zoomBy: (factor) => this.dollyEased(1 / factor),
        zoomStepAnimated: (dir) => this.animateDolly(ZOOM_STEP.button ** -dir), // toolkit button: glide
        orbit: (dx, dy) => this.dragCamera('orbit', dx, dy),
        turnStep: (dir) => this.dragCamera('orbit', dir * TURN_STEP_PX, 0), // toolkit turn: the orbit's own glide
        // Twist arrives in radians, not screen px, so it is applied raw: feeding it to the inertia
        // would mix units into one velocity. A positive yaw turns the ground counter-clockwise on
        // screen, the way a positive twist turned the fingers.
        orbitTwist: (dRad) => this.orbitBy(dRad, 0),
        tilt: (v) => this.animateTilt(v),      // toolkit tilt steppers: glide
        fitToMap: () => this.animateFit(),     // toolkit fit: glide
        fitBox: (box, into) => this.animateFitBox(box, into),
        endGesture: () => {
          // Decorative continuation the user did not ask for: under reduced motion the camera
          // stops where the hand left it.
          if (isMotionReduced()) this.inertia.cancel();
          else this.inertia.release(performance.now());
        },
      };
    }
    return this.verbs;
  }

  /** One frame of the camera catching up: the tail of a live drag, or the glide after one.
   *  Returns whether the camera moved. */
  tickInertia(): boolean {
    const now = performance.now();
    let moved = false;
    const step = this.inertia.step(now);
    if (step) { this.applyDrag(this.inertiaMode, step.dx, step.dy); moved = true; }
    const zoom = this.zoomInertia.step(now);
    if (zoom) { this.dollyBy(Math.exp(zoom.dx)); moved = true; }
    return moved;
  }

  /** A glide must not resume when the view comes back, minutes later. */
  cancelGlides(): void {
    this.inertia.cancel();
    this.zoomInertia.cancel();
  }

  // ── Editor camera verbs ────────────────────────────────────────────────────
  // The editor pointer machine drives the camera imperatively (OrbitControls'
  // own pointer handling is disabled in editor mode); these implement the same
  // constrained moves: yaw/pitch around the orbit target, clamped dolly, and a
  // ground-plane pan whose screen-pixel scale matches what the eye expects at
  // the current distance.

  /** Yaw/pitch the camera around the orbit target (radians). */
  orbitBy(dYaw: number, dPitch: number): void {
    this.landIntro();
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const sph = new THREE.Spherical().setFromVector3(offset);
    sph.theta -= dYaw;
    sph.phi = Math.max(this.controls.minPolarAngle, Math.min(this.controls.maxPolarAngle, sph.phi - dPitch));
    sph.makeSafe();
    offset.setFromSpherical(sph);
    this.camera.position.copy(t).add(offset);
    this.camera.lookAt(t);
    this.host.requestRender();
  }

  /** Scale the orbit distance (factor > 1 moves away), clamped to the controls' range. */
  dollyBy(factor: number): void {
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const d = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, offset.length() * factor));
    offset.setLength(d);
    this.camera.position.copy(t).add(offset);
    this.host.requestRender();
  }

  /** Ground-plane pan by screen pixel deltas along the camera's ground axes.
   *  Sign contract matches the 2D pan verb: pan(+dx, +dy) slides the view
   *  right/down in screen terms — screen-down is ground-BACKWARD from the
   *  camera, so W (screen-up) walks the camera forward, camera-relative. */
  panCamera(dx: number, dy: number): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const h = this.host.viewHeight() || 1;
    const worldPerPx = (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1); else fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3()
      .addScaledVector(right, dx * worldPerPx)
      .addScaledVector(fwd, -dy * worldPerPx);
    this.camera.position.add(move);
    this.controls.target.add(move);
    this.clampTarget();
    this.host.requestRender();
  }

  animateCamTween(): void {
    const tw = this.camTween;
    if (!tw) return;
    const raw = Math.min(1, (performance.now() - tw.startMs) / tw.dur);
    const t = easeOutCubic(raw);
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, t);
    this.controls.target.lerpVectors(tw.fromTgt, tw.toTgt, t);
    this.camera.lookAt(this.controls.target);
    this.host.viewportChanged();
    if (raw >= 1) { this.camTween = null; this.controls.update(); }
  }

  /** Toolkit zoom: glide the orbit distance by `factor` (>1 = away), clamped. */
  animateDolly(factor: number): void {
    this.landIntro();
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const d = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, offset.length() * factor));
    offset.setLength(d);
    this.startCamTween(t.clone().add(offset), t.clone());
  }

  /** Toolkit tilt: glide to tilt value v (0..1 across the polar clamp range). */
  animateTilt(v: number): void {
    this.landIntro();
    const t = this.controls.target;
    const offset = new THREE.Vector3().subVectors(this.camera.position, t);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const clamped = Math.max(0, Math.min(1, v));
    sph.phi = this.controls.maxPolarAngle + (this.controls.minPolarAngle - this.controls.maxPolarAngle) * clamped;
    sph.makeSafe();
    offset.setFromSpherical(sph);
    this.startCamTween(t.clone().add(offset), t.clone());
  }

  /** Toolkit fit: glide back to the resting whole-map framing. */
  animateFit(): void {
    this.landIntro();
    this.startCamTween(this.introTo.clone(), this.introTarget.clone());
  }

  /**
   * Glide until the map rectangle `box` (in map cells, on the orbit target's plane) fills the client
   * box `into` as far as it fits, centred in it, from the heading and tilt held now. A slide along the
   * plane carries the camera's picture of the plane with it, so each pass dollies the box's projected
   * bounds to the box's size and slides the bounds' centre onto the box's; three passes settle it.
   */
  animateFitBox(box: Rect, into: ScreenBox): void {
    this.landIntro();
    const view = viewportRect(this.dom);
    if (view.width <= 0 || view.height <= 0 || into.width <= 0 || into.height <= 0) return;
    const template = this.host.template();
    const off = mapCenterOffset(template.width, template.height);
    const ground = this.controls.target.y;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ground);
    const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
      .map(([x, z]) => new THREE.Vector3(x! - off.x, ground, z! - off.z));
    const toward = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
    const probe = this.camera.clone();
    const target = new THREE.Vector3(box.x + box.w / 2 - off.x, ground, box.y + box.h / 2 - off.z);
    let dist = this.camera.position.distanceTo(this.controls.target);
    const pose = (): void => {
      probe.position.copy(target).addScaledVector(toward, dist);
      probe.lookAt(target);
      probe.updateMatrixWorld();
    };
    const onScreen = (p: THREE.Vector3) => {
      const v = p.clone().project(probe);
      return { x: ((v.x + 1) / 2) * view.width, y: ((1 - v.y) / 2) * view.height };
    };
    /** The middle of the corners' bounds on the canvas, and their width and height there. */
    const bounds = () => {
      const pts = corners.map(onScreen), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const left = Math.min(...xs), top = Math.min(...ys), w = Math.max(...xs) - left, h = Math.max(...ys) - top;
      return { x: left + w / 2, y: top + h / 2, w, h };
    };
    const groundAt = (x: number, y: number): THREE.Vector3 | null => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((x / view.width) * 2 - 1, 1 - (y / view.height) * 2), probe);
      return ray.ray.intersectPlane(plane, new THREE.Vector3());
    };
    const want = { x: into.left + into.width / 2 - view.left, y: into.top + into.height / 2 - view.top };
    for (let pass = 0; pass < 3; pass++) {
      pose();
      const { w, h } = bounds();
      if (w > 0 && h > 0) dist = clamp(dist * Math.max(w / into.width, h / into.height), this.controls.minDistance, this.controls.maxDistance);
      pose();
      const mid = bounds();
      const from = groundAt(mid.x, mid.y), to = groundAt(want.x, want.y);
      if (from && to) target.add(from.sub(to));
    }
    pose();
    this.startCamTween(probe.position.clone(), target.clone());
  }

  /** The dolly distance as a share of the fit distance — the zoom readout. */
  zoomPercent(): number {
    const fit = this.introTo.distanceTo(this.introTarget);
    const cur = this.camera.position.distanceTo(this.controls.target);
    return Math.round((fit / Math.max(0.01, cur)) * 100);
  }

  dispose(): void {
    this.controls.removeEventListener('change', this.host.requestRender);
    this.controls.dispose();
  }

  /** Apply travel through one of the two drag verbs. */
  private applyDrag(mode: 'orbit' | 'pan', dx: number, dy: number): void {
    if (mode === 'orbit') {
      this.orbitBy(dx * TURN_RAD_PER_PX, dy * TURN_RAD_PER_PX);
    } else {
      this.panCamera(dx, dy);
    }
  }

  /**
   * A drag step. It is not applied here: it goes into the inertia accumulator and the render loop
   * drains it, which is what gives the camera weight going in as well as coming out. Reduced motion
   * skips the accumulator entirely and applies the step at once.
   */
  private dragCamera(mode: 'orbit' | 'pan', dx: number, dy: number): void {
    this.landIntro();
    if (isMotionReduced()) { this.applyDrag(mode, dx, dy); return; }
    if (mode !== this.inertiaMode) {
      // Travel measured while orbiting must never be applied as a pan. Hand back what is owed
      // through the verb that earned it, then switch.
      const owed = this.inertia.flush();
      if (owed) this.applyDrag(this.inertiaMode, owed.dx, owed.dy);
      this.inertiaMode = mode;
    }
    this.inertia.sample(dx, dy, performance.now());
    this.host.requestRender(); // nothing moved yet — the loop has to run to drain it
  }

  /** A wheel/pinch dolly, eased. Reduced motion applies it outright: the smoothing is decoration,
   *  and the zoom itself is not. */
  private dollyEased(factor: number): void {
    this.landIntro();
    if (isMotionReduced()) { this.dollyBy(factor); return; }
    this.zoomInertia.sample(Math.log(factor), 0, performance.now());
    this.host.requestRender();
  }

  /** The orbit target stays over the map (small margin) — panning can never
   *  strand the camera over empty void, mirroring the 2D pan bounds. */
  private clampTarget(): void {
    const template = this.host.template();
    const off = mapCenterOffset(template.width, template.height);
    const frame = mapFrame(template);
    const m = 4;
    const t = this.controls.target;
    const cx = Math.max(frame.x - off.x - m, Math.min(frame.x + frame.width - off.x + m, t.x));
    const cz = Math.max(frame.y - off.z - m, Math.min(frame.y + frame.height - off.z + m, t.z));
    this.camera.position.x += cx - t.x;
    this.camera.position.z += cz - t.z;
    t.x = cx;
    t.z = cz;
  }

  /** Start an eased glide of the camera pose (position + orbit target) toward a
   *  goal — the toolkit zoom/tilt/fit buttons use this so the view slides instead
   *  of jumping. A new glide replaces any in flight (held buttons chase smoothly). */
  private startCamTween(toPos: THREE.Vector3, toTgt: THREE.Vector3, dur = animConfig.cameraGlide.map3dMs): void {
    // Reduced motion: land on the goal pose immediately instead of gliding. One chokepoint, so every
    // toolkit glide (zoom steppers, tilt steppers, fit-to-map) is covered.
    if (isMotionReduced()) {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTgt);
      this.camera.lookAt(this.controls.target);
      this.camTween = null;
      this.controls.update();
      this.host.viewportChanged();
      this.host.requestRender();
      return;
    }
    this.camTween = {
      startMs: performance.now(), dur,
      fromPos: this.camera.position.clone(), toPos: toPos.clone(),
      fromTgt: this.controls.target.clone(), toTgt: toTgt.clone(),
    };
    this.host.requestRender();
  }
}

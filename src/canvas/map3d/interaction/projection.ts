/**
 * The 3D editor's ViewProjection: pointer → cell via visible-surface picking,
 * cell → screen via camera projection. Tools receive exactly the coordinate
 * semantics the 2D viewport gives them — macro cells, half-cell micro coords —
 * so the shared tool codebase never knows which view produced them.
 */
import * as THREE from 'three';
import type { GridState, MacroCoord } from '../../../core/model/types';
import type { ViewProjection } from '../../view-projection';
import { GROUND_SLAB_Y, mapCenterOffset } from '../core/coords';
import { pickSurface, surfaceHeightAt, type Vec3 } from './pick';

export interface CameraHost {
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  state(): GridState;
  /** Ground-plane camera pan by SCREEN pixel deltas (the Hand tool verb). */
  panCamera(dx: number, dy: number): void;
  /** Mesh-precise object pick (see scene.pickObjectAt). */
  pickObjectAt(sx: number, sy: number): string | null;
  /** World bounding box of an object's rendered body. */
  objectBoundingBox(id: string): THREE.Box3 | null;
}

/** A far-off-map sentinel for rays that never meet the world (pointing at the
 *  sky): rules reject any command there, so tools no-op exactly like a 2D
 *  pointer parked outside the map. */
const OFF_MAP = -10_000;

export class Projection3D implements ViewProjection {
  constructor(private host: CameraHost) {}

  /** Pointer ray in world space from canvas-relative CSS pixel coords. */
  private ray(sx: number, sy: number): { origin: Vec3; dir: Vec3 } {
    const rect = this.host.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((sx - rect.left) / rect.width) * 2 - 1,
      -((sy - rect.top) / rect.height) * 2 + 1,
    );
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.host.camera);
    return {
      origin: { x: rc.ray.origin.x, y: rc.ray.origin.y, z: rc.ray.origin.z },
      dir: { x: rc.ray.direction.x, y: rc.ray.direction.y, z: rc.ray.direction.z },
    };
  }

  /** The world XZ the pointer touches: the picked surface, else the ground
   *  plane (rays past the map edge give coherent out-of-map cells, like 2D). */
  private pointAt(sx: number, sy: number): { wx: number; wz: number } | null {
    const { origin, dir } = this.ray(sx, sy);
    const hit = pickSurface(this.host.state(), origin, dir);
    if (hit) return { wx: hit.point.x, wz: hit.point.z };
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (GROUND_SLAB_Y - origin.y) / dir.y;
    if (t <= 0) return null;
    return { wx: origin.x + dir.x * t, wz: origin.z + dir.z * t };
  }

  screenToMacro(sx: number, sy: number): MacroCoord {
    const p = this.pointAt(sx, sy);
    if (!p) return { x: OFF_MAP, y: OFF_MAP };
    const s = this.host.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    return { x: Math.floor(p.wx + off.x), y: Math.floor(p.wz + off.z) };
  }

  screenToMicro(sx: number, sy: number): MacroCoord {
    const p = this.pointAt(sx, sy);
    if (!p) return { x: OFF_MAP, y: OFF_MAP };
    const s = this.host.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    return { x: Math.floor((p.wx + off.x) * 2), y: Math.floor((p.wz + off.z) * 2) };
  }

  screenToHalf(sx: number, sy: number): MacroCoord {
    const p = this.pointAt(sx, sy);
    if (!p) return { x: OFF_MAP, y: OFF_MAP };
    const s = this.host.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    return {
      x: Math.round((p.wx + off.x) * 2) / 2,
      y: Math.round((p.wz + off.z) * 2) / 2,
    };
  }

  cellToScreen(x: number, y: number): { x: number; y: number; scale: number; behind?: boolean } {
    const s = this.host.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    const wx = x - off.x, wz = y - off.z;
    const h = surfaceHeightAt(s, wx + 0.5, wz + 0.5);
    const rect = this.host.canvas.getBoundingClientRect();
    const project = (px: number, pz: number) => {
      const v = new THREE.Vector3(px, h, pz).project(this.host.camera);
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    };
    const corner = project(wx, wz);
    const right = project(wx + 1, wz);
    // Camera-space z tells the caller the projection is a mirrored lie (same test objectScreenBox
    // makes on a body's centre); the coords come back regardless so nothing changes for callers
    // that don't ask.
    const camZ = new THREE.Vector3(wx, h, wz).applyMatrix4(this.host.camera.matrixWorldInverse).z;
    return {
      x: corner.x, y: corner.y,
      scale: Math.hypot(right.x - corner.x, right.y - corner.y),
      ...(camZ >= -0.05 ? { behind: true } : {}),
    };
  }

  pan(dx: number, dy: number): void {
    this.host.panCamera(dx, dy);
  }

  pickObject(sx: number, sy: number): string | null {
    return this.host.pickObjectAt(sx, sy);
  }

  objectScreenBox(id: string): {
    x: number; y: number; w: number; h: number; scale: number;
    anchors: { left: { x: number; y: number }; right: { x: number; y: number } };
  } | null {
    const box = this.host.objectBoundingBox(id);
    if (!box) return null;
    const cam = this.host.camera;
    // Off-camera guard: a box whose CENTRE is at or behind the camera plane projects with a sign
    // flip (perspective divide by a negative w), throwing the handles to a wrong spot. Return null
    // so the caller hides them. Objects are small, so centre-in-front ⇒ every corner is in front
    // and safe to project (a large locked object like the plaza carries no handles anyway).
    const center = box.getCenter(new THREE.Vector3());
    if (center.clone().applyMatrix4(cam.matrixWorldInverse).z >= -0.05) return null;
    const rect = this.host.canvas.getBoundingClientRect();
    const v = new THREE.Vector3();
    const project = (px: number, py: number, pz: number): { x: number; y: number } => {
      v.set(px, py, pz).project(cam);
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const top: Array<{ x: number; y: number }> = [];
    for (const cx of [box.min.x, box.max.x]) {
      for (const cy of [box.min.y, box.max.y]) {
        for (const cz of [box.min.z, box.max.z]) {
          const p = project(cx, cy, cz);
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          if (cy === box.max.y) top.push(p);
        }
      }
    }
    // The handles anchor to the TOP FACE's projected extremes — real box
    // corners, not the screen AABB's (which sit in empty space around a
    // perspective diamond).
    top.sort((a, b) => a.x - b.x);
    // Button size tracks the OBJECT'S own apparent size — one world unit projected AT the object —
    // not a cell at the map origin (which balloons the handles when the origin sits near the camera).
    const s0 = project(center.x, center.y, center.z);
    const s1 = project(center.x + 1, center.y, center.z);
    const scale = Math.hypot(s1.x - s0.x, s1.y - s0.y);
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, scale, anchors: { left: top[0]!, right: top[top.length - 1]! } };
  }
}

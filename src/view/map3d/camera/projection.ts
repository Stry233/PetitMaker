import { viewportRect } from '../../../platform/device/viewport-space';
/**
 * The 3D editor's ViewProjection: pointer → cell via visible-surface picking,
 * cell → screen via camera projection. Tools receive exactly the coordinate
 * semantics the 2D viewport gives them — macro cells, half-cell micro coords —
 * so the shared tool codebase never knows which view produced them.
 */
import * as THREE from 'three';
import type { GridState } from '../../../core/model/types';
import { mapPoint, type MapPoint } from '../../../core/grid/grids';
import { getPlacedObjectSize, objectElevation } from '../../../state/object-geometry';
import type { ViewProjection } from '../../../tools/pointer/runtime';
import { GROUND_SLAB_Y, cellCornerWorld, mapCenterOffset, surfaceY } from '../geometry/coords';
import { pickSurface, surfaceHeightAt, type Vec3 } from '../geometry/pick';
import { cellCentre } from '../../../core/grid/grid-convert';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { cloneCell } from '../../../core/model/grid-model';

export interface CameraHost {
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  state(): GridState;
  /** Mesh-precise object pick (see scene.pickObjectAt). */
  pickObjectAt(sx: number, sy: number): string | null;
  pickAnnotationLabel?(sx: number, sy: number): string | null;
  annotationLabelBox?(id: string): { x: number; y: number; w: number; h: number } | null;
  /** World selection bounds: occupied footprint in X/Z, rendered body extent in Y. */
  objectBoundingBox(id: string): THREE.Box3 | null;
}

/** A far-off-map sentinel for rays that never meet the world (pointing at the
 *  sky): rules reject any command there, so tools no-op exactly like a 2D
 *  pointer parked outside the map. */
const OFF_MAP = -10_000;

export class Projection3D implements ViewProjection {
  /** The terrain a press began over (`holdSurface`): at a low camera angle a ray meets terrain the
   *  press has just raised several cells nearer the camera, so picking the live surface would walk a
   *  click's brush towards the viewer. */
  private held: GridState | null = null;

  constructor(private host: CameraHost) {}

  holdSurface(): void {
    const state = this.host.state();
    this.held = { ...state, cells: state.cells.map((row) => row.map(cloneCell)) };
  }

  releaseSurface(): void {
    this.held = null;
  }

  /** Pointer ray in world space from canvas-relative CSS pixel coords. */
  private ray(sx: number, sy: number): { origin: Vec3; dir: Vec3 } {
    const rect = viewportRect(this.host.canvas);
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
    const hit = pickSurface(this.held ?? this.host.state(), origin, dir);
    if (hit) return { wx: hit.point.x, wz: hit.point.z };
    if (Math.abs(dir.y) < 1e-6) return null;
    const t = (GROUND_SLAB_Y - origin.y) / dir.y;
    if (t <= 0) return null;
    return { wx: origin.x + dir.x * t, wz: origin.z + dir.z * t };
  }

  screenToPoint(sx: number, sy: number): MapPoint {
    const p = this.pointAt(sx, sy);
    if (!p) return mapPoint({ x: OFF_MAP, y: OFF_MAP });
    const s = this.host.state();
    const off = mapCenterOffset(s.template.width, s.template.height);
    return mapPoint({ x: p.wx + off.x, y: p.wz + off.z });
  }

  cellToScreen(x: number, y: number): { x: number; y: number; scale: number; behind?: boolean } {
    const s = this.host.state();
    const { x: wx, z: wz } = cellCornerWorld(x, y, s.template.width, s.template.height, PLACEMENT_GRID);
    const centre = cellCentre({ x, y });
    const mid = cellCornerWorld(centre.x, centre.y, s.template.width, s.template.height, PLACEMENT_GRID);
    const h = surfaceHeightAt(s, mid.x, mid.z);
    const rect = viewportRect(this.host.canvas);
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

  pickObject(sx: number, sy: number): string | null {
    return this.host.pickObjectAt(sx, sy);
  }

  pickAnnotationLabel(sx: number, sy: number): string | null {
    return this.host.pickAnnotationLabel?.(sx, sy) ?? null;
  }

  annotationLabelBox(id: string): { x: number; y: number; w: number; h: number } | null {
    return this.host.annotationLabelBox?.(id) ?? null;
  }

  objectScreenBox(id: string): { x: number; y: number; w: number; h: number } | null {
    let box = this.host.objectBoundingBox(id);
    if (!box) {
      const state = this.host.state();
      const object = state.objects.get(id);
      if (!object) return null;
      // Roads have no instanced body; their handles follow the footprint at its standing surface.
      const corner = cellCornerWorld(object.position.x, object.position.y, state.template.width, state.template.height, PLACEMENT_GRID);
      const size = getPlacedObjectSize(object);
      const y = surfaceY(objectElevation(state, object));
      box = new THREE.Box3(new THREE.Vector3(corner.x, y, corner.z), new THREE.Vector3(corner.x + size.w, y, corner.z + size.h));
    }
    const cam = this.host.camera;
    // Off-camera guard: a box whose centre is at or behind the camera plane projects with a sign
    // flip (perspective divide by a negative w), throwing the handles to a wrong spot. Return null
    // so the caller hides them. Objects are small, so centre-in-front ⇒ every corner is in front
    // and safe to project (a large locked object such as a landmark carries no handles anyway).
    const center = box.getCenter(new THREE.Vector3());
    if (center.clone().applyMatrix4(cam.matrixWorldInverse).z >= -0.05) return null;
    const rect = viewportRect(this.host.canvas);
    const v = new THREE.Vector3();
    const project = (px: number, py: number, pz: number): { x: number; y: number } => {
      v.set(px, py, pz).project(cam);
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cx of [box.min.x, box.max.x]) {
      for (const cy of [box.min.y, box.max.y]) {
        for (const cz of [box.min.z, box.max.z]) {
          const p = project(cx, cy, cz);
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
      }
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
}

import type { GlQuality } from '../../../platform/device/device-quality';
import * as THREE from 'three';
import type { GridState } from '../../../core/model/types';
import { objectElevation } from '../../../state/object-geometry';
import { objectInstance } from '../geometry/object-meshes';
import { archetypeGeometry } from '../models/object-archetypes';
import { groupModelGeometry } from '../models/build-model';
import { DASHED_CONTOUR, clipTrianglesAbove, contourTriangles, silhouetteContours, type ContourDash } from '../geometry/move-silhouette';
import { bodyFloorY, flatBodyTriangles } from '../geometry/object-marks';
import type { ArchetypeKey } from '../geometry/types';
import { isMotionReduced } from '../../../platform/channels/motion-state';

interface Outline {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  triangles: Float32Array;
  pose: string;
  target: number;
  from: number;
  since: number;
}
const FADE_MS = 160;

/** How a set of outlines is drawn: the contour's colour, opacity, css-px width and dash (null for a
 *  solid line), the fill's colour and opacity, and the prefix each outline mesh is named by. */
export interface BodyOutlineLook {
  stroke: number;
  opacity: number;
  width: number;
  dash: ContourDash | null;
  fill: number;
  fillOpacity: number;
  name: string;
}

/** What outlines project through: the camera and canvas size, the clock the fades run on and the
 *  model quality whose bodies they trace. */
export interface BodyOutlineView {
  camera?: THREE.Camera | undefined;
  viewport?: (() => { width: number; height: number }) | undefined;
  nowMs?: () => number;
  modelQuality?: () => GlQuality;
}

/** Where a moved object stood while a move preview runs: a dashed white contour over a faint fill. */
export const MOVE_ORIGIN_LOOK: BodyOutlineLook = {
  stroke: 0xffffff, opacity: .95, width: 3, dash: DASHED_CONTOUR, fill: 0xe8f4ff, fillOpacity: .14, name: 'move-origin',
};
const CLIP_PLANES = [
  (v: THREE.Vector4) => v.w + v.x, (v: THREE.Vector4) => v.w - v.x,
  (v: THREE.Vector4) => v.w + v.y, (v: THREE.Vector4) => v.w - v.y,
  (v: THREE.Vector4) => v.w + v.z, (v: THREE.Vector4) => v.w - v.z,
];

/**
 * Screen-space outlines of placed objects' bodies: the projected triangle union traced, retaining
 * concavities but omitting interior model edges, drawn over the whole scene so a body another model
 * hides still shows. Each fades in and out over `FADE_MS`, at once under reduced motion.
 */
export class BodyOutlines3D {
  private outlines = new Map<string, Outline>();
  private cameraKey = '';

  private readonly camera: THREE.Camera | undefined;
  private readonly viewport: () => { width: number; height: number };
  private readonly nowMs: () => number;
  private readonly modelQuality: () => GlQuality;

  constructor(private readonly parent: THREE.Group, view: BodyOutlineView = {}, private readonly look: BodyOutlineLook = MOVE_ORIGIN_LOOK) {
    this.camera = view.camera;
    this.viewport = view.viewport ?? (() => ({ width: 1024, height: 768 }));
    this.nowMs = view.nowMs ?? (() => performance.now());
    this.modelQuality = view.modelQuality ?? (() => 'full');
  }

  show(state: GridState, ids: readonly string[]): void {
    this.tick();
    const keep = new Set(ids);
    for (const [id, outline] of this.outlines) if (!keep.has(id)) this.fade(outline, 0);
    for (const id of ids) {
      const obj = state.objects.get(id);
      if (!obj) continue;
      // The ground under it rides in the pose: a terrain edit re-seats the body and its floor.
      const floor = bodyFloorY(state, obj);
      const pose = `${this.modelQuality()}:${objectElevation(state, obj)}:${floor}:${JSON.stringify(obj)}`;
      const existing = this.outlines.get(id);
      if (existing?.pose === pose) { this.fade(existing, this.look.opacity); continue; }
      if (existing) this.remove(id, existing);
      const resolved = objectInstance(state, obj);
      let triangles: Float32Array;
      if (resolved) {
        const { groupKey, inst } = resolved;
        const source = groupKey.startsWith('m:')
          ? groupModelGeometry(groupKey, this.modelQuality())
          : archetypeGeometry(groupKey.slice(2) as ArchetypeKey);
        if (!source) continue;
        const geometry = source.index ? source.toNonIndexed() : source.clone();
        geometry.applyMatrix4(new THREE.Matrix4().compose(
          new THREE.Vector3(inst.x, inst.y, inst.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotationY),
          new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ),
        ));
        // What the ground hides is no part of the outline.
        triangles = new Float32Array(clipTrianglesAbove(geometry.getAttribute('position').array, floor));
        geometry.dispose();
      } else {
        // A coating has no body: it draws as one flat face, which the outline traces.
        triangles = new Float32Array(flatBodyTriangles(state, obj));
      }
      const { look } = this;
      const material = new THREE.MeshBasicMaterial({
        transparent: true, opacity: isMotionReduced() ? look.opacity : 0,
        depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false,
      });
      material.color.setHex(look.stroke).convertSRGBToLinear();
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.name = `${look.name}-${id}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      const fillMaterial = material.clone();
      fillMaterial.color.setHex(look.fill).convertSRGBToLinear();
      fillMaterial.opacity = material.opacity * look.fillOpacity / look.opacity;
      const fill = new THREE.Mesh(new THREE.BufferGeometry(), fillMaterial);
      fill.name = `${look.name}-fill-${id}`;
      fill.frustumCulled = false;
      fill.renderOrder = 3;
      mesh.add(fill);
      this.outlines.set(id, { mesh, fill, triangles, pose, target: look.opacity, from: material.opacity, since: this.nowMs() });
      this.parent.add(mesh);
      this.cameraKey = '';
    }
    if (isMotionReduced()) this.tick();
    this.update();
  }

  /** Camera and viewport changes invalidate the silhouette; fading only changes opacity. */
  update(): void {
    if (!this.outlines.size || !this.camera) return;
    this.camera.updateMatrixWorld();
    const { width, height } = this.viewport();
    if (width <= 0 || height <= 0) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const key = [...matrix.elements, width, height].join(',');
    if (key === this.cameraKey) return;
    this.cameraKey = key;
    for (const { mesh, fill, triangles } of this.outlines.values()) {
      const projected: number[] = [];
      for (let i = 0; i < triangles.length; i += 9) {
        let polygon = [0, 3, 6].map(offset => new THREE.Vector4(
          triangles[i + offset]!, triangles[i + offset + 1]!, triangles[i + offset + 2]!, 1,
        ).applyMatrix4(matrix));
        // Clip before perspective division, including models that cross the near plane.
        for (const plane of CLIP_PLANES) {
          if (polygon.every(v => plane(v) >= 0)) continue;
          const clipped: THREE.Vector4[] = [];
          for (let j = 0; j < polygon.length; j++) {
            const a = polygon[j]!, b = polygon[(j + 1) % polygon.length]!;
            const da = plane(a), db = plane(b);
            if (da >= 0) clipped.push(a);
            if ((da >= 0) !== (db >= 0)) clipped.push(a.clone().lerp(b, da / (da - db)));
          }
          polygon = clipped;
        }
        for (let j = 1; j < polygon.length - 1; j++) {
          for (const v of [polygon[0]!, polygon[j]!, polygon[j + 1]!]) {
            projected.push((v.x / v.w + 1) * width / 2, (1 - v.y / v.w) * height / 2);
          }
        }
      }
      let minX = width, minY = height, maxX = 0, maxY = 0;
      for (let i = 0; i < projected.length; i += 2) {
        minX = Math.min(minX, projected[i]!); maxX = Math.max(maxX, projected[i]!);
        minY = Math.min(minY, projected[i + 1]!); maxY = Math.max(maxY, projected[i + 1]!);
      }
      const vertices: number[] = [];
      const fillVertices: number[] = [];
      if (maxX > minX && maxY > minY) {
        // Bound camera-orbit work; ordinary object silhouettes use 1.5 samples per CSS pixel.
        const scale = Math.min(1.5, 1536 / Math.max(maxX - minX, maxY - minY));
        const triangles2D = projected.map((value, i) => (value - (i % 2 ? minY : minX)) * scale + 1);
        const contours = silhouetteContours(triangles2D, Math.ceil((maxX - minX) * scale) + 3, Math.ceil((maxY - minY) * scale) + 3)
          .map(loop => loop.map(p => ({ x: (p.x - 1) / scale + minX, y: (p.y - 1) / scale + minY })));
        const point = new THREE.Vector3();
        for (const contour of contours) {
          const boundary = contour.map(p => new THREE.Vector2(p.x, p.y));
          for (const face of THREE.ShapeUtils.triangulateShape(boundary, [])) {
            for (const index of face) {
              const p = boundary[index]!;
              point.set(p.x / width * 2 - 1, 1 - p.y / height * 2, 0).unproject(this.camera);
              fillVertices.push(point.x, point.y, point.z);
            }
          }
        }
        const stroke = contourTriangles(contours, this.look.width, this.look.dash);
        for (let i = 0; i < stroke.length; i += 2) {
          point.set(stroke[i]! / width * 2 - 1, 1 - stroke[i + 1]! / height * 2, 0).unproject(this.camera);
          vertices.push(point.x, point.y, point.z);
        }
      }
      mesh.geometry.dispose();
      mesh.geometry = new THREE.BufferGeometry();
      mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      fill.geometry.dispose();
      fill.geometry = new THREE.BufferGeometry();
      fill.geometry.setAttribute('position', new THREE.Float32BufferAttribute(fillVertices, 3));
    }
  }

  private fade(outline: Outline, target: number): void {
    if (outline.target === target) return;
    outline.from = outline.mesh.material.opacity;
    outline.target = target;
    outline.since = this.nowMs();
  }

  tick(): boolean {
    let active = false;
    const now = this.nowMs();
    for (const [id, outline] of this.outlines) {
      const t = isMotionReduced() ? 1 : Math.min(1, (now - outline.since) / FADE_MS);
      outline.mesh.material.opacity = outline.from + (outline.target - outline.from) * (t * t * (3 - 2 * t));
      outline.fill.material.opacity = outline.mesh.material.opacity * this.look.fillOpacity / this.look.opacity;
      if (t < 1 && outline.from !== outline.target) active = true;
      else if (!outline.target) this.remove(id, outline);
    }
    return active;
  }

  clear(): void {
    for (const outline of this.outlines.values()) this.fade(outline, 0);
    this.tick();
  }

  private remove(id: string, outline: Outline): void {
    outline.fill.geometry.dispose();
    outline.fill.material.dispose();
    outline.mesh.geometry.dispose();
    outline.mesh.material.dispose();
    this.parent.remove(outline.mesh);
    this.outlines.delete(id);
  }

  dispose(): void {
    for (const [id, outline] of this.outlines) this.remove(id, outline);
  }
}

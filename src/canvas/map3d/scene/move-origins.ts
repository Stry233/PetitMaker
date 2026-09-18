import * as THREE from 'three';
import type { GridState } from '../../../core/model/types';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { objectInstance } from '../build/object-meshes';
import { archetypeGeometry } from '../build/object-archetypes';
import { modelGeometry } from '../models/build-model';
import { dashedContourTriangles, silhouetteContours } from '../build/move-silhouette';
import type { ArchetypeKey } from '../core/types';
import { mapCenterOffset, surfaceY } from '../core/coords';
import { isMotionReduced } from '../../map2d/motion-state';

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
const OPACITY = .95;
const FILL_OPACITY = .14;
const CLIP_PLANES = [
  (v: THREE.Vector4) => v.w + v.x, (v: THREE.Vector4) => v.w - v.x,
  (v: THREE.Vector4) => v.w + v.y, (v: THREE.Vector4) => v.w - v.y,
  (v: THREE.Vector4) => v.w + v.z, (v: THREE.Vector4) => v.w - v.z,
];

/** Trace the projected triangle union, retaining concavities but omitting interior model edges. */
export class MoveOrigins3D {
  private outlines = new Map<string, Outline>();
  private cameraKey = '';

  constructor(
    private parent: THREE.Group,
    private camera?: THREE.Camera,
    private viewport: () => { width: number; height: number } = () => ({ width: 1024, height: 768 }),
    private nowMs: () => number = () => performance.now(),
  ) {}

  show(state: GridState, ids: readonly string[]): void {
    this.tick();
    const keep = new Set(ids);
    for (const [id, outline] of this.outlines) if (!keep.has(id)) this.fade(outline, 0);
    for (const id of ids) {
      const obj = state.objects.get(id);
      if (!obj) continue;
      const pose = JSON.stringify(obj);
      const existing = this.outlines.get(id);
      if (existing?.pose === pose) { this.fade(existing, OPACITY); continue; }
      if (existing) this.remove(id, existing);
      const resolved = objectInstance(state, obj);
      let geometry: THREE.BufferGeometry;
      if (resolved) {
        const { groupKey, inst } = resolved;
        const source = groupKey.startsWith('m:')
          ? modelGeometry(groupKey.slice(2))
          : archetypeGeometry(groupKey.slice(2) as ArchetypeKey);
        if (!source) continue;
        geometry = source.index ? source.toNonIndexed() : source.clone();
        geometry.applyMatrix4(new THREE.Matrix4().compose(
          new THREE.Vector3(inst.x, inst.y, inst.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotationY),
          new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ),
        ));
      } else {
        const { w, h } = getPlacedObjectSize(obj);
        const off = mapCenterOffset(state.template.width, state.template.height);
        const x = obj.position.x - off.x, z = obj.position.y - off.z;
        const y = surfaceY(obj.elevation) + .03;
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute([
          x,y,z, x+w,y,z, x+w,y,z+h, x,y,z, x+w,y,z+h, x,y,z+h,
        ], 3));
      }
      const triangles = new Float32Array(geometry.getAttribute('position').array);
      geometry.dispose();
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: isMotionReduced() ? OPACITY : 0,
        depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.name = `move-origin-${id}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      const fillMaterial = material.clone();
      fillMaterial.color.setHex(0xe8f4ff).convertSRGBToLinear();
      fillMaterial.opacity = material.opacity * FILL_OPACITY / OPACITY;
      const fill = new THREE.Mesh(new THREE.BufferGeometry(), fillMaterial);
      fill.name = `move-origin-fill-${id}`;
      fill.frustumCulled = false;
      fill.renderOrder = 3;
      mesh.add(fill);
      this.outlines.set(id, { mesh, fill, triangles, pose, target: OPACITY, from: material.opacity, since: this.nowMs() });
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
        const stroke = dashedContourTriangles(contours);
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
      outline.fill.material.opacity = outline.mesh.material.opacity * FILL_OPACITY / OPACITY;
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

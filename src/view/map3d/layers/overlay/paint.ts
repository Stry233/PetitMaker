import * as THREE from 'three';

export function makeMat(color: number, opacity: number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
  mat.color.setHex(color).convertSRGBToLinear();
  return mat;
}

export function toGeo(m: { positions: number[]; index: number[] }): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(m.positions, 3));
  geo.setIndex(m.index);
  return geo;
}

/**
 * Box paint is cached, one material per colour and opacity, and a box never disposes one. three
 * deletes a program when its last material is disposed and links it again on next use, and the
 * hover box is rebuilt on every pointer move; on a software rasterizer each link costs over a
 * second. Colour and opacity are per-role constants (hover, band, selection, footprint), so one
 * material per role paints every box, and the cache lives as long as the overlay.
 */
export class BoxMaterials {
  private mats = new Map<string, THREE.Material>();

  /** The shared fill material for a box role. */
  fill(color: number, opacity: number): THREE.MeshBasicMaterial {
    const key = `fill:${color}:${opacity}`;
    let mat = this.mats.get(key) as THREE.MeshBasicMaterial | undefined;
    if (!mat) { mat = makeMat(color, opacity); this.mats.set(key, mat); }
    return mat;
  }

  /** The shared outline material for a box role. */
  edge(color: number, opacity: number): THREE.LineBasicMaterial {
    const key = `edge:${color}:${opacity}`;
    let mat = this.mats.get(key) as THREE.LineBasicMaterial | undefined;
    if (!mat) {
      mat = new THREE.LineBasicMaterial({ transparent: true, opacity });
      mat.color.setHex(color).convertSRGBToLinear();
      this.mats.set(key, mat);
    }
    return mat;
  }

  dispose(): void {
    for (const mat of this.mats.values()) mat.dispose();
    this.mats.clear();
  }
}

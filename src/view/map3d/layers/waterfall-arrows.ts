/**
 * White flow arrows at waterfall faces, the 3D twin of the 2D indicator pass, riding each face's
 * water surface. Rebuilt whole after any terrain flush: the detection is a fast full-grid scan, and
 * flushes are coalesced per frame.
 */
import * as THREE from 'three';
import type { GridState } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { waterfallFaceMap } from '../../../core/domain/terrain/waterfall-geometry';
import { mapCenterOffset } from '../geometry/coords';
import { surfaceHeightAt } from '../geometry/pick';

export class WaterfallArrows {
  readonly group = new THREE.Group();
  private disposables: { dispose(): void }[] = [];

  /** Redraws the arrows for `state`, skipping faces on hidden elevations. */
  rebuild(state: GridState, hiddenLayers: ReadonlySet<number>): void {
    this.dispose();
    const { width, height } = state.template;
    const off = mapCenterOffset(width, height);
    const cellFaces = waterfallFaceMap(state);
    if (cellFaces.size === 0) return;
    const positions: number[] = [];
    const half = 0.16;
    for (const [key, dirs] of cellFaces) {
      const [x, y] = key.split(',').map(Number);
      const t = getCell(state.cells, x!, y!)?.terrain;
      if (!t || hiddenLayers.has(t.elevation)) continue;
      // Terrain grid (−0.5): the arrow floats over the water cell's surface.
      const wx = x! - off.x, wz = y! - off.z;
      const h = surfaceHeightAt(state, wx, wz) + 0.05;
      const spread = dirs.length > 1 ? 0.22 : 0;
      for (const dir of dirs) {
        let cxp = wx, czp = wz;
        if (dir === 'north') czp -= spread;
        else if (dir === 'south') czp += spread;
        else if (dir === 'west') cxp -= spread;
        else if (dir === 'east') cxp += spread;
        const tri: Record<string, number[]> = {
          north: [cxp, czp - half, cxp - half, czp + half, cxp + half, czp + half],
          south: [cxp, czp + half, cxp - half, czp - half, cxp + half, czp - half],
          west: [cxp - half, czp, cxp + half, czp - half, cxp + half, czp + half],
          east: [cxp + half, czp, cxp - half, czp - half, cxp - half, czp + half],
        };
        const [ax, az, bx, bz, cx2, cz2] = tri[dir]!;
        positions.push(ax!, h, az!, bx!, h, bz!, cx2!, h, cz2!);
      }
    }
    if (positions.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false });
      this.group.add(new THREE.Mesh(geo, mat));
      this.disposables.push(geo, mat);
    }
  }

  /** Frees the arrows' geometry and material. */
  dispose(): void {
    this.group.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

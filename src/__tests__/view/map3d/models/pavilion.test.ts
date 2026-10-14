import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildModel } from '../../../../view/map3d/models/build-model';
import { getSpec } from '../../../../view/map3d/models/registry';

describe('pavilion facade', () => {
  it('keeps the closed door and jamb channels behind the projecting stone frame', () => {
    const geometry = buildModel({ parts: getSpec('facility-pavilion')!.parts });
    const doorstep = -geometry.boundingBox!.min.z;
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    const depth = (x: number, y: number) => {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, y, -4), new THREE.Vector3(0, 0, 1)).intersectObject(mesh)[0]!;
      expect(hit, `closed entrance at ${x}, ${y}`).toBeDefined();
      return 4 - hit.distance;
    };
    try {
      for (const x of [-.5, -.25, .25, .5]) {
        for (const y of [.6, 1.25]) {
          expect(depth(x, y)).toBeGreaterThan(doorstep - .20);
          expect(depth(x, y)).toBeLessThan(doorstep - .09);
        }
      }
      for (const side of [-1, 1]) {
        const frame = depth(side * .92, .75);
        expect(frame - depth(side * .77, .75)).toBeGreaterThan(.04);
        expect(frame - depth(side * .5, .75)).toBeGreaterThan(.07);
      }
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });

  it('keeps all ten panes and the foundation joint recessed behind their stone surrounds', () => {
    const geometry = buildModel({ parts: getSpec('facility-pavilion')!.parts });
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    const glass = new THREE.Color('#e7ce83');
    const rearGlass = new THREE.Color('#ddc77e');
    const colors = geometry.getAttribute('color');
    const surface = (angle: number, height: number, offset = 0) => {
      const rotation = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(angle));
      const origin = new THREE.Vector3(offset, height, -4).applyMatrix4(rotation);
      const direction = new THREE.Vector3(0, 0, 1).transformDirection(rotation);
      const hit = new THREE.Raycaster(origin, direction).intersectObject(mesh)[0]!;
      expect(hit, `surface at ${angle} degrees`).toBeDefined();
      return { radius: 4 - hit.distance, color: new THREE.Color().fromBufferAttribute(colors, hit.face!.a) };
    };
    try {
      for (const side of [-1, 1]) {
        for (const angle of [42, 74, 106, 138]) {
          const pane = surface(side * angle, .75);
          const pier = surface(side * (angle + 16), .75);
          expect(pane.color.toArray()).toEqual(glass.toArray().map(value => expect.closeTo(value, 5)));
          expect(pier.radius - pane.radius).toBeGreaterThan(.10);
          expect(pier.radius - pane.radius).toBeLessThan(.25);
          expect(surface(side * angle, .95).radius).toBeGreaterThan(pane.radius);
          expect(surface(side * angle, .43).radius).toBeGreaterThan(pane.radius);
        }
      }
      for (const offset of [-.245, .245]) {
        const pane = surface(180, .75, offset);
        expect(pane.color.toArray()).toEqual(rearGlass.toArray().map(value => expect.closeTo(value, 5)));
        expect(surface(154, .75).radius - pane.radius).toBeGreaterThan(.10);
      }
      for (const angle of [42, 106, 178]) {
        const seam = surface(angle, .225).radius;
        expect(surface(angle, .10).radius - seam, `lower plinth at ${angle}`).toBeGreaterThan(.04);
        expect(surface(angle, .29).radius - seam, `upper plinth at ${angle}`).toBeGreaterThan(.04);
      }
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });
});

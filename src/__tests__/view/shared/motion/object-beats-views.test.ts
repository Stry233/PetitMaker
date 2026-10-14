// @vitest-environment jsdom
/**
 * The 2D sprite and the 3D instance sample the same placement plop and rotation curves at the same
 * progress, so the two views cannot drift apart again.
 */
import '../../../_support/pixi-env'; // object-animations reaches PIXI, which needs jsdom's missing 2D context
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import * as PIXI from 'pixi.js-legacy';
import { animateRotation, animateSquash } from '../../../../view/map2d/layers/object-animations';
import { ObjectMotion } from '../../../../view/map3d/layers/object-motion';
import type { InstanceGroup } from '../../../../view/map3d/layers/object-layer';
import { objectInstance } from '../../../../view/map3d/geometry/object-meshes';
import { plopScale, spinEase } from '../../../../view/shared/motion/object-beats';
import { animConfig } from '../../../../view/shared/motion/anim-config';
import type { PlacedObject } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';
import { OBJECT_CHILD } from '../../../../view/map2d/draw/object-children';

/** Progress points through the squash, its peak and the bounce back. */
const SAMPLES = [0.1, 0.25, 0.3, 0.5, 0.8];

/** A scene stand-in holding one object instance, enough to run its plop and spin ticks. */
function scene3d(object: PlacedObject) {
  const state = makeState(24, 24);
  state.objects.set(object.id, object);
  const resolved = objectInstance(state, object)!;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
  const group = { mesh, instances: [resolved.inst], isModel: true } as unknown as InstanceGroup;
  const scene = new ObjectMotion({
    *drawn(id) { if (id === object.id) yield { group, slot: 0, inst: resolved.inst }; },
    state: () => state, recastShadows: () => {}, rebuildRoads: () => {},
  });
  const decompose = () => {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(0, m);
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), scale = new THREE.Vector3();
    m.decompose(pos, q, scale);
    return { scale, yaw: new THREE.Euler().setFromQuaternion(q, 'YXZ').y };
  };
  return { scene, inst: resolved.inst, decompose };
}

afterEach(() => vi.restoreAllMocks());

const cabin: PlacedObject = { id: 'cabin', catalogId: 'building-fluorite-cabin', position: { x: 6, y: 8 }, rotation: 0, elevation: 0 };

describe('object beats in both views', () => {
  it('plops the 2D sprite and the 3D instance along the same curve', () => {
    const wrapper = new PIXI.Container();
    const queue: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => { queue.push(cb); return queue.length; });
    animateSquash(new Map([['a', wrapper]]), 'a', 2, () => {});
    queue.shift()!(1000);
    const seen2d = SAMPLES.map((t) => { queue.shift()!(1000 + t * animConfig.plop.settleMs); return { x: wrapper.scale.x, y: wrapper.scale.y }; });
    vi.restoreAllMocks();

    const { scene, inst, decompose } = scene3d(cabin);
    const span = Math.max(inst.scaleX, inst.scaleZ, 1);
    const seen3d = SAMPLES.map((t) => {
      vi.spyOn(performance, 'now').mockReturnValue(10_000 + t * animConfig.plop.settleMs);
      scene.plops.set(cabin.id, 10_000);
      scene.tickPlops();
      const { scale } = decompose();
      return { across: scale.x / inst.scaleX, up: scale.y / inst.scaleY };
    });

    SAMPLES.forEach((t, i) => {
      const at2 = plopScale(t, 2);
      expect(seen2d[i]!.x).toBeCloseTo(at2.across, 9);
      expect(seen2d[i]!.y).toBeCloseTo(at2.up, 9);
      const at3 = plopScale(t, span);
      expect(seen3d[i]!.across).toBeCloseTo(at3.across, 6);
      expect(seen3d[i]!.up).toBeCloseTo(at3.up, 6);
    });
  });

  it('turns the 2D icon and the 3D instance along the same eased fraction', () => {
    const wrapper = new PIXI.Container();
    const icon = new PIXI.Container();
    icon.name = OBJECT_CHILD.icon;
    wrapper.addChild(icon);
    const queue: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => { queue.push(cb); return queue.length; });
    const eased2d: number[] = [];
    animateRotation(new Map([['a', wrapper]]), 'a', { fromDeg: 0, toDeg: 90 }, () => {}, (e) => eased2d.push(e));
    queue.shift()!(1000);
    // The first frame starts the clock at t = 0.
    for (const t of SAMPLES) queue.shift()!(1000 + t * animConfig.rotation.durationMs);
    vi.restoreAllMocks();

    const { scene } = scene3d(cabin);
    const eased3d: number[] = [];
    for (const t of SAMPLES) {
      vi.spyOn(performance, 'now').mockReturnValue(10_000 + t * animConfig.rotation.durationMs);
      scene.spins.set(cabin.id, { from: 0, to: 90, born: 10_000, onFrame: (e: number) => eased3d.push(e) });
      scene.tickSpins();
    }

    SAMPLES.forEach((t, i) => {
      expect(eased2d[i + 1]).toBeCloseTo(spinEase(t), 9);
      expect(eased3d[i]).toBeCloseTo(spinEase(t), 9);
    });
  });
});

/**
 * The 3D view's object tweens: the placement plop, a single object's spin and a group's rigid-body
 * turn. Each runs off the instance's stored transform, so it composes with (and settles back to)
 * the real placement. Under reduced motion nothing is registered here and the instance stands at
 * its canonical transform.
 */
import * as THREE from 'three';
import type { GridState } from '../../../core/model/types';
import type { GroupRotation } from '../../../tools/objects';
import { animConfig, easeOutBack } from '../../shared/motion/anim-config';
import { arcMotion, arcOffset, spinOffset, type ArcMotion } from '../../shared/motion/group-arc';
import { plopScale, spinEase } from '../../shared/motion/object-beats';
import { bodyRoute } from '../geometry/object-meshes';
import { UP_AXIS, writeInstance, type DrawnSlot } from './object-layer';

/** What the tweens read from the scene that holds them. */
export interface ObjectMotionHost {
  /** Each instance that draws object `id`. */
  drawn(id: string): Iterable<DrawnSlot>;
  /** The live map. */
  state(): GridState;
  /** The shadow map is frozen; a moving body asks for one re-cast per frame it moves. */
  recastShadows(): void;
  /** Rebuilds the trimmed-road surfaces, displacing the named roads on the ground plane. */
  rebuildRoads(offsets?: ReadonlyMap<string, { dx: number; dz: number }>): void;
}

export class ObjectMotion {
  readonly plops = new Map<string, number>(); // id → start ms
  /** `onFrame`, when supplied, is the selection ring's hook onto this same clock (see
   *  `tools/pointer/runtime/view-seam.ts`'s `EditorView.animateRotation`) — called once per tick with the tween's own
   *  progress, exactly 1 on the settling frame, never under reduced motion (this map stays empty then). */
  readonly spins = new Map<string, { from: number; to: number; born: number; onFrame?: (eased: number) => void }>(); // degrees
  /** The one in-flight group rotation (a rigid body has one clock; a second turn supersedes it).
   *  `onFrame` is the ring's hook, called once per tick (not once per member) with the same progress. */
  private groupArc: {
    born: number; sweepRad: number;
    /** `roadTrim` members have no instance to back-date — their body rides the trimmed-road mesh, so
     *  the tween displaces that mesh for them instead. */
    members: Array<{ id: string; motion: ArcMotion; spun: boolean; roadTrim: boolean }>;
    hasRoadTrim: boolean;
    onFrame?: (eased: number) => void;
  } | null = null;

  constructor(private readonly host: ObjectMotionHost) {}

  /** Starts a group turn, superseding one in flight. */
  turnGroup(turn: GroupRotation, onFrame?: (eased: number) => void): void {
    const state = this.host.state();
    const members = turn.members.map((m) => ({
      id: m.id, spun: m.spun, motion: arcMotion(turn.pivot, m.from),
      roadTrim: bodyRoute(state, m.id) === 'roadTrim',
    }));
    this.groupArc = {
      born: performance.now(),
      sweepRad: (turn.sweepDeg * Math.PI) / 180,
      members,
      hasRoadTrim: members.some((m) => m.roadTrim),
      onFrame,
    };
  }

  /** Drops `id`'s plop and spin; its instances are about to be drawn somewhere else. */
  stop(id: string): void {
    this.plops.delete(id);
    this.spins.delete(id);
  }

  /** Drops every tween: the instanced set they ran on is being rebuilt. */
  clear(): void {
    this.plops.clear();
    this.spins.clear();
    this.groupArc = null;
  }

  /** Placement plop: the shared `plopScale` curve on the fresh instance's matrix, the same curve
   *  the 2D sprite takes. */
  tickPlops(): boolean {
    if (this.plops.size === 0) return false;
    const now = performance.now();
    const cfg = animConfig.plop;
    for (const [id, born] of this.plops) {
      const t = (now - born) / cfg.settleMs;
      const drawn = [...this.host.drawn(id)];
      if (drawn.length === 0 || t >= 1) {
        for (const { group, slot, inst } of drawn) writeInstance(group, slot, inst);
        this.plops.delete(id);
        continue;
      }
      // The body's scale span is its footprint, and sets the amplitude for everything that draws
      // the object.
      const body = drawn[0]!.inst;
      const { across: sxz, up: sy } = plopScale(t, Math.max(body.scaleX, body.scaleZ, 1));
      for (const { group, slot, inst } of drawn) {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, inst.rotationY);
        m.compose(
          new THREE.Vector3(inst.x, inst.y, inst.z),
          q,
          new THREE.Vector3(inst.scaleX * sxz, inst.scaleY * sy, inst.scaleZ * sxz),
        );
        group.mesh.setMatrixAt(slot, m);
        group.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    return this.plops.size > 0;
  }

  /** Rotation: the shared `spinEase` curve on the instance's matrix, the same curve the 2D icon
   *  takes. The state already holds the final angle, so the tween back-dates the visible rotation
   *  and settles onto the real one. */
  tickSpins(): boolean {
    if (this.spins.size === 0) return false;
    const now = performance.now();
    const cfg = animConfig.rotation;
    for (const [id, spin] of this.spins) {
      const t = (now - spin.born) / cfg.durationMs;
      const drawn = [...this.host.drawn(id)];
      if (drawn.length === 0 || t >= 1) {
        for (const { group, slot, inst } of drawn) writeInstance(group, slot, inst);
        spin.onFrame?.(1);
        this.spins.delete(id);
        continue;
      }
      const ease = spinEase(t);
      const deg = spin.from + (spin.to - spin.from) * ease;
      for (const { group, slot, inst } of drawn) {
        const m = new THREE.Matrix4();
        // Yaw = rot(deg) = restYaw + (to − deg)·π/180 (rot's slope is −π/180). At
        // deg=from this is exactly the previous rotation's yaw (correct first frame);
        // as deg climbs to `to` the yaw decreases to restYaw — a CW turn from above,
        // matching the 2D sprite.
        const q = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, inst.rotationY + ((spin.to - deg) * Math.PI) / 180);
        m.compose(new THREE.Vector3(inst.x, inst.y, inst.z), q, new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ));
        group.mesh.setMatrixAt(slot, m);
        group.mesh.instanceMatrix.needsUpdate = true;
      }
      spin.onFrame?.(ease);
    }
    // The shadow map is frozen (autoUpdate off), so a spinning object's shadow would otherwise stay
    // fixed while the object turns. Re-cast it each frame a spin is active — including the frame the
    // last spin settles (writeInstance above set the final matrix) — so the shadow tracks and lands
    // at the final orientation.
    this.host.recastShadows();
    return this.spins.size > 0;
  }

  /**
   * Group rotation: the selection turns as one rigid body. Every member arcs about the shared
   * centre, spun members also yaw a quarter turn, carried ones do not. One entry and one clock, or
   * the body comes apart (view/shared/motion/group-arc.ts), so a second turn replaces this one.
   * Cell units are world units on the ground, so the arc's offset applies straight to x/z. A
   * trim-meshed road has no instance matrix, so its mesh is rebuilt with the frame's offsets, only
   * when the selection holds one.
   */
  tickGroupArc(): boolean {
    const arc = this.groupArc;
    if (!arc) return false;
    const cfg = animConfig.groupRotation;
    const t = Math.min((performance.now() - arc.born) / cfg.durationMs, 1);
    const e = t < 1 ? easeOutBack(t, cfg.overshoot) : 1;
    const roadOffsets = arc.hasRoadTrim ? new Map<string, { dx: number; dz: number }>() : null;
    for (const m of arc.members) {
      if (m.roadTrim) {
        if (roadOffsets && t < 1) {
          const { dx, dy } = arcOffset(m.motion, arc.sweepRad, e);
          roadOffsets.set(m.id, { dx, dz: dy });
        }
        continue;
      }
      for (const { group, slot, inst } of this.host.drawn(m.id)) {
        if (t >= 1) { writeInstance(group, slot, inst); continue; }
        const { dx, dy } = arcOffset(m.motion, arc.sweepRad, e);
        // Yaw runs opposite the screen-space spin offset (rot's slope is −π/180, as in tickSpins), so
        // a member back-dated by a clockwise-from-above turn settles onto its stored rotation.
        const yaw = inst.rotationY - (m.spun ? spinOffset(arc.sweepRad, e) : 0);
        const mat = new THREE.Matrix4().compose(
          new THREE.Vector3(inst.x + dx, inst.y, inst.z + dy),
          new THREE.Quaternion().setFromAxisAngle(UP_AXIS, yaw),
          new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ),
        );
        group.mesh.setMatrixAt(slot, mat);
        group.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    if (roadOffsets) this.host.rebuildRoads(roadOffsets.size > 0 ? roadOffsets : undefined);
    // The shadow map is frozen, so every moving member's shadow would otherwise stay behind on the
    // ground — including on the settling frame, where writeInstance above landed the real transform.
    this.host.recastShadows();
    arc.onFrame?.(e);
    if (t >= 1) this.groupArc = null;
    return this.groupArc !== null;
  }
}

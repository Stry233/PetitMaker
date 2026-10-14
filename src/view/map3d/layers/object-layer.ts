/**
 * The map's objects as instanced meshes: one group per model, deck or archetype key, each with
 * spare capacity and dense slots (`InstanceSlots`), so an edit adds or frees one slot rather than
 * rebuilding a mesh. A trimmed road has no instance here; the road surfaces mesh it.
 */
import * as THREE from 'three';
import type { GridState, PlacedObject } from '../../../core/model/types';
import type { GlQuality } from '../../../platform/device/device-quality';
import { isCoatingItem } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { iconUrl } from '../../../assets/icon-urls';
import { assertFinite } from '../geometry/finite';
import { cellCornerWorld } from '../geometry/coords';
import { InstanceSlots } from '../geometry/instance-slots';
import { objectSlotIds, objectSlotInstances, slotOwner } from '../geometry/object-meshes';
import type { ArchetypeKey, ObjectInstance } from '../geometry/types';
import { ensureFadeRadius } from '../draw/proximity-fade';
import { iconDominantColor } from '../draw/icon-color';
import { archetypeGeometry } from '../models/object-archetypes';
import { deckGeometry, groupModelGeometry } from '../models/build-model';

/** One instanced-object group's live scene state. */
export interface InstanceGroup {
  mesh: THREE.InstancedMesh;
  capacity: number;
  isModel: boolean;
  geo: THREE.BufferGeometry;
  instances: (ObjectInstance | null)[];
}

/** One instance that draws an object: its group, its slot and its canonical transform. */
export interface DrawnSlot { group: InstanceGroup; slot: number; inst: ObjectInstance }

export const UP_AXIS = new THREE.Vector3(0, 1, 0);

/** Writes an instance's canonical transform (and, for a tinted archetype, its colour) into its slot. */
export function writeInstance(group: InstanceGroup, slot: number, inst: ObjectInstance): void {
  if (import.meta.env.DEV) assertFinite(`the object instance in slot ${slot}`, [inst.x, inst.y, inst.z, inst.rotationY, inst.scaleX, inst.scaleY, inst.scaleZ]);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromAxisAngle(UP_AXIS, inst.rotationY);
  m.compose(new THREE.Vector3(inst.x, inst.y, inst.z), q, new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ));
  group.mesh.setMatrixAt(slot, m);
  group.mesh.instanceMatrix.needsUpdate = true;
  if (!group.isModel) {
    group.mesh.setColorAt(slot, new THREE.Color().setRGB(inst.color[0], inst.color[1], inst.color[2], THREE.SRGBColorSpace));
    group.mesh.instanceColor!.needsUpdate = true;
  }
}

/** A zero-scale matrix hides one instance without disturbing its slot. */
function writeHiddenInstance(group: InstanceGroup, slot: number): void {
  const m = new THREE.Matrix4().makeScale(0, 0, 0);
  group.mesh.setMatrixAt(slot, m);
  group.mesh.instanceMatrix.needsUpdate = true;
}

/**
 * The instanced mesh one group draws with. Every instanced body takes the proximity fade through
 * the two faded materials; ground surfaces keep their floor through their geometry's
 * persistent-ground marker, never through a material of their own.
 */
export function makeInstancedMesh(
  key: string, geo: THREE.BufferGeometry, capacity: number, materials: { sharedMat: THREE.Material; modelMat: THREE.Material },
): THREE.InstancedMesh {
  const isModel = key.startsWith('m:') || key.startsWith('d:');
  const mesh = new THREE.InstancedMesh(geo, isModel ? materials.modelMat : materials.sharedMat, capacity);
  mesh.count = 0;
  // Instances sit far from the origin but the geometry's bounding sphere is
  // origin-centred; skip frustum culling (≤ a handful of meshes) so whole
  // groups never pop out when the origin leaves the frustum.
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** What the instances read from the scene that holds them. */
export interface ObjectInstancesHost {
  readonly scene: THREE.Scene;
  /** The archetype bodies' material, tinted per instance. */
  readonly sharedMat: THREE.Material;
  /** The models' material; their colours are baked into vertices. */
  readonly modelMat: THREE.Material;
  /** The live map. */
  state(): GridState;
  hiddenLayers(): ReadonlySet<number>;
  quality(): GlQuality;
  /** False once the scene stops drawing; an icon tint that lands later is dropped. */
  running(): boolean;
  requestRender(): void;
}

export class ObjectLayer3D {
  readonly groups = new Map<string, InstanceGroup>();
  private slots = new InstanceSlots();
  private instanced: THREE.InstancedMesh[] = [];
  private roadIds = new Set<string>();
  private elevations = new Map<string, number>();

  constructor(private readonly host: ObjectInstancesHost) {}

  /** Instances every object on the live map, then refines the archetype tints. */
  buildAll(): void {
    for (const obj of this.host.state().objects.values()) this.add(obj);
    this.refineIconColors();
  }

  /** Instances one object into its groups (creating or growing each group's mesh as needed).
   *  Returns true when the object is a road; the caller decides whether the road surfaces rebuild. */
  add(obj: PlacedObject): boolean {
    const isRoad = isCoatingItem(getCatalogItem(obj.catalogId));
    if (isRoad) this.roadIds.add(obj.id);
    // A trimmed road has none: the road-trim pass meshes it.
    for (const drawn of objectSlotInstances(this.host.state(), obj)) this.place(drawn.slotId, obj.elevation, drawn);
    return isRoad;
  }

  /** Frees one object's instance slots, keeping each group dense (the group's last instance moves
   *  into the hole). Returns true for roads. */
  remove(id: string): boolean {
    const isRoad = this.roadIds.delete(id);
    for (const slotId of objectSlotIds(id)) this.free(slotId);
    return isRoad;
  }

  /** Rebuilds the set from the live map: every slot, road id and elevation record is bookkeeping
   *  about a set the scene stopped mirroring. The group meshes stay (capacity is reusable); only
   *  their counts and instances are rewritten. */
  reset(): void {
    for (const group of this.groups.values()) group.mesh.count = 0;
    this.slots = new InstanceSlots();
    this.roadIds.clear();
    this.elevations.clear();
    this.buildAll();
  }

  /** Each instance that draws object `id`: its body, then its deck parts when it has them. */
  *drawn(id: string): Generator<DrawnSlot> {
    for (const slotId of objectSlotIds(id)) {
      const ref = this.slots.slotOf(slotId);
      const group = ref ? this.groups.get(ref.group) : undefined;
      const inst = ref && group ? group.instances[ref.slot] : null;
      if (ref && group && inst) yield { group, slot: ref.slot, inst };
    }
  }

  /** Zero-scales the instances standing on newly hidden elevations and rewrites the ones whose
   *  elevation came back; a slot keeps its metadata, so unhiding restores the real transform. */
  applyLayerToggle(changed: readonly number[], hidden: ReadonlySet<number>): void {
    for (const [id, elev] of this.elevations) {
      if (!changed.includes(elev)) continue;
      const ref = this.slots.slotOf(id);
      if (!ref) continue;
      const group = this.groups.get(ref.group);
      const inst = group?.instances[ref.slot];
      if (!group || !inst) continue;
      if (hidden.has(elev)) writeHiddenInstance(group, ref.slot);
      else writeInstance(group, ref.slot, inst);
    }
  }

  /** Draws `obj`'s instances at its transform without touching the canonical instance metadata:
   *  the move preview's frame. */
  showAt(obj: PlacedObject): void {
    for (const resolved of objectSlotInstances(this.host.state(), obj)) {
      const ref = this.slots.slotOf(resolved.slotId);
      const group = ref ? this.groups.get(ref.group) : undefined;
      if (!ref || !group) continue;
      if (this.host.hiddenLayers().has(obj.elevation)) writeHiddenInstance(group, ref.slot);
      else writeInstance(group, ref.slot, resolved.inst);
      group.mesh.boundingSphere = null;
      group.mesh.boundingBox = null;
    }
  }

  /** Swaps every model and deck group onto the geometry of the current quality. */
  requalify(): void {
    for (const [key, group] of this.groups) {
      const geo = key.startsWith('d:') ? deckGeometry(key.slice(2), this.host.quality())
        : key.startsWith('m:') ? groupModelGeometry(key, this.host.quality()) : null;
      if (!geo) continue;
      if (!key.startsWith('d:')) ensureFadeRadius(geo);
      group.geo = geo;
      group.mesh.geometry = geo;
    }
  }

  /** Selection bounds use the occupied footprint in X/Z and the rendered body's vertical extent.
   *  Objects without an instanced body use the overlay's flat footprint fallback. */
  boundingBox(id: string): THREE.Box3 | null {
    const state = this.host.state();
    const obj = state.objects.get(id);
    const ref = this.slots.slotOf(id);
    if (!obj || !ref) return null;
    const group = this.groups.get(ref.group);
    const inst = group?.instances[ref.slot];
    if (!group || !inst) return null;
    if (!group.geo.boundingBox) group.geo.computeBoundingBox();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(inst.x, inst.y, inst.z),
      new THREE.Quaternion().setFromAxisAngle(UP_AXIS, inst.rotationY),
      new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ),
    );
    const box = group.geo.boundingBox!.clone().applyMatrix4(m);
    const { width, height } = state.template;
    const corner = cellCornerWorld(obj.position.x, obj.position.y, width, height, PLACEMENT_GRID);
    const size = getPlacedObjectSize(obj);
    box.min.x = corner.x; box.max.x = corner.x + size.w;
    box.min.z = corner.z; box.max.z = corner.z + size.h;
    return box;
  }

  /** The nearest object whose mesh `rc` hits, with the hit's distance along the ray. */
  pick(rc: THREE.Raycaster): { dist: number; id: string } | null {
    let best: { dist: number; id: string } | null = null;
    for (const [key, group] of this.groups) {
      if (group.mesh.count === 0) continue;
      for (const hit of rc.intersectObject(group.mesh, false)) {
        if (hit.instanceId === undefined) continue;
        const slotId = this.slots.idAt(key, hit.instanceId);
        if (!slotId) continue;
        const id = slotOwner(slotId);
        if (!best || hit.distance < best.dist) best = { dist: hit.distance, id };
      }
    }
    return best;
  }

  /** Refines each icon-sprite instance's tint from the category fallback to its icon's real
   *  dominant colour (async; per unique icon, once loaded). Degrades gracefully: if an icon never
   *  loads, the category colour stays. */
  refineIconColors(): void {
    const urls = new Set<string>();
    for (const g of this.groups.values()) {
      if (g.isModel) continue; // models bake their colours
      for (const inst of g.instances) {
        if (inst?.icon) { const u = iconUrl(inst.icon); if (u) urls.add(u); }
      }
    }
    const col = new THREE.Color();
    for (const url of urls) {
      void iconDominantColor(url).then((rgb) => {
        if (!rgb || !this.host.running()) return;
        let changed = false;
        for (const g of this.groups.values()) {
          if (g.isModel) continue;
          let touched = false;
          g.instances.forEach((inst, i) => {
            if (inst?.icon && iconUrl(inst.icon) === url) {
              g.mesh.setColorAt(i, col.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace));
              touched = true;
            }
          });
          if (touched && g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
          if (touched) changed = true;
        }
        if (changed) this.host.requestRender();
      });
    }
  }

  /** Frees the per-instance buffers (instanceMatrix, instanceColor). Not their geometry: that is
   *  the shared model and archetype geometry, freed when the last scene's cache lease ends. */
  dispose(): void {
    for (const mesh of this.instanced) mesh.dispose();
  }

  /** Puts one instance in its group's next slot under `slotId`. */
  private place(slotId: string, elevation: number, resolved: { groupKey: string; inst: ObjectInstance }): void {
    const group = this.ensureGroup(resolved.groupKey);
    if (!group) return;
    const slot = this.slots.add(slotId, resolved.groupKey);
    if (slot >= group.capacity) this.growGroup(resolved.groupKey, group);
    group.instances[slot] = resolved.inst;
    this.elevations.set(slotId, elevation);
    if (this.host.hiddenLayers().has(elevation)) writeHiddenInstance(group, slot);
    else writeInstance(group, slot, resolved.inst);
    group.mesh.count = this.slots.count(resolved.groupKey);
  }

  /** Frees the slot `slotId` holds, if any. */
  private free(slotId: string): void {
    this.elevations.delete(slotId);
    const removed = this.slots.remove(slotId);
    if (!removed) return; // not instanced (trimmed road, or unknown)
    const group = this.groups.get(removed.group);
    if (!group) return;
    if (removed.moved) {
      const inst = group.instances[removed.moved.fromSlot]!;
      group.instances[removed.slot] = inst;
      group.instances[removed.moved.fromSlot] = null;
      writeInstance(group, removed.slot, inst);
    } else {
      group.instances[removed.slot] = null;
    }
    group.mesh.count = this.slots.count(removed.group);
    group.mesh.instanceMatrix.needsUpdate = true;
  }

  private ensureGroup(key: string): InstanceGroup | null {
    const existing = this.groups.get(key);
    if (existing) return existing;
    // 'm:<id>' → bespoke per-item model and 'd:<id>' → an item's deck parts (baked vertex colours,
    // no instance tint); 'a:<archetype>' → category archetype (white material + per-instance tint).
    const isDeck = key.startsWith('d:');
    const isModel = isDeck || key.startsWith('m:');
    const quality = this.host.quality();
    const geo = isDeck ? deckGeometry(key.slice(2), quality) : isModel ? groupModelGeometry(key, quality) : archetypeGeometry(key.slice(2) as ArchetypeKey);
    if (!geo) return null;
    ensureFadeRadius(geo);

    const group: InstanceGroup = { mesh: this.addMesh(key, geo, 16), capacity: 16, isModel, geo, instances: [] };
    this.groups.set(key, group);
    return group;
  }

  private addMesh(key: string, geo: THREE.BufferGeometry, capacity: number): THREE.InstancedMesh {
    const mesh = makeInstancedMesh(key, geo, capacity, this.host);
    this.host.scene.add(mesh);
    this.instanced.push(mesh);
    return mesh;
  }

  /** Doubles a full group's capacity, copying the live instance buffers. */
  private growGroup(key: string, group: InstanceGroup): void {
    const old = group.mesh;
    const next = this.addMesh(key, group.geo, group.capacity * 2);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    next.instanceMatrix.needsUpdate = true;
    if (old.instanceColor) {
      // Materialize the color buffer at the new capacity before copying.
      next.setColorAt(0, new THREE.Color());
      (next.instanceColor!.array as Float32Array).set(old.instanceColor.array as Float32Array);
      next.instanceColor!.needsUpdate = true;
    }
    next.count = old.count;
    this.host.scene.remove(old);
    old.dispose();
    this.instanced = this.instanced.filter((m2) => m2 !== old);
    group.mesh = next;
    group.capacity *= 2;
  }
}

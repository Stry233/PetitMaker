/**
 * A group rotation must animate EVERY member in 3D, whatever draws its body.
 *
 * The 3D view splits object bodies two ways: most ride an InstancedMesh, but a road whose corners
 * were edge-cut is meshed by buildRoadTrimMeshes and deliberately skipped by the instancer. The tween
 * resolved members through the instance registry alone, so a trimmed road had nothing to move and sat
 * still while the rest of the body turned around it. These pin the model-side facts the tween now
 * routes on, plus the displacement that carries a trim-meshed road along its arc.
 */
import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType } from '../../core/model/types';
import type { Corners, EditorEvents, GridState, PlacedObject } from '../../core/model/types';
import { bodyRoute, isTrimMeshedRoad, objectInstance } from '../../canvas/map3d/build/object-meshes';
import { buildRoadTrimMeshes } from '../../canvas/map3d/build/terrain-geometry';
import { Overlay3D } from '../../canvas/map3d/scene/overlay3d';
import { mapCenterOffset } from '../../canvas/map3d/core/coords';
import { arcMotion, arcOffset, type GroupRotation } from '../../canvas/group-arc';
import { rotateGroup } from '../../tools/objects/group-actions';
import { makeState } from '../rules/_helpers';
import { roadLookup } from '../../state/object-index';

const BR_FAN: Corners = ['square', 'square', 'square', 'fan']; // a canonical road-cut state

function mapWithRoads(): { gs: GridState; exec: CommandExecutor } {
  const gs = makeState(24, 24) as GridState;
  const exec = new CommandExecutor(gs, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(gs));
  // Three, so the trimmed road sits OFF the turn's pivot and actually travels.
  for (const [id, x, y] of [['r1', 5, 5], ['r2', 6, 5], ['r3', 7, 5]] as const) {
    const object: PlacedObject = {
      id, catalogId: 'path-overgrown-dirt', position: { x, y },
      rotation: 0, elevation: 0,
      ...(id === 'r1' ? { corners: BR_FAN } : {}),
    };
    expect(exec.execute({ type: CommandType.PlaceObject, timestamp: 0, object, loadValue: 0 }).success).toBe(true);
  }
  return { gs, exec };
}

function turnOf(gs: GridState, exec: CommandExecutor, ids: string[]): GroupRotation {
  let turn: GroupRotation | null = null;
  const res = rotateGroup(exec, gs, ids, 1, (t) => { turn = t; });
  expect(res.blockedBy).toBeNull();
  expect(turn).not.toBeNull();
  return turn!;
}

describe('3D body routing for a group rotation', () => {
  it('routes a trimmed road to the trim mesh and gives EVERY member a body to animate', () => {
    const { gs, exec } = mapWithRoads();
    const turn = turnOf(gs, exec, ['r1', 'r2', 'r3']);
    expect(turn.members.map((m) => m.id)).toEqual(['r1', 'r2', 'r3']);
    expect(isTrimMeshedRoad(gs.objects.get('r1')!)).toBe(true);
    expect(bodyRoute(gs, 'r1')).toBe('roadTrim');
    expect(bodyRoute(gs, 'r2'), 'every road is meshed now, feather and all').toBe('roadTrim');
    // The bug: a member the view has no body for is skipped without a trace.
    for (const m of turn.members) expect(bodyRoute(gs, m.id), m.id).not.toBe('none');
  });

  it('agrees with the instancer about who is skipped', () => {
    const { gs } = mapWithRoads();
    for (const obj of gs.objects.values()) {
      expect(objectInstance(gs, obj) === null, obj.id).toBe(isTrimMeshedRoad(obj));
    }
  });

  it('reports a member the map no longer holds', () => {
    const { gs } = mapWithRoads();
    expect(bodyRoute(gs, 'gone')).toBe('none');
  });
});

/** This map is paved in ONE material, so the split's single part is the road mesh. */
const buildRoadTrimMesh = (...args: Parameters<typeof buildRoadTrimMeshes>) =>
  buildRoadTrimMeshes(...args)[0]?.mesh ?? { positions: [] as number[] };

describe('buildRoadTrimMeshes offsets', () => {
  it('a uniformly-offset surface travels whole, on the ground plane only', () => {
    // A drag-move frame: every member of the run carries the same offset, so the region mesh
    // translates as one body.
    const { gs } = mapWithRoads();
    const off = { dx: 0.4, dz: 0.7 };
    const rest = buildRoadTrimMesh(gs);
    const moved = buildRoadTrimMesh(gs, undefined, new Map([['r1', off], ['r2', off], ['r3', off]]));
    expect(rest.positions.length).toBeGreaterThan(0);
    expect(moved.positions.length).toBe(rest.positions.length);
    for (let i = 0; i < rest.positions.length; i += 3) {
      expect(moved.positions[i]! - rest.positions[i]!).toBeCloseTo(off.dx, 5);
      expect(moved.positions[i + 1]!).toBeCloseTo(rest.positions[i + 1]!, 5);
      expect(moved.positions[i + 2]! - rest.positions[i + 2]!).toBeCloseTo(off.dz, 5);
    }
  });

  it('a rotation frame (offsets differing per member) still carries every tile along its own arc', () => {
    // A surface cannot stretch between members on different arcs, so the region falls back to
    // per-tile bodies for the tween: each tile's body moves by exactly its own offset.
    const { gs, exec } = mapWithRoads();
    const turn = turnOf(gs, exec, ['r1', 'r2', 'r3']);
    const frame = new Map(turn.members.map((m) => {
      const { dx, dy } = arcOffset(arcMotion(turn.pivot, m.from), (turn.sweepDeg * Math.PI) / 180, 0.4);
      return [m.id, { dx, dz: dy }];
    }));
    const moved = buildRoadTrimMesh(gs, undefined, frame);
    expect(moved.positions.length).toBeGreaterThan(0);
    // Some cell corner of each member's tile appears at its offset position (every kept shape
    // anchors on at least one cell corner, wherever its cut points).
    const goff = mapCenterOffset(gs.template.width, gs.template.height);
    for (const m of turn.members) {
      const obj = gs.objects.get(m.id)!;
      const o = frame.get(m.id)!;
      let found = false;
      for (const [cx, cz] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        const wx = obj.position.x + cx - goff.x + o.dx, wz = obj.position.y + cz - goff.z + o.dz;
        for (let i = 0; i < moved.positions.length && !found; i += 3) {
          found = Math.abs(moved.positions[i]! - wx) < 1e-6 && Math.abs(moved.positions[i + 2]! - wz) < 1e-6;
        }
        if (found) break;
      }
      expect(found, `${m.id} travels by its own offset`).toBe(true);
    }
  });

  it('lands back on the rest pose at the end of the sweep (offset zero)', () => {
    const { gs, exec } = mapWithRoads();
    const turn = turnOf(gs, exec, ['r1', 'r2', 'r3']);
    const member = turn.members.find((m) => m.id === 'r1')!;
    const end = arcOffset(arcMotion(turn.pivot, member.from), (turn.sweepDeg * Math.PI) / 180, 1);
    const rest = buildRoadTrimMesh(gs);
    const landed = buildRoadTrimMesh(gs, undefined, new Map([['r1', { dx: end.dx, dz: end.dy }]]));
    for (let i = 0; i < rest.positions.length; i++) {
      expect(landed.positions[i]!).toBeCloseTo(rest.positions[i]!, 10);
    }
  });
});

describe('Overlay3D selection without an instanced body', () => {
  const overlayFor = (gs: GridState, box: (id: string) => null = () => null) =>
    new Overlay3D(() => gs, () => {}, box);

  it('rings a trimmed road from its MODEL footprint instead of drawing nothing', () => {
    const { gs } = mapWithRoads();
    const overlay = overlayFor(gs);              // no instanced body for anything
    overlay.showObjectSelection('r1');
    overlay.flush();
    expect(overlay.group.children.length, 'fill + edges').toBe(2);
    expect(overlay.unresolvedSelections()).toEqual([]);
    const road = gs.objects.get('r1')!;
    const off = mapCenterOffset(gs.template.width, gs.template.height);
    const geo = (overlay.group.children[0] as THREE.Mesh).geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    expect((bb.min.x + bb.max.x) / 2).toBeCloseTo(road.position.x - off.x + 0.5, 5);
    expect((bb.min.z + bb.max.z) / 2).toBeCloseTo(road.position.y - off.z + 0.5, 5);
  });

  it('reports an id the map no longer holds rather than silently drawing nothing', () => {
    const { gs } = mapWithRoads();
    const overlay = overlayFor(gs);
    overlay.showObjectSelection('gone');
    overlay.flush();
    expect(overlay.group.children.length).toBe(0);
    expect(overlay.unresolvedSelections()).toEqual(['gone']);
  });
});

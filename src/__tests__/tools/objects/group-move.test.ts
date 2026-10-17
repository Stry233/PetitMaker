/**
 * Group move: one delta applied to every member, all-or-nothing.
 *
 * There is no MoveObject command — a move is RemoveObject then a validated PlaceObject — so the
 * ordering is the feature: a group that still sits on the map while its own destinations are
 * validated collides with itself. And a removal can be refused (V-LOCK-02), so a placement that
 * follows an unchecked removal relocates an object the map still holds.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { __setCatalogItem } from '../../../state/catalog';
import { CommandType, TerrainType } from '../../../core/model/types';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { makeState, setTerrain, makeExecutor } from '../../_support/map-state';
import { moveGroup, planGroupMove } from '../../../tools/objects/group-actions';
import { planObjectMove } from '../../../tools/placement/probe';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { ItemCategory } from '../../../config/catalog/categories';

__setCatalogItem({
  id: 'grp-hut', category: ItemCategory.Building, name: { en: 'Group Hut' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [],
});

interface Spec { id: string; x: number; y: number; locked?: boolean }

function mapWith(specs: Spec[]): { gs: GridState; exec: CommandExecutor } {
  const gs = makeState(24, 24);
  const exec = makeExecutor(gs);
  for (const s of specs) {
    const object: PlacedObject = {
      id: s.id, catalogId: 'grp-hut', position: { x: s.x, y: s.y },
      rotation: 0, elevation: 0,
      ...(s.locked ? { locked: true } : {}),
    };
    const res = exec.execute({ type: CommandType.PlaceObject, object });
    expect(res.success).toBe(true);
  }
  return { gs, exec };
}

const posOf = (gs: GridState, id: string) => gs.objects.get(id)!.position;

describe('moveGroup', () => {
  it('removes every member BEFORE planning any placement, so a tight group can slide by one', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    const res = moveGroup(exec, gs, ['a', 'b'], { dx: 1, dy: 0 });
    expect(res.blockedBy).toBeNull();
    expect(res.moved).toBe(2);
    expect(posOf(gs, 'a')).toEqual({ x: 5, y: 4 });
    expect(posOf(gs, 'b')).toEqual({ x: 6, y: 4 });
  });

  it('refuses the WHOLE move when one member is locked, naming it, and rewinds the members it already lifted', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'plaza', x: 8, y: 8, locked: true }]);
    const before = exec.historyDepth();
    const res = moveGroup(exec, gs, ['a', 'plaza'], { dx: 1, dy: 0 });
    expect(res.blockedBy).toBe('plaza');
    expect(res.moved).toBe(0);
    expect(posOf(gs, 'a')).toEqual({ x: 4, y: 4 });
    expect(posOf(gs, 'plaza')).toEqual({ x: 8, y: 8 });
    expect(exec.historyDepth()).toBe(before);
    expect(res.refusal?.errors[0]?.ruleId).toBe('V-LOCK-02');
  });

  it('never places a member whose removal was refused', () => {
    const { gs, exec } = mapWith([{ id: 'plaza', x: 8, y: 8, locked: true }, { id: 'a', x: 4, y: 4 }]);
    expect(moveGroup(exec, gs, ['plaza', 'a'], { dx: 3, dy: 0 }).blockedBy).toBe('plaza');
    expect(gs.objects.size).toBe(2);
    expect(posOf(gs, 'plaza')).toEqual({ x: 8, y: 8 });
    expect(posOf(gs, 'a')).toEqual({ x: 4, y: 4 });
  });

  it('refuses the whole move when one destination is illegal, and nothing shifts', () => {
    // 'wall' is not in the group, so 'b' has nowhere legal to land.
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'wall', x: 6, y: 4 }]);
    const res = moveGroup(exec, gs, ['a', 'b'], { dx: 1, dy: 0 });
    expect(res.blockedBy).toBe('b');
    expect(posOf(gs, 'a')).toEqual({ x: 4, y: 4 });
    expect(posOf(gs, 'b')).toEqual({ x: 5, y: 4 });
    expect(res.refusal?.errors.length).toBeGreaterThan(0);
  });

  it('is one undo entry, and one undo puts every member back', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
    const before = exec.historyDepth();
    moveGroup(exec, gs, ['a', 'b'], { dx: 0, dy: 1 });
    expect(exec.historyDepth()).toBe(before + 1);
    exec.undo();
    expect(posOf(gs, 'a')).toEqual({ x: 4, y: 4 });
    expect(posOf(gs, 'b')).toEqual({ x: 6, y: 4 });
  });

  it('skips an id whose object is gone rather than throwing or blocking the rest', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
    const res = moveGroup(exec, gs, ['a', 'ghost', 'b'], { dx: 0, dy: 2 });
    expect(res.blockedBy).toBeNull();
    expect(res.moved).toBe(2);
    expect(posOf(gs, 'a')).toEqual({ x: 4, y: 6 });
    expect(posOf(gs, 'b')).toEqual({ x: 6, y: 6 });
    expect(moveGroup(exec, gs, ['ghost'], { dx: 1, dy: 0 })).toEqual({ moved: 0, blockedBy: null, refusal: null });
  });

  it('tracks the destination terrain, so a member landing on a terrace takes its elevation', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }]);
    setTerrain(gs, 6, 4, TerrainType.Mountain, 2);
    expect(moveGroup(exec, gs, ['a'], { dx: 2, dy: 0 }).blockedBy).toBeNull();
    expect(gs.objects.get('a')!.elevation).toBe(2);
  });

  describe('onWillPlace (the landing-animation hook)', () => {
    it('fires once per member, right as its own destination is about to be placed', () => {
      const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
      const seen: Array<{ id: string; next: { x: number; y: number } }> = [];
      const res = moveGroup(exec, gs, ['a', 'b'], { dx: 1, dy: 0 }, (member, next) => {
        seen.push({ id: member.id, next: next.position });
      });
      expect(res.moved).toBe(2);
      expect(seen).toEqual([{ id: 'a', next: { x: 5, y: 4 } }, { id: 'b', next: { x: 7, y: 4 } }]);
    });

    it('never fires for a move that refuses (nothing actually lands)', () => {
      const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'plaza', x: 8, y: 8, locked: true }]);
      const seen: string[] = [];
      const res = moveGroup(exec, gs, ['a', 'plaza'], { dx: 1, dy: 0 }, (member) => seen.push(member.id));
      expect(res.blockedBy).toBe('plaza');
      expect(seen).toEqual([]);
    });
  });
});

describe('planGroupMove', () => {
  it('reads a group sliding into its own footprint as valid, and a blocked destination as invalid', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'wall', x: 7, y: 4 }]);
    expect(planGroupMove(exec, gs, ['a', 'b'], 1, 0).valid).toBe(true);
    expect(planGroupMove(exec, gs, ['a', 'b'], 2, 0).valid).toBe(false);
    // The probe is non-mutating: nothing was lifted off the map for good.
    expect(gs.objects.size).toBe(3);
    expect(posOf(gs, 'a')).toEqual({ x: 4, y: 4 });
  });

  it('refuses a preview that contains a locked member, since the move would be refused', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'plaza', x: 8, y: 8, locked: true }]);
    expect(planGroupMove(exec, gs, ['a', 'plaza'], 1, 0).valid).toBe(false);
  });

  it('lands each member where its own move plan would, a snapping ramp and a locked member included', () => {
    // A mountain band at y <= 9, a shoulder at x = 7 and a water bank at x = 4 below it: the ramp's
    // trait snaps a candidate one row down back onto the cliff, at the mountain's height.
    const gs = makeState(20, 20);
    for (let y = 0; y <= 9; y++) for (let x = 0; x < 20; x++) setTerrain(gs, x, y, TerrainType.Mountain, 1);
    for (let y = 10; y <= 14; y++) {
      setTerrain(gs, 7, y, TerrainType.Mountain, 1);
      setTerrain(gs, 4, y, TerrainType.Water, 0);
    }
    const objects: PlacedObject[] = [
      { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 4.5, y: 9 }, rotation: 0, elevation: 1 },
      { id: 'h', catalogId: 'grp-hut', position: { x: 12, y: 14 }, rotation: 0, elevation: 0 },
      { id: 'lock', catalogId: 'grp-hut', position: { x: 15, y: 15 }, rotation: 0, elevation: 0, locked: true },
    ];
    for (const object of objects) gs.objects.set(object.id, object);
    bumpObjectsVersion(gs, { added: objects });
    const exec = makeExecutor(gs);
    const plan = planGroupMove(exec, gs, objects.map((o) => o.id), 0, 1);
    expect(plan.valid).toBe(false);
    expect(plan.landed).toEqual(objects.map((o) => planObjectMove(exec, gs, o, o.position.x, o.position.y + 1).preview));
    expect(plan.landed[0]!.elevation).toBe(1);
  });
});


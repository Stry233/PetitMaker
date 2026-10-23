/** Moving, rotating and deleting objects, one at a time and as a selection, and the locked
 *  landmarks no edit may move. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { dragObject, objectsOf, picture, placeItem, plateau, pointAt } from './_editing';
import { clearAllObjects } from '../../../tools/generation';
import { groupBounds } from '../../../tools/objects';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';

const TREE = 'tree-apple';
const CABIN = 'building-bamboo-cabin';
const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });
/** The centre of the cell an object's anchor stands in, where a press grabs it. */
const grip = (o: PlacedObject) => pointAt(o.position.x + 0.5, o.position.y + 0.5);
const place = (w: SpecWorld, item: string, c: MacroCoord): PlacedObject => {
  const o = placeItem(w, item, c);
  if (!o) throw new Error(`${item} refused at ${c.x},${c.y}`);
  return o;
};
const landmark = (w: SpecWorld) => [...w.state.objects.values()].find((o) => o.locked)!;
const where = (w: SpecWorld, ids: readonly string[]) => ids.map((id) => {
  const o = w.object(id)!;
  return { x: o.position.x, y: o.position.y, rotation: o.rotation };
});

describe('moving objects', () => {
  spec('EDIT-27', 'a dragged object moves as one undo step and takes the height of the ground it lands on', () => {
    const w = world();
    const at = w.openGround(10, 4);
    plateau(w, shift(at, 6, 0), 4, 4, 1);
    const tree = place(w, TREE, shift(at, 0, 1));
    const before = picture(w);
    expect(dragObject(w, [tree.id], tree.id, grip(tree), pointAt(at.x + 7.5, at.y + 1.5))).toBeNull();
    expect(w.object(tree.id)).toMatchObject({ position: { x: at.x + 7, y: at.y + 1 }, elevation: 1 });
    w.undo();
    expect(picture(w)).toBe(before);
  });

  spec('EDIT-27', 'dragging one of a selection moves the whole selection as one undo step', () => {
    const w = world();
    const at = w.openGround(12, 6);
    const a = place(w, TREE, shift(at, 1, 1));
    const b = place(w, TREE, shift(at, 4, 2));
    const before = picture(w);
    expect(dragObject(w, [a.id, b.id], a.id, grip(a), pointAt(at.x + 6.5, at.y + 3.5))).toBeNull();
    expect(where(w, [a.id, b.id])).toEqual([{ x: at.x + 6, y: at.y + 3, rotation: 0 }, { x: at.x + 9, y: at.y + 4, rotation: 0 }]);
    w.undo();
    expect(picture(w)).toBe(before);
  });

  spec('EDIT-27', 'a group move one member cannot make leaves every member where it stood and names the rule', () => {
    const w = world();
    const plaza = landmark(w);
    const row = { x: plaza.position.x - 9, y: plaza.position.y + 10 };
    const a = place(w, TREE, row);
    const b = place(w, TREE, shift(row, 5, 0));
    const before = picture(w);
    const refusal = dragObject(w, [a.id, b.id], a.id, grip(a), pointAt(row.x + 5.5, row.y + 0.5));
    expect(refusal?.errors.map((e) => e.ruleId)).toContain('V-PLACE-OVERLAP');
    expect(picture(w)).toBe(before);
  });
});

describe('rotating objects', () => {
  /** A house and a tree beside it, the tree square and unable to turn. */
  function pair(w: SpecWorld) {
    const at = w.openGround(16, 16);
    const cabin = place(w, CABIN, shift(at, 3, 5));
    const tree = place(w, TREE, shift(at, 11, 7));
    return [cabin.id, tree.id];
  }
  const centre = (w: SpecWorld, ids: string[]) => {
    const b = groupBounds(ids.map((id) => w.object(id)!));
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  };

  spec('EDIT-28', 'a selection turns a quarter as one body about its centre, and four turns bring it home', () => {
    for (const turn of [1, -1] as const) {
      const w = world();
      const ids = pair(w);
      const home = where(w, ids);
      const pivot = centre(w, ids);
      expect(w.sandbox.rotateGroup(ids, turn).moved).toBe(2);
      const turned = centre(w, ids);
      expect(Math.abs(turned.x - pivot.x) + Math.abs(turned.y - pivot.y), 'about the centre').toBeLessThanOrEqual(1);
      expect(w.object(ids[0]!)!.rotation, 'the house turns').toBe(turn === 1 ? 90 : 270);
      expect(w.object(ids[1]!)!.rotation, 'the tree keeps its facing').toBe(0);
      expect(where(w, ids)[1], 'and is carried round').not.toEqual(home[1]);
      for (let i = 0; i < 3; i++) expect(w.sandbox.rotateGroup(ids, turn).moved).toBe(2);
      expect(where(w, ids)).toEqual(home);
    }
  });

  spec('EDIT-29', 'a turn is refused whole when a member is locked', () => {
    const w = world();
    const tree = place(w, TREE, w.openGround(3, 3));
    const before = picture(w);
    const res = w.sandbox.rotateGroup([landmark(w).id, tree.id], 1);
    expect(res.moved).toBe(0);
    expect(res.refusal).not.toBeNull();
    expect(picture(w)).toBe(before);
  });

  spec('EDIT-29', 'a turn is refused whole when a member would land where the rules refuse it', () => {
    const w = world();
    const ids = pair(w);
    w.sandbox.rotateGroup(ids, 1);
    const landing = w.object(ids[1]!)!.position;
    w.undo();
    place(w, TREE, shift(landing, 0, 0));
    const before = picture(w);
    const res = w.sandbox.rotateGroup(ids, 1);
    expect(res.moved).toBe(0);
    expect(res.refusal).not.toBeNull();
    expect(picture(w)).toBe(before);
  });

  spec('EDIT-29', 'a turn is refused whole when a member cannot turn and is not square, as a bridge', () => {
    const w = world();
    const at = w.openGround(12, 12);
    plateau(w, at, 4, 6, 1);
    plateau(w, shift(at, 8, 0), 4, 6, 1);
    const bridge = place(w, 'bridge-iron', shift(at, 5, 2));
    const tree = place(w, TREE, shift(at, 5, 9));
    const before = picture(w);
    const res = w.sandbox.rotateGroup([bridge.id, tree.id], 1);
    expect(res.moved).toBe(0);
    expect(res.refusal?.errors.map((e) => e.message)).toEqual(['error.span_no_group_rotate']);
    expect(picture(w)).toBe(before);
  });

  spec('EDIT-29', 'a turn with a ramp in the selection is refused whole', () => {
    const w = world();
    const at = w.openGround(12, 12);
    plateau(w, at, 6, 6, 1);
    const ramp = place(w, 'ramp-grassy', shift(at, 5, 2));
    const tree = place(w, TREE, shift(at, 2, 2));
    const before = picture(w);
    const res = w.sandbox.rotateGroup([ramp.id, tree.id], 1);
    expect(res.moved).toBe(0);
    expect(res.refusal).not.toBeNull();
    expect(picture(w)).toBe(before);
  });

  spec('EDIT-29', 'a single object whose turned footprint is refused stays as it was', () => {
    const w = world();
    const at = w.openGround(12, 12);
    const house = place(w, 'building-myhouse', shift(at, 2, 2));
    const { w: width, h: height } = { w: 7, h: 4 };
    expect(groupBounds([house])).toEqual({ minX: at.x + 2, minY: at.y + 2, maxX: at.x + 2 + width, maxY: at.y + 2 + height });
    expect(w.sandbox.rotateObject(w.object(house.id)!, 90, { from: 0, to: 90 }).ok, 'on open ground it turns').toBe(true);
    w.undo();
    place(w, TREE, shift(at, 3, 2 + height + 2));
    const before = picture(w);
    const res = w.sandbox.rotateObject(w.object(house.id)!, 90, { from: 0, to: 90 });
    expect(res.ok, 'with a tree where the turned house would reach').toBe(false);
    expect(picture(w)).toBe(before);
  });
});

describe('deleting objects', () => {
  spec('EDIT-30', 'deleting a selection removes its unlocked members in one step and keeps and counts the locked ones', () => {
    const w = world();
    const tree = place(w, TREE, w.openGround(3, 3));
    const plaza = landmark(w);
    const before = picture(w);
    const res = w.sandbox.deleteGroup([tree.id, plaza.id]);
    expect(res).toMatchObject({ deleted: 1, kept: 1, refusal: null });
    expect(w.object(tree.id)).toBeUndefined();
    expect(w.object(plaza.id)).toBeDefined();
    w.undo();
    expect(picture(w)).toBe(before);
  });

  spec('EDIT-30', 'a selection of locked objects only is refused and nothing changes', () => {
    const w = world();
    const locked = [...w.state.objects.values()].filter((o) => o.locked).map((o) => o.id);
    expect(locked.length).toBeGreaterThan(0);
    const before = picture(w);
    const res = w.sandbox.deleteGroup(locked);
    expect(res.deleted).toBe(0);
    expect(res.refusal?.errors.map((e) => e.ruleId)).toContain('V-LOCK-02');
    expect(picture(w)).toBe(before);
  });
});

describe('locked objects', () => {
  spec('EDIT-32', 'a planet\'s landmarks are never moved, turned or removed, and clearing every object leaves them', () => {
    const w = world();
    const plaza = landmark(w);
    const before = picture(w);
    expect(w.remove(plaza.id).refusedBy).toEqual(['V-LOCK-02']);
    expect(dragObject(w, [plaza.id], plaza.id, grip(plaza), pointAt(plaza.position.x - 3.5, plaza.position.y + 0.5))).not.toBeNull();
    expect(w.sandbox.rotateObject(plaza, 90, { from: 0, to: 90 }).ok).toBe(false);
    expect(w.sandbox.rotateGroup([plaza.id], 1).moved).toBe(0);
    expect(picture(w)).toBe(before);

    const landmarks = [...w.state.objects.values()].filter((o) => o.locked);
    place(w, TREE, w.openGround(3, 3));
    clearAllObjects({ state: w.state, execute: (cmd) => w.sandbox.execute(cmd) });
    expect(objectsOf(w, TREE)).toEqual([]);
    expect([...w.state.objects.values()]).toEqual(landmarks);
  });
});

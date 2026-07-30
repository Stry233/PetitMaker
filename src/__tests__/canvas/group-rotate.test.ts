/**
 * Group rotate: the selection turns as ONE rigid body.
 *
 * A quarter turn does two things at once: every member's POSITION turns about the selection's
 * bounding-box centre, and every member's own ROTATION advances by the same 90 degrees. The
 * FOOTPRINT turns, not the anchor — a 3x1 becomes 1x3, so its anchor moves by an amount that
 * depends on its own extent. Rotating anchors alone drifts wide members outward, invisibly in one
 * turn; four turns landing every member exactly home is the test that sees it.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { registerCatalogItem } from '../../state/catalog';
import { CommandType, ItemCategory, ObjectCategory, TerrainType } from '../../core/model/types';
import type { EditorEvents, GridState, PlacedObject } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { getPlacedObjectSize } from '../../state/object-geometry';
import type { GroupRotation } from '../../canvas/group-arc';
import { rotateGroup } from '../../ui/chrome/group-actions';

for (const [id, width, height, rotatable] of [
  // 'rot-span' stands for the bridges and ramps: unrotatable AND non-square.
  ['rot-hut', 1, 1, true], ['rot-wide', 3, 1, true], ['rot-fixed', 1, 1, false], ['rot-span', 2, 4, false],
] as const) {
  registerCatalogItem({
    id, category: ItemCategory.Building, name: { en: id },
    emoji: '🏠', width, height, loadValue: 0, rotatable, placementMode: 'point',
    traits: [],
  });
}

interface Spec { id: string; x: number; y: number; catalogId?: string; locked?: boolean }

function mapWith(specs: Spec[]): { gs: GridState; exec: CommandExecutor } {
  const gs = makeState(24, 24);
  const exec = new CommandExecutor(gs, new EventBus<EditorEvents>(), createDefaultRegistry());
  for (const s of specs) {
    const object: PlacedObject = {
      id: s.id, catalogId: s.catalogId ?? 'rot-hut', position: { x: s.x, y: s.y },
      rotation: 0, category: ObjectCategory.House, elevation: 0,
      ...(s.locked ? { locked: true } : {}),
    };
    const res = exec.execute({ type: CommandType.PlaceObject, timestamp: 0, object, loadValue: 0 });
    expect(res.success).toBe(true);
  }
  return { gs, exec };
}

const snapshot = (gs: GridState, ids: string[]) => ids.map((id) => {
  const obj = gs.objects.get(id)!;
  return { id, x: obj.position.x, y: obj.position.y, rotation: obj.rotation };
});

describe('rotateGroup', () => {
  it('turns the arrangement AND each member, not each member in place', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'c', x: 6, y: 4 }]);
    expect(rotateGroup(exec, gs, ['a', 'b', 'c'], 1).blockedBy).toBeNull();
    const xs = ['a', 'b', 'c'].map((id) => gs.objects.get(id)!.position.x);
    const ys = ['a', 'b', 'c'].map((id) => gs.objects.get(id)!.position.y);
    expect(new Set(xs).size).toBe(1);   // the row became a column
    expect(new Set(ys).size).toBe(3);
    expect(gs.objects.get('a')!.rotation).toBe(90);  // and each member turned with it
  });

  it('keeps the arrangement centred on the selection, not anchored at a corner', () => {
    // Row of three at y=4, x=4..6: centre (5.5, 4.5). The column must straddle that same centre.
    const { gs } = (() => {
      const m = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'c', x: 6, y: 4 }]);
      rotateGroup(m.exec, m.gs, ['a', 'b', 'c'], 1);
      return m;
    })();
    expect(snapshot(gs, ['a', 'b', 'c'])).toEqual([
      { id: 'a', x: 5, y: 3, rotation: 90 },
      { id: 'b', x: 5, y: 4, rotation: 90 },
      { id: 'c', x: 5, y: 5, rotation: 90 },
    ]);
  });

  it('returns every member exactly home after four turns', () => {
    // The identity that catches a footprint rotated by its anchor instead of its extent.
    const { gs, exec } = mapWith([
      { id: 'wide', x: 4, y: 4, catalogId: 'rot-wide' }, { id: 't', x: 8, y: 6 },
    ]);
    const before = snapshot(gs, ['wide', 't']);
    for (let i = 0; i < 4; i++) expect(rotateGroup(exec, gs, ['wide', 't'], 1).blockedBy).toBeNull();
    expect(snapshot(gs, ['wide', 't'])).toEqual(before);
  });

  it('returns home after four turns when the box centre is off the lattice', () => {
    // A 2x1 bounding box centres on a cell EDGE: the true centre is half a cell off the grid in
    // both axes, so the rigid arrangement is nudged half a cell. Successive nudges must cancel.
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    const before = snapshot(gs, ['a', 'b']);
    for (let i = 0; i < 4; i++) expect(rotateGroup(exec, gs, ['a', 'b'], 1).blockedBy).toBeNull();
    expect(snapshot(gs, ['a', 'b'])).toEqual(before);
  });

  it('returns home after four counter-clockwise turns, and undoes one clockwise turn', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }]);
    const before = snapshot(gs, ['a', 'b']);
    for (let i = 0; i < 4; i++) expect(rotateGroup(exec, gs, ['a', 'b'], -1).blockedBy).toBeNull();
    expect(snapshot(gs, ['a', 'b'])).toEqual(before);

    rotateGroup(exec, gs, ['a', 'b'], 1);
    rotateGroup(exec, gs, ['a', 'b'], -1);
    expect(snapshot(gs, ['a', 'b'])).toEqual(before);
  });

  it('normalises each member rotation into 0..270', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
    rotateGroup(exec, gs, ['a', 'b'], -1);
    expect(gs.objects.get('a')!.rotation).toBe(270);
    rotateGroup(exec, gs, ['a', 'b'], 1);
    expect(gs.objects.get('a')!.rotation).toBe(0);
  });

  it('carries a member that cannot rotate: its position turns, its facing does not', () => {
    const { gs, exec } = mapWith([{ id: 'house', x: 4, y: 4 }, { id: 'flower', x: 6, y: 4, catalogId: 'rot-fixed' }]);
    const res = rotateGroup(exec, gs, ['house', 'flower'], 1);
    expect(res.blockedBy).toBeNull();
    expect(res.moved).toBe(2);
    // Both turn about (5.5, 4.5); only the house's own rotation advances.
    expect(snapshot(gs, ['house', 'flower'])).toEqual([
      { id: 'house', x: 5, y: 3, rotation: 90 },
      { id: 'flower', x: 5, y: 5, rotation: 0 },
    ]);
  });

  it('refuses the whole rotation when an unrotatable member is non-square, naming it', () => {
    // A span cannot swap its extent, so carrying it reshapes the bounding box turn by turn and
    // walks the whole arrangement off its starting cells.
    const { gs, exec } = mapWith([{ id: 'house', x: 4, y: 4 }, { id: 'span', x: 8, y: 4, catalogId: 'rot-span' }]);
    const before = snapshot(gs, ['house', 'span']);
    const res = rotateGroup(exec, gs, ['house', 'span'], 1);
    expect(res.blockedBy).toBe('span');
    expect(res.moved).toBe(0);
    expect(snapshot(gs, ['house', 'span'])).toEqual(before);
    expect(res.refusal?.errors[0]?.ruleId).toBe('V-ROTATE-SPAN');
  });

  it('returns a carried member home after four turns, still unturned', () => {
    const { gs, exec } = mapWith([{ id: 'house', x: 4, y: 4 }, { id: 'flower', x: 6, y: 4, catalogId: 'rot-fixed' }]);
    const before = snapshot(gs, ['house', 'flower']);
    for (let i = 0; i < 4; i++) expect(rotateGroup(exec, gs, ['house', 'flower'], 1).blockedBy).toBeNull();
    expect(snapshot(gs, ['house', 'flower'])).toEqual(before);
  });

  it('refuses the whole rotation when a member is locked, and nothing turns', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'plaza', x: 8, y: 8, locked: true }]);
    const before = snapshot(gs, ['a', 'plaza']);
    const undos = exec.getUndoStackSize();
    const res = rotateGroup(exec, gs, ['a', 'plaza'], 1);
    expect(res.blockedBy).toBe('plaza');
    expect(res.refusal?.errors[0]?.ruleId).toBe('V-LOCK-02');
    expect(snapshot(gs, ['a', 'plaza'])).toEqual(before);
    expect(exec.getUndoStackSize()).toBe(undos);
  });

  it('refuses the whole rotation when a member lands illegally, and nothing turns', () => {
    // 'wall' is not in the group and sits where the row's rotation sends 'c'.
    const { gs, exec } = mapWith([
      { id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'c', x: 6, y: 4 }, { id: 'wall', x: 5, y: 5 },
    ]);
    const before = snapshot(gs, ['a', 'b', 'c']);
    const res = rotateGroup(exec, gs, ['a', 'b', 'c'], 1);
    expect(res.blockedBy).not.toBeNull();
    expect(res.refusal?.errors.length).toBeGreaterThan(0);
    expect(snapshot(gs, ['a', 'b', 'c'])).toEqual(before);
  });

  it('is one undo entry, and one undo puts every member back', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
    const before = snapshot(gs, ['a', 'b']);
    const undos = exec.getUndoStackSize();
    expect(rotateGroup(exec, gs, ['a', 'b'], 1).moved).toBe(2);
    expect(exec.getUndoStackSize()).toBe(undos + 1);
    exec.undo();
    expect(snapshot(gs, ['a', 'b'])).toEqual(before);
  });

  it('skips an id whose object is gone rather than throwing or blocking the rest', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
    expect(rotateGroup(exec, gs, ['a', 'ghost', 'b'], 1).moved).toBe(2);
    expect(rotateGroup(exec, gs, ['ghost'], 1)).toEqual({ moved: 0, blockedBy: null, refusal: null });
  });

  it('tracks the destination terrain, so a member turning onto a terrace takes its elevation', () => {
    const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
    // The pair rotates about (5.5, 4.5): 'a' lands on (5, 3), 'b' on (5, 5).
    setTerrain(gs, 5, 3, TerrainType.Mountain, 2);
    expect(rotateGroup(exec, gs, ['a', 'b'], 1).blockedBy).toBeNull();
    expect(gs.objects.get('a')!.position).toEqual({ x: 5, y: 3 });
    expect(gs.objects.get('a')!.elevation).toBe(2);
  });

  describe('the animation spec (what a view is asked to tween)', () => {
    it('describes the whole turn ONCE: one pivot, one sweep, every member', () => {
      // One spec, not one signal per member: a rigid body has one clock, and a view that received
      // members separately could not give them one.
      const { gs, exec } = mapWith([
        { id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'c', x: 6, y: 4 },
      ]);
      const turns: GroupRotation[] = [];
      expect(rotateGroup(exec, gs, ['a', 'b', 'c'], 1, (turn) => turns.push(turn)).moved).toBe(3);
      expect(turns.length).toBe(1);
      expect(turns[0]!.pivot).toEqual({ x: 5.5, y: 4.5 });   // the bounding-box centre members turn about
      expect(turns[0]!.sweepDeg).toBe(90);
      expect(turns[0]!.members.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    });

    it('carries the PRE-rotation footprint centre, which is what the arc starts from', () => {
      const { gs, exec } = mapWith([{ id: 'wide', x: 4, y: 4, catalogId: 'rot-wide' }, { id: 't', x: 8, y: 6 }]);
      let turn: GroupRotation | null = null;
      rotateGroup(exec, gs, ['wide', 't'], 1, (spec) => { turn = spec; });
      const spec = turn as unknown as GroupRotation;
      // The 3x1 'wide' was at (4,4): centre (5.5, 4.5). Its CENTRE is what turns rigidly (the anchor
      // does not — the extent swaps), so that is the point the animation must travel from.
      expect(spec.members[0]).toEqual({ id: 'wide', from: { x: 5.5, y: 4.5 }, spun: true });
      expect(spec.members[1]!.from).toEqual({ x: 8.5, y: 6.5 });
      // And the rotation of that start about the pivot IS where the member really landed.
      const now = gs.objects.get('wide')!.position;
      const size = getPlacedObjectSize(gs.objects.get('wide')!);
      const { pivot } = spec;
      expect(now.x + size.w / 2).toBeCloseTo(pivot.x - (spec.members[0]!.from.y - pivot.y), 10);
      expect(now.y + size.h / 2).toBeCloseTo(pivot.y + (spec.members[0]!.from.x - pivot.x), 10);
    });

    it('marks a rotatable member SPUN and a carried (non-rotatable) member NOT', () => {
      const { gs, exec } = mapWith([
        { id: 'house', x: 4, y: 4 }, { id: 'flower', x: 6, y: 4, catalogId: 'rot-fixed' },
      ]);
      let turn: GroupRotation | null = null;
      const res = rotateGroup(exec, gs, ['house', 'flower'], 1, (spec) => { turn = spec; });
      expect(res.blockedBy).toBeNull();
      expect((turn as unknown as GroupRotation).members.map((m) => ({ id: m.id, spun: m.spun })))
        .toEqual([{ id: 'house', spun: true }, { id: 'flower', spun: false }]);
    });

    it('signs the sweep by the turn direction', () => {
      const { gs, exec } = mapWith([{ id: 'a', x: 4, y: 4 }, { id: 'b', x: 6, y: 4 }]);
      let sweep = 0;
      rotateGroup(exec, gs, ['a', 'b'], -1, (spec) => { sweep = spec.sweepDeg; });
      expect(sweep).toBe(-90);
    });

    it('never fires for a rotation that refuses (an unrotatable span carries nothing)', () => {
      const { gs, exec } = mapWith([{ id: 'house', x: 4, y: 4 }, { id: 'span', x: 8, y: 4, catalogId: 'rot-span' }]);
      const turns: GroupRotation[] = [];
      const res = rotateGroup(exec, gs, ['house', 'span'], 1, (spec) => turns.push(spec));
      expect(res.blockedBy).toBe('span');
      expect(turns).toEqual([]);
    });

    it('never fires when a member lands illegally, so nothing animates a turn that did not happen', () => {
      const { gs, exec } = mapWith([
        { id: 'a', x: 4, y: 4 }, { id: 'b', x: 5, y: 4 }, { id: 'c', x: 6, y: 4 }, { id: 'wall', x: 5, y: 5 },
      ]);
      const turns: GroupRotation[] = [];
      expect(rotateGroup(exec, gs, ['a', 'b', 'c'], 1, (spec) => turns.push(spec)).moved).toBe(0);
      expect(turns).toEqual([]);
    });
  });
});

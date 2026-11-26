// @vitest-environment jsdom
/** Placed blueprint groups through random runs of placing, editing members, turning, flipping, moving,
 *  deleting, undo and redo: every undo and redo brings back the map and its groups together, and a
 *  group's own edits change nothing but what it held and what it lays. */
import { expect } from 'vitest';
import { spec } from '../../_support/spec';
import { useEditorStore } from '../../../state/store';
import { groupRefs } from '../../../state/placed-groups';
import {
  armBlueprint, flipSelectedGroup, moveSelectedGroup, placeArmedAt, saveBlueprint, turnSelectedGroup, takeBackSelectedGroup,
} from '../../../editor/editing/blueprint';
import { groupStands, liveMembers, mapGroups } from '../../../core/model/placed-group';
import type { GridState } from '../../../core/model/types';
import { TerrainType } from '../_world';
import { blueprintEditor, open, scene, shift } from './_blueprints';

blueprintEditor();
const s = () => useEditorStore.getState();

/** A small seeded generator, so a failing run can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The groups as a person can select them: each standing group's members, by id. */
function groupsOf(state: GridState): string {
  return JSON.stringify(mapGroups(state).filter((g) => groupStands(state, g)).map((g) => [g.id, groupRefs(state, g)]).sort());
}

/** Every object and every terrain cell, keyed, as it stands. */
function contents(state: GridState): Map<string, string> {
  const out = new Map<string, string>();
  for (const o of state.objects.values()) out.set(`o:${o.id}`, JSON.stringify(o));
  state.cells.forEach((row, y) => row.forEach((c, x) => { if (c.terrain) out.set(`t:${x},${y}`, JSON.stringify(c.terrain)); }));
  return out;
}

/** The keys of what a group holds, in `contents`' keys. */
function memberKeys(state: GridState): Set<string> {
  const out = new Set<string>();
  for (const g of mapGroups(state)) {
    const m = liveMembers(state, g);
    for (const o of m.objects) out.add(`o:${o.id}`);
    for (const c of m.cells) out.add(`t:${c.x},${c.y}`);
  }
  return out;
}

spec('BLUE-07', 'undo and redo keep groups and the map together, and a group edit touches only the group', async () => {
  const sc = scene();
  open(sc.w);
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(record);
  const executor = sc.w.sandbox.executor;
  const spots = [0, 6, 12].flatMap((dx) => [0, 5].map((dy) => shift(sc.free, dx, dy)));

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const next = rng(seed);
    const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(next() * xs.length)];
    const start = executor.historyDepth();
    // What the map and its groups were before each step still standing, and after each step undone.
    const done: string[] = [];
    const undone: string[] = [];
    const snap = (): string => `${sc.w.fingerprint()}|${groupsOf(sc.w.state)}`;

    for (let step = 0; step < 24; step++) {
      const state = sc.w.state;
      const before = snap();
      const depth = executor.historyDepth();
      const roll = next();
      const standing = mapGroups(state).filter((g) => groupStands(state, g));
      const group = pick(standing);
      if (roll < 0.15 && executor.historyDepth() > start) {
        executor.undoEdit();
        expect(snap(), `seed ${seed} step ${step}: undo`).toBe(done.pop());
        undone.push(before);
        continue;
      }
      if (roll < 0.25 && undone.length > 0) {
        executor.redoEdit();
        expect(snap(), `seed ${seed} step ${step}: redo`).toBe(undone.pop());
        done.push(before);
        continue;
      }
      if (roll < 0.45 || !group) {
        armBlueprint(record.id);
        s().turnArmedBlueprintBy(Math.floor(next() * 4));
        if (next() < 0.5) s().flipArmedBlueprint();
        placeArmedAt(pick(spots)!);
      } else if (roll < 0.55) {
        const o = pick(liveMembers(state, group).objects);
        if (o) sc.w.remove(o.id);
      } else if (roll < 0.62) {
        const c = pick(liveMembers(state, group).cells);
        if (c) sc.w.stroke([{ x: c.x, y: c.y }], TerrainType.Mountain, c.laid.elevation + 1);
      } else {
        s().setSelection(groupRefs(state, group), { record: false });
        const was = contents(state);
        const held = memberKeys(state);
        const op = next();
        if (op < 0.3) turnSelectedGroup(next() < 0.5 ? 1 : -1);
        else if (op < 0.5) flipSelectedGroup();
        else if (op < 0.8) moveSelectedGroup(pick(spots)!);
        else takeBackSelectedGroup();
        // Nothing changed but what a group held before or holds now.
        const now = contents(sc.w.state);
        const holds = memberKeys(sc.w.state);
        for (const key of new Set([...was.keys(), ...now.keys()])) {
          if (was.get(key) !== now.get(key)) expect(held.has(key) || holds.has(key), `seed ${seed} step ${step}: ${key} touched`).toBe(true);
        }
      }
      if (executor.historyDepth() > depth) {
        done.push(before);
        undone.length = 0;
      } else {
        // Every change is a step of its own, a turn or move of a group just placed included.
        expect(snap(), `seed ${seed} step ${step}: a change without a step`).toBe(before);
      }
    }
    while (executor.historyDepth() > start) executor.undoEdit();
    expect(groupsOf(sc.w.state), `seed ${seed}: all undone`).toBe('[]');
  }
});

/** The map, every group's whole record (id, blueprint, name, Adapted from, frame and members) and
 *  the selection, as they stand. */
function look(sc: ReturnType<typeof scene>): { map: string; groups: string; selection: string } {
  return { map: sc.w.fingerprint(), groups: JSON.stringify(sc.w.state.groups ?? []), selection: JSON.stringify(s().selection) };
}

/** The scene's sample saved, then placed once on open ground beside it, selected whole; with the
 *  look of the map before the placement. */
async function placedOnce(): Promise<{ sc: ReturnType<typeof scene>; before: ReturnType<typeof look> }> {
  const sc = scene();
  open(sc.w);
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(record);
  armBlueprint(record.id);
  const before = look(sc);
  placeArmedAt(sc.free);
  return { sc, before };
}

const edits: [string, (sc: ReturnType<typeof scene>) => boolean][] = [
  ['move', (sc) => moveSelectedGroup(shift(sc.free, 6, 0))],
  ['turn', () => turnSelectedGroup(1)],
];

for (const [name, edit] of edits) {
  spec('BLUE-07', `a ${name} of a group just placed is an undo step of its own: undo gives the group back where it was placed, whole and selected as before the ${name}`, async () => {
    const { sc, before } = await placedOnce();
    const placed = look(sc);
    const group = mapGroups(sc.w.state)[0]!;
    expect(s().selection).toEqual(groupRefs(sc.w.state, group));
    expect(edit(sc)).toBe(true);
    const done = look(sc);
    expect(done.map).not.toBe(placed.map);
    // Wherever it is laid again the group keeps its id, blueprint, name and Adapted from.
    expect(mapGroups(sc.w.state).map((g) => [g.id, g.blueprint, g.name, g.origin])).toEqual([[group.id, group.blueprint, group.name, group.origin]]);

    sc.w.undo();
    expect(look(sc), 'one undo gives back the group as placed, selected whole').toEqual(placed);
    sc.w.undo();
    expect(look(sc).map, 'a second undo takes the placement back').toBe(before.map);
    expect(look(sc).groups).toBe(before.groups);
    sc.w.redo();
    expect(look(sc), 'redo lays the placement again').toEqual(placed);
    sc.w.redo();
    expect(look(sc), 'a second redo repeats the ' + name).toEqual(done);
  });
}

spec('BLUE-07', 'each move of a group is one undo step: undo walks it back one move at a time, and redo replays them in order', async () => {
  const { sc } = await placedOnce();
  const steps = [look(sc)];
  for (const dx of [6, 12, 6]) {
    expect(moveSelectedGroup(shift(sc.free, dx, 5))).toBe(true);
    steps.push(look(sc));
  }
  for (let i = steps.length - 2; i >= 0; i--) {
    sc.w.undo();
    expect(look(sc), `undo back to step ${i}`).toEqual(steps[i]);
  }
  for (let i = 1; i < steps.length; i++) {
    sc.w.redo();
    expect(look(sc), `redo to step ${i}`).toEqual(steps[i]);
  }
});

spec('BLUE-07', 'a placement, a move of it and taking it back each reach the map\'s listeners as one change of objects, one undo step each, the selection following', async () => {
  const sc = scene();
  open(sc.w);
  const record = await saveBlueprint({ frame: sc.frame, name: 'Terrace', author: 'Mei', folder: null });
  if (typeof record === 'string') throw new Error(record);
  armBlueprint(record.id);
  let changes = 0;
  sc.w.sandbox.bus.on('objects-changed', () => { changes++; });
  const depth = () => sc.w.sandbox.executor.historyDepth();
  const step = (name: string, act: () => unknown): ReturnType<typeof look> => {
    const before = look(sc);
    const d = depth();
    changes = 0;
    act();
    expect(changes, `${name}: changes heard`).toBe(1);
    expect(depth(), `${name}: undo steps`).toBe(d + 1);
    const after = look(sc);
    sc.w.undo();
    expect(look(sc).map, `${name}: undo restores the map`).toBe(before.map);
    expect(look(sc).groups, `${name}: undo restores the groups`).toBe(before.groups);
    sc.w.redo();
    expect(look(sc).map, `${name}: redo lays it again`).toBe(after.map);
    expect(look(sc).groups, `${name}: redo restores the groups`).toBe(after.groups);
    return after;
  };

  step('place', () => placeArmedAt(sc.free));
  const group = () => mapGroups(sc.w.state)[0]!;
  s().setSelection(groupRefs(sc.w.state, group()), { record: false });
  expect(s().selection).toEqual(groupRefs(sc.w.state, group()));
  step('move', () => expect(moveSelectedGroup(shift(sc.free, 6, 0))).toBe(true));
  expect(s().selection, 'the moved group stays selected whole').toEqual(groupRefs(sc.w.state, group()));
  s().setSelection(groupRefs(sc.w.state, group()), { record: false });
  step('take-back', () => expect(takeBackSelectedGroup()).toBe(true));
  expect(s().selection, 'nothing is selected once the group is taken back').toEqual([]);
});

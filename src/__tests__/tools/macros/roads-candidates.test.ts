/**
 * PRESS AGAIN FOR ANOTHER WAY: the whole-map roads press hands back a different candidate each time,
 * takes its OWN last one back to do it, and touches nothing else.
 *
 * A SEED THE ROUTER DOES NOT READ makes the press seed-invariant: five seeds over the fixture below
 * laid the same 679 cells, Jaccard 1.000 across every pair. `network-variation.ts` gives the seed four
 * decisions to land on, behind `NetworkOptions.variation` so generation (which runs this same router and
 * is hash-pinned) cannot see them.
 *
 * ON A REAL HAND-BUILT MAP. `hand-terraced-hexia.json` is a person's own island: many small
 * plateaus, houses on raised ground, a river, a plaza in its own court. Every earlier road pin but
 * `roads-hand-terraced.ts` builds its fixture with the GENERATOR, and a generated island's broad
 * rooms hide most of what a person's terracing asks of a router.
 *
 * A VARIANT THAT IS MERELY DIFFERENT IS A BUG, so every case below measures the candidate as well as
 * the difference: every house served, one piece, no orphan crossing, nothing hand-placed lost.
 */
import { describe, expect, it } from 'vitest';
// @ts-ignore - node:fs is untyped in this project (no @types/node)
import { readFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { cellKey, NEIGHBORS4 } from '../../../core/model/grid-model';
import { ItemCategory, type EditorEvents, type GridState, type PlacedObject } from '../../../core/model/types';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { deserialize } from '../../../io/json-codec';
import { categoryOf, getCatalogItem } from '../../../state/catalog';
import { getObjectIndex, roadLookup } from '../../../state/object-index';
import { objectRect } from '../../../state/object-geometry';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { applyMacro } from '../../../tools/macros';
import { pressRoadNetwork } from '../../../kit/operations/road-press';
import type { KitContext } from '../../../kit/context';

const FIXTURE = 'src/__tests__/fixtures/road-maps/hand-terraced-hexia.json'; // vitest runs from the repo root

interface Kit extends KitContext { executor: CommandExecutor }

function loadMap(): Kit {
  const template = getMapTemplate('hexia');
  const state = deserialize(readFileSync(FIXTURE, 'utf8'), template) as unknown as GridState;
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

const houses = (state: GridState): PlacedObject[] => [...state.objects.values()]
  .filter((o) => !o.locked && getCatalogItem(o.catalogId)?.category === ItemCategory.Building);
const crossings = (state: GridState): PlacedObject[] => [...state.objects.values()]
  .filter((o) => categoryOf(o) === ItemCategory.Bridge || categoryOf(o) === ItemCategory.Ramp);
const name = (o: PlacedObject): string => `${o.catalogId}@${o.position.x},${o.position.y}`;

/** Every cell the network covers: pavement plus each crossing's deck. */
function networkCells(state: GridState): Set<string> {
  const out = new Set<string>();
  for (const o of state.objects.values()) {
    const cat = categoryOf(o);
    if (cat !== ItemCategory.Road && cat !== ItemCategory.Bridge && cat !== ItemCategory.Ramp) continue;
    const r = objectRect(o);
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) out.add(`${x},${y}`);
  }
  return out;
}

const jaccard = (a: ReadonlySet<string>, b: ReadonlySet<string>): number => {
  let inter = 0;
  for (const k of a) if (b.has(k)) inter++;
  return inter / (a.size + b.size - inter);
};

function pavedNear(state: GridState, o: PlacedObject, pad: number): boolean {
  const { roadByCell } = getObjectIndex(state);
  const r = objectRect(o);
  for (let y = Math.floor(r.y) - pad; y <= Math.ceil(r.y + r.h) + pad - 1; y++) {
    for (let x = Math.floor(r.x) - pad; x <= Math.ceil(r.x + r.w) + pad - 1; x++) {
      if (roadByCell.has(cellKey(x, y))) return true;
    }
  }
  return false;
}

/** The walk a finished network offers, as a component id per cell: pavement, decks, and each deck's
 *  one-cell apron (the `flat` trait refuses a tile at a transition often enough that a bare cell
 *  there is the design's documented neck, not a break). */
function pavementComponents(state: GridState, W: number, H: number): Map<number, number> {
  const walk = new Set<number>();
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  for (const o of state.objects.values()) {
    const cat = categoryOf(o);
    const crossing = cat === ItemCategory.Bridge || cat === ItemCategory.Ramp;
    if (cat !== ItemCategory.Road && !crossing) continue;
    const r = objectRect(o);
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
      if (!inB(x, y)) continue;
      walk.add(y * W + x);
      if (crossing) for (const [dx, dy] of NEIGHBORS4) if (inB(x + dx, y + dy)) walk.add((y + dy) * W + (x + dx));
    }
  }
  const comp = new Map<number, number>();
  let next = 0;
  for (const s of walk) {
    if (comp.has(s)) continue;
    const id = next++;
    comp.set(s, id);
    const queue = [s];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!, x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        if (!inB(x + dx, y + dy)) continue;
        const ni = (y + dy) * W + (x + dx);
        if (walk.has(ni) && !comp.has(ni)) { comp.set(ni, id); queue.push(ni); }
      }
    }
  }
  return comp;
}

function componentsAround(comp: Map<number, number>, rect: { x: number; y: number; w: number; h: number }, W: number, pad: number): Set<number> {
  const out = new Set<number>();
  for (let y = Math.floor(rect.y) - pad; y <= Math.ceil(rect.y + rect.h) + pad - 1; y++) {
    for (let x = Math.floor(rect.x) - pad; x <= Math.ceil(rect.x + rect.w) + pad - 1; x++) {
      const c = comp.get(y * W + x);
      if (c !== undefined) out.add(c);
    }
  }
  return out;
}

/** Everything the acceptance standard asks of ONE candidate, whichever press produced it. */
function expectGoodCandidate(kit: Kit, label: string): void {
  const W = kit.state.template.width, H = kit.state.template.height;
  const unserved = houses(kit.state).filter((h) => !pavedNear(kit.state, h, 2)).map(name);
  expect(unserved, `${label}: houses with no pavement at them`).toEqual([]);

  const comp = pavementComponents(kit.state, W, H);
  const plaza = [...kit.state.objects.values()].find((o) => o.locked)!;
  const plazaComps = componentsAround(comp, objectRect(plaza), W, 1);
  expect(plazaComps.size, `${label}: no pavement reaches the plaza`).toBeGreaterThan(0);
  for (const h of houses(kit.state)) {
    const shared = [...componentsAround(comp, objectRect(h), W, 2)].some((c) => plazaComps.has(c));
    expect(shared, `${label}: ${name(h)} is not on the plaza's own network`).toBe(true);
  }
  const orphans = crossings(kit.state).filter((c) => !pavedNear(kit.state, c, 1)).map(name);
  expect(orphans, `${label}: crossings with no pavement at either end`).toEqual([]);
}

describe('one press, more than one way to pave it', () => {
  /**
   * The measurement that is the acceptance criterion. Held at a threshold well clear of both ends:
   * 1.000 was the defect, and a matrix that drifted back toward it would mean the seed had stopped
   * reaching the decisions that shape a layout. The observed spread is 0.26 to 0.47.
   */
  it('five seeds lay five different networks, and every one of them is a good one', () => {
    const shots: Set<string>[] = [];
    for (const seed of [1, 2, 3, 4, 5]) {
      const kit = loadMap();
      const standing = new Set(kit.state.objects.keys());
      const before = networkCells(kit.state);
      const outcome = applyMacro(kit, 'roads', { seed });
      expect(outcome.changes, `seed ${seed}: ${outcome.reason ?? ''}`).toBeGreaterThan(0);

      expectGoodCandidate(kit, `seed ${seed}`);
      for (const id of standing) expect(kit.state.objects.has(id), `seed ${seed}: ${id} was removed`).toBe(true);

      const laid = networkCells(kit.state);
      for (const k of before) laid.delete(k);
      expect(laid.size, `seed ${seed} laid nothing`).toBeGreaterThan(200);
      shots.push(laid);
    }
    for (let i = 0; i < shots.length; i++) {
      for (let j = i + 1; j < shots.length; j++) {
        const j2 = jaccard(shots[i]!, shots[j]!);
        expect(j2, `seeds ${i + 1} and ${j + 1} lay the same network (jaccard ${j2.toFixed(3)})`).toBeLessThan(0.75);
      }
    }
  }, 120000);

  it('the same seed lays the same network, every time', () => {
    const shot = (): string => {
      const kit = loadMap();
      applyMacro(kit, 'roads', { seed: 4 });
      return [...networkCells(kit.state)].sort().join('|');
    };
    const first = shot();
    expect(first.length, 'the fixture laid nothing to compare').toBeGreaterThan(0);
    for (let n = 0; n < 3; n++) expect(shot()).toBe(first);
  }, 120000);
});

describe('a re-press replaces its own last answer', () => {
  // Every case loads its own map, and the press's memory keys off the map it was pressed on, so
  // none of them can inherit another's ids or seed.

  it('three presses leave three candidates, not three networks piled up', () => {
    const kit = loadMap();
    const standing = new Set(kit.state.objects.keys());
    const depth = kit.executor.getUndoStackSize();

    const first = pressRoadNetwork(kit, {});
    expect(first.outcome.changes, first.outcome.reason ?? '').toBeGreaterThan(0);
    expect(first.nth).toBe(1);
    const firstCells = networkCells(kit.state);
    expectGoodCandidate(kit, 'press 1');
    expect(kit.executor.getUndoStackSize(), 'a press is one undo entry').toBe(depth + 1);

    const sizes = [firstCells.size];
    for (const nth of [2, 3]) {
      const again = pressRoadNetwork(kit, {});
      expect(again.outcome.changes, `press ${nth}: ${again.outcome.reason ?? ''}`).toBeGreaterThan(0);
      expect(again.outcome.code, `press ${nth} reported a refusal`).toBeUndefined();
      expect(again.nth, 'the press count is what the shell narrates from').toBe(nth);
      expectGoodCandidate(kit, `press ${nth}`);
      expect(kit.executor.getUndoStackSize(), `press ${nth} is one undo entry`).toBe(depth + nth);
      sizes.push(networkCells(kit.state).size);
    }

    // THE PREVIOUS CANDIDATE IS GONE, not buried: the map holds ONE candidate's worth of pavement
    // however many times it was pressed. A press that added would grow this without bound.
    expect(Math.max(...sizes), `network sizes across three presses: ${sizes.join(', ')}`)
      .toBeLessThan(sizes[0]! * 1.5);
    // And it IS another candidate rather than the same one relaid.
    expect(jaccard(firstCells, networkCells(kit.state))).toBeLessThan(0.75);

    // NOTHING A HAND PLACED IS TAKEN AWAY BY ANY OF THEM.
    for (const id of standing) expect(kit.state.objects.has(id), `${id} did not survive three presses`).toBe(true);

    // Three presses, three undos, back to the map as it stood.
    for (let n = 0; n < 3; n++) expect(kit.executor.undo(), `undo ${n + 1}`).toBe(true);
    expect(kit.executor.getUndoStackSize()).toBe(depth);
    expect(networkCells(kit.state).size, 'undo left pavement standing').toBe(0);
    expect(new Set(kit.state.objects.keys())).toEqual(standing);
  }, 180000);

  it('a road the user painted is not the press\'s to take back', () => {
    const kit = loadMap();
    // Far from every house, so it joins nothing and the router has no reason to pave over it: what
    // is measured is whether the take-back can reach an object it never created. Found at runtime
    // rather than written down, since a spot on this island is the fixture's to choose.
    const far = houses(kit.state).map((h) => h.position);
    let hand: PlacedObject | null = null;
    for (let y = 2; y < kit.state.template.height - 2 && !hand; y += 1) {
      for (let x = 2; x < kit.state.template.width - 2 && !hand; x += 1) {
        if (far.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 25)) continue;
        const obj: PlacedObject = {
          id: 'hand-painted-road', catalogId: 'path-overgrown-dirt', position: { x, y }, rotation: 0, elevation: 0,
        };
        if (kit.executor.execute(objectPlacementCommand(obj)).success) hand = obj;
      }
    }
    expect(hand, 'nowhere on the island took a hand-painted road tile').not.toBeNull();

    expect(pressRoadNetwork(kit, {}).outcome.changes).toBeGreaterThan(0);
    expect(pressRoadNetwork(kit, {}).outcome.changes).toBeGreaterThan(0);
    expect(pressRoadNetwork(kit, {}).outcome.changes).toBeGreaterThan(0);

    expect(kit.state.objects.has(hand!.id), 'the hand-painted road was taken back with the press\'s own')
      .toBe(true);
  }, 180000);

  it('with no memory of its own work, a press behaves exactly as a first press does', () => {
    // The state after a reload: the roads stand, and their ids are gone. `applyMacro` with no
    // `replace` is that caller, and `already-connected` remains the honest answer for it.
    const kit = loadMap();
    expect(applyMacro(kit, 'roads', { seed: 1 }).changes).toBeGreaterThan(0);
    const again = applyMacro(kit, 'roads', { seed: 2 });
    expect(again.changes).toBe(0);
    expect(again.code, again.reason ?? '').toBe('already-connected');
  }, 120000);

  it('a press over a painted region takes back only what stands inside it', () => {
    const kit = loadMap();
    const first = pressRoadNetwork(kit, {});
    expect(first.outcome.changes).toBeGreaterThan(0);
    const before = networkCells(kit.state);

    // A small region in one corner of the island. Whatever the run makes of it, the streets on the
    // far side of the map are not this press's to strip.
    const region = [];
    for (let y = 20; y < 40; y++) for (let x = 20; x < 40; x++) region.push({ x, y });
    pressRoadNetwork(kit, { region });

    const outside = [...before].filter((k) => {
      const [x, y] = k.split(',').map(Number) as [number, number];
      return x < 20 || x >= 40 || y < 20 || y >= 40;
    });
    expect(outside.length, 'the fixture put no pavement outside the region').toBeGreaterThan(50);
    const after = networkCells(kit.state);
    const stripped = outside.filter((k) => !after.has(k));
    expect(stripped, 'a regioned press stripped pavement outside its own region').toEqual([]);
  }, 180000);
});

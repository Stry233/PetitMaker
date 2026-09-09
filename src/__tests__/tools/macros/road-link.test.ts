/**
 * `road-link`: two taps lay one route between them, or one tap on a building spurs it to the
 * network — driven through the real `applyMacro` path (build → replay → commit), same as every
 * other macro. Fixture style follows `macro-quality.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { makeState, setTerrain } from '../../rules/_helpers';
import { roadLookup } from '../../../state/object-index';
import { categoryOf } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { buildingGate } from '../../../tools/placement/object';
import { gateTerminalCells } from '../../../tools/placement/route';
import { generateObjectId } from '../../../core/model/object-id';
import {
  CellZone, ItemCategory, TerrainType,
  type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';
import { applyMacro } from '../../../tools/macros';
import { routeWorld } from '../../../tools/macros/route-world';
import type { KitContext } from '../../../kit/context';

const SIZE = 45;
const SHORE = 3;

interface Kit extends KitContext { executor: CommandExecutor }

/** An open, flat, buildable map with a sea border — same shape as `macro-quality.test.ts`'s
 *  `makeKit`, without the cone (road-link has no terrain-reading probe to satisfy). */
function makeKit(size = SIZE): Kit {
  const state = makeState(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < SHORE || y < SHORE || x >= size - SHORE || y >= size - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

function place(kit: Kit, catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): PlacedObject {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation, elevation: 0 };
  const r = kit.executor.execute(objectPlacementCommand(obj));
  expect(r.success, `place ${catalogId}@${x},${y}: ${r.errors?.[0]?.message ?? ''}`).toBe(true);
  return obj;
}

/** Every Road/Bridge/Ramp-category object currently on the map, as `MacroCoord`s. */
function roadCells(state: GridState): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (const o of state.objects.values()) {
    const cat = categoryOf(o);
    if (cat === ItemCategory.Road || cat === ItemCategory.Bridge || cat === ItemCategory.Ramp) out.push(o.position);
  }
  return out;
}

const chebyshev = (a: MacroCoord, b: MacroCoord): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

describe('road-link: two taps', () => {
  it('lays one road between them, in one undo entry', () => {
    const kit = makeKit();
    const depth = kit.executor.getUndoStackSize();
    const from = { x: 10, y: 10 }, to = { x: 30, y: 10 };

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to, width: 1 });

    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(kit.executor.getUndoStackSize()).toBe(depth + 1);
  });

  it('reaches both taps', () => {
    const kit = makeKit();
    const from = { x: 10, y: 10 }, to = { x: 30, y: 10 };
    applyMacro(kit, 'road-link', { seed: 1, from, at: to, width: 1 });

    const cells = roadCells(kit.state);
    expect(cells.some((c) => chebyshev(c, from) <= 1), 'a coating within one cell of the first tap').toBe(true);
    expect(cells.some((c) => chebyshev(c, to) <= 1), 'a coating within one cell of the second tap').toBe(true);
  });

  it('lays roads, bridges and ramps, and nothing else', () => {
    const kit = makeKit();
    // A ford: 4-wide water strip, capped top+bottom by mountain at elev 1 so it has no exposed
    // face (same fixture shape as network.test.ts's own ford) — a run that must bridge to connect.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 20; x <= 23; x++) {
        if (y < 15 || y > 24) setTerrain(kit.state, x, y, TerrainType.Mountain, 1);
        else setTerrain(kit.state, x, y, TerrainType.Water, 0);
      }
    }
    const from = { x: 10, y: 19 }, to = { x: 33, y: 19 };
    const before = new Set(kit.state.objects.keys());
    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to, width: 1 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    for (const [id, o] of kit.state.objects) {
      if (before.has(id)) continue;
      const cat = categoryOf(o);
      expect([ItemCategory.Road, ItemCategory.Bridge, ItemCategory.Ramp], `${o.catalogId} is not a road/bridge/ramp`)
        .toContain(cat);
    }
  });

  it('bridges a water gap rather than walking round', () => {
    const kit = makeKit();
    // A ford: 4-wide water strip, capped top+bottom by mountain at elev 1 so it has no exposed
    // face (same fixture shape as network.test.ts's own ford).
    for (let y = 0; y < SIZE; y++) {
      for (let x = 20; x <= 23; x++) {
        if (y < 15 || y > 24) setTerrain(kit.state, x, y, TerrainType.Mountain, 1);
        else setTerrain(kit.state, x, y, TerrainType.Water, 0);
      }
    }
    const from = { x: 10, y: 19 }, to = { x: 33, y: 19 };
    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to, width: 1 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    const bridges = [...kit.state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Bridge);
    expect(bridges.length, 'a bridge stands over the ford').toBeGreaterThan(0);
    const cells = roadCells(kit.state);
    expect(cells.some((c) => chebyshev(c, from) <= 2), 'the route reaches the west bank').toBe(true);
    expect(cells.some((c) => chebyshev(c, to) <= 2), 'the route reaches the east bank').toBe(true);
  });

  it('leaves a plant on the only line standing, and reports it', () => {
    const kit = makeKit();
    // A wide lake (too deep for any bridge span) crossed by a dry causeway three cells wide — the
    // placement analysis only reads a cell "open" when its whole 8-neighbourhood shares its level
    // (`analysis.ts`'s level-interior test), so a ONE-wide strip would never register as open at
    // all; three wide leaves exactly its centre column open, the only 4-connected path north-south.
    // A tree sits ON that column.
    for (let y = 15; y <= 24; y++) {
      for (let x = SHORE; x < SIZE - SHORE; x++) {
        if (x >= 19 && x <= 21) continue;
        setTerrain(kit.state, x, y, TerrainType.Water, 0);
      }
    }
    const tree = place(kit, 'tree-appletree', 20, 19);
    const from = { x: 20, y: 6 }, to = { x: 20, y: 38 };

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to, width: 1 });

    expect(kit.state.objects.has(tree.id), 'the standing tree survives').toBe(true);
    expect(outcome.blocked ?? [], 'blocked names the tree\'s cell').toContainEqual({ x: 20, y: 19 });
  });

  it('the offer index chooses, and clamps out of range', () => {
    const kit = makeKit();
    // A wall of decorations blocks the direct row; a lake sits just above it, so going up and over
    // hugs the water while going down and under does not (route-offers.test.ts's own fixture).
    for (let x = 15; x <= 25; x++) place(kit, 'flower-daisy', x, 20);
    for (let x = 15; x <= 25; x++) setTerrain(kit.state, x, 18, TerrainType.Water, 0);
    const from = { x: 10, y: 20 }, to = { x: 30, y: 20 };

    const laidCells = (opts: Record<string, unknown>): Set<string> => {
      const run = makeKitFrom(kit.state);
      applyMacro(run, 'road-link', { seed: 1, from, at: to, ...opts });
      return new Set(roadCells(run.state).map((c) => `${c.x},${c.y}`));
    };
    const first = laidCells({ offer: 0 });
    const second = laidCells({ offer: 1 });
    expect(first.size).toBeGreaterThan(0);
    expect(second.size).toBeGreaterThan(0);
    expect([...first].sort().join('|')).not.toBe([...second].sort().join('|'));

    // A wildly out-of-range offer clamps into range rather than throwing.
    expect(() => laidCells({ offer: 99 })).not.toThrow();
  });

  it('the same taps on the same map lay the same road', () => {
    const shape = (): string => {
      const kit = makeKit();
      applyMacro(kit, 'road-link', { seed: 1, from: { x: 10, y: 10 }, at: { x: 30, y: 10 }, width: 1 });
      return roadCells(kit.state).map((c) => `${c.x},${c.y}`).sort().join('|');
    };
    expect(shape()).toBe(shape());
  });

  it('picks the standing street\'s material, then the caller\'s own', () => {
    const kit = makeKit();
    place(kit, 'path-park-stone', 30, 10);
    const from = { x: 10, y: 10 }, to = { x: 29, y: 12 };

    const learned = makeKitFrom(kit.state);
    applyMacro(learned, 'road-link', { seed: 1, from, at: to, width: 1 });
    const laid = [...learned.state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
    expect(laid.length).toBeGreaterThan(0);
    expect(laid.every((o) => o.catalogId === 'path-park-stone'), 'learned the nearest street\'s material').toBe(true);

    const forced = makeKitFrom(kit.state);
    applyMacro(forced, 'road-link', { seed: 1, from, at: to, width: 1, material: 'path-simple-brick' });
    const laidForced = [...forced.state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
    expect(laidForced.some((o) => o.catalogId === 'path-simple-brick'), 'the caller\'s own material wins').toBe(true);
  });
});

describe('road-link: building endpoints', () => {
  it.each([0, 90, 180, 270] as const)('resolves rotated buildings to their entrances before routing (%i°)', rotation => {
    const kit = makeKit();
    const from = place(kit, 'building-forest-cabin', 10, 10, rotation);
    const to = place(kit, 'building-sunset-cabin', 28, 26, rotation);
    const outcome = applyMacro(kit, 'road-link', {
      seed: 1, from: { x: 11, y: 11 }, at: { x: 29, y: 27 }, width: 2,
    });
    expect(outcome.changes, JSON.stringify(outcome)).toBeGreaterThan(0);
    for (const [i, building] of [from, to].entries()) {
      expect(gateTerminalCells(objectRect(building), rotation)).toContainEqual(outcome.ends?.[i]);
      expect(kit.state.objects.get(building.id)).toEqual(building);
    }
    expect(kit.registry.validatePostStroke(kit.state)).toEqual([]);
  });
});

describe('road-link: one tap on a building', () => {
  it('connects the gate', () => {
    const kit = makeKit();
    const house = place(kit, 'building-myhouse', 18, 20, 0);
    const outcome = applyMacro(kit, 'road-link', { seed: 1, at: { x: house.position.x + 3, y: house.position.y + 1 } });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    const { clear } = buildingGate(objectRect(house), house.rotation);
    const gateHasRoad = clear.some((c) => roadCells(kit.state).some((r) => r.x === c.x && r.y === c.y));
    expect(gateHasRoad, 'a cell of the gate strip carries a road').toBe(true);
  });

  it('a door with no way through reports AT the door', () => {
    const kit = makeKit();
    // Gate faces NORTH (rotation 180): the flat trait only extends the house's OWN placement
    // check past its right/bottom edge, so water immediately north of the footprint does not
    // block the house from standing — only its door.
    const house = place(kit, 'building-myhouse', 18, 20, 180);
    for (let x = 17; x <= 25; x++) setTerrain(kit.state, x, 19, TerrainType.Water, 0);

    const outcome = applyMacro(kit, 'road-link', { seed: 1, at: { x: house.position.x + 3, y: house.position.y + 1 } });

    expect(outcome.code).toBe('door-unreachable');
    const { clear } = buildingGate(objectRect(house), house.rotation);
    expect(outcome.at, 'the report names a cell of the gate strip').toBeDefined();
    expect(clear.some((c) => c.x === outcome.at!.x && c.y === outcome.at!.y)).toBe(true);
  });

  /** `ensureGateTerminals`' "already terminates" check cannot trust a `PlaceCtx.roads` Set that
   *  `widenRoads` (a bare `executor.execute`, never `tryPlace`) does not update: a spur wide enough to
   *  widen straight over its own gate strip then stacks a second road object there, the corruption class
   *  `road-stack.test.ts` guards for the sibling `roads` macro. */
  it('a spur press never stacks two road objects on one cell (width > 1)', () => {
    const kit = makeKit();
    const house = place(kit, 'building-myhouse', 18, 20, 0);
    const outcome = applyMacro(kit, 'road-link', { seed: 1, at: { x: house.position.x + 3, y: house.position.y + 1 }, width: 3 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    const counts = new Map<string, number>();
    for (const o of kit.state.objects.values()) {
      if (categoryOf(o) !== ItemCategory.Road) continue;
      const key = `${o.position.x},${o.position.y}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
  });

  it('a gate that already meets pavement reports already-connected, and builds nothing', () => {
    const kit = makeKit();
    const house = place(kit, 'building-myhouse', 18, 20, 0);
    // The approach cell, already paved — as if an earlier press already reached this door.
    place(kit, 'path-cobblestone', 21, 24);
    const before = [...kit.state.objects.keys()].sort();

    const outcome = applyMacro(kit, 'road-link', { seed: 1, at: { x: house.position.x + 3, y: house.position.y + 1 } });

    expect(outcome.code).toBe('already-connected');
    expect(outcome.changes).toBe(0);
    expect([...kit.state.objects.keys()].sort()).toEqual(before);
  });

  it('a tap on open ground (nothing to connect) reports nothing-to-connect', () => {
    const kit = makeKit();
    const outcome = applyMacro(kit, 'road-link', { seed: 1, at: { x: 20, y: 20 } });
    expect(outcome.code).toBe('nothing-to-connect');
    expect(outcome.changes).toBe(0);
  });
});

describe('routeWorld', () => {
  /** The cache key has to carry `near`: `style.materialId` ("the nearest standing street") is a function
   *  of it, so a key of `${cellsVersion}|${objectsVersion}|${regionKey}` alone answers a second call on
   *  the same unedited map with the first call's material. */
  it('reads the material nearest EACH call\'s own `near`, not a stale cache hit', () => {
    const kit = makeKit();
    place(kit, 'path-park-stone', 5, 5);
    place(kit, 'path-simple-brick', 40, 40);

    const nearStone = routeWorld(kit, { seed: 1, near: { x: 6, y: 6 } });
    const nearBrick = routeWorld(kit, { seed: 1, near: { x: 39, y: 39 } });

    expect(nearStone.style.materialId).toBe('path-park-stone');
    expect(nearBrick.style.materialId).toBe('path-simple-brick');
  });
});

/** A fresh kit sharing `state`'s terrain/objects (cloned via a plain state re-wrap) — for comparing
 *  two runs from the SAME starting map without one run's edits leaking into the other. */
function makeKitFrom(state: GridState): Kit {
  const clone: GridState = {
    template: state.template,
    cells: state.cells.map((row) => row.map((c) => ({ ...c, terrain: c.terrain ? { ...c.terrain } : null }))),
    objects: new Map([...state.objects].map(([id, o]) => [id, { ...o }])),
    lockedLayers: new Set(state.lockedLayers),
  };
  const executor = new CommandExecutor(clone, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(clone));
  return { state: clone, executor, registry: executor.getRegistry() };
}

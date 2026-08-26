/**
 * THE ROADS PRESS ON A HAND-BUILT TERRACED MAP, which is the map this feature was reported broken
 * on and the one shape none of its other fixtures had. Every earlier road pin builds its island
 * with the GENERATOR, and a generated island has a handful of broad rooms with the plaza sitting in
 * the middle of the largest of them. A person terraces instead: many small rectangular plateaus with
 * sharp edges, houses standing on raised ground, and a plaza in a court of its own.
 *
 * `hand-terraced-hexia.json` is a real such map, in the app's own save format (its provenance ledger
 * stripped, its object ids renamed), loaded through the ordinary `deserialize`. It decomposes into
 * 38 open regions, and the ONE fact the press turns on is asserted below before any press is made: the
 * plaza's own court is not the map's largest region. A `hubNode` that answers that question with
 * `rankedRegions[0]` plans every portal chain out of a region the plaza cannot reach, and each realized
 * ramp then A*-es toward a network on the far side of a cliff — which on this map lays 55 tiles in one
 * box around the plaza, scatters 12 crossings joined to nothing, serves none of the 8 houses, and leaves
 * the next press reporting that it can find no open ground.
 */
import { describe, expect, it } from 'vitest';
// @ts-ignore - node:fs is untyped in this project (no @types/node)
import { readFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { CellZone, ItemCategory, type EditorEvents, type GridState, type PlacedObject } from '../../../core/model/types';
import { cellKey, NEIGHBORS4 } from '../../../core/model/grid-model';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { deserialize } from '../../../io/json-codec';
import { categoryOf, getCatalogItem } from '../../../state/catalog';
import { getObjectIndex, roadLookup } from '../../../state/object-index';
import { objectRect } from '../../../state/object-geometry';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { applyMacro } from '../../../tools/macros';
import { analyzeTerrain } from '../../../tools/placement/analysis';
import { hubNode } from '../../../tools/macros/road-paving';
import { makeState } from '../../rules/_helpers';
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

const name = (o: PlacedObject): string => `${o.catalogId}@${o.position.x},${o.position.y}`;

/** Whether pavement stands within `pad` cells of a footprint. */
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

/** The walk a finished network offers: road surfaces, crossing decks, and each deck's one-cell
 *  apron (the `flat` trait refuses a tile at a transition often enough that a bare cell there is
 *  the design's own documented neck, not a break). Returns the component id per cell. */
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

/** The components pavement around `rect` belongs to. */
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

describe('the fixture is the map that broke: a hand-terraced island', () => {
  it('is many small plateaus, houses on raised ground, and a plaza its own court', () => {
    const kit = loadMap();
    const a = analyzeTerrain(kit.state, null);
    expect(a.regionCells.length, 'a hand-terraced map decomposes into many small plateaus').toBeGreaterThanOrEqual(30);
    expect(houses(kit.state).length).toBe(8);
    expect(houses(kit.state).every((h) => h.elevation > 0), 'every house stands on raised ground').toBe(true);
    expect([...kit.state.objects.values()].some((o) => o.locked), 'the plaza stands').toBe(true);

    // THE STRUCTURAL FACT the press turns on: the plaza's court is not the map's largest region, so a
    // hub whose region is `rankedRegions[0]` names ground the plaza cannot reach.
    const hub = hubNode(kit.state, a)!;
    expect(hub.region).not.toBe(a.rankedRegions[0]);
  });
});

describe('one whole-map roads press on a hand-terraced island', () => {
  it('joins every house to one network that reaches the plaza, over the ramps it needs', () => {
    const kit = loadMap();
    const standing = new Set(kit.state.objects.keys());
    const W = kit.state.template.width, H = kit.state.template.height;

    const outcome = applyMacro(kit, 'roads', { seed: 1 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    const laid = [...kit.state.objects.values()].filter((o) => !standing.has(o.id));
    const roads = laid.filter((o) => categoryOf(o) === ItemCategory.Road);
    const crossings = laid.filter((o) => categoryOf(o) === ItemCategory.Bridge || categoryOf(o) === ItemCategory.Ramp);
    expect(roads.length, 'a network, not a plaza ring').toBeGreaterThan(200);
    expect(crossings.length, 'a terraced map is crossed by ramps').toBeGreaterThan(0);

    // EVERY HOUSE IS SERVED. Not "most": a press that reaches seven of eight has skipped one in
    // silence, which is the failure this pin exists for.
    const unserved = houses(kit.state).filter((h) => !pavedNear(kit.state, h, 2)).map(name);
    expect(unserved).toEqual([]);

    // ONE network: every house's pavement is the same piece, and that piece reaches the plaza.
    const comp = pavementComponents(kit.state, W, H);
    const plaza = [...kit.state.objects.values()].find((o) => o.locked)!;
    const plazaComps = componentsAround(comp, objectRect(plaza), W, 1);
    expect(plazaComps.size, 'pavement reaches the plaza').toBeGreaterThan(0);
    for (const h of houses(kit.state)) {
      const shared = [...componentsAround(comp, objectRect(h), W, 2)].some((c) => plazaComps.has(c));
      expect(shared, `${name(h)} is on the plaza's own network`).toBe(true);
    }

    // NO ORPHAN CROSSING: a ramp or bridge with no pavement at either end is a staircase in a
    // field. All twelve of them were exactly that before the hub knew its own region.
    const orphans = crossings.filter((c) => !pavedNear(kit.state, c, 1)).map(name);
    expect(orphans).toEqual([]);

    // NOTHING A HAND PLACED IS TAKEN AWAY.
    for (const id of standing) expect(kit.state.objects.has(id), `${id} survived the press`).toBe(true);
  }, 60000);

  it('says the plan is already the plan when pressed again, rather than claiming no ground', () => {
    const kit = loadMap();
    expect(applyMacro(kit, 'roads', { seed: 1 }).changes).toBeGreaterThan(0);

    const again = applyMacro(kit, 'roads', { seed: 2 });
    expect(again.changes).toBe(0);
    expect(again.code, again.reason ?? '').toBe('already-connected');
  }, 60000);
});

describe('a house the network cannot reach is named, not skipped', () => {
  /** Flat buildable ground with a sea border, and a moat too wide for any catalog bridge cutting
   *  an island out of it: two houses on the mainland for the press to join, one marooned. */
  function marooned(): Kit {
    const SIZE = 60, SHORE = 3, MOAT_X0 = 30, MOAT_X1 = 43;
    const state = makeState(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const border = x < SHORE || y < SHORE || x >= SIZE - SHORE || y >= SIZE - SHORE;
      const moat = x >= MOAT_X0 && x <= MOAT_X1;
      if (border || moat) state.cells[y]![x]!.zone = CellZone.Void;
    }
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const kit: Kit = { state, executor, registry: executor.getRegistry() };
    for (const [id, x, y] of [['building-myhouse', 10, 12], ['building-stall', 18, 34], ['building-wave-cabin', 50, 30]] as const) {
      const obj: PlacedObject = { id: `hand-${x}-${y}`, catalogId: id, position: { x, y }, rotation: 0, elevation: 0 };
      expect(executor.execute(objectPlacementCommand(obj)).success, `${id}@${x},${y}`).toBe(true);
    }
    return kit;
  }

  it('lays the network it can and reports the marooned house AT its doorstep', () => {
    const kit = marooned();
    const outcome = applyMacro(kit, 'roads', { seed: 1 });

    expect(outcome.changes, 'the mainland houses still get their streets').toBeGreaterThan(0);
    expect(outcome.code, outcome.reason ?? '').toBe('stranded');
    expect(outcome.at, 'the report stands at the house it is about').toBeDefined();
    expect(Math.abs(outcome.at!.x - 50) + Math.abs(outcome.at!.y - 30)).toBeLessThanOrEqual(6);
  }, 60000);
});

/**
 * DID THE ROUTE ACTUALLY CONNECT THE TWO TAPS?
 *
 * The two-tap gesture exists to put a road between two points, and A ROAD IN THREE PIECES CAN REPORT
 * SUCCESS: `route.ts` plans against crossing SITES, the `waterSpan`/`heightDrop` traits SNAP the deck
 * somewhere else during validation, and the plan's approach cells then land under the deck or one cell
 * short of its entrance. One hole at an entrance and the deck plus its aprons are an island of pavement
 * neither leg reaches. Measured over three generated islands, that left the taps in different
 * components on 21% of laid routes, every one of them reported as a success.
 *
 * Both outcomes are pinned: a route that CAN be joined comes out as one walkable piece, and one that
 * cannot lays nothing and says so. The middle case — pavement on the map plus a success report — is
 * what this file exists to keep unreachable.
 *
 * TWO CASES RUN ON A GENERATED ISLAND, because the failure is real terrain's: it takes a route over
 * more than one region, with a crossing the traits snap several cells along its own axis, and every
 * hand-built fixture of that shape happened to join by luck. Both pairs are ones the sweep measured.
 */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { categoryOf } from '../../../state/catalog';
import { cloneGridState, NEIGHBORS4 } from '../../../core/model/grid-model';
import { objectRect } from '../../../state/object-geometry';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { clearAllObjects, generateTerrain } from '../../../tools/generation/terrain-generator';
import { crossingExitCells } from '../../../tools/placement/network';
import { applyMacro } from '../../../tools/macros';
import { makeState, setTerrain } from '../../rules/_helpers';
import {
  CellZone, ItemCategory, TerrainType,
  type Command, type EditorEvents, type GenerateConfig, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';

const SIZE = 45;
const SHORE = 3;
const ISLAND = 96;

interface Kit { state: GridState; executor: CommandExecutor; registry: ReturnType<CommandExecutor['getRegistry']> }

function kitOf(state: GridState): Kit {
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

/** An open, flat, buildable map with a sea border — `road-contract.test.ts`'s own fixture. */
function makeKit(size = SIZE): Kit {
  const state = makeState(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < SHORE || y < SHORE || x >= size - SHORE || y >= size - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  return kitOf(state);
}

/** A generated island, terrain only. Cached per seed and handed out as a clone: generation is the
 *  expensive half of these cases and neither of them needs a private island. */
const islands = new Map<number, GridState>();
function islandKit(seed: number): Kit {
  let base = islands.get(seed);
  if (!base) {
    base = makeState(ISLAND, ISLAND);
    const exec = new CommandExecutor(base, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(base));
    const config: GenerateConfig = {
      algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 5, seed, region: null,
    };
    const state = base;
    exec.runSilently(() => {
      generateTerrain(config, state, (c: Command) => exec.execute(c), exec.getRegistry());
      // TERRAIN ONLY: the island generator furnishes what it builds, and this fixture is
      // about relief. What stands on it is the case's own subject, planted or laid below.
      clearAllObjects(state, (c: Command) => exec.execute(c));
    });
    exec.commitStrokeGroup(exec.getUndoStackSize());
    islands.set(seed, base);
  }
  return kitOf(cloneGridState(base));
}

/** Two taps on the generated island whose route has to take a crossing, searched for on the fixture
 *  rather than remembered: a coarse lattice of standable cells, paired east-west at link range and
 *  across a tier step, and the first pair a link joins over a bridge or a ramp wins. A written-down
 *  pair goes stale the next time the terrain moves. It throws rather than skipping if the island offers
 *  none — a fixture with
 *  no step in it cannot ask this question. */
function pairOverACrossing(seed: number): { from: MacroCoord; to: MacroCoord } {
  return pairWhere(seed, (outcome, state) => outcome.changes > 0 && crossings(state).length > 0);
}

/** The lattice both searches walk: standable cells paired east-west at link range, each pair tried on
 *  its own copy of the island until `want` is satisfied. It throws rather than skipping when nothing
 *  qualifies — a fixture that cannot pose the question must say so, not pass quietly. */
function pairWhere(
  seed: number,
  want: (outcome: ReturnType<typeof applyMacro>, state: GridState) => boolean,
): { from: MacroCoord; to: MacroCoord } {
  const probe = islandKit(seed);
  const { width: W, height: H } = probe.state.template;
  const standable = (x: number, y: number): boolean => {
    const cell = probe.state.cells[y]?.[x];
    if (!cell || cell.zone !== CellZone.Grass) return false;
    return !cell.terrain || cell.terrain.type === TerrainType.Mountain;
  };
  for (let y = 8; y < H - 8; y += 8) {
    for (let x = 8; x < W - 26; x += 8) {
      if (!standable(x, y)) continue;
      for (const span of [18, 22, 26]) {
        if (!standable(x + span, y)) continue;
        const trial = islandKit(seed);
        const from: MacroCoord = { x, y }, to: MacroCoord = { x: x + span, y };
        if (want(applyMacro(trial, 'road-link', { seed: 1, from, at: to }), trial.state)) return { from, to };
      }
    }
  }
  throw new Error('the fixture no longer offers a pair this case can be asked about');
}

/** Two taps on the generated island whose link comes back `unjoined`: the router found a line and
 *  laying it came apart, which is the clause under test. Searched on the same lattice and for the
 *  same reason as `pairOverACrossing`. */
function pairThatCannotJoin(seed: number): { from: MacroCoord; to: MacroCoord } {
  return pairWhere(seed, (outcome) => outcome.changes === 0 && outcome.code === 'unjoined');
}

function place(kit: Kit, catalogId: string, x: number, y: number): PlacedObject {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0, elevation: 0 };
  const r = kit.executor.execute(objectPlacementCommand(obj));
  expect(r.success, `place ${catalogId}@${x},${y}: ${r.errors?.[0]?.message ?? ''}`).toBe(true);
  return obj;
}

const key = (c: MacroCoord): string => `${c.x},${c.y}`;

function roadObjects(state: GridState): PlacedObject[] {
  return [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
}

/**
 * Every cell a walk along the map's roads may use: pavement, plus each crossing deck AND the ring of
 * cells around it. The apron is not slack — the `flat` trait refuses a road tile at a deck's own
 * transition on its own (the cell beside the water a bridge spans has that water as its own +1-right
 * neighbour), so a bare doorstep at a crossing is the design's documented neck and a walk crosses it.
 * A gap WIDER than that is a break, which is what these tests measure.
 */
function roadWalk(state: GridState): Set<string> {
  const cells = new Set<string>();
  const aprons: string[] = [];
  for (const o of state.objects.values()) {
    const cat = categoryOf(o);
    const crossing = cat === ItemCategory.Bridge || cat === ItemCategory.Ramp;
    if (cat !== ItemCategory.Road && !crossing) continue;
    const r = objectRect(o);
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
      cells.add(`${x},${y}`);
      if (crossing) aprons.push(`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`);
    }
  }
  for (const a of aprons) cells.add(a);
  return cells;
}

/** The 4-connected pieces of `cells`, largest first. */
function components(cells: ReadonlySet<string>): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of cells) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start], comp: string[] = [];
    while (queue.length) {
      const k = queue.pop()!;
      comp.push(k);
      const [x, y] = k.split(',').map(Number) as [number, number];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
        const nk = `${x + dx},${y + dy}`;
        if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
      }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Which piece the road nearest `at` belongs to, or -1 when no road stands within `slack` cells of
 *  it: a tap is a point a hand aimed at, and the planner snaps it onto the nearest cell a road can
 *  actually stand on. */
function pieceAt(comps: string[][], at: MacroCoord, slack = 2): number {
  for (let i = 0; i < comps.length; i++) {
    for (const k of comps[i]!) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      if (Math.abs(x - at.x) + Math.abs(y - at.y) <= slack) return i;
    }
  }
  return -1;
}

function crossings(state: GridState): PlacedObject[] {
  return [...state.objects.values()]
    .filter((o) => categoryOf(o) === ItemCategory.Bridge || categoryOf(o) === ItemCategory.Ramp);
}

/** A 4-wide water strip capped top and bottom by mountain at elev 1, so it has no exposed face:
 *  the ford `road-contract.test.ts` uses, with its two banks 23 cells apart. */
function ford(kit: Kit): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 20; x <= 23; x++) {
      if (y < 15 || y > 24) setTerrain(kit.state, x, y, TerrainType.Mountain, 1);
      else setTerrain(kit.state, x, y, TerrainType.Water, 0);
    }
  }
}

/** A lake that reaches neither map edge: 4 wide, 21 tall, so the two banks are 23 cells apart and a
 *  route can still walk round either end of it — twice as far as crossing. */
function lake(kit: Kit): void {
  for (let y = 10; y <= 30; y++) for (let x = 20; x <= 23; x++) setTerrain(kit.state, x, y, TerrainType.Water, 0);
}

/** Pavement stands at BOTH of a deck's entrances, or touching one: the `flat` trait refuses a road
 *  tile at the transition itself often enough that a bare doorstep is the design's documented neck,
 *  but a road that never comes within a cell of a bridge is a road that does not use it. */
function expectPavementAtDeck(state: GridState, deck: PlacedObject): void {
  const paved = new Set(roadObjects(state).map((o) => key(o.position)));
  const at = (c: MacroCoord): boolean => paved.has(key(c))
    || NEIGHBORS4.some(([dx, dy]) => paved.has(key({ x: c.x + dx, y: c.y + dy })));
  const [exitA, exitB] = crossingExitCells(deck);
  for (const end of [exitA, exitB]) {
    expect(end.some(at), `no pavement at the deck end near ${key(end[0]!)}`).toBe(true);
  }
}

/** The two taps are joined by one piece of road. */
function expectJoined(state: GridState, from: MacroCoord, to: MacroCoord): void {
  const comps = components(roadWalk(state));
  const a = pieceAt(comps, from), b = pieceAt(comps, to);
  expect(a, 'no road stands near the first tap').toBeGreaterThanOrEqual(0);
  expect(b, 'no road stands near the second tap').toBeGreaterThanOrEqual(0);
  expect(a, `the route came out in pieces of ${comps.map((c) => c.length).join(',')} cells`).toBe(b);
}

describe('a two-tap route joins the two taps', () => {
  it('over a ramp the trait snapped elsewhere: the deck is IN the road', () => {
    const { from, to } = pairOverACrossing(11);
    const kit = islandKit(11);

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    const crossings = [...kit.state.objects.values()]
      .filter((o) => categoryOf(o) === ItemCategory.Bridge || categoryOf(o) === ItemCategory.Ramp);
    expect(crossings.length, 'the fixture no longer routes over a crossing').toBeGreaterThan(0);
    expectJoined(kit.state, from, to);
  });

  it('across a ford: the bridge is in the road, not beside it', () => {
    const kit = makeKit();
    ford(kit); // the taps sit on opposite banks, so the route must bridge
    const from: MacroCoord = { x: 10, y: 19 }, to: MacroCoord = { x: 33, y: 19 };

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect([...kit.state.objects.values()].some((o) => categoryOf(o) === ItemCategory.Bridge),
      'a bridge stands over the ford').toBe(true);
    expectJoined(kit.state, from, to);
  });

  it('A BRIDGE IS A ROAD: the route crosses the deck someone built, and leaves it exactly as it stood', () => {
    const kit = makeKit();
    lake(kit);
    const from: MacroCoord = { x: 10, y: 19 }, to: MacroCoord = { x: 33, y: 19 };
    // The bridge the user built, straight between the two taps. Placed on the first water cell of
    // their row; the `waterSpan` trait snaps position and span from there.
    const bridge = place(kit, 'bridge-plank', 20, 19);
    const wasAt = { ...bridge.position };

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(kit.state.objects.has(bridge.id), 'the standing bridge was removed or replaced').toBe(true);
    expect(kit.state.objects.get(bridge.id)!.position, 'the standing bridge was moved').toEqual(wasAt);
    expect(crossings(kit.state).length, 'a second crossing was built beside the one already there').toBe(1);
    expectJoined(kit.state, from, to);
    // The road WALKS ONTO the deck rather than round the lake: the pavement reaches both entrances, and
    // a way round does exist here for a route that would rather take it.
    expectPavementAtDeck(kit.state, bridge);
    expect(roadObjects(kit.state).length, 'the route walked round the lake instead of over the bridge')
      .toBeLessThanOrEqual(30);
  });

  it('a standing deck is not reported as a cell a planting holds', () => {
    const kit = makeKit();
    ford(kit); // no way round at all, so the route must cross the deck rather than choose to
    const bridge = place(kit, 'bridge-plank', 20, 19);
    const deck = objectRect(bridge);

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from: { x: 10, y: 19 }, at: { x: 33, y: 19 } });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    const onDeck = (outcome.blocked ?? []).filter((c) => c.x >= deck.x && c.x < deck.x + deck.w && c.y >= deck.y && c.y < deck.y + deck.h);
    expect(onDeck, 'the bridge the route crossed came back as something in its way').toEqual([]);
  });

  it('the whole-map press crosses a standing deck too, rather than routing round it', () => {
    const kit = makeKit();
    ford(kit); // no way round, so the only street between the two houses is over the standing deck
    const bridge = place(kit, 'bridge-plank', 20, 19);
    const west = place(kit, 'building-myhouse', 8, 8);
    const east = place(kit, 'building-bamboo-cabin', 30, 30);

    const outcome = applyMacro(kit, 'roads', { seed: 1 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(crossings(kit.state).length, 'a second crossing was built beside the one already there').toBe(1);
    const comps = components(roadWalk(kit.state));
    const a = pieceAt(comps, west.position, 4), b = pieceAt(comps, east.position, 4);
    expect(a, 'no street reached the west house').toBeGreaterThanOrEqual(0);
    expect(b, 'no street reached the east house').toBeGreaterThanOrEqual(0);
    expect(a, `the two banks came out in pieces of ${comps.map((c) => c.length).join(',')} cells`).toBe(b);
    expectPavementAtDeck(kit.state, bridge);
  });

  it('a route that cannot be joined lays nothing and names where it stopped', () => {
    // `unjoined` is the accident this clause exists for: the router DID find a line, and laying it
    // came apart on the way — a crossing the traits would not seat where the plan wanted it. Which
    // pairs those are belongs to the terrain, so the pair is searched for rather than remembered.
    const { from, to } = pairThatCannotJoin(7);
    const kit = islandKit(7);
    const before = roadObjects(kit.state).length;

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to });
    expect(outcome.changes, 'a route that does not connect kept its pavement').toBe(0);
    expect(outcome.code).toBe('unjoined');
    expect(outcome.at, 'the refusal does not say where the road stopped').toBeTruthy();
    expect(roadObjects(kit.state).length, 'pavement was left standing after the refusal').toBe(before);
  });

  it('a planting on the only line through is the refusal, and it is still standing', () => {
    const kit = makeKit();
    // A one-cell-wide land bridge at x=22 across a band far wider than any catalog bridge can span:
    // every route north to south crosses exactly that column (`road-contract.test.ts`'s bottleneck),
    // so a flower parked there cannot be detoured around.
    for (let y = 12; y <= 33; y++) {
      for (let x = SHORE; x <= SIZE - 1 - SHORE; x++) {
        if (x >= 21 && x <= 23) continue;
        kit.state.cells[y]![x]!.zone = CellZone.Void;
      }
    }
    const flower = place(kit, 'flower-daisy', 22, 22);

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from: { x: 20, y: 6 }, at: { x: 24, y: 40 } });
    expect(outcome.changes, 'half a road was left on either side of the flower').toBe(0);
    expect(outcome.code, 'the refusal blamed the geometry rather than the planting').toBe('blocked');
    expect(outcome.blocked?.map(key), 'the report never named the cell it cannot have').toContain(key(flower.position));
    expect(kit.state.objects.has(flower.id), 'the blocking flower was swept').toBe(true);
    expect(roadObjects(kit.state), 'pavement was left standing after the refusal').toEqual([]);
  });
});

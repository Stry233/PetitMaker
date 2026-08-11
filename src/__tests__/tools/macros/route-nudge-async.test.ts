/**
 * The nudge and the cycle on the path PRODUCTION runs: the build happens off-thread, so a drop's or a
 * tap's own work lands a round trip after it was asked for.
 *
 * Its own file because `installMacroBuildRunner` has no uninstall — a runner installed here would make
 * every later test in a shared file asynchronous. The runner below hands out promises the test resolves
 * by hand, which is the only way to have two drops inside one build window on purpose.
 *
 * There is no DOM here: the marks are a module singleton, so what the overlay would show is readable
 * straight off `getRouteSession()`.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { MacroTool } from '../../../tools/macros/macro-tool';
import {
  buildMacroRun, installMacroBuildRunner, type MacroBuild, type MacroId, type MacroOpts,
} from '../../../tools/macros';
import {
  __resetRouteSession, getRouteSession, moveRouteMark,
} from '../../../tools/macros/route-session';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { categoryOf } from '../../../state/catalog';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import {
  CellZone, ItemCategory, TerrainType,
  type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';

const SIZE = 45;
const SHORE = 3;

/** The live editor the runner builds against, set per test. */
let live: { state: GridState; executor: CommandExecutor } | null = null;
/** Builds asked for and not yet answered, in order. */
let waiting: (() => void)[] = [];
/**
 * An offer whose build comes back EMPTY, or null for none.
 *
 * The only way in to the relay's refusal path from outside for a CYCLE: the ends and the seed a cycle
 * re-lays with are the ones that already worked, and `layRoadLink` clamps an offer index into the
 * offers it actually drafted, so no map and no argument makes a cycle's own run lay nothing. The
 * refusal is still reachable in the wild (a build that lands against ground that has moved), and what
 * must hold when it happens is the contract this pins: the route that stood goes back.
 */
let refuseOffer: number | null = null;

installMacroBuildRunner((state: GridState, id: MacroId, opts: MacroOpts): Promise<MacroBuild | null> =>
  new Promise((resolve) => {
    waiting.push(() => {
      const executor = live!.executor;
      const built = buildMacroRun({ state, executor, registry: executor.getRegistry() }, id, opts);
      if (built && refuseOffer !== null && opts.offer === refuseOffer) {
        resolve({ run: { ...built.run, commands: [] }, report: { code: 'no-route' } });
        return;
      }
      resolve(built);
    });
  }));

/**
 * Answer every build the tool asks for until it stops asking, then let its chain settle.
 *
 * The request itself arrives a microtask late (`layLink` queues onto `this.applying`, and
 * `applyMacroAsync` reaches the runner from inside that), so a synchronous sweep of `waiting` would
 * find it empty. Repeating is also what carries the refusal path, whose restore is a second build
 * asked for by the first one's answer.
 */
async function flush(): Promise<void> {
  for (let round = 0; round < 8; round++) {
    await new Promise((r) => { setTimeout(r, 0); });
    const answer = waiting;
    waiting = [];
    for (const a of answer) a();
  }
  await new Promise((r) => { setTimeout(r, 0); });
}

/** An open, flat, buildable map with a sea border — `road-link-gesture.test.ts`'s fixture. */
function makeMap(): { state: GridState; executor: CommandExecutor } {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x < SHORE || y < SHORE || x >= SIZE - SHORE || y >= SIZE - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor };
}

const paved = (state: GridState): string[] =>
  [...state.objects.values()].map((o) => `${o.position.x},${o.position.y}`);

/** Every object on the map as `catalogId@x,y`, sorted — a whole-map fingerprint a refused cycle must
 *  not move. */
const fingerprint = (state: GridState): string[] =>
  [...state.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort();

/** A wall of decorations across the direct row with a lake just above it: the shape that provably
 *  drafts more than one way to go, so the route it lays has something to cycle to
 *  (`route-offers.ts`'s own `lakeWorld`). */
function multiOffer(): { state: GridState; executor: CommandExecutor } {
  const { state, executor } = makeMap();
  for (let x = 15; x <= 25; x++) {
    const obj: PlacedObject = { id: `wall-${x}`, catalogId: 'flower-daisy', position: { x, y: 20 }, rotation: 0, elevation: 0 };
    expect(executor.execute(objectPlacementCommand(obj)).success).toBe(true);
  }
  for (let x = 15; x <= 25; x++) setTerrain(state, x, 18, TerrainType.Water, 0);
  return { state, executor };
}

/** A multi-offer route committed through the tool on the off-thread path, its marks standing. */
async function laidMultiOffer(): Promise<{
  tool: MacroTool; state: GridState; executor: CommandExecutor; ctx: ReturnType<typeof makeToolCtx>;
}> {
  const { state, executor } = multiOffer();
  live = { state, executor };
  const ctx = makeToolCtx(state, executor, 1, 1, { armedMacro: 'road-link' });
  const tool = new MacroTool();
  tool.onActivate();
  tool.onPointerDown({ x: 10, y: 20 }, { x: 10, y: 20 }, ctx);
  tool.onPointerDown({ x: 30, y: 20 }, { x: 30, y: 20 }, ctx);
  await flush();
  expect(getRouteSession(), 'the marks opened once the build landed').not.toBeNull();
  return { tool, state, executor, ctx };
}

/** A cell in the middle of what is paved right now: where a tap that means "cycle this route" lands. */
function onRoad(state: GridState): MacroCoord {
  const cells = [...state.objects.values()]
    .filter((o) => categoryOf(o) === ItemCategory.Road)
    .map((o) => o.position)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  expect(cells.length, 'there is pavement to tap on').toBeGreaterThan(0);
  return cells[Math.floor(cells.length / 2)]!;
}

/** A two-tap route committed through the tool, with its off-thread build answered. */
async function laidRoute(): Promise<{
  tool: MacroTool; state: GridState; executor: CommandExecutor; ctx: ReturnType<typeof makeToolCtx>;
}> {
  const { state, executor } = makeMap();
  live = { state, executor };
  const ctx = makeToolCtx(state, executor, 1, 1, { armedMacro: 'road-link' });
  const tool = new MacroTool();
  tool.onActivate();
  const at = (x: number, y: number): MacroCoord => ({ x, y });
  tool.onPointerDown(at(10, 10), at(10, 10), ctx);
  tool.onPointerDown(at(30, 10), at(30, 10), ctx);
  await flush();
  expect(getRouteSession(), 'the marks opened once the build landed').not.toBeNull();
  return { tool, state, executor, ctx };
}

beforeEach(() => { waiting = []; refuseOffer = null; });
afterEach(() => { __resetRouteSession(); live = null; });

describe('a nudge whose build is still in flight', () => {
  it('lands one undo entry and moves the marks with it', async () => {
    const { state, executor } = await laidRoute();
    const committed = executor.getUndoStackSize();

    moveRouteMark('to', 30, 16, true);
    // The rollback is synchronous and the re-lay is queued, so the road is OFF the map for the whole
    // build window. Intrinsic: the build has to see the map without the line it is replacing.
    expect(state.objects.size, 'mid-window the route is gone').toBe(0);

    await flush();

    expect(executor.getUndoStackSize()).toBe(committed);
    expect(paved(state)).toContain('30,16');
    expect(getRouteSession()!.to).toEqual({ x: 30, y: 16 });
  });

  it('a second drop inside the window refuses without orphaning the tool', async () => {
    // The second drop sees a depth of `watermark` (the first drop rolled back and its build has not
    // landed), so the guard refuses and the marks go. The first drop's build then lands with no session
    // behind it: it must finish the map and NOT re-create the tool's claim on a gesture, or nothing
    // clears that claim again and Escape stops disarming the card.
    const { tool, state, ctx } = await laidRoute();

    moveRouteMark('to', 30, 16, true);
    moveRouteMark('to', 30, 20, true);
    expect(getRouteSession(), 'the refused drop put the marks away').toBeNull();

    await flush();

    expect(paved(state), 'the airborne build still finished the map').toContain('30,16');
    expect(tool.cancelPending(ctx), 'Escape falls through to the disarm, as it must').toBe(false);
    expect(tool.cancelPending(ctx)).toBe(false);
  });

  it('and a card switch that lands mid-build cannot leave the claim standing either', async () => {
    const { tool, ctx } = await laidRoute();

    moveRouteMark('to', 30, 16, true);
    // The hand moves to another card while the build is in flight: `armedNow` drops the route at the
    // next pointer event, and the build lands after that.
    const switched = { ...ctx, armedMacro: 'patch-tree', armingEpoch: ctx.armingEpoch + 1 };
    tool.onPointerMove({ x: 12, y: 24 }, { x: 12, y: 24 }, switched);
    expect(getRouteSession()).toBeNull();

    await flush();

    expect(tool.cancelPending(ctx)).toBe(false);
  });
});

describe('a cycle whose build is still in flight', () => {
  it('lands the next way round as one undo entry', async () => {
    const { tool, state, executor, ctx } = await laidMultiOffer();
    const committed = executor.getUndoStackSize();
    const first = paved(state).sort();

    const cell = onRoad(state);
    tool.onPointerDown(cell, cell, ctx);
    await flush();

    expect(paved(state).sort(), 'a different way round').not.toEqual(first);
    expect(executor.getUndoStackSize(), 'still the commit\'s own entry').toBe(committed);
    expect(getRouteSession(), 'the marks stand for the next choice').not.toBeNull();
  });

  it('a refused cycle leaves the map as it was', async () => {
    const { tool, state, executor, ctx } = await laidMultiOffer();
    const committed = executor.getUndoStackSize();
    const before = fingerprint(state);

    refuseOffer = 1;
    const cell = onRoad(state);
    tool.onPointerDown(cell, cell, ctx);
    await flush();

    expect(fingerprint(state), 'the route that stood went back, object for object').toEqual(before);
    expect(executor.getUndoStackSize(), 'under one undo entry, as it was').toBe(committed);
    expect(getRouteSession()!.from, 'the marks describe the ends the map really has').toEqual({ x: 10, y: 20 });
    expect(getRouteSession()!.to).toEqual({ x: 30, y: 20 });
  });
});

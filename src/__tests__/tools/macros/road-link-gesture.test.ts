/**
 * `road-link`'s GESTURE, through the real `MacroTool`: the two taps, an Escape between them, a tap on
 * the road the taps laid that chooses another way round, a tap on a building that is the whole
 * gesture on its own, and the ghost's promise against what the press actually lays.
 *
 * THE MULTI-OFFER FIXTURE IS THE POINT of half of these. A bare map drafts exactly one way to go, and
 * for as long as a tap on the drawn route cycled, one offer was the only case where the second tap
 * committed at all — so every pin below that is about committing or choosing runs on `multiOffer`,
 * whose own offer count is asserted rather than assumed.
 *
 * Fixture style follows `macro-quality.test.ts`/`road-link.test.ts`; the state machine itself is
 * pinned here rather than in either of those, which drive `applyMacro` directly and never touch
 * `MacroTool`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setToastPresenter } from '../../../core/runtime/toast-bus';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { categoryOf } from '../../../state/catalog';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import { MacroTool } from '../../../tools/macros/macro-tool';
import { previewMacro } from '../../../tools/macros/preview';
import { __resetRouteSession, getRouteSession, LINGER_MS } from '../../../tools/macros/route-session';
import {
  CellZone, ItemCategory, TerrainType,
  type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';

const SIZE = 45;
const SHORE = 3;

/** An open, flat, buildable map with a sea border — same shape as `road-link.test.ts`'s `makeKit`. */
function makeMap(size = SIZE): { state: GridState; executor: CommandExecutor } {
  const state = makeState(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x < SHORE || y < SHORE || x >= size - SHORE || y >= size - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor };
}

function place(
  executor: CommandExecutor, catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0,
): PlacedObject {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation, elevation: 0 };
  const r = executor.execute(objectPlacementCommand(obj));
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

interface GhostCall { cells: MacroCoord[]; losses: MacroCoord[] }

/** A `ToolContext` armed with `road-link`, its overlay capturing every `showGhost` payload. */
function linkCtx(state: GridState, executor: CommandExecutor) {
  const calls: GhostCall[] = [];
  const overlay = {
    showGhost(cells: MacroCoord[], _color: number, _terrainGrid?: boolean, _trim?: unknown, losses?: readonly MacroCoord[]) {
      calls.push({ cells: [...cells], losses: losses ? [...losses] : [] });
    },
    showGhostSpans() {},
    clearGhost() {},
    flashCommit() {},
  };
  // `t` renders its params, so a toast that NAMES something (the offer a cycle chose) can be read
  // back off the text rather than only recognised by its key.
  const ctx = makeToolCtx(state, executor, 1, 1, {
    armedMacro: 'road-link', overlay: overlay as any,
    t: (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  });
  return { ctx, calls };
}

const at = (x: number, y: number): MacroCoord => ({ x, y });
/** road-link ignores the micro coord entirely; `m`/`micro` are both `at`, under the names the
 *  card-switch tests below read most naturally at each call site. */
const m = at;
const micro = at;

/** `road-link`, armed and activated on a fresh map — the shorthand the card-switch tests share. */
function armLink(): { tool: MacroTool; ctx: ReturnType<typeof linkCtx>['ctx']; exec: CommandExecutor } {
  const { state, executor } = makeMap();
  const { ctx } = linkCtx(state, executor);
  const tool = new MacroTool();
  tool.onActivate();
  return { tool, ctx, exec: executor };
}

/** Whether any Road/Bridge/Ramp object sits in the bounding rectangle between two points — "a
 *  route between them" for a fixture where nothing else armed in these tests ever paves. */
function roadBetween(state: GridState, from: MacroCoord, to: MacroCoord): boolean {
  const x0 = Math.min(from.x, to.x), x1 = Math.max(from.x, to.x);
  const y0 = Math.min(from.y, to.y), y1 = Math.max(from.y, to.y);
  return roadCells(state).some((c) => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1);
}

/** Let the airborne preview land — `previewMacroAsync` resolves on a microtask even with no
 *  worker installed (the sync path still wraps in a promise). */
async function settle(): Promise<void> {
  await new Promise((r) => { setTimeout(r, 0); });
}

/** A wall of decorations blocks the direct row; a lake sits just above it, so going up and over
 *  hugs the water while going down and under does not — `route-offers.ts`'s own `lakeWorld` shape,
 *  which provably drafts more than one way to go. The one fixture every multi-offer pin below
 *  shares, because a map with a single offer cannot tell a working gesture from a broken one. */
function multiOffer(): { state: GridState; executor: CommandExecutor } {
  const { state, executor } = makeMap();
  for (let x = 15; x <= 25; x++) place(executor, 'flower-daisy', x, 20);
  for (let x = 15; x <= 25; x++) setTerrain(state, x, 18, TerrainType.Water, 0);
  return { state, executor };
}

const LINK_FROM = at(10, 20);
const LINK_TO = at(30, 20);

/** How many ways the map drafts between two points, off the same preview the ghost asks for. */
function offerCount(ctx: ReturnType<typeof linkCtx>['ctx'], from: MacroCoord, to: MacroCoord): number {
  return previewMacro(ctx.macroContext, 'road-link', {
    seed: 1, at: to, from, offer: 0, material: ctx.tileMaterial, width: ctx.brushSize,
  }).offers.length;
}

/** Every paved cell on the map, sorted — the pavement a cycle has to CHANGE and a full wrap has to
 *  bring back exactly. */
const pavement = (state: GridState): string[] =>
  roadCells(state).map((c) => `${c.x},${c.y}`).sort();

/** A cell in the middle of what is paved right now: where a tap that means "cycle this route" lands.
 *  Re-read after every cycle, since the way round changes which cells there are. */
function onRoad(state: GridState): MacroCoord {
  const cells = [...roadCells(state)].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  expect(cells.length, 'there is pavement to tap on').toBeGreaterThan(0);
  return cells[Math.floor(cells.length / 2)]!;
}

describe('road-link: the two taps', () => {
  it('the second tap commits, however many ways there are to go', async () => {
    const { state, executor } = multiOffer();
    const { ctx, calls } = linkCtx(state, executor);
    const tool = new MacroTool();
    tool.onActivate();
    const depth = executor.getUndoStackSize();
    expect(offerCount(ctx, LINK_FROM, LINK_TO), 'the fixture drafts more than one way to go').toBeGreaterThan(1);

    tool.onPointerDown(LINK_FROM, LINK_FROM, ctx);
    // The pointer rests where the second tap lands, which is how a hand presses it — and the ghost
    // is drawn from the mark TO that cell, so the commit tap is always on the drawn route.
    tool.onPointerMove(LINK_TO, LINK_TO, ctx);
    await settle();
    const ghost = calls[calls.length - 1]!;
    const before = new Set(state.objects.keys());
    tool.onPointerDown(LINK_TO, LINK_TO, ctx);

    expect(executor.getUndoStackSize(), 'the route landed as one undo entry').toBe(depth + 1);
    expect(roadCells(state).length, 'pavement reached the map').toBeGreaterThan(0);
    expect(tool.hasPending(), 'the gesture is over').toBe(false);
    // And it laid the way round the ghost drew: with several to choose from, the ghost and the commit
    // have to agree on WHICH, or the choice is made before anyone is offered it.
    const laid = new Set<string>();
    for (const [id, o] of state.objects) if (!before.has(id)) laid.add(`${o.position.x},${o.position.y}`);
    expect(new Set(ghost.cells.map((c) => `${c.x},${c.y}`))).toEqual(laid);
  });

  it('the first tap lays nothing', () => {
    const { state, executor } = makeMap();
    const { ctx } = linkCtx(state, executor);
    const tool = new MacroTool();
    tool.onActivate();
    const depth = executor.getUndoStackSize();

    tool.onPointerDown(at(10, 10), { x: 10, y: 10 }, ctx);

    expect(executor.getUndoStackSize()).toBe(depth);
    expect(state.objects.size).toBe(0);
    expect(tool.hasPending()).toBe(true);
  });

  it('the second tap lays one road and one undo entry', () => {
    const { state, executor } = makeMap();
    const { ctx } = linkCtx(state, executor);
    const tool = new MacroTool();
    tool.onActivate();
    const depth = executor.getUndoStackSize();

    tool.onPointerDown(at(10, 10), { x: 10, y: 10 }, ctx);
    tool.onPointerDown(at(30, 10), { x: 30, y: 10 }, ctx);

    expect(executor.getUndoStackSize()).toBe(depth + 1);
    expect(roadCells(state).length).toBeGreaterThan(0);
    expect(tool.hasPending()).toBe(false);
  });

  it('Escape between the taps abandons the gesture and keeps the tool armed', () => {
    const { state, executor } = makeMap();
    const { ctx } = linkCtx(state, executor);
    const tool = new MacroTool();
    tool.onActivate();
    const depth = executor.getUndoStackSize();

    tool.onPointerDown(at(10, 10), { x: 10, y: 10 }, ctx);
    expect(tool.cancelPending(ctx)).toBe(true);
    expect(executor.getUndoStackSize()).toBe(depth);
    expect(tool.hasPending()).toBe(false);

    // A following pair of taps still works: abandoning a gesture never disarms the macro.
    tool.onPointerDown(at(10, 10), { x: 10, y: 10 }, ctx);
    tool.onPointerDown(at(30, 10), { x: 30, y: 10 }, ctx);
    expect(executor.getUndoStackSize()).toBe(depth + 1);
    expect(roadCells(state).length).toBeGreaterThan(0);
  });

  it('Escape with no gesture standing falls through', () => {
    const { state, executor } = makeMap();
    const { ctx } = linkCtx(state, executor);
    const tool = new MacroTool();
    tool.onActivate();

    expect(tool.cancelPending(ctx)).toBe(false);
  });

  it('a tap on a building is the whole gesture', () => {
    const { state, executor } = makeMap();
    const house = place(executor, 'building-myhouse', 18, 20, 0);
    const { ctx } = linkCtx(state, executor);
    const tool = new MacroTool();
    tool.onActivate();
    const depth = executor.getUndoStackSize();

    tool.onPointerDown(at(house.position.x, house.position.y), { x: 0, y: 0 }, ctx);

    expect(executor.getUndoStackSize()).toBe(depth + 1);
    expect(roadCells(state).length).toBeGreaterThan(0);
    expect(tool.hasPending()).toBe(false);
  });
});

describe('road-link: the choice moves to the road it laid', () => {
  afterEach(() => { __resetRouteSession(); });

  /** A committed multi-offer route through the real tool, its marks standing. */
  async function laidRoute(pre?: (executor: CommandExecutor) => void): Promise<{
    tool: MacroTool; ctx: ReturnType<typeof linkCtx>['ctx']; state: GridState; executor: CommandExecutor; offers: number;
  }> {
    const { state, executor } = multiOffer();
    pre?.(executor);
    const { ctx } = linkCtx(state, executor);
    const offers = offerCount(ctx, LINK_FROM, LINK_TO);
    expect(offers, 'the fixture drafts more than one way to go').toBeGreaterThan(1);
    const tool = new MacroTool();
    tool.onActivate();
    tool.onPointerDown(LINK_FROM, LINK_FROM, ctx);
    tool.onPointerMove(LINK_TO, LINK_TO, ctx);
    await settle();
    tool.onPointerDown(LINK_TO, LINK_TO, ctx);
    expect(getRouteSession(), 'the route landed and left its marks').not.toBeNull();
    return { tool, ctx, state, executor, offers };
  }

  /** Every toast posted while `body` ran. */
  async function toasted(body: () => Promise<void> | void): Promise<string[]> {
    const out: string[] = [];
    const stop = setToastPresenter((text) => { out.push(text); });
    try { await body(); } finally { stop(); }
    return out;
  }

  it('a tap on the road it just laid cycles to the next way round', async () => {
    const { tool, ctx, state } = await laidRoute();
    const first = pavement(state);

    const toasts = await toasted(() => {
      const cell = onRoad(state);
      tool.onPointerDown(cell, cell, ctx);
    });

    expect(pavement(state), 'the cycle laid a genuinely different set of cells').not.toEqual(first);
    const said = toasts[toasts.length - 1];
    expect(said, 'the toast names the way it chose').toContain('smart.route_offer');
    expect(said, 'and says it is the second of them').toContain('"n":2');
    expect(getRouteSession(), 'the marks stand for the next choice').not.toBeNull();
  });

  it('cycling is one undo entry', async () => {
    const { tool, ctx, state, executor } = await laidRoute();
    const committed = executor.getUndoStackSize();
    const first = pavement(state);

    for (let i = 0; i < 2; i++) {
      const cell = onRoad(state);
      tool.onPointerDown(cell, cell, ctx);
      // Or the depth below would hold for two taps that cycled nothing.
      if (i === 0) expect(pavement(state), 'the tap cycled').not.toEqual(first);
    }

    expect(executor.getUndoStackSize(), 'two cycles cost what the commit cost').toBe(committed);
  });

  it('a cycle does not re-lay what stood', async () => {
    let byHand: PlacedObject | null = null;
    const { tool, ctx, state } = await laidRoute((executor) => { byHand = place(executor, 'path-overgrown-dirt', 8, 36); });
    const first = pavement(state);

    const cell = onRoad(state);
    tool.onPointerDown(cell, cell, ctx);

    expect(pavement(state), 'the tap cycled').not.toEqual(first);
    expect(state.objects.has(byHand!.id), 'the hand-placed road kept its own id').toBe(true);
    expect(state.objects.get(byHand!.id)!.position).toEqual({ x: 8, y: 36 });
  });

  it('the last offer wraps to the first', async () => {
    const { tool, ctx, state, offers } = await laidRoute();
    const first = pavement(state);

    for (let i = 0; i < offers; i++) {
      const cell = onRoad(state);
      tool.onPointerDown(cell, cell, ctx);
      // Every way but the last is its own road, or "back where it started" would be the reading of a
      // tap that cycled nothing at all.
      if (i < offers - 1) expect(pavement(state), `way ${i + 2} is its own road`).not.toEqual(first);
    }

    expect(pavement(state), 'all the way round is the road it started with').toEqual(first);
  });

  it('a cycle buys the marks another moment', () => {
    // A cycle is a tap on the ROUTE, so it never reaches the clock a tap on a mark restarts — and
    // marks that expired under a hand still choosing would end the choice half way through it.
    vi.useFakeTimers();
    try {
      const { state, executor } = multiOffer();
      const { ctx } = linkCtx(state, executor);
      const tool = new MacroTool();
      tool.onActivate();
      tool.onPointerDown(LINK_FROM, LINK_FROM, ctx);
      tool.onPointerDown(LINK_TO, LINK_TO, ctx);
      expect(getRouteSession()).not.toBeNull();

      vi.advanceTimersByTime(LINGER_MS - 100);
      const cell = onRoad(state);
      tool.onPointerDown(cell, cell, ctx);
      vi.advanceTimersByTime(200);

      expect(getRouteSession(), 'the old clock was cancelled, not merely ignored').not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a single-offer route has nothing to cycle', async () => {
    // Open ground between the taps: one way to go, so a tap on the road it laid is an ordinary tap.
    const { state, executor } = makeMap();
    const { ctx } = linkCtx(state, executor);
    expect(offerCount(ctx, at(10, 10), at(30, 10)), 'open ground drafts one way to go').toBe(1);
    const tool = new MacroTool();
    tool.onActivate();
    tool.onPointerDown(at(10, 10), at(10, 10), ctx);
    tool.onPointerDown(at(30, 10), at(30, 10), ctx);
    const committed = executor.getUndoStackSize();
    const laid = pavement(state);

    const cell = onRoad(state);
    tool.onPointerDown(cell, cell, ctx);

    expect(tool.hasPending(), 'the tap started a fresh first mark').toBe(true);
    expect(executor.getUndoStackSize(), 'and a first mark lays nothing').toBe(committed);
    expect(pavement(state), 'the road it laid is untouched').toEqual(laid);
    expect(getRouteSession(), 'the marks went, as they do for any next gesture').toBeNull();
  });
});

describe('road-link: the ghost promises what the press lays', () => {
  it('per gesture: the two-tap route', async () => {
    const { state, executor } = makeMap();
    const { ctx, calls } = linkCtx(state, executor);
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerDown(at(10, 10), { x: 10, y: 10 }, ctx);
    tool.onPointerMove(at(30, 10), { x: 30, y: 10 }, ctx);
    await settle();
    const ghost = calls[calls.length - 1]!;
    expect(ghost.cells.length).toBeGreaterThan(0);

    const before = new Set(state.objects.keys());
    tool.onPointerDown(at(30, 10), { x: 30, y: 10 }, ctx);

    const laid = new Set<string>();
    for (const [id, o] of state.objects) if (!before.has(id)) laid.add(`${o.position.x},${o.position.y}`);
    const promised = new Set(ghost.cells.map((c) => `${c.x},${c.y}`));
    expect(promised).toEqual(laid);
    // A fresh map has nothing standing to replace.
    expect(ghost.losses).toEqual([]);
  });

  it('per gesture: a tap on a building', async () => {
    const { state, executor } = makeMap();
    const house = place(executor, 'building-myhouse', 18, 20, 0);
    const { ctx, calls } = linkCtx(state, executor);
    const tool = new MacroTool();
    tool.onActivate();

    // road-link's move-driven ghost only asks over a building with no mark down.
    tool.onPointerMove(at(house.position.x, house.position.y), { x: 0, y: 0 }, ctx);
    await settle();
    expect(calls.length).toBeGreaterThan(0);
    const ghost = calls[calls.length - 1]!;
    expect(ghost.cells.length).toBeGreaterThan(0);

    const before = new Set(state.objects.keys());
    tool.onPointerDown(at(house.position.x, house.position.y), { x: 0, y: 0 }, ctx);

    const laid = new Set<string>();
    for (const [id, o] of state.objects) if (!before.has(id)) laid.add(`${o.position.x},${o.position.y}`);
    const promised = new Set(ghost.cells.map((c) => `${c.x},${c.y}`));
    expect(promised).toEqual(laid);
  });
});

describe('the mark does not outlive its card', () => {
  // Every armed macro shares ToolType.Macro, so switching cards fires no deactivate. The tool's
  // only evidence of a switch is the id under its own hand changing, and each of these three ways
  // back to road-link reaches that check by a different route: a press for the other card, a MOVE
  // for it (no press at all), and a press the other card refused before it could act.
  it.each([
    ['the other card was pressed', (t: MacroTool, c: ReturnType<typeof linkCtx>['ctx']) => t.onPointerDown(m(12, 12), micro(12, 12), c)],
    ['the other card was only hovered', (t: MacroTool, c: ReturnType<typeof linkCtx>['ctx']) => t.onPointerMove(m(12, 12), micro(12, 12), c)],
    ['the other card refused the cell', (t: MacroTool, c: ReturnType<typeof linkCtx>['ctx']) => t.onPointerDown(m(0, 0), micro(0, 0), c)],
  ])('a mark does not survive a card switch: %s', (_name, detour) => {
    const { tool, ctx } = armLink();
    tool.onPointerDown(m(5, 5), micro(5, 5), ctx);          // mark 1
    expect(tool.hasPending()).toBe(true);
    detour(tool, { ...ctx, armedMacro: 'patch-tree', armingEpoch: 1 } as typeof ctx);
    const backAgain = { ...ctx, armedMacro: 'road-link', armingEpoch: 2 } as typeof ctx;
    tool.onPointerDown(m(20, 20), micro(20, 20), backAgain); // must be a fresh mark 1, not a commit
    expect(tool.hasPending()).toBe(true);
    // No road-link commit happened: whatever the detour added, no route between (5,5) and (20,20)
    // exists — the cells between them carry no coating.
    expect(roadBetween(ctx.gridState, m(5, 5), m(20, 20))).toBe(false);
  });

  it('a mark does not survive a SILENT round trip, with no pointer event between the cards', () => {
    // The way an id comparison cannot see: the tool is asked nothing while the two cards are
    // clicked, and by the time the pointer returns the id is `road-link` again. The epoch has
    // counted two changes, which is the difference between "unchanged" and "changed twice".
    const { tool, ctx } = armLink();
    tool.onPointerDown(m(5, 5), micro(5, 5), ctx);
    expect(tool.hasPending()).toBe(true);
    const backAgain = { ...ctx, armedMacro: 'road-link', armingEpoch: 2 } as typeof ctx;
    tool.onPointerDown(m(20, 20), micro(20, 20), backAgain);
    expect(tool.hasPending()).toBe(true);
    expect(roadBetween(ctx.gridState, m(5, 5), m(20, 20))).toBe(false);
  });

  it('onDeactivate clears the mark, so a mode switch abandons the gesture', () => {
    const { tool, ctx } = armLink();
    tool.onPointerDown(m(5, 5), micro(5, 5), ctx);
    expect(tool.hasPending()).toBe(true);
    tool.onDeactivate(ctx);
    expect(tool.hasPending()).toBe(false);
  });
});

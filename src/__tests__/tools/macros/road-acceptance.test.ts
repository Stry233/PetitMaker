/** Road drag and network acceptance: complete previews, connectivity, materials, widths and undo. */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { categoryOf } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { MacroTool } from '../../../tools/macros/macro-tool';
import { applyMacro, type MacroOpts } from '../../../tools/macros';
import { previewMacro } from '../../../tools/macros/preview';
import { setToastPresenter } from '../../../core/runtime/toast-bus';
import { gateTerminalCells } from '../../../tools/placement/route';
import { OFFER_ORDER } from '../../../tools/placement/route-offers';
import { clearAllObjects, generateTerrain } from '../../../tools/generation/terrain-generator';
import { cloneGridState } from '../../../core/model/grid-model';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import type { ToolContext } from '../../../tools/runtime/types';
import {
  CellZone, ItemCategory, TerrainType,
  type Command, type EditorEvents, type GenerateConfig, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';

const SIZE = 45;
const SHORE = 3;
const ISLAND = 96;

interface Kit { state: GridState; executor: CommandExecutor; registry: ReturnType<CommandExecutor['getRegistry']> }

/** An open, flat, buildable map with a sea border. */
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

/** A generated planet, terrain only. Cached per seed and handed out as a clone: generation is the
 *  expensive half of the one case that needs one. */
const islands = new Map<number, GridState>();
function generatedIsland(seed: number): Kit {
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
      // TERRAIN ONLY: the planet generator furnishes what it builds, and this fixture is
      // about relief. What stands on it is the case's own subject, planted or laid below.
      clearAllObjects(state, (c: Command) => exec.execute(c));
    });
    exec.commitStrokeGroup(exec.getUndoStackSize());
    islands.set(seed, base);
  }
  const state = cloneGridState(base);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

/** A 4-wide water strip capped top and bottom by mountain, so it has no exposed face: the banks are
 *  23 cells apart and the only way across is a bridge (`road-contract.test.ts`'s own ford). */
function ford(kit: Kit): void {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 20; x <= 23; x++) {
      if (y < 15 || y > 24) setTerrain(kit.state, x, y, TerrainType.Mountain, 1);
      else setTerrain(kit.state, x, y, TerrainType.Water, 0);
    }
  }
}

/** The southern half of the map one level up: a route from north to south has to ramp. */
function terrace(kit: Kit): void {
  for (let y = 24; y < SIZE - SHORE; y++) for (let x = SHORE; x < SIZE - SHORE; x++) {
    setTerrain(kit.state, x, y, TerrainType.Mountain, 1);
  }
}

function place(kit: Kit, catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0, elevation = 0): PlacedObject {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation, elevation };
  const r = kit.executor.execute(objectPlacementCommand(obj));
  expect(r.success, `place ${catalogId}@${x},${y}: ${r.errors?.[0]?.message ?? ''}`).toBe(true);
  return obj;
}

const at = (x: number, y: number): MacroCoord => ({ x, y });
const key = (c: MacroCoord): string => `${c.x},${c.y}`;

/** Let the airborne preview land — `previewMacroAsync` resolves on a microtask with no worker
 *  installed, so one macrotask is enough. */
const settle = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

function roadObjects(state: GridState): PlacedObject[] {
  return [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
}

function crossings(state: GridState): PlacedObject[] {
  return [...state.objects.values()]
    .filter((o) => categoryOf(o) === ItemCategory.Bridge || categoryOf(o) === ItemCategory.Ramp);
}

function pavedCells(state: GridState): Set<string> {
  const paved = new Set<string>();
  for (const o of roadObjects(state)) {
    const r = objectRect(o);
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) for (let x = Math.floor(r.x); x < r.x + r.w; x++) paved.add(`${x},${y}`);
  }
  return paved;
}

function decorations(state: GridState): PlacedObject[] {
  return [...state.objects.values()].filter((o) => {
    const cat = categoryOf(o);
    return cat === ItemCategory.Tree || cat === ItemCategory.Flora;
  });
}

/**
 * Every cell a walk along the map's roads may use: pavement, plus each crossing deck AND the ring
 * around it. The apron is not slack — the `flat` trait refuses a road tile at a deck's own
 * transition, so a bare doorstep at a crossing is the design's documented neck. Anything wider is a
 * break, which is what these cases measure.
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

/** Which piece the road nearest `at` belongs to, or -1 when none stands within `slack` cells: a tap
 *  is a point a hand aimed at, and the planner snaps it to the nearest cell a road can stand on. */
function pieceAt(comps: string[][], target: MacroCoord, slack = 2): number {
  for (let i = 0; i < comps.length; i++) {
    for (const k of comps[i]!) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      if (Math.abs(x - target.x) + Math.abs(y - target.y) <= slack) return i;
    }
  }
  return -1;
}

/** The endpoints are joined by ONE piece of road. */
function expectJoined(state: GridState, from: MacroCoord, to: MacroCoord): void {
  const comps = components(roadWalk(state));
  const a = pieceAt(comps, from), b = pieceAt(comps, to);
  expect(a, 'no road stands near the first tap').toBeGreaterThanOrEqual(0);
  expect(b, 'no road stands near the second tap').toBeGreaterThanOrEqual(0);
  expect(a, `the route came out in pieces of ${comps.map((c) => c.length).join(',')} cells`).toBe(b);
}

interface Ghost { cells: MacroCoord[]; losses: MacroCoord[] }

/**
 * A `road-link`-armed context whose overlay keeps every `showGhost` payload — what the tool
 * PROMISED, in the tool's own words — and whose toasts are collected, since a toast is the only
 * thing the tool says out loud and several of these cases are about what the user is told.
 */
function linkTool(kit: Kit, over: Partial<ToolContext> = {}): {
  tool: MacroTool; ctx: ToolContext; ghosts: Ghost[]; toasts: string[];
} {
  const ghosts: Ghost[] = [];
  const overlay = {
    showGhost(cells: MacroCoord[], _color: number, _terrainGrid?: boolean, _trim?: unknown, losses?: readonly MacroCoord[]) {
      ghosts.push({ cells: [...cells], losses: losses ? [...losses] : [] });
    },
    showGhostSpans() {}, clearGhost() {}, flashCommit() {},
  };
  const toasts: string[] = [];
  setToastPresenter((text) => { toasts.push(text); });
  const ctx = makeToolCtx(kit.state, kit.executor, 1, 1, { armedMacro: 'road-link', overlay: overlay as unknown as ToolContext['overlay'], ...over });
  const tool = new MacroTool();
  tool.onActivate();
  return { tool, ctx, ghosts, toasts };
}

/** A road drag through the actual tool pointer lifecycle. */
async function dragRoad(
  d: { tool: MacroTool; ctx: ToolContext }, from: MacroCoord, to: MacroCoord,
): Promise<void> {
  d.tool.onPointerDown(from, from as never, d.ctx);
  d.tool.onPointerMove(to, to as never, d.ctx);
  await settle();
  d.tool.onPointerUp(to, to as never, d.ctx);
}

/** Every object id the map gained while `body` ran, as cells. */
/** Two taps on the generated planet whose route has to take a crossing, searched for on the fixture
 *  rather than remembered: a coarse lattice of standable cells, paired east-west at link range and
 *  across a tier step, and the first pair a link actually joins over a bridge or a ramp wins. It
 *  throws rather than skipping if the planet offers none — a fixture with no step in it cannot ask
 *  this question, and passing quietly would hide that. */
function pairOverACrossing(): { from: MacroCoord; to: MacroCoord } {
  const probe = generatedIsland(11);
  const { width: W, height: H } = probe.state.template;
  const standable = (x: number, y: number): number | null => {
    const cell = probe.state.cells[y]?.[x];
    if (!cell || cell.zone !== CellZone.Grass) return null;
    if (cell.terrain && cell.terrain.type !== TerrainType.Mountain) return null;
    return cell.terrain?.elevation ?? 0;
  };
  for (let y = 8; y < H - 8; y += 6) {
    for (let x = 8; x < W - 26; x += 4) {
      const a = standable(x, y);
      if (a === null) continue;
      for (const span of [18, 22, 26]) {
        const b = standable(x + span, y);
        if (b === null || b === a) continue;
        const trial = generatedIsland(11);
        const from = at(x, y), to = at(x + span, y);
        const outcome = applyMacro(trial, 'road-link', { seed: 1, from, at: to });
        if (outcome.changes > 0 && crossings(trial.state).length > 0) return { from, to };
      }
    }
  }
  throw new Error('the fixture no longer offers a pair whose route takes a crossing');
}

function laidBy(kit: Kit, body: () => void): Set<string> {
  const before = new Set(kit.state.objects.keys());
  body();
  const laid = new Set<string>();
  for (const [id, o] of kit.state.objects) if (!before.has(id)) laid.add(key(o.position));
  return laid;
}

describe('acceptance: the ghost promises what the press lays', () => {
  it('gesture 1: the route the bar\'s own material and width would lay, coating losses included', async () => {
    const kit = makeKit();
    // Off the direct line but inside a width-3 dilation's reach: the standing dirt tile is a LOSS,
    // and the ghost has to say so before the press replaces it with the armed material.
    const dirt = place(kit, 'path-overgrown-dirt', 20, 11);
    const d = linkTool(kit, { tileMaterial: 'path-cobblestone', brushSize: 3 });

    d.tool.onPointerDown(at(10, 10), at(10, 10), d.ctx);
    d.tool.onPointerMove(at(30, 10), at(30, 10), d.ctx);
    await settle();
    const ghost = d.ghosts[d.ghosts.length - 1]!;
    expect(ghost.cells.length).toBeGreaterThan(0);
    expect(ghost.losses.map(key)).toContain(key(dirt.position));

    const laid = laidBy(kit, () => { d.tool.onPointerUp(at(30, 10), at(30, 10), d.ctx); });
    expect(new Set(ghost.cells.map(key))).toEqual(laid);
    expect(kit.state.objects.has(dirt.id), 'the standing coating was reused rather than replaced').toBe(false);
    const replaced = roadObjects(kit.state).find((o) => o.position.x === 20 && o.position.y === 11);
    expect(replaced?.catalogId, 'the run paved in the bar\'s own material').toBe('path-cobblestone');
  });

  it('gesture 2: a door spur into a standing street', async () => {
    const kit = makeKit();
    for (let x = 8; x <= 34; x++) place(kit, 'path-overgrown-dirt', x, 10);
    const house = place(kit, 'building-myhouse', 20, 24, 0);
    const d = linkTool(kit);

    d.tool.onPointerDown(house.position, house.position, d.ctx);
    d.tool.onPointerMove(at(20, 10), at(20, 10), d.ctx);
    await settle();
    const ghost = d.ghosts[d.ghosts.length - 1]!;
    expect(ghost.cells.length).toBeGreaterThan(0);

    const laid = laidBy(kit, () => { d.tool.onPointerUp(at(20, 10), at(20, 10), d.ctx); });
    expect(new Set(ghost.cells.map(key))).toEqual(laid);
  });

  it('the programmatic network operation commits exactly its previewed footprint', () => {
    const kit = makeKit();
    place(kit, 'building-myhouse', 10, 10);
    place(kit, 'building-bamboo-cabin', 30, 30, 180);
    const opts: MacroOpts = { seed: 1 };

    const preview = previewMacro(kit, 'roads', opts);
    expect(preview.added.length).toBeGreaterThan(0);

    const laid = laidBy(kit, () => {
      const outcome = applyMacro(kit, 'roads', opts);
      expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    });
    expect(new Set(preview.added.map(key))).toEqual(laid);
  });
});

describe('acceptance: the contract, through the tool', () => {
  it('a WIDE route through a garden leaves every plant standing, and says the road necked', async () => {
    const kit = makeKit();
    const planted: PlacedObject[] = [];
    // Flora only, on a lattice: a tree carries an exclusionRadius, so a bed of them cannot be
    // planted this densely in the first place.
    for (let x = 12; x <= 32; x += 2) for (const y of [8, 9, 11, 12]) planted.push(place(kit, 'flower-daisy', x, y));
    expect(planted.length).toBeGreaterThan(20);

    // Width 3: at width 1 the corridor threads between the plants and the question never arises. The
    // dilation is the only thing that ever reached a hand's planting.
    const d = linkTool(kit, { brushSize: 3 });
    const depth = kit.executor.getUndoStackSize();
    await dragRoad(d, at(10, 10), at(34, 10));

    expect(roadObjects(kit.state).length, 'the second tap laid no road at all').toBeGreaterThan(0);
    expect(kit.executor.getUndoStackSize(), 'the route did not land as one undo entry').toBe(depth + 1);
    for (const p of planted) {
      expect(kit.state.objects.has(p.id), `${p.catalogId}@${p.position.x},${p.position.y} was swept`).toBe(true);
    }
    const paved = pavedCells(kit.state);
    for (const p of planted) {
      expect(paved.has(key(p.position)), `pavement was laid over ${p.catalogId}@${key(p.position)}`).toBe(false);
    }
    expect(d.toasts, 'the corridor narrowed round a planting and the run said nothing').toContain('smart.road_necked');
  });

  it('a planting on the only way through is SHOWN as a loss, and the press refuses rather than laying half a road', async () => {
    const kit = makeKit();
    // A one-cell-wide land bridge at x=22 across an impassable band, far wider than any catalog
    // bridge can span: any route north-to-south must cross exactly that column
    // (`road-contract.test.ts`'s own bottleneck).
    for (let y = 12; y <= 33; y++) for (let x = SHORE; x <= SIZE - 1 - SHORE; x++) {
      if (x >= 21 && x <= 23) continue;
      kit.state.cells[y]![x]!.zone = CellZone.Void;
    }
    const flower = place(kit, 'flower-daisy', 22, 22);
    const d = linkTool(kit);

    d.tool.onPointerDown(at(20, 6), at(20, 6), d.ctx);
    d.tool.onPointerMove(at(24, 40), at(24, 40), d.ctx);
    await settle();

    const ghost = d.ghosts[d.ghosts.length - 1]!;
    expect(ghost.losses.map(key), 'the ghost never named the cell it cannot have').toContain(key(flower.position));
    expect(kit.state.objects.has(flower.id), 'a hover removed something').toBe(true);

    d.tool.onPointerUp(at(24, 40), at(24, 40), d.ctx);
    expect(kit.state.objects.has(flower.id), 'the blocking flower was swept by the press').toBe(true);
    expect(roadObjects(kit.state), 'half a road was left on either side of the flower').toEqual([]);
    expect(d.toasts, 'nothing was laid and the tool said nothing').toContain('smart.blocked');
  });

  it('no flora rides along', async () => {
    const kit = makeKit();
    const kit3 = makeKit();
    place(kit3, 'building-myhouse', 10, 10);
    place(kit3, 'building-bamboo-cabin', 30, 30, 180);

    const d = linkTool(kit);
    await dragRoad(d, at(10, 10), at(34, 10));
    expect(roadObjects(kit.state).length).toBeGreaterThan(0);
    expect(decorations(kit.state), 'the dragged route planted a roadside').toEqual([]);

    const whole = applyMacro(kit3, 'roads', { seed: 1 });
    expect(whole.changes, whole.reason ?? '').toBeGreaterThan(0);
    expect(decorations(kit3.state), 'the whole-map press planted a roadside').toEqual([]);
  });

  it('the beautifier runs at the bar\'s own trim setting, and only then', async () => {
    const trimmed = (o: PlacedObject): boolean => !!o.corners && o.corners.some((c) => c !== 'square');
    const layBent = async (autoEdgeCut: 'round' | 'off'): Promise<Kit> => {
      const kit = makeKit();
      const d = linkTool(kit, { autoEdgeCut });
      await dragRoad(d, at(10, 10), at(30, 30));
      expect(roadObjects(kit.state).length, `trim ${autoEdgeCut}: nothing was laid`).toBeGreaterThan(0);
      return kit;
    };

    expect(roadObjects((await layBent('round')).state).some(trimmed), 'trim "round" left every corner square').toBe(true);
    expect(roadObjects((await layBent('off')).state).some(trimmed), 'trim "off" trimmed a corner anyway').toBe(false);
  });
});

describe('acceptance: a gate is a terminal', () => {
  it('gesture 2: the spur ends in the gate strip it was tapped for', async () => {
    const kit = makeKit();
    for (let x = 8; x <= 34; x++) place(kit, 'path-overgrown-dirt', x, 10);
    const house = place(kit, 'building-myhouse', 20, 24, 0);
    const d = linkTool(kit);

    d.tool.onPointerDown(house.position, house.position, d.ctx);
    d.tool.onPointerUp(at(20, 10), at(20, 10), d.ctx);
    const paved = pavedCells(kit.state);
    const strip = gateTerminalCells(objectRect(house), house.rotation);
    expect(strip.some((c) => paved.has(key(c))), 'the spur stopped short of the door').toBe(true);
  });

  it('pressing a served door waits for a drag without paving again', () => {
    const kit = makeKit();
    for (let x = 8; x <= 34; x++) place(kit, 'path-overgrown-dirt', x, 10);
    const house = place(kit, 'building-myhouse', 20, 24, 0);
    // The APPROACH row only: the strip's first three cells are the footprint's own gate row, and a
    // coating there overlaps the house.
    for (const c of gateTerminalCells(objectRect(house), house.rotation).slice(0, 3)) place(kit, 'path-overgrown-dirt', c.x, c.y);

    const d = linkTool(kit);
    const before = roadObjects(kit.state).length;
    const depth = kit.executor.getUndoStackSize();
    d.tool.onPointerDown(house.position, house.position, d.ctx);

    expect(roadObjects(kit.state).length, 'a served door was paved again').toBe(before);
    expect(kit.executor.getUndoStackSize(), 'a press that laid nothing left an undo entry').toBe(depth);
    expect(d.toasts).toEqual([]);
  });

  it('gesture 3: EVERY house the whole-map press connected is paved to its door', () => {
    const kit = makeKit();
    // Three houses, three facings, all on open flat ground the press can reach: the clause is about
    // the LAST cell of a spur, and a gate that rotates with its house is the case a spur misses.
    // No terrain stands between them, so every door here is reachable and the run has no excuse.
    const houses = [
      place(kit, 'building-myhouse', 8, 8, 0),
      place(kit, 'building-boat-cabin', 26, 8, 180),
      place(kit, 'building-forest-cabin', 16, 26, 90),
    ];

    const outcome = applyMacro(kit, 'roads', { seed: 1 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(outcome.code, 'the press reported a refusal on ground that has none').toBeUndefined();

    const paved = pavedCells(kit.state);
    for (const h of houses) {
      const strip = gateTerminalCells(objectRect(h), h.rotation);
      expect(strip.some((c) => paved.has(key(c))), `${h.catalogId}@${key(h.position)}: no pavement at its door`).toBe(true);
    }
    // One network, not three spurs that never met.
    const comps = components(roadWalk(kit.state));
    expect(comps.length, `the streets came out in pieces of ${comps.map((c) => c.length).join(',')} cells`).toBe(1);
  });

  it('gesture 1: a route whose second tap lands on a house paves that house\'s gate strip', async () => {
    const kit = makeKit();
    const house = place(kit, 'building-myhouse', 30, 20, 0);
    // A planting off the line, so the pair drafts more than one way to go and the commit is the
    // multi-offer one a bare map never asks for.
    for (const y of [14, 15, 16]) place(kit, 'flower-daisy', 22, y);

    const d = linkTool(kit);
    await dragRoad(d, at(10, 20), house.position);

    expect(roadObjects(kit.state).length, 'the second tap laid nothing').toBeGreaterThan(0);
    const paved = pavedCells(kit.state);
    const strip = gateTerminalCells(objectRect(house), house.rotation);
    expect(strip.some((c) => paved.has(key(c))), 'the route reached the house but not its door').toBe(true);
  });
});

describe('acceptance: the route joins the endpoints, or lays nothing', () => {
  it('however many ways round the map offers, the second tap lays the one the ghost drew', async () => {
    const kit = makeKit();
    // A lake between the taps: round it and over it are genuinely different lines, so more than one
    // offer survives the collapse. `road-link-gesture.test.ts` pins that the tap COMMITS on such a
    // map; what is asserted here is that what it commits is the line the ghost had drawn, since the
    // ghost and the commit name their offer in two different methods.
    for (let y = 15; y <= 25; y++) for (let x = 18; x <= 26; x++) setTerrain(kit.state, x, y, TerrainType.Water, 0);
    const from = at(10, 20), to = at(34, 20);
    expect(previewMacro(kit, 'road-link', { seed: 1, from, at: to }).offers.length,
      'the fixture drafts one way to go, so it cannot ask the question').toBeGreaterThan(1);

    const d = linkTool(kit);
    const depth = kit.executor.getUndoStackSize();
    d.tool.onPointerDown(from, from as never, d.ctx);
    d.tool.onPointerMove(to, to as never, d.ctx);
    await settle();
    const ghost = d.ghosts[d.ghosts.length - 1]!;
    expect(ghost.cells.length).toBeGreaterThan(0);

    const laid = laidBy(kit, () => { d.tool.onPointerUp(to, to as never, d.ctx); });
    expect(laid.size, 'the second tap laid nothing').toBeGreaterThan(0);
    expect(new Set(ghost.cells.map(key)), 'the tap laid a different way round than the ghost drew').toEqual(laid);
    expect(kit.executor.getUndoStackSize(), 'the route did not land as one undo entry').toBe(depth + 1);
    expectJoined(kit.state, from, to);
  });

  it('across a ford: the bridge is IN the road, and the road is one piece', async () => {
    const kit = makeKit();
    ford(kit);
    const from = at(10, 19), to = at(33, 19);
    const d = linkTool(kit);
    await dragRoad(d, from, to);

    expect(roadObjects(kit.state).length, 'the second tap laid nothing').toBeGreaterThan(0);
    expect(crossings(kit.state).some((o) => categoryOf(o) === ItemCategory.Bridge),
      'a route across water laid no bridge').toBe(true);
    expectJoined(kit.state, from, to);
    expect(d.toasts, 'a route that worked reported a refusal').toEqual([]);
  });

  it('up a terrace: the ramp is IN the road, and the road is one piece', async () => {
    const kit = makeKit();
    terrace(kit);
    const from = at(22, 14), to = at(22, 36);
    const d = linkTool(kit);
    await dragRoad(d, from, to);

    expect(roadObjects(kit.state).length, 'the second tap laid nothing').toBeGreaterThan(0);
    expect(crossings(kit.state).some((o) => categoryOf(o) === ItemCategory.Ramp),
      'a route up a step laid no ramp').toBe(true);
    expectJoined(kit.state, from, to);
  });

  it('on a GENERATED planet, where a crossing snaps away from its plan, the road is still one piece', async () => {
    // A hand-built ford or terrace joins whether or not the run stitches its pavement: the deck
    // lands where the plan put it. What breaks the route is a `waterSpan`/`heightDrop` trait moving
    // a realized deck several cells along its own axis, so the plan's approach cells fall under it
    // or a cell short of its entrance — and that needs real terrain.
    //
    // THE PAIR IS FOUND, NOT WRITTEN DOWN. The taps have to sit on ground the generator happened to
    // build a step between, so a pair copied into the file goes stale the next time the terrain moves.
    const { from, to } = pairOverACrossing();
    const kit = generatedIsland(11);
    const d = linkTool(kit);
    await dragRoad(d, from, to);

    expect(roadObjects(kit.state).length, 'the second tap laid nothing').toBeGreaterThan(0);
    expect(crossings(kit.state).length, 'the fixture no longer routes over a crossing').toBeGreaterThan(0);
    expectJoined(kit.state, from, to);
    expect(d.toasts, 'a route that worked reported a refusal').toEqual([]);
  });

  it('a route may cross the bridge the hand already built, and leaves it where it stood', async () => {
    const kit = makeKit();
    // A lake that reaches neither edge: 4 wide, 21 tall, so a way round exists and is twice as long.
    for (let y = 10; y <= 30; y++) for (let x = 20; x <= 23; x++) setTerrain(kit.state, x, y, TerrainType.Water, 0);
    const from = at(10, 19), to = at(33, 19);
    const bridge = place(kit, 'bridge-plank', 20, 19);
    const wasAt = { ...bridge.position };

    const d = linkTool(kit);
    await dragRoad(d, from, to);

    expect(kit.state.objects.get(bridge.id)?.position, 'the standing bridge was moved or removed').toEqual(wasAt);
    expect(crossings(kit.state).length, 'a second crossing was built beside the one already there').toBe(1);
    expectJoined(kit.state, from, to);
    expect(roadObjects(kit.state).length, 'the route walked round the lake instead of over the bridge')
      .toBeLessThanOrEqual(30);
  });
});

describe('acceptance: the map\'s own character routes the press', () => {
  // The turn-penalty half of `readRoadStyle` is pinned at the unit level (`road-style.test.ts`):
  // over the fixtures a dragged route can actually be laid on, the straightener collapses the
  // rectilinear and the organic answer onto the same line, so the style the map was measured at is
  // not observable from the pavement here.
  //
  // The MATERIAL half runs only where the caller names none, which is why these three drive
  // `applyMacro`: `state/slices/edit.ts` seeds `tileMaterial` with the first road in the catalog and
  // never clears it, so both `MacroTool.linkOpts` and `SmartBuild.tsx` always name one and the
  // learned material is always overridden. The agent's `build_road_network` is the caller that
  // reaches this, and it is the caller these cases stand for.
  it.each(['path-simple-brick', 'path-park-stone', 'path-cobblestone'])('a new lane is paved in the standing street\'s own surface: %s', (material) => {
    const kit = makeKit();
    for (let y = 8; y <= 30; y++) place(kit, material, 30, y);

    const before = new Set(kit.state.objects.keys());
    const outcome = applyMacro(kit, 'road-link', { seed: 1, from: at(12, 20), at: at(28, 20) });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    const fresh = [...kit.state.objects.values()].filter((o) => !before.has(o.id) && categoryOf(o) === ItemCategory.Road);
    expect(fresh.length).toBeGreaterThan(0);
    expect([...new Set(fresh.map((o) => o.catalogId))]).toEqual([material]);
  });

  it('a route joins a standing street rather than stopping beside it', async () => {
    const kit = makeKit();
    for (let y = 6; y <= 34; y++) place(kit, 'path-overgrown-dirt', 28, y);

    const before = new Set(kit.state.objects.keys());
    const d = linkTool(kit);
    await dragRoad(d, at(10, 15), at(28, 20));

    const fresh = [...kit.state.objects.values()].filter((o) => !before.has(o.id) && categoryOf(o) === ItemCategory.Road);
    expect(fresh.length, 'the second tap laid nothing').toBeGreaterThan(0);
    // Orthogonally adjacent to a cell of the standing street: the new lane MEETS the line.
    const meets = fresh.some((o) => o.position.x === 27 && o.position.y >= 6 && o.position.y <= 34);
    expect(meets, 'the new lane never reached the street it was routed to').toBe(true);
  });
});

describe('acceptance: the same taps lay the same road', () => {
  it('ten runs of one pair are identical, object for object', () => {
    const shot = (): string => {
      const kit = makeKit();
      for (let x = 15; x <= 25; x++) setTerrain(kit.state, x, 18, TerrainType.Water, 0);
      applyMacro(kit, 'road-link', { seed: 7, from: at(10, 22), at: at(34, 12), trim: 'round' });
      return [...kit.state.objects.values()]
        .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}:${o.rotation}:${(o.corners ?? []).join('')}`)
        .sort().join('|');
    };
    const first = shot();
    expect(first.length, 'the fixture laid nothing to compare').toBeGreaterThan(0);
    for (let n = 0; n < 9; n++) expect(shot()).toBe(first);
  });

  it('the offers come back in the drafting order, every time', () => {
    const kit = makeKit();
    // A lake between the taps: the way round and the way across are genuinely different lines, so
    // more than one offer survives the collapse.
    for (let y = 15; y <= 25; y++) for (let x = 18; x <= 26; x++) setTerrain(kit.state, x, y, TerrainType.Water, 0);
    const opts: MacroOpts = { seed: 1, from: at(10, 20), at: at(34, 20) };

    const offers = previewMacro(kit, 'road-link', opts).offers;
    expect(offers.length).toBeGreaterThan(1);
    const order = [...offers].sort((a, b) => OFFER_ORDER.indexOf(a as never) - OFFER_ORDER.indexOf(b as never));
    expect(offers, 'the offers came back out of OFFER_ORDER').toEqual(order);

    for (let n = 0; n < 3; n++) {
      const again = makeKit();
      for (let y = 15; y <= 25; y++) for (let x = 18; x <= 26; x++) setTerrain(again.state, x, y, TerrainType.Water, 0);
      expect(previewMacro(again, 'road-link', opts).offers).toEqual(offers);
    }
  });
});

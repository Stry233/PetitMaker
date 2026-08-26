/**
 * A gimmick is a testable thing: output that never varies, ignores its context, or is quietly
 * empty. These are the generator's own design-quality probes (`tools/generation/design-quality.test.ts`)
 * applied to the macros.
 *
 * Seven of them were written failing and marked with vitest's `it.fails` rather than softened, which
 * is what specified the work that followed: the mound had no rng in the file at all and read the
 * surface only to skip a cell already high enough, the ecology could put a glade exactly where the
 * user pointed and plant nothing, and the stream carved the same ten cells at every dial setting.
 * All seven are ordinary tests now.
 *
 * ONE FIXTURE: a terraced cone near the west shore with flat grass east of it. Each macro is aimed
 * where its own material is, because a probe that fails for want of ground says nothing about the
 * macro. A stream is pointed at the cone's flank, since water has to fall from somewhere and reach
 * somewhere; everything else is pointed at the flat, which is where a person aims them.
 */
import { describe, expect, it, vi } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultTerrainCell } from '../../../core/model/grid-model';
import {
  CellZone, TerrainType,
  type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../core/model/object-id';
import { applyMacro, type MacroId, type MacroOpts } from '../../../tools/macros';
import { MacroTool } from '../../../tools/macros/macro-tool';
import type { ToolContext } from '../../../tools/runtime/types';
import type { KitContext } from '../../../kit/context';
import { createDefaultRegistry } from '../../../rules';
import { makeState } from '../../rules/_helpers';

/** The macros that build where the user pointed. `roads` works over the whole region instead, so it
 *  takes no aim point and answers no dial. `road-link` is aimed at a POINT PAIR rather than a disc
 *  around one cell, so it sits outside `AIMED` too: it has no ground to "read" under a radius, no
 *  dial that widens a footprint, and (by design — the same taps must lay the same road) no seed to
 *  vary by. Its own two-tap gesture is pinned directly, in `road-link.test.ts`. */
const AIMED: MacroId[] = ['raise', 'stream', 'patch-tree', 'patch-flora'];
const EVERY: MacroId[] = ['raise', 'stream', 'road-link', 'roads', 'patch-tree', 'patch-flora'];

const SIZE = 40;
/** Sea all the way round, so a course has a coast to reach. */
const SHORE = 3;
/** The relief on the map, set well west of centre so its flank is a short walk from the shore. */
const CONE = { at: { x: 14, y: 20 }, radius: 6, peak: 6 };
/** Tier 2 on the cone's western flank: two terraces to fall down and then open ground to the sea. */
const FLANK: MacroCoord = { x: 10, y: 20 };
/** Open grass east of the cone, well clear of its radius (cone spans x in [8,20]). */
const FLAT: MacroCoord = { x: 24, y: 20 };
/** road-link's FIRST tap: the same open column as `FLAT`, far enough north for a real route. */
const ROAD_FROM: MacroCoord = { x: 24, y: 10 };
const AIM: Record<MacroId, MacroCoord> = {
  raise: FLAT, 'patch-tree': FLAT, 'patch-flora': FLAT, roads: FLAT, stream: FLANK, 'road-link': FLAT,
};
/** road-link's own second tap, alongside `AIM`: absent for every other id. */
const FROM: Partial<Record<MacroId, MacroCoord>> = { 'road-link': ROAD_FROM };
const RADIUS = 5;

/** `AIM`/`radius`, plus `from` for `road-link` — the one id whose gesture is a point PAIR. Every
 *  probe below reads its opts through this, so the two-tap shape rides along automatically. */
function macroOpts(id: MacroId, seed: number, radius = RADIUS): MacroOpts {
  return { seed, at: AIM[id], radius, ...(FROM[id] ? { from: FROM[id] } : {}) };
}

interface Kit extends KitContext { executor: CommandExecutor }

function makeKit(): Kit {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x < SHORE || y < SHORE || x >= SIZE - SHORE || y >= SIZE - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  raiseCone(state, CONE.at, CONE.radius, CONE.peak);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

/** A wedding cake written straight into the cells: one tier per ring, so every neighbour is within
 *  one tier and V-MTN-03 holds by construction without going through the executor. */
function raiseCone(state: GridState, at: MacroCoord, radius: number, peak: number): void {
  for (let y = at.y - radius; y <= at.y + radius; y++) {
    for (let x = at.x - radius; x <= at.x + radius; x++) {
      const cell = state.cells[y]?.[x];
      if (!cell || cell.zone !== CellZone.Grass) continue;
      const tier = peak - Math.max(Math.abs(x - at.x), Math.abs(y - at.y));
      if (tier <= 0) continue;
      cell.terrain = createDefaultTerrainCell(TerrainType.Mountain, Math.max(tier, cell.terrain?.elevation ?? 0));
    }
  }
}

/**
 * A staircase rising to the south-east across `at`'s neighbourhood, one tier every four cells and
 * never lowering what is already there. The ground the "reads its ground" probe changes, and it has
 * to sit UNDER the aim point: relief somewhere else on the map is not the ground a macro lands on.
 *
 * Two things keep the result legal, and both are load-bearing: the ramp is feathered back down to
 * the edge of its own box, so no cell drops to bare ground from a tier V-MTN-03 owes a 3x3 base;
 * and a maximum of 1-Lipschitz fields is 1-Lipschitz, so laying it over the cone cannot open a step
 * neither of them had. An illegal fixture is not a hostile map for a macro to read, it is a map
 * where every post-stroke check fails and every macro reverts whole.
 */
function raiseSlope(kit: Kit, at: MacroCoord, reach = 6, cap = 3): void {
  for (let y = at.y - reach; y <= at.y + reach; y++) {
    for (let x = at.x - reach; x <= at.x + reach; x++) {
      const cell = kit.state.cells[y]?.[x];
      if (!cell || cell.zone !== CellZone.Grass) continue;
      const edge = reach - Math.max(Math.abs(x - at.x), Math.abs(y - at.y));
      const tier = Math.min(cap, Math.floor(((x - at.x) + (y - at.y) + 2 * reach) / 4), edge);
      if (tier <= 0) continue;
      cell.terrain = createDefaultTerrainCell(TerrainType.Mountain, Math.max(tier, cell.terrain?.elevation ?? 0));
    }
  }
}

function place(kit: Kit, catalogId: string, x: number, y: number): string | null {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0, elevation: 0 };
  return kit.executor.execute(objectPlacementCommand(obj)).success ? obj.id : null;
}

/** The fixture with work already standing on it: two buildings out on the flat for the router to
 *  connect, and two trees inside the aim disc for a macro to leave alone. */
function populatedKit(): { kit: Kit; mine: string[] } {
  const kit = makeKit();
  const mine = [
    place(kit, 'building-myhouse', 10, 30),
    place(kit, 'building-stall', 28, 30),
    place(kit, 'tree-appletree', 22, 18),
    place(kit, 'tree-appletree', 26, 22),
  ].filter((id): id is string => id !== null);
  expect(mine).toHaveLength(4);
  return { kit, mine };
}

/** Terrain and objects, ids excluded. An id is minted with `Date.now()`/`Math.random()` and is never
 *  seed-derived, so leaving one in would make every "does it vary" comparison pass on its own. So
 *  would the provenance ledger, which carries the seed. */
function shapeOf(state: GridState): string {
  const cells = state.cells.map((row) => row.map((c) => terrainMark(c.terrain)).join(' ')).join('\n');
  const objects = [...state.objects.values()]
    .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}/${o.rotation}/${o.elevation}/${o.spanLength ?? ''}`)
    .sort()
    .join('|');
  return `${cells}\n--\n${objects}`;
}

function terrainMark(t: GridState['cells'][number][number]['terrain']): string {
  return t ? `${t.type}:${t.elevation}${t.patchOnly ? 'p' : ''}` : '.';
}

/** Every cell's contents as one string, so two runs can be compared cell by cell. */
function marks(state: GridState): Map<string, string> {
  const out = new Map<string, string>();
  const here = new Map<string, string[]>();
  for (const o of state.objects.values()) {
    const key = `${o.position.x},${o.position.y}`;
    const at = here.get(key);
    if (at) at.push(o.catalogId);
    else here.set(key, [o.catalogId]);
  }
  state.cells.forEach((row, y) => row.forEach((cell, x) => {
    const key = `${x},${y}`;
    out.set(key, `${terrainMark(cell.terrain)}/${(here.get(key) ?? []).sort().join(',')}`);
  }));
  return out;
}

/** What a run left behind: only the cells whose contents changed, mapped to what they hold now. */
function delta(before: Map<string, string>, after: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, mark] of after) if (before.get(key) !== mark) out.set(key, mark);
  return out;
}

/** Terrain and objects with ids, which is what an undo has to put back exactly. */
function gridSnapshot(state: GridState): string {
  return JSON.stringify({ cells: state.cells, objects: [...state.objects.entries()] });
}

describe('a macro is not a gimmick', () => {
  it.each(AIMED)('%s makes a different thing for a different seed', (id) => {
    expectVaries(id);
  });

  function expectVaries(id: MacroId): void {
    const shapes = [1, 2, 3, 4, 5].map((seed) => {
      const kit = makeKit();
      expect(applyMacro(kit, id, { seed, at: AIM[id], radius: RADIUS }).changes, `${id} built nothing at seed ${seed}`).toBeGreaterThan(0);
      return shapeOf(kit.state);
    });
    expect(new Set(shapes).size, `${id} is the same at every seed`).toBeGreaterThan(3);
  }

  /**
   * A STAMP IS SUBTRACTIVE. Its shape was decided before the ground was read, so on higher ground it
   * lays the same thing on a subset of the same cells: every cell it touches gets exactly what it
   * would have got on the flat, and the ones already at that height are simply skipped. A macro that
   * reads its ground breaks that pattern somewhere, by laying on a cell the flat run never touched or
   * by leaving a different thing on one they share.
   *
   * Comparing the two finished maps instead would prove nothing: the sloped map differs before the
   * macro runs at all.
   */
  it.each(AIMED)('%s reads the ground it lands on', (id) => {
    expectReadsGround(id);
  });

  function expectReadsGround(id: MacroId): void {
    const run = (slope: boolean): Map<string, string> => {
      const kit = makeKit();
      if (slope) raiseSlope(kit, AIM[id]);
      const before = marks(kit.state);
      applyMacro(kit, id, { seed: 9, at: AIM[id], radius: RADIUS });
      return delta(before, marks(kit.state));
    };
    const flat = run(false);
    const sloped = run(true);
    expect(flat.size, `${id} built nothing on the flat fixture`).toBeGreaterThan(0);
    expect(sloped.size, `${id} built nothing on the sloped fixture`).toBeGreaterThan(0);

    const subtractive = [...sloped].every(([key, mark]) => flat.get(key) === mark);
    expect(subtractive, `${id} is a stamp: on different ground it laid the same thing on a subset of the same cells`).toBe(false);
  }

  it.each(EVERY)('%s is never silently empty', (id) => {
    const { kit } = populatedKit();
    const out = applyMacro(kit, id, macroOpts(id, 3));
    if (out.changes === 0) {
      expect(out.reason, `${id} did nothing and said nothing`).toBeTruthy();
      expect(out.reason!.length, `${id}'s reason is not a sentence`).toBeGreaterThan(12);
    } else {
      expect(out.changes).toBeGreaterThan(0);
    }
  });

  it.each(AIMED)('%s does not destroy what a person built', (id) => {
    const { kit, mine } = populatedKit();
    applyMacro(kit, id, { seed: 3, at: AIM[id], radius: RADIUS });
    for (const objectId of mine) expect(kit.state.objects.has(objectId), `${id} removed hand-placed work`).toBe(true);
  });

  it('road-link does not destroy what a person built', () => {
    const { kit, mine } = populatedKit();
    applyMacro(kit, 'road-link', macroOpts('road-link', 3));
    for (const objectId of mine) expect(kit.state.objects.has(objectId), 'road-link removed hand-placed work').toBe(true);
  });

  /**
   * A HELD press over what a person built: several staged bursts must never rewrite a hand-placed
   * tree or flower standing in the same disc, only grow the hold's own stand beside it. The single
   * press above already proves placement leaves them alone; this proves ageing does too.
   */
  it.each(['patch-tree', 'patch-flora'] as const)('%s: a held press does not destroy what a person built', (id) => {
    const kit = makeKit();
    const at = AIM[id];
    const hand = [
      place(kit, 'tree-appletree', at.x + 2, at.y),
      place(kit, 'flower-daisy', at.x - 2, at.y),
    ].filter((objectId): objectId is string => objectId !== null);
    expect(hand).toHaveLength(2);

    vi.useFakeTimers();
    try {
      const tool = new MacroTool();
      tool.onActivate();
      const ctx = {
        gridState: kit.state,
        overlay: { showGhost: vi.fn(), clearGhost: vi.fn() },
        getUndoStackSize: () => kit.executor.getUndoStackSize(),
        collapseHistory: (start: number) => kit.executor.collapseHistory(start),
        t: (key: string) => key,
        armedMacro: id,
        brushSize: RADIUS - 3,
        macroContext: { state: kit.state, executor: kit.executor, registry: kit.executor.getRegistry() },
      } as unknown as ToolContext;
      tool.onPointerDown(at as MacroCoord, { x: at.x, y: at.y }, ctx);
      // Several bursts: enough to climb the succession ladder.
      vi.advanceTimersByTime(350 * 5);
      tool.onPointerUp(at as MacroCoord, { x: at.x, y: at.y }, ctx);
    } finally {
      vi.useRealTimers();
    }

    for (const objectId of hand) {
      expect(kit.state.objects.has(objectId), `${id} held press removed hand-placed work`).toBe(true);
    }
  });

  it.each(AIMED)('%s answers its dial', (id) => {
    expectDialAnswers(id);
  });

  function expectDialAnswers(id: MacroId): void {
    const small = makeKit(), large = makeKit();
    const tight = applyMacro(small, id, { seed: 4, at: AIM[id], radius: 2 });
    const wide = applyMacro(large, id, { seed: 4, at: AIM[id], radius: 7 });
    expect(wide.changes, `${id} built nothing at its widest setting`).toBeGreaterThan(0);
    expect(tight.changes, `${id}'s dial does nothing`).not.toBe(wide.changes);
  }

  it.each(EVERY)('%s is one undo entry', (id) => {
    const { kit } = populatedKit();
    const before = gridSnapshot(kit.state);
    const depth = kit.executor.getUndoStackSize();

    const out = applyMacro(kit, id, macroOpts(id, 3));
    expect(kit.executor.getUndoStackSize(), `${id} landed as more than one entry`).toBeLessThanOrEqual(depth + 1);
    if (out.changes === 0) return;

    kit.executor.undo();
    expect(gridSnapshot(kit.state)).toBe(before);
  });
});

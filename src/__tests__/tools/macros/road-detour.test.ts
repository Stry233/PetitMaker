/**
 * A ROUTE CROSSES WHERE THE TWO TAPS ARE, NOT WHERE THE BEST FORD IS.
 *
 * Two things carry that and both are pinned here: the candidate POOL covers a whole seam rather
 * than the first few sites a row-major scan meets, and the SCORE leads with how far off the line
 * between the two taps a site lies.
 *
 * Without them — candidates scored on their own merits alone (narrow span, deck square to the
 * travel, a clear run-in on both banks) and the region graph walked on portal COST alone — nothing
 * in either decision knows where the road has been asked to go. On real islands that laid 125 cells
 * for an eleven-cell trip: fifteen cells east along the bank, over a bridge, twenty cells back west.
 * Over 75 tap pairs on three generated islands the median such route ran 2.2x the straight-line
 * distance between its taps and 28 of them ran past 3x.
 */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { roadLookup } from '../../../state/object-index';
import { categoryOf } from '../../../state/catalog';
import { cloneGridState } from '../../../core/model/grid-model';
import { clearAllObjects, generateTerrain } from '../../../tools/generation/terrain-generator';
import { analyzeTerrain } from '../../../tools/placement/analysis';
import { scoreCrossing, crossingDetour, type RouteWorld } from '../../../tools/placement/route';
import { applyMacro } from '../../../tools/macros';
import { makeState, setTerrain } from '../../rules/_helpers';
import {
  CellZone, ItemCategory, TerrainType,
  type Command, type EditorEvents, type GenerateConfig, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';
import type { Portal } from '../../../tools/placement/portals';

/** The style a bare map reads: no turn penalty, no learned alignment, no standing material. */
const DEFAULT_STYLE = { turnPenalty: 0, naturalness: 1, alignment: new Map<number, 'x' | 'y'>(), materialId: undefined, source: 'default' as const };

const SHORE = 3;
const CHANNEL = 80;
const ISLAND = 96;

interface Kit { state: GridState; executor: CommandExecutor; registry: ReturnType<CommandExecutor['getRegistry']> }
function kitOf(state: GridState): Kit {
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

/**
 * A map split top to bottom by a 4-wide channel: bridgeable at EVERY row, so the candidate scan
 * finds far more sites along the one seam than a small per-pair cap can hold, and the ones it keeps
 * are the first it meets — the northern ones. The taps sit in the far SOUTH, which is what makes
 * "which candidates were kept" visible in the road that gets laid.
 */
function channelKit(): Kit {
  const state = makeState(CHANNEL, CHANNEL);
  for (let y = 0; y < CHANNEL; y++) {
    for (let x = 0; x < CHANNEL; x++) {
      if (x < SHORE || y < SHORE || x >= CHANNEL - SHORE || y >= CHANNEL - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  for (let y = SHORE; y < CHANNEL - SHORE; y++) for (let x = 38; x <= 41; x++) setTerrain(state, x, y, TerrainType.Water, 0);
  return kitOf(state);
}

/** A generated island, terrain only — cached per seed and handed out as a clone. */
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

const man = (a: MacroCoord, b: MacroCoord): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const roadCount = (state: GridState): number =>
  [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road).length;
const crossingsOf = (state: GridState): PlacedObject[] => [...state.objects.values()]
  .filter((o) => categoryOf(o) === ItemCategory.Bridge || categoryOf(o) === ItemCategory.Ramp);

describe('a route crosses near its own taps', () => {
  it('bridges beside the taps on a seam with far more sites than the pool may keep', () => {
    const kit = channelKit();
    const from: MacroCoord = { x: 20, y: 68 }, to: MacroCoord = { x: 60, y: 68 };

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    const bridges = crossingsOf(kit.state);
    expect(bridges.length, 'nothing was built over the channel').toBe(1);
    const at = bridges[0]!.position;
    expect(Math.abs(at.y - from.y), `the bridge landed at y=${at.y}, ${Math.abs(at.y - from.y)} rows from the taps`)
      .toBeLessThanOrEqual(8);
    expect(roadCount(kit.state), 'the road walked far off the line between the taps')
      .toBeLessThanOrEqual(man(from, to) * 2);
  });

  it('on a generated island, a pair the sweep measured at 8x the straight line comes back under 3x', () => {
    const kit = islandKit(23);
    const from: MacroCoord = { x: 78, y: 37 }, to: MacroCoord = { x: 64, y: 48 };

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(roadCount(kit.state)).toBeLessThanOrEqual(man(from, to) * 3);
  });
});

describe('scoreCrossing weighs the detour first', () => {
  const world = (portals: Portal[]): RouteWorld => ({
    a: analyzeTerrain(makeState(60, 60)), portals, regionAdj: new Map(),
    road: new Set(), occupied: new Set(), style: DEFAULT_STYLE,
  });
  const ford = (y: number): Portal => ({
    kind: 'bridge', regionA: 0, regionB: 1, anchor: { x: 30, y },
    approachA: { x: 28, y }, approachB: { x: 32, y }, cost: 6,
  });

  it('a site on the line outscores an identical one twenty cells off it', () => {
    const from: MacroCoord = { x: 10, y: 30 }, to: MacroCoord = { x: 50, y: 30 };
    const near = ford(30), far = ford(50);
    const w = world([near, far]);
    expect(crossingDetour(near.anchor, from, to)).toBe(0);
    expect(crossingDetour(far.anchor, from, to)).toBe(40);
    // Same span, same run-in, and the far one is even squarer to the travel — the detour still wins.
    expect(scoreCrossing(w, near, from, to).span).toBeCloseTo(scoreCrossing(w, far, from, to).span, 10);
    expect(scoreCrossing(w, near, from, to).approach).toBe(scoreCrossing(w, far, from, to).approach);
    expect(scoreCrossing(w, near, from, to).total).toBeGreaterThan(scoreCrossing(w, far, from, to).total);
  });

  it('the same detour costs more on a short trip than on a long one', () => {
    const p = ford(40);
    const short = scoreCrossing(world([p]), p, { x: 25, y: 30 }, { x: 35, y: 30 }).detour;
    const long = scoreCrossing(world([p]), p, { x: 0, y: 30 }, { x: 59, y: 30 }).detour;
    expect(long).toBeGreaterThan(short);
  });
});

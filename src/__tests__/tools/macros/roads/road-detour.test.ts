/** Aimed roads cross near their endpoints on long seams and generated terrain. */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { categoryOf } from '../../../../state/catalog';
import { cloneGridState } from '../../../../core/model/grid-model';
import { clearAllObjects } from '../../../../tools/generation';
import { applyMacro } from '../../../../tools/macros';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { TerrainType, type Command, type GridState, type MacroCoord, type PlacedObject } from '../../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../../tools/generation/recipe';
import { CellZone } from '../../../../core/game/zones';
import { generateWith } from '../../../_support/generation';
import { ItemCategory } from '../../../../config/catalog/categories';

const SHORE = 3;
const CHANNEL = 80;
const ISLAND = 96;

interface Kit { state: GridState; executor: CommandExecutor; registry: ReturnType<CommandExecutor['getRegistry']> }
function kitOf(state: GridState): Kit {
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

/**
 * A map split top to bottom by a 4-wide channel: bridgeable at every row, so the candidate scan
 * finds far more sites along the one seam than a small per-pair cap can hold, and the ones it keeps
 * are the first it meets — the northern ones. The taps sit in the far south, which is what makes
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

/** A generated planet, terrain only — cached per seed and handed out as a clone. */
const islands = new Map<number, GridState>();
function islandKit(seed: number): Kit {
  let base = islands.get(seed);
  if (!base) {
    base = makeState(ISLAND, ISLAND);
    const exec = makeExecutor(base);
    const config: GenerateConfig = defaultConfig('designed', { maxElevation: 5, seed });
    const state = base;
    exec.transaction({ silent: true }, () => {
      generateWith(state, exec, config);
      // Terrain only: the planet generator furnishes what it builds, and this fixture is
      // about relief. What stands on it is the case's own subject, planted or laid below.
      clearAllObjects({ state, execute: (c: Command) => exec.execute(c) });
    });
    exec.beginStroke().commit();
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

  it('on a generated planet, a pair the sweep measured at 8x the straight line comes back under 3x', () => {
    const kit = islandKit(23);
    const from: MacroCoord = { x: 78, y: 37 }, to: MacroCoord = { x: 64, y: 48 };

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from, at: to });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(roadCount(kit.state)).toBeLessThanOrEqual(man(from, to) * 3);
  });
});

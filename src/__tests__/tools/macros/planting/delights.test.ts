/**
 * Rare delights: the press that lays a set piece instead of a stand.
 *
 * Three things make a surprise a feature rather than a bug, and all three are pinned here: it is
 * Rare and it is the seed's (so the same press always answers the same way and the ghost can show
 * it), every piece is rule-legal on arrival, and it never overrides a composition the user asked
 * for — a press beside a house lays the house's bed, whatever the seed rolled.
 */
import { placeObjectCommand } from '../../../../core/model/command-build';
import { describe, it, expect } from 'vitest';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../../../../core/model/types';
import type { CategoryRole } from '../../../../core/model/traits';
import { roleOf } from '../../../../state/catalog';
import { applyMacro, type MacroId } from '../../../../tools/macros';
import { delightIds, delightRoll, layDelight } from '../../../../tools/macros/planting/delights';
import { circleCells } from '../../../../core/grid/shapes';
import { generateObjectId } from '../../../../core/model/object-id';
import type { EditContext } from '../../../../core/commands/edit-context';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';

const SIZE = 44;
const AT = { x: 22, y: 22 };
const RADIUS = 8;
const SWEEP = 500;

const CARDS = [
  ['patch-tree', 'canopy'],
  ['patch-flora', 'groundcover'],
] as const;

function setup(state: GridState = makeState(SIZE, SIZE)): EditContext {
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

const shapeOf = (state: GridState): string => [...state.objects.values()]
  .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort().join('|');

/** The seeds that roll a set piece, in order. */
function delightSeeds(lead: CategoryRole, upTo: number): number[] {
  const out: number[] = [];
  for (let seed = 1; seed <= upTo; seed++) if (delightRoll(seed, lead)) out.push(seed);
  return out;
}

describe('how often a press is a delight', () => {
  it.each(CARDS)('%s rolls one on a few presses in a hundred, and can roll any of them', (_id, lead) => {
    const seeds = delightSeeds(lead, SWEEP);
    const rate = seeds.length / SWEEP;
    // Wide on purpose: what is pinned is that it stays a surprise, not the third decimal place.
    expect(rate, `the rate came out at ${rate}`).toBeGreaterThan(0.01);
    expect(rate).toBeLessThan(0.06);
    // Every authored piece is reachable — one the roll can never produce is one nobody will see.
    const seen = new Set(seeds.map((seed) => delightRoll(seed, lead)));
    expect([...seen].sort()).toEqual(delightIds(lead).sort());
  });

  it('answers the same seed the same way, whoever asks', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(delightRoll(seed, 'groundcover')).toBe(delightRoll(seed, 'groundcover'));
    }
  });
});

describe('a set piece on the map', () => {
  it.each(CARDS)('%s: every delight lands rule-clean, as one undo entry', (id, lead) => {
    const seeds = delightSeeds(lead, 200);
    expect(seeds.length, 'the sweep rolled no delight to check').toBeGreaterThan(2);
    for (const seed of seeds) {
      const kit = setup();
      const depth = kit.executor.historyDepth();
      const out = applyMacro(kit, id as MacroId, { seed, at: AT, radius: RADIUS });
      expect(out.changes, `seed ${seed}: the set piece laid nothing`).toBeGreaterThan(0);
      expect(out.reason, `seed ${seed}: ${out.reason}`).toBeUndefined();
      expect(kit.registry.validatePostStroke(kit.state), `seed ${seed}: the set piece broke a rule`).toEqual([]);
      expect(kit.executor.historyDepth()).toBe(depth + 1);
    }
  });

  it.each(CARDS)('%s: a set piece is drawn, not grown — its own role, one or two species', (id, lead) => {
    for (const seed of delightSeeds(lead, 200)) {
      const kit = setup();
      applyMacro(kit, id as MacroId, { seed, at: AT, radius: RADIUS });
      const objects = [...kit.state.objects.values()];
      for (const o of objects) expect(roleOf(o), `seed ${seed}: ${o.catalogId} is not this card's`).toBe(lead);
      // A stand is an ecology and reaches for a handful of species; a piece is a drawing in one or
      // two colours.
      expect(new Set(objects.map((o) => o.catalogId)).size, `seed ${seed}: too many species for a set piece`).toBeLessThanOrEqual(2);
    }
  });

  it('builds the same set piece at the same seed', () => {
    const seed = delightSeeds('groundcover', 200)[0]!;
    const run = (): string => {
      const kit = setup();
      applyMacro(kit, 'patch-flora', { seed, at: AT, radius: RADIUS });
      return shapeOf(kit.state);
    };
    const first = run();
    expect(first.length).toBeGreaterThan(0);
    expect(run()).toBe(first);
  });

  it('lays it once and repeats it: a hold neither extends nor ages a set piece', () => {
    const seed = delightSeeds('groundcover', 200)[0]!;
    const kit = setup();
    applyMacro(kit, 'patch-flora', { seed, at: AT, radius: RADIUS });
    const piece = shapeOf(kit.state);

    const next = applyMacro(kit, 'patch-flora', {
      seed: seed + 1, at: AT, radius: RADIUS, stage: 2, anchorSeed: seed,
    });
    expect(next.changes).toBe(0);
    expect(shapeOf(kit.state), 'a held press grew the set piece into a stand').toBe(piece);
  });
});

/**
 * The two gates, asked of `layDelight` itself rather than of a finished map: null is the answer that
 * hands the press back to the wild stand, and reading it directly is the only way to tell a gate
 * that closed from a piece the ground happened to refuse.
 */
describe('a set piece needs room and level ground', () => {
  const seed = delightSeeds('canopy', 200)[0]!;

  const disc = (radius: number): MacroCoord[] =>
    circleCells(AT, radius, radius).filter((c) => c.x >= 0 && c.y >= 0 && c.x < SIZE && c.y < SIZE);
  const ask = (kit: EditContext, radius: number): number | null => layDelight(kit, {
    cells: disc(radius), centre: AT, radius, seed, lead: 'canopy', stage: 1,
  });

  it('draws one on open level ground', () => {
    expect(ask(setup(), RADIUS)).toBeGreaterThan(0);
  });

  it('gives way to the stand on a disc too small to draw in', () => {
    expect(ask(setup(), 3)).toBeNull();
  });

  it('gives way to the stand on a terraced disc', () => {
    const state = makeState(SIZE, SIZE);
    // A staircase across the aim point: four tiers under one disc.
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const tier = Math.max(0, Math.min(3, Math.floor((x - AT.x + 6) / 4)));
        for (let e = 1; e <= tier; e++) setTerrain(state, x, y, TerrainType.Mountain, e);
      }
    }
    expect(ask(setup(state), RADIUS)).toBeNull();
  });
});

describe('a delight never overrides what the user pointed at', () => {
  it('lays the house its bed, whatever the seed rolled', () => {
    const seed = delightSeeds('canopy', 200)[0]!;
    expect(delightRoll(seed, 'canopy')).toBe('lone-grand');

    const kit = setup();
    const cabin: PlacedObject = {
      id: generateObjectId(), catalogId: 'building-forest-cabin', position: { x: 18, y: 14 }, rotation: 0, elevation: 0,
    };
    expect(kit.executor.execute(placeObjectCommand(cabin)).success).toBe(true);

    applyMacro(kit, 'patch-tree', { seed, at: AT, radius: RADIUS });
    const objects = [...kit.state.objects.values()].filter((o) => o.id !== cabin.id);
    expect(objects.length).toBeGreaterThan(0);
    // Everything the press laid frames the house. The lone grand tree the roll called for would have
    // stood at the aim point, eight cells from the nearest wall.
    for (const o of objects) {
      const dx = Math.max(cabin.position.x - o.position.x, o.position.x - (cabin.position.x + 4), 0);
      const dy = Math.max(cabin.position.y - o.position.y, o.position.y - (cabin.position.y + 3), 0);
      expect(Math.max(dx, dy), `${o.catalogId}@${o.position.x},${o.position.y} is not part of the bed`).toBeLessThanOrEqual(2);
    }
  });
});

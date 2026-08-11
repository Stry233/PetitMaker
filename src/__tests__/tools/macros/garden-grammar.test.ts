/**
 * Garden grammar: the press reads what it is BESIDE.
 *
 * What is pinned here is the CHOICE (building before road before wild, from the object index alone),
 * the two compositions it leads to, the navigation regulation both of them keep (nothing on a
 * house's gate strip, nothing on a paved cell), and the two claims that make the feature honest —
 * the ghost previews the composition the press will lay, and a hold over one lays it again rather
 * than growing it into a wood.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules';
import { ItemCategory, type EditorEvents, type GridState, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { categoryOf } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { roadLookup } from '../../../state/object-index';
import { applyMacro } from '../../../tools/macros';
import { readGrammar } from '../../../tools/macros/grammar';
import { previewMacro } from '../../../tools/macros/preview';
import { buildingGate } from '../../../tools/generation/placement/object';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { generateObjectId } from '../../../tools/utils';
import { circleCells } from '../../../tools/paint/shapes';
import type { KitContext } from '../../../kit/context';
import { makeState } from '../../rules/_helpers';

const SIZE = 44;
/** A 5x4 cabin, well inside the map so its bed has room all the way round. */
const CABIN = { id: 'building-forest-cabin', x: 18, y: 16 };
/** Below the cabin: the disc reaches its bottom edge, so the press is beside the house. */
const BESIDE = { x: 20, y: 24 };
/** The paved row, and a press sitting on it. */
const ROAD_Y = 22;
const ON_ROAD = { x: 22, y: ROAD_Y };
/** Empty ground far from both. */
const OPEN = { x: 10, y: 36 };
const RADIUS = 6;
const DENSITY = 0.9;

function setup(): KitContext {
  const state = makeState(SIZE, SIZE);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

function place(kit: KitContext, catalogId: string, x: number, y: number): PlacedObject {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0, elevation: 0 };
  expect(kit.executor.execute(objectPlacementCommand(obj)).success, `${catalogId} would not stand at ${x},${y}`).toBe(true);
  return obj;
}

const withCabin = (): { kit: KitContext; cabin: PlacedObject } => {
  const kit = setup();
  return { kit, cabin: place(kit, CABIN.id, CABIN.x, CABIN.y) };
};

function withRoad(): KitContext {
  const kit = setup();
  for (let x = 12; x <= 32; x++) place(kit, 'road-stone', x, ROAD_Y);
  return kit;
}

/** The disc a press of `radius` works over, exactly as `buildMacro` builds it. */
const disc = (at: MacroCoord, radius: number): MacroCoord[] =>
  circleCells(at, radius, radius).filter((c) => c.x >= 0 && c.y >= 0 && c.x < SIZE && c.y < SIZE);

const centroid = (cells: readonly MacroCoord[]): { x: number; y: number } => ({
  x: cells.reduce((s, c) => s + c.x, 0) / cells.length,
  y: cells.reduce((s, c) => s + c.y, 0) / cells.length,
});

const grammarAt = (state: GridState, at: MacroCoord): ReturnType<typeof readGrammar> => {
  const cells = disc(at, RADIUS);
  return readGrammar(state, cells, centroid(cells));
};

/** What stands on each cell, by "x,y". */
function planted(state: GridState): Map<string, PlacedObject> {
  const out = new Map<string, PlacedObject>();
  for (const o of state.objects.values()) out.set(`${o.position.x},${o.position.y}`, o);
  return out;
}

const shapeOf = (state: GridState): string => [...state.objects.values()]
  .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort().join('|');

/** The cells at Chebyshev ring `d` around a footprint — the bed's own geometry, restated. */
function ring(obj: PlacedObject, d: number): MacroCoord[] {
  const r = objectRect(obj);
  const x0 = Math.floor(r.x) - d, x1 = Math.ceil(r.x + r.w) - 1 + d;
  const y0 = Math.floor(r.y) - d, y1 = Math.ceil(r.y + r.h) - 1 + d;
  const out: MacroCoord[] = [];
  for (let x = x0; x <= x1; x++) { out.push({ x, y: y0 }, { x, y: y1 }); }
  for (let y = y0 + 1; y <= y1 - 1; y++) { out.push({ x: x0, y }, { x: x1, y }); }
  return out;
}

describe('which grammar a press falls under', () => {
  it('reads a building, a road and open ground off the object index', () => {
    const { kit, cabin } = withCabin();
    const site = grammarAt(kit.state, BESIDE);
    expect(site?.kind).toBe('building');
    expect(site && site.kind === 'building' && site.building.id).toBe(cabin.id);

    expect(grammarAt(withRoad().state, ON_ROAD)?.kind).toBe('road');
    expect(grammarAt(setup().state, OPEN)).toBeNull();
  });

  it('takes the building when the disc holds both', () => {
    const kit = setup();
    place(kit, CABIN.id, CABIN.x, CABIN.y);
    for (let x = 16; x <= 26; x++) place(kit, 'road-stone', x, 24);
    // A house standing on a paved street is still a house.
    expect(grammarAt(kit.state, BESIDE)?.kind).toBe('building');
  });

  it('leaves open ground to the wild stand', () => {
    const kit = setup();
    const out = applyMacro(kit, 'patch-flora', { seed: 4, at: OPEN, radius: RADIUS, density: DENSITY });
    expect(out.changes).toBeGreaterThan(0);
    // Not a composition: a stand is drawn from the ecology and reaches more than a ring's worth of
    // species (a bed is one colour and an accent).
    const species = new Set([...kit.state.objects.values()].map((o) => o.catalogId));
    expect(species.size).toBeGreaterThan(2);
  });
});

describe('the bed around a building', () => {
  it('rings the house and keeps its doorstep open', () => {
    const { kit, cabin } = withCabin();
    const out = applyMacro(kit, 'patch-flora', { seed: 4, at: BESIDE, radius: RADIUS, density: DENSITY });
    expect(out.changes).toBeGreaterThan(0);

    const at = planted(kit.state);
    const strip = new Set(buildingGate(objectRect(cabin), cabin.rotation).clear.map((c) => `${c.x},${c.y}`));
    let bedded = 0;
    for (const c of ring(cabin, 1)) {
      const key = `${c.x},${c.y}`;
      if (strip.has(key)) {
        expect(at.has(key), `a plant landed on the gate strip at ${key}`).toBe(false);
        continue;
      }
      expect(categoryOf(at.get(key) ?? { catalogId: '' }), `nothing was planted against the wall at ${key}`)
        .toBe(ItemCategory.Flora);
      bedded++;
    }
    expect(bedded, 'the ring is too small to be a bed').toBeGreaterThan(12);
    // ONE colour with an accent through it, not a species lottery.
    expect(new Set([...kit.state.objects.values()]
      .filter((o) => categoryOf(o) === ItemCategory.Flora).map((o) => o.catalogId)).size).toBeLessThanOrEqual(2);
  });

  it('frames the house from a step back on the tree card, leaving the wall clear', () => {
    const { kit, cabin } = withCabin();
    expect(applyMacro(kit, 'patch-tree', { seed: 4, at: BESIDE, radius: RADIUS, density: DENSITY }).changes).toBeGreaterThan(0);
    const at = planted(kit.state);
    // A tree against the wall is a hedge nobody can get past.
    for (const c of ring(cabin, 1)) expect(at.has(`${c.x},${c.y}`), `a tree stands against the wall at ${c.x},${c.y}`).toBe(false);
    const framed = ring(cabin, 2).filter((c) => at.has(`${c.x},${c.y}`));
    expect(framed.length, 'the house was not framed at all').toBeGreaterThan(6);
    for (const c of framed) expect(categoryOf(at.get(`${c.x},${c.y}`)!)).toBe(ItemCategory.Tree);
  });
});

describe('the border along a road', () => {
  it('follows the pavement without paving over it', () => {
    const kit = withRoad();
    expect(applyMacro(kit, 'patch-flora', { seed: 4, at: ON_ROAD, radius: RADIUS, density: DENSITY }).changes).toBeGreaterThan(0);

    const flora = [...kit.state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Flora);
    expect(flora.length).toBeGreaterThan(8);
    for (const o of flora) {
      // Beside the road, never on it, and never further than the border row.
      expect(o.position.y, `a flower was planted on the road at ${o.position.x},${o.position.y}`).not.toBe(ROAD_Y);
      expect(Math.abs(o.position.y - ROAD_Y)).toBe(1);
    }
  });

  it('plants a hedge with gaps on the tree card', () => {
    const kit = withRoad();
    expect(applyMacro(kit, 'patch-tree', { seed: 4, at: ON_ROAD, radius: RADIUS, density: DENSITY }).changes).toBeGreaterThan(0);
    const trees = [...kit.state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Tree);
    expect(trees.length).toBeGreaterThan(3);
    for (const o of trees) expect(Math.abs(o.position.y - ROAD_Y)).toBe(1);
    // A line with gaps to walk through: fewer trees than the border has cells.
    const border = trees.filter((o) => o.position.y === ROAD_Y - 1).length;
    expect(border).toBeLessThan(2 * RADIUS);
  });
});

describe('the ghost shows the composition', () => {
  it('previews the bed a press beside a house will lay', () => {
    const { kit } = withCabin();
    const opts = { seed: 4, at: BESIDE, radius: RADIUS, density: DENSITY };
    const preview = previewMacro(kit, 'patch-flora', opts).added.map((c) => `${c.x},${c.y}`).sort();
    expect(preview.length).toBeGreaterThan(12);

    applyMacro(kit, 'patch-flora', opts);
    const laid = [...kit.state.objects.values()]
      .filter((o) => categoryOf(o) === ItemCategory.Flora)
      .map((o) => `${o.position.x},${o.position.y}`).sort();
    expect(preview).toEqual(laid);
  });
});

describe('a composition does not grow', () => {
  it('lays the same bed again on the next burst of the hold, and ages nothing', () => {
    const { kit } = withCabin();
    applyMacro(kit, 'patch-flora', { seed: 4, at: BESIDE, radius: RADIUS, density: DENSITY });
    const bed = shapeOf(kit.state);
    expect(bed.length).toBeGreaterThan(0);

    // The next burst of the same hold: its own seed, the hold's anchor seed, one step older.
    const next = applyMacro(kit, 'patch-flora', {
      seed: 5, at: BESIDE, radius: RADIUS, density: DENSITY, stage: 2, anchorSeed: 4,
    });
    expect(next.changes).toBe(0);
    expect(shapeOf(kit.state), 'a held press grew the bed into something else').toBe(bed);
  });
});

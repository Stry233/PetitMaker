/**
 * The contract both road macros hold, driven through `applyMacro` exactly as a press reaches
 * them: `roads` (whole-map) and `road-link` (two-tap). One describe per clause.
 */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import {
  CellZone, ItemCategory, TerrainType,
  type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { makeState, setTerrain } from '../../rules/_helpers';
import { categoryOf } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { buildingGate } from '../../../tools/placement/object';
import { crossingEnds } from '../../../tools/placement/themes';
import { objectRect } from '../../../state/object-geometry';
import { generateObjectId } from '../../../core/model/object-id';
import { applyMacro, type MacroOpts } from '../../../tools/macros';
import { previewMacro } from '../../../tools/macros/preview';
import type { KitContext } from '../../../kit/context';

const SIZE = 45;
const SHORE = 3;

interface Kit extends KitContext { executor: CommandExecutor }

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

function place(kit: Kit, catalogId: string, x: number, y: number, rotation: 0 | 90 | 180 | 270 = 0): PlacedObject {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation, elevation: 0 };
  const r = kit.executor.execute(objectPlacementCommand(obj));
  expect(r.success, `place ${catalogId}@${x},${y}: ${r.errors?.[0]?.message ?? ''}`).toBe(true);
  return obj;
}

/** Void everywhere in `[x0,x1]x[y0,y1]` except a THREE-wide strip centred on `keepX`: the flat
 *  trait's own "level-interior" margin excludes any grass cell touching void from `open`, so a
 *  single bare column would already fail to route with nothing standing on it at all. Three wide,
 *  only the centre column clears that margin (its neighbours are the strip's own grass, not
 *  void) — so it is the ONE passable column across the whole band, exactly as intended, and it
 *  clears for the right structural reason rather than by accident. */
function carveBottleneck(kit: Kit, x0: number, x1: number, y0: number, y1: number, keepX: number): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x >= keepX - 1 && x <= keepX + 1) continue;
      kit.state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
}

/** A rectangular region as the flat cell list `MacroOpts.region` wants. */
function rectRegion(x0: number, y0: number, x1: number, y1: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push({ x, y });
  return cells;
}

function roadObjects(state: GridState): PlacedObject[] {
  return [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
}

function decorationCount(state: GridState): number {
  return [...state.objects.values()].filter((o) => {
    const cat = categoryOf(o);
    return cat === ItemCategory.Tree || cat === ItemCategory.Flora;
  }).length;
}

describe('road contract: a press never deletes what a hand placed', () => {
  it('roads: a tree standing in a house\'s gate strip survives the whole-map press', () => {
    const kit = makeKit();
    const house = place(kit, 'building-myhouse', 20, 20);
    const rect = objectRect(house);
    const { clear } = buildingGate(rect, house.rotation);
    // The clear strip's OWN footprint row plus the approach row beyond it — the tree goes on the
    // approach row, off the door cell itself but still inside the reserved clearance zone.
    const outsideFootprint = (c: MacroCoord): boolean => !(c.x >= rect.x && c.x < rect.x + rect.w && c.y >= rect.y && c.y < rect.y + rect.h);
    const stripCell = clear.find((c) => outsideFootprint(c) && kit.state.cells[c.y]?.[c.x])!;
    const tree = place(kit, 'tree-apple', stripCell.x, stripCell.y);
    // A flower on the open ground between the house and the hub: `roads` never needs to report a
    // route this can route around by construction (its occupied set excludes decorated cells), so
    // the honest assertion here is survival, not a `blocked` report — see the road-link case below
    // for the one clause branch that DOES exercise `outcome.blocked`.
    const flower = place(kit, 'flower-daisy', 20, 30);

    const outcome = applyMacro(kit, 'roads', { seed: 1 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(kit.state.objects.has(tree.id), 'the gate-strip tree was swept').toBe(true);
    expect(kit.state.objects.has(flower.id), 'the flower on open ground was swept').toBe(true);
  });

  it('road-link: a flower holding the ONLY passable cell is left standing and named blocked', () => {
    const kit = makeKit();
    // A one-cell-wide land bridge at x=22 across an otherwise impassable band: any route from
    // north to south of it must cross exactly this column, so a decoration parked there cannot be
    // detoured around, only reported. The band is far wider than any bridge/ramp in the catalog can
    // span, so the router cannot dodge the whole obstacle by crossing it instead.
    carveBottleneck(kit, SHORE, SIZE - 1 - SHORE, 12, 33, 22);
    const flower = place(kit, 'flower-daisy', 22, 22);

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from: { x: 20, y: 6 }, at: { x: 24, y: 40 } });
    expect(kit.state.objects.has(flower.id), 'the blocking flower was swept').toBe(true);
    expect(outcome.blocked && outcome.blocked.some((c) => c.x === 22 && c.y === 22), 'the report names the blocking cell').toBe(true);
  });

  it('road-link: a flower bed at a crossing\'s own 3x3 end clearance survives the press', () => {
    const kit = makeKit();
    // A ford: 4-wide water strip, capped top+bottom by mountain at elev 1 so it has no exposed
    // face (the shape `road-link.test.ts`'s own bridge fixtures use) — a run that must bridge to
    // connect, reserving 3x3 clearance at both crossing ends (`realizeCrossings`).
    for (let y = 0; y < SIZE; y++) {
      for (let x = 20; x <= 23; x++) {
        if (y < 15 || y > 24) setTerrain(kit.state, x, y, TerrainType.Mountain, 1);
        else setTerrain(kit.state, x, y, TerrainType.Water, 0);
      }
    }
    // A scattered flower bed on BOTH banks, straddling the row the taps sit on: wherever the
    // router lands its crossing, some of these fall inside the 3x3 it reserves at each end. One
    // column per bank, clear of the flat trait's own +1-right margin against the water (x=19's
    // OWN right neighbour is the water at x=20, which the trait refuses on its own).
    const flowers: PlacedObject[] = [];
    for (const y of [16, 18, 20, 22, 24]) flowers.push(place(kit, 'flower-daisy', 18, y));
    for (const y of [16, 18, 20, 22, 24]) flowers.push(place(kit, 'flower-daisy', 24, y));

    const outcome = applyMacro(kit, 'road-link', { seed: 1, from: { x: 10, y: 19 }, at: { x: 33, y: 19 } });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    const bridge = roadObjects(kit.state).find((o) => o.catalogId.startsWith('bridge') || categoryOf(o) === ItemCategory.Bridge)
      ?? [...kit.state.objects.values()].find((o) => categoryOf(o) === ItemCategory.Bridge);
    expect(bridge, 'a bridge stands over the ford').toBeTruthy();

    // The test is meaningless if none of the flower bed actually sat inside the reserved
    // clearance — confirm at least one did before trusting the survival check below.
    const clearance = new Set<string>();
    for (const e of crossingEnds(bridge!)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      clearance.add(`${e.x + dx},${e.y + dy}`);
    }
    expect(flowers.some((f) => clearance.has(`${f.position.x},${f.position.y}`)), 'the fixture missed the reserved clearance').toBe(true);

    for (const f of flowers) expect(kit.state.objects.has(f.id), `flower@${f.position.x},${f.position.y} was swept`).toBe(true);
  });
});

describe('road contract: an unrouted whole-map press names its own reason', () => {
  it('roads: a house on an island too far to bridge reports "unrouted", not "place some buildings"', () => {
    const kit = makeKit();
    // A moat wide enough that no catalog bridge/ramp can span it, isolating an island (with its
    // own house) from the open strip at x<15 — where the hub sits (it is the larger region).
    // Doorsteps exist; nothing walks or bridges between them.
    for (let y = 3; y <= 41; y++) {
      for (let x = 15; x <= 41; x++) {
        if (x >= 28 && x <= 41 && y >= 10 && y <= 30) continue; // the island itself, sized for the house below
        kit.state.cells[y]![x]!.zone = CellZone.Void;
      }
    }
    place(kit, 'building-myhouse', 31, 18);

    const outcome = applyMacro(kit, 'roads', { seed: 1 });
    expect(outcome.changes).toBe(0);
    expect(outcome.code, outcome.reason ?? '').toBe('unrouted');
  });
});

describe('road contract: the ghost shows what it would replace', () => {
  it('road-link: previewMacro.removed equals the coating the press then replaces', () => {
    const kit = makeKit();
    // Off the direct (10,10)->(30,10) line but inside a width-3 dilation's reach: the widen pass
    // strips this standing coating and repaves it in the run's own material.
    const dirtTile = place(kit, 'path-overgrown-dirt', 20, 11);
    const opts: MacroOpts = { seed: 1, from: { x: 10, y: 10 }, at: { x: 30, y: 10 }, material: 'path-cobblestone', width: 3 };

    const preview = previewMacro(kit, 'road-link', opts);
    expect(preview.removed).toEqual([dirtTile.position]);

    const outcome = applyMacro(kit, 'road-link', opts);
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(kit.state.objects.has(dirtTile.id), 'the old coating was replaced, not reused').toBe(false);
    const replaced = roadObjects(kit.state).find((o) => o.position.x === 20 && o.position.y === 11);
    expect(replaced?.catalogId).toBe('path-cobblestone');
  });
});

describe('road contract: no flora rides along', () => {
  it('roads: the whole-map press plants no trees or flowers of its own', () => {
    const kit = makeKit();
    place(kit, 'building-myhouse', 10, 10);
    place(kit, 'building-bamboo-cabin', 30, 30, 180);
    expect(decorationCount(kit.state)).toBe(0);

    const outcome = applyMacro(kit, 'roads', { seed: 1 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(roadObjects(kit.state).length, 'a network was actually laid').toBeGreaterThan(0);
    expect(decorationCount(kit.state), 'roadside tree-lining rode along').toBe(0);
  });

  it('road-link: the two-tap press plants no trees or flowers of its own', () => {
    const kit = makeKit();
    const before = decorationCount(kit.state);
    const outcome = applyMacro(kit, 'road-link', { seed: 1, from: { x: 10, y: 10 }, at: { x: 30, y: 10 } });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(decorationCount(kit.state)).toBe(before);
  });
});

describe('road contract: the beautifier ran', () => {
  const trimmed = (o: PlacedObject): boolean => !!o.corners && o.corners.some((c) => c !== 'square');

  it('road-link: trim "round" leaves a bent road with non-square corners; "off" leaves none', () => {
    const opts = (trim: 'round' | 'off'): MacroOpts => (
      { seed: 1, from: { x: 10, y: 10 }, at: { x: 30, y: 30 }, trim }
    );

    const round = makeKit();
    applyMacro(round, 'road-link', opts('round'));
    expect(roadObjects(round.state).some(trimmed), 'trim "round" left every corner square').toBe(true);

    const off = makeKit();
    applyMacro(off, 'road-link', opts('off'));
    expect(roadObjects(off.state).some(trimmed), 'trim "off" trimmed a corner anyway').toBe(false);
  });

  it('roads: trim "round" leaves a bent road with non-square corners; "off" leaves none', () => {
    const build = (trim: 'round' | 'off'): Kit => {
      const kit = makeKit();
      place(kit, 'building-myhouse', 10, 10);
      place(kit, 'building-bamboo-cabin', 30, 30, 180);
      const outcome = applyMacro(kit, 'roads', { seed: 1, trim });
      expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
      return kit;
    };

    expect(roadObjects(build('round').state).some(trimmed), 'trim "round" left every corner square').toBe(true);
    expect(roadObjects(build('off').state).some(trimmed), 'trim "off" trimmed a corner anyway').toBe(false);
  });
});

describe('road contract: the painted region binds the press', () => {
  it('road-link: every laid object lands inside the painted region', () => {
    const kit = makeKit();
    // A building well outside the region: nothing this press does may touch it, and nothing it
    // lays may land near it either.
    place(kit, 'building-myhouse', 30, 30);
    const region = rectRegion(5, 5, 16, 16);

    const before = new Set(kit.state.objects.keys());
    const outcome = applyMacro(kit, 'road-link', { seed: 1, from: { x: 6, y: 10 }, at: { x: 14, y: 10 }, region });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    const fresh = [...kit.state.objects.values()].filter((o) => !before.has(o.id));
    expect(fresh.length).toBeGreaterThan(0);
    for (const o of fresh) {
      expect(o.position.x, `${o.catalogId}@${o.position.x},${o.position.y} strayed out of the region`).toBeGreaterThanOrEqual(5);
      expect(o.position.x).toBeLessThanOrEqual(16);
      expect(o.position.y).toBeGreaterThanOrEqual(5);
      expect(o.position.y).toBeLessThanOrEqual(16);
    }
  });
});

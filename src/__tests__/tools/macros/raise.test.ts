/**
 * ONE VERB THAT GROWS, through the press that ships it.
 *
 * Every case here goes through `applyMacro`, not through `raiseTerrain`, because a rise is the
 * builder plus the replay plus the post-stroke commit and the three can disagree. `terrace.test.ts`
 * already proves the ring geometry is legal by construction on painted cells; what is proved here is
 * that a press lays those rings on a live map, climbs one rung per stage, leaves alone everything it
 * did not raise, and SAYS what the ground refused.
 *
 * The fixture is `macro-quality.test.ts`'s shape: a grass island with a sea border, so a disc near
 * the middle has room and the map's own edge is never the thing under test.
 */
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { surfaceElevation } from '../../../core/edge-cut/terrain-silhouette';
import { createDefaultTerrainCell } from '../../../core/model/grid-model';
import {
  CellZone, TerrainType,
  type EditorEvents, type GridState, type MacroCoord, type PlacedObject,
} from '../../../core/model/types';
import type { KitContext } from '../../../kit/context';
import { createDefaultRegistry } from '../../../rules';
import { objectRect } from '../../../state/object-geometry';
import { roadLookup } from '../../../state/object-index';
import { applyMacro, type MacroOpts } from '../../../tools/macros';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import { FLAT_TOP } from '../../../tools/macros/terrace';
import { insetFor, LADDER_TOP, ladderPeak, raiseFooting, STEEP_INSET, WIDE_INSET } from '../../../tools/macros/raise';
import { generateObjectId } from '../../../tools/utils';
import { makeState } from '../../rules/_helpers';

const SIZE = 40;
/** Sea all the way round, so the aim disc never leans on the grid's own edge. */
const SHORE = 3;
const FLAT: MacroCoord = { x: 20, y: 20 };

interface Kit extends KitContext { executor: CommandExecutor }

function makeKit(): Kit {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x < SHORE || y < SHORE || x >= SIZE - SHORE || y >= SIZE - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

function raise(kit: Kit, opts: Partial<MacroOpts> = {}): ReturnType<typeof applyMacro> {
  return applyMacro(kit, 'raise', { seed: 3, at: FLAT, radius: 6, ...opts });
}

const surface = (state: GridState, x: number, y: number): number => surfaceElevation(state.cells[y]?.[x]?.terrain ?? null);

function summit(state: GridState): number {
  let top = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) top = Math.max(top, surface(state, x, y));
  return top;
}

/** How many cells stand at `tier` or above: the mass of one terrace and everything nested in it. */
function massAt(state: GridState, tier: number): number {
  let n = 0;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (surface(state, x, y) >= tier) n++;
  return n;
}

function raisedCells(state: GridState): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (surface(state, x, y) > 0) out.push({ x, y });
  return out;
}

const shapeOf = (state: GridState): string => state.cells
  .map((row) => row.map((c) => (c.terrain ? `${c.terrain.type}:${c.terrain.elevation}` : '.')).join(' ')).join('\n');

/** A wedding cake written straight into the cells: one tier per ring, legal by construction without
 *  going through the executor. Somebody's hand-built mountain, for the hold to step around. */
function raiseCone(state: GridState, at: MacroCoord, radius: number, peak: number): MacroCoord[] {
  const cells: MacroCoord[] = [];
  for (let y = at.y - radius; y <= at.y + radius; y++) {
    for (let x = at.x - radius; x <= at.x + radius; x++) {
      const cell = state.cells[y]?.[x];
      if (!cell || cell.zone !== CellZone.Grass) continue;
      const tier = peak - Math.max(Math.abs(x - at.x), Math.abs(y - at.y));
      if (tier <= 0) continue;
      cell.terrain = createDefaultTerrainCell(TerrainType.Mountain, tier);
      cells.push({ x, y });
    }
  }
  return cells;
}

function place(kit: Kit, catalogId: string, x: number, y: number): PlacedObject {
  const obj: PlacedObject = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0, elevation: 0 };
  expect(kit.executor.execute(objectPlacementCommand(obj)).success, `${catalogId} would not stand at ${x},${y}`).toBe(true);
  return obj;
}

describe('the ladder', () => {
  it('is a rung per stage, and stops at the map ceiling', () => {
    expect(ladderPeak(1)).toBe(2);
    expect(ladderPeak(2)).toBe(FLAT_TOP);
    expect(ladderPeak(0)).toBe(2);
    expect(ladderPeak(99)).toBe(LADDER_TOP);
  });

  it('has two step widths and no third', () => {
    expect(insetFor('wide')).toBe(WIDE_INSET);
    expect(insetFor('steep')).toBe(STEEP_INSET);
    expect(STEEP_INSET).toBeGreaterThanOrEqual(2);
  });
});

describe('a raise', () => {
  it('lays a mound at a tap', () => {
    const kit = makeKit();
    const out = raise(kit);
    expect(out.changes).toBeGreaterThan(0);
    expect(out.peak).toBe(ladderPeak(1));
    // The footing is bare grass, so the summit tier IS the elevation standing.
    expect(summit(kit.state)).toBe(ladderPeak(1));
    expect(kit.registry.validatePostStroke(kit.state)).toEqual([]);
  });

  it('climbs a rung per stage, and never past what the ground carries', () => {
    for (let stage = 1; stage <= 7; stage++) {
      const kit = makeKit();
      const out = raise(kit, { radius: 8, steepness: 'steep', stage });
      expect(out.changes, `stage ${stage} built nothing`).toBeGreaterThan(0);
      expect(out.peak, `stage ${stage} climbed past its rung`).toBeLessThanOrEqual(ladderPeak(stage));
      expect(summit(kit.state), `stage ${stage}: the report and the map disagree`).toBe(out.peak);
      expect(kit.registry.validatePostStroke(kit.state), `stage ${stage} left the map illegal`).toEqual([]);
    }
  });

  it('reaches the rung it is asked for while the footprint can carry it', () => {
    // A radius-8 disc at the steep step still has a core at tier 6, so these four rungs are the
    // ladder itself rather than the erosion running out.
    for (let stage = 1; stage <= 4; stage++) {
      const kit = makeKit();
      expect(raise(kit, { radius: 8, steepness: 'steep', stage }).peak).toBe(ladderPeak(stage));
    }
  });

  it('lays a flat top at one level', () => {
    const kit = makeKit();
    expect(raise(kit, { stage: 2 }).peak).toBe(FLAT_TOP);
    const levels = new Set(raisedCells(kit.state).map((c) => surface(kit.state, c.x, c.y)));
    expect([...levels]).toEqual([FLAT_TOP]);
  });

  it('steps by its steepness, and by nothing else', () => {
    const opts = { seed: 11, radius: 8, stage: 5 } as const;
    const wide = makeKit(); raise(wide, { ...opts, steepness: 'wide' });
    const steep = makeKit(); raise(steep, { ...opts, steepness: 'steep' });

    expect(shapeOf(wide.state)).not.toBe(shapeOf(steep.state));
    // One outline, one flat top: the same seed draws the same rim, so the two masses can only
    // differ above the tier the rings start nesting at.
    expect(massAt(wide.state, FLAT_TOP)).toBe(massAt(steep.state, FLAT_TOP));
    // And above it the wider step eats more of the core per tier, so it stands narrower and lower.
    expect(massAt(wide.state, FLAT_TOP + 1)).toBeLessThan(massAt(steep.state, FLAT_TOP + 1));
    expect(summit(wide.state)).toBeLessThanOrEqual(summit(steep.state));
    for (const kit of [wide, steep]) expect(kit.registry.validatePostStroke(kit.state)).toEqual([]);
  });

  /**
   * THE CONTRACT. A hold raises the ground it stands on and the mass it has already raised, and
   * nothing else: somebody's mountain inside the disc keeps every tier it had, and the summit steps
   * away from it rather than leaning on it.
   */
  it('grows only its own mass, burst after burst', () => {
    const kit = makeKit();
    const cone = raiseCone(kit.state, { x: 25, y: 20 }, 3, 4);
    const coneWas = new Map(cone.map((c) => [`${c.x},${c.y}`, surface(kit.state, c.x, c.y)]));

    // What the tool holds for the length of one press: the footing read once at the anchor, and the
    // cells each burst raised. Both reset on re-anchor.
    const footing = raiseFooting(kit.state, FLAT, 8);
    const held = new Set<number>();
    let peak = 0;
    for (let stage = 1; stage <= 5; stage++) {
      const was = new Set(raisedCells(kit.state).map((c) => `${c.x},${c.y}:${surface(kit.state, c.x, c.y)}`));
      const out = raise(kit, { radius: 8, steepness: 'steep', stage, footing, heldCells: [...held] });
      // It climbs while the footprint carries it and never falls back: the hole the cone leaves
      // means the top rung of this disc is its own, not the rung the stage asked for.
      expect(out.peak, `burst ${stage} lost height`).toBeGreaterThanOrEqual(peak);
      expect(out.peak, `burst ${stage} climbed past its rung`).toBeLessThanOrEqual(ladderPeak(stage));
      peak = out.peak!;
      for (const c of raisedCells(kit.state)) {
        if (!was.has(`${c.x},${c.y}:${surface(kit.state, c.x, c.y)}`)) held.add(c.y * SIZE + c.x);
      }
      for (const [key, elevation] of coneWas) {
        const [x, y] = key.split(',').map(Number) as [number, number];
        expect(surface(kit.state, x, y), `burst ${stage} rewrote a hand-built cell at ${key}`).toBe(elevation);
      }
      expect(kit.registry.validatePostStroke(kit.state), `burst ${stage} left the map illegal`).toEqual([]);
    }
    expect(peak).toBeGreaterThan(FLAT_TOP);

    // The summit is the hold's own, and it keeps the erosion's distance from the mass it stepped
    // around: a cell standing at the top is never up against the cone.
    const top = summit(kit.state);
    for (const c of raisedCells(kit.state)) {
      if (surface(kit.state, c.x, c.y) !== top || coneWas.has(`${c.x},${c.y}`)) continue;
      for (const h of cone) {
        expect(Math.abs(c.x - h.x) + Math.abs(c.y - h.y), `the summit leans on the cone at ${c.x},${c.y}`)
          .toBeGreaterThanOrEqual(STEEP_INSET);
      }
    }
  });

  it('names what the ground refused, and leaves it standing', () => {
    const kit = makeKit();
    const house = place(kit, 'building-myhouse', 21, 19);
    const rect = objectRect(house);
    const out = raise(kit, { radius: 7, stage: 2 });

    expect(out.changes).toBeGreaterThan(0);
    expect(kit.state.objects.has(house.id), 'the raise removed a hand-placed building').toBe(true);
    const blocked = new Set((out.blocked ?? []).map((c) => `${c.x},${c.y}`));
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        expect(`${x},${y}:${blocked.has(`${x},${y}`)}`, 'a refused cell went unreported').toBe(`${x},${y}:true`);
        expect(surface(kit.state, x, y), 'the ground under the building moved').toBe(0);
      }
    }
  });

  it('reports the ceiling the footprint has, not the rung asked for', () => {
    const first = makeKit();
    const out = raise(first, { radius: 4, steepness: 'wide', stage: 7 });
    expect(out.peak).toBeGreaterThan(0);
    expect(out.peak).toBeLessThan(ladderPeak(7));
    expect(summit(first.state)).toBe(out.peak);

    const again = makeKit();
    expect(raise(again, { radius: 4, steepness: 'wide', stage: 7 }).peak).toBe(out.peak);
  });

  it('is one undo entry', () => {
    const kit = makeKit();
    const before = JSON.stringify(kit.state.cells);
    const depth = kit.executor.getUndoStackSize();

    expect(raise(kit, { stage: 4 }).changes).toBeGreaterThan(0);
    expect(kit.executor.getUndoStackSize()).toBe(depth + 1);

    kit.executor.undo();
    expect(JSON.stringify(kit.state.cells)).toBe(before);
  });

  it('builds the same rise at the same seed', () => {
    const run = (): string => {
      const kit = makeKit();
      expect(raise(kit, { seed: 17, radius: 7, stage: 4, steepness: 'steep' }).changes).toBeGreaterThan(0);
      return shapeOf(kit.state);
    };
    const first = run();
    for (let i = 0; i < 9; i++) expect(run()).toBe(first);
  });

  it('varies its outline with the seed', () => {
    const shapes = [1, 2, 3, 4, 5].map((seed) => {
      const kit = makeKit();
      expect(raise(kit, { seed, radius: 6, stage: 2 }).changes).toBeGreaterThan(0);
      return shapeOf(kit.state);
    });
    expect(new Set(shapes).size).toBeGreaterThan(3);
  });

  it('builds nothing off the map, and says so', () => {
    const kit = makeKit();
    const depth = kit.executor.getUndoStackSize();
    for (const opts of [{ at: { x: 999, y: 999 } }, { at: undefined }]) {
      const out = raise(kit, opts as Partial<MacroOpts>);
      expect(out.changes).toBe(0);
      expect(out.reason).toEqual(expect.any(String));
      expect(out.reason!.length).toBeGreaterThan(12);
    }
    expect(kit.executor.getUndoStackSize()).toBe(depth);
  });

  it('builds nothing where no ground would take it, and says so', () => {
    const kit = makeKit();
    for (const row of kit.state.cells) for (const cell of row) cell.zone = CellZone.Void;
    const out = raise(kit);
    expect(out.changes).toBe(0);
    expect(out.reason).toEqual(expect.any(String));
  });
});

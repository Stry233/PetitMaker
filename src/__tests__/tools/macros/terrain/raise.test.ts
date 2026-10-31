/**
 * The raise macro through `applyMacro`, since the builder, the replay and the post-stroke commit can
 * disagree. `terrace.test.ts` holds the ring geometry; here a press lays the rings on a live map,
 * climbs one rung per stage, leaves alone what it did not raise, and reports what the ground refused.
 * The fixture is a grass plain with a sea border, as in `macro-quality.test.ts`.
 */
import { placeObjectCommand } from '../../../../core/model/command-build';
import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { surfaceElevation } from '../../../../core/domain/terrain/terrain-surface';
import { createDefaultTerrainCell } from '../../../../core/model/grid-model';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';
import type { EditContext } from '../../../../core/commands/edit-context';
import { objectRect } from '../../../../state/object-geometry';
import { applyMacro, type MacroOpts } from '../../../../tools/macros';
import { FLAT_TOP } from '../../../../tools/macros/terrain/terrace';
import { LADDER_TOP, raiseFooting } from '../../../../tools/macros/terrain/raise';
import { generateObjectId } from '../../../../core/model/object-id';
import { makeState, makeExecutor } from '../../../_support/map-state';

const SIZE = 40;
/** Sea all the way round, so the aim disc never leans on the grid's own edge. */
const SHORE = 3;
const FLAT: MacroCoord = { x: 20, y: 20 };

interface Kit extends EditContext { executor: CommandExecutor }

function makeKit(): Kit {
  const state = makeState(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x < SHORE || y < SHORE || x >= SIZE - SHORE || y >= SIZE - SHORE) state.cells[y]![x]!.zone = CellZone.Void;
    }
  }
  const executor = makeExecutor(state);
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

/** A hand-built stepped cone written straight into the cells, one tier per ring, for the hold to
 *  step around. */
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
  expect(kit.executor.execute(placeObjectCommand(obj)).success, `${catalogId} would not stand at ${x},${y}`).toBe(true);
  return obj;
}

/** The steep step's inset: two cells a tier, the least a terrace stands back from what it steps around. */
const STEEP_STEP = 2;
/** The tier a rung reaches: rung 1 a mound at tier 2, rung 2 the flat top, one terrace a rung after
 *  that, up to the map's ceiling. */
const ladderPeak = (stage: number): number => Math.min(LADDER_TOP, Math.max(1, stage) + 1);

describe('the ladder', () => {
  it('is a rung per stage, and stops at the map ceiling', () => {
    const peak = (stage: number) => raise(makeKit(), { radius: 16, steepness: 'steep', stage }).peak;
    expect(peak(1)).toBe(2);
    expect(peak(2)).toBe(FLAT_TOP);
    expect(peak(0)).toBe(2);
    expect(peak(LADDER_TOP - 1)).toBe(LADDER_TOP);
    expect(peak(99)).toBe(LADDER_TOP);
  });
});

describe('a raise', () => {
  it('lays a mound at a tap', () => {
    const kit = makeKit();
    const out = raise(kit);
    expect(out.changes).toBeGreaterThan(0);
    expect(out.peak).toBe(ladderPeak(1));
    // On bare grass the summit tier is the standing elevation.
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
    // A radius-8 disc at the steep step keeps a core at tier 6, so erosion does not cap these rungs.
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
    // The same seed draws the same rim, so the masses differ only above the flat top.
    expect(massAt(wide.state, FLAT_TOP)).toBe(massAt(steep.state, FLAT_TOP));
    // Above it the wider step eats more of the core per tier.
    expect(massAt(wide.state, FLAT_TOP + 1)).toBeLessThan(massAt(steep.state, FLAT_TOP + 1));
    expect(summit(wide.state)).toBeLessThanOrEqual(summit(steep.state));
    for (const kit of [wide, steep]) expect(kit.registry.validatePostStroke(kit.state)).toEqual([]);
  });

  /** A hold raises its footing and its own mass, nothing else: a mountain inside the disc keeps every
   *  tier, and the summit steps away from it. */
  it('grows only its own mass, burst after burst', () => {
    const kit = makeKit();
    const cone = raiseCone(kit.state, { x: 25, y: 20 }, 3, 4);
    const coneWas = new Map(cone.map((c) => [`${c.x},${c.y}`, surface(kit.state, c.x, c.y)]));

    // Held for one press: the footing read once at the anchor, and the cells each burst raised.
    const footing = raiseFooting(kit.state, FLAT, 8);
    const held = new Set<number>();
    let peak = 0;
    for (let stage = 1; stage <= 5; stage++) {
      const was = new Set(raisedCells(kit.state).map((c) => `${c.x},${c.y}:${surface(kit.state, c.x, c.y)}`));
      const out = raise(kit, { radius: 8, steepness: 'steep', stage, footing, heldCells: [...held] });
      // It never falls back; the cone's hole means it may stop below the stage's rung.
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

    // No summit cell touches the cone.
    const top = summit(kit.state);
    for (const c of raisedCells(kit.state)) {
      if (surface(kit.state, c.x, c.y) !== top || coneWas.has(`${c.x},${c.y}`)) continue;
      for (const h of cone) {
        expect(Math.abs(c.x - h.x) + Math.abs(c.y - h.y), `the summit leans on the cone at ${c.x},${c.y}`)
          .toBeGreaterThanOrEqual(STEEP_STEP);
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
    const depth = kit.executor.historyDepth();

    expect(raise(kit, { stage: 4 }).changes).toBeGreaterThan(0);
    expect(kit.executor.historyDepth()).toBe(depth + 1);

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
    const depth = kit.executor.historyDepth();
    for (const opts of [{ at: { x: 999, y: 999 } }, { at: undefined }]) {
      const out = raise(kit, opts as Partial<MacroOpts>);
      expect(out.changes).toBe(0);
      expect(out.reason).toEqual(expect.any(String));
      expect(out.reason!.length).toBeGreaterThan(12);
    }
    expect(kit.executor.historyDepth()).toBe(depth);
  });

  it('builds nothing where no ground would take it, and says so', () => {
    const kit = makeKit();
    for (const row of kit.state.cells) for (const cell of row) cell.zone = CellZone.Void;
    const out = raise(kit);
    expect(out.changes).toBe(0);
    expect(out.reason).toEqual(expect.any(String));
  });
});

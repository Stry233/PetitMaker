/**
 * Hold to grow: the smart-planting press's spray turns a hold into time.
 *
 * Each burst at the spot the hand rests on advances the stand one succession step, so age falls off
 * from the press centre — climax at the heart, the middle tier a ring out, pioneers at the rim. What
 * is pinned here is that geometry, the card promises that must survive it (a flora-led hold plants
 * no tree, whatever it grows into), the fold to one undo entry, and determinism.
 */
import { placeObjectCommand } from '../../../../core/model/command-build';
import { makeToolCtx } from '../../../_support/tool-ctx';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import type { GridState, MacroCoord, PlacedObject } from '../../../../core/model/types';
import { categoryOf, getPlaceableByCategory } from '../../../../state/catalog';
import type { EditContext } from '../../../../core/commands/edit-context';
import { applyMacro, type MacroId } from '../../../../tools/macros';
import { MacroTool } from '../../../../tools/pointer/macros/macro-tool';
import { ageStand, CLIMAX_STAGE, successionPalette, tierOf } from '../../../../tools/macros/planting/succession';
import { buildHabitatField } from '../../../../tools/macros/planting/habitat';
import { analyzeTerrain } from '../../../../tools/placement/analysis';
import type { HostedToolContext } from '../../../../tools/pointer/runtime/host';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { CHUNK_LOAD_LIMIT } from '../../../../core/game/profile';
import { getMapStats } from '../../../../state/map-stats';
import { cell, point } from '../../../_support/grid';
import { ItemCategory } from '../../../../config/catalog/categories';

const AT = { x: 20, y: 20 };
const RADIUS = 8;
/** Long enough to reach the top of the ladder and settle there. */
const BURSTS = 5;
/** The seed sweep the pooled probes run over. */
const SEEDS = [1, 7, 13, 29];

function setup(): EditContext {
  const state = makeState(40, 40);
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

/** One hold at the aim point: `bursts` presses of the same gesture, each one step older. Threads
 *  `heldIds` exactly as `MacroTool`'s spray does (`macro-tool.ts:burst`), since a burst now ages
 *  only what earlier bursts of its own hold planted. */
function hold(kit: EditContext, id: MacroId, bursts: number, seed = 1): void {
  const baseIds = new Set(kit.state.objects.keys());
  for (let k = 1; k <= bursts; k++) {
    const heldIds = [...kit.state.objects.keys()].filter((objId) => !baseIds.has(objId));
    applyMacro(kit, id, {
      seed: seed + k - 1, at: AT, radius: RADIUS, stage: k,
      ...(heldIds.length > 0 ? { heldIds } : {}),
    });
  }
  if (!kit.state.ignoreChunkLoad) {
    for (const chunk of getMapStats(kit.state).chunks.values()) expect(chunk.load).toBeLessThanOrEqual(CHUNK_LOAD_LIMIT);
  }
}

/** Every standing plant as (tier it reads as, how far from the press centre it stands). */
function aged(state: GridState): { tier: number; d: number }[] {
  const out: { tier: number; d: number }[] = [];
  for (const o of state.objects.values()) {
    const palette = successionPalette(categoryOf(o));
    if (!palette) continue;
    out.push({
      tier: tierOf(o.catalogId, palette) ?? 1,
      d: Math.hypot(o.position.x - AT.x, o.position.y - AT.y),
    });
  }
  return out;
}

const meanD = (rows: { tier: number; d: number }[], tier: number): number => {
  const ds = rows.filter((r) => r.tier === tier).map((r) => r.d);
  return ds.reduce((a, b) => a + b, 0) / ds.length;
};

const shapeOf = (state: GridState): string => [...state.objects.values()]
  .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort().join('|');

describe('the succession table', () => {
  it.each([ItemCategory.Tree, ItemCategory.Flora])('names every %s the catalog can plant', (category) => {
    const palette = successionPalette(category)!;
    expect(palette).toBeTruthy();
    for (const item of getPlaceableByCategory(category)) {
      expect(tierOf(item.id, palette), `${item.id} has no tier`).not.toBeNull();
    }
    // Every rung is reachable: a tier with nothing in it would silently leave a plant unaged.
    for (let tier = 1; tier <= CLIMAX_STAGE; tier++) {
      const pool = getPlaceableByCategory(category).filter((i) => tierOf(i.id, palette) === tier);
      expect(pool.length, `${category} tier ${tier} is empty`).toBeGreaterThan(0);
    }
    // The grand specimen is one of the category's own climax species — the flora card's showpiece
    // is a bloom, never a tree.
    const grandCategory = categoryOf({ catalogId: palette.grand });
    expect(grandCategory).toBe(category);
    expect(tierOf(palette.grand, palette)).toBe(CLIMAX_STAGE);
    // And it is reserved: the climax tier still has ordinary species left once its whole species is
    // held back, or the specimen would be indistinguishable from the stand around it.
    const ordinaryClimax = getPlaceableByCategory(category)
      .filter((i) => tierOf(i.id, palette) === CLIMAX_STAGE && !i.id.startsWith(palette.grand));
    expect(ordinaryClimax.length).toBeGreaterThan(1);
  });

  it('ages from the centre outward and freezes once the ladder is climbed', () => {
    // One pioneer tree per ring, a centre half a cell off the grid so the distances land on the ring
    // edges: 0.5 and 2.5 and 4.5 cells out with rings two wide, and one far past the last ring.
    const centre = { x: 20, y: 20.5 };
    const spots = [{ x: 20, y: 20 }, { x: 20, y: 18 }, { x: 20, y: 25 }, { x: 60, y: 20 }];
    const tiersAt = (stage: number): (number | null)[] => {
      const state = makeState(80, 40);
      const executor = makeExecutor(state);
      const holdIds = new Set<string>();
      for (const [k, at] of spots.entries()) {
        const id = `pioneer-${k}`;
        expect(executor.execute(placeObjectCommand({ id, catalogId: 'tree-peach', position: at, rotation: 0, elevation: 0 })).success).toBe(true);
        holdIds.add(id);
      }
      ageStand({ state, executor, registry: executor.getRegistry() }, {
        cells: spots, centre, ringWidth: 2, stage, seed: 5, lead: ItemCategory.Tree, holdIds,
        field: buildHabitatField(analyzeTerrain(state)),
      });
      const palette = successionPalette(ItemCategory.Tree)!;
      return spots.map((at) => {
        const standing = [...state.objects.values()].find((o) => o.position.x === at.x && o.position.y === at.y);
        return standing ? tierOf(standing.catalogId, palette) : null;
      });
    };
    expect(tierOf('tree-peach', successionPalette(ItemCategory.Tree)!)).toBe(1);
    // One ring per tier, at a stage that has reached the top.
    expect(tiersAt(3)).toEqual([3, 2, 1, 1]);
    // A short press ages nothing anywhere.
    expect(tiersAt(1)).toEqual([1, 1, 1, 1]);
    // A hold longer than the ladder is the same stand, not a climax one out to the rim.
    expect(tiersAt(99)).toEqual(tiersAt(3));
  });
});

describe('a hold', () => {
  // Pooled over four holds rather than measured on one: the innermost ring is a couple of dozen
  // cells and a single press puts only a handful of plants in it, so one map's climax mean is two
  // or three samples wide. The claim is about the gradient, not about one draw.
  it.each(['patch-tree', 'patch-flora'] as const)('%s: age falls off from the press centre', (id) => {
    const rows = SEEDS.flatMap((seed) => {
      const kit = setup();
      hold(kit, id, BURSTS, seed);
      return aged(kit.state);
    });
    for (let tier = 1; tier <= CLIMAX_STAGE; tier++) {
      expect(rows.filter((r) => r.tier === tier).length, `tier ${tier} is unrepresented`).toBeGreaterThan(4);
    }
    expect(meanD(rows, CLIMAX_STAGE)).toBeLessThan(meanD(rows, 2));
    expect(meanD(rows, 2)).toBeLessThan(meanD(rows, 1));
  });

  /**
   * A 30-seed sweep per card, not one press: the stage-1 community hands the grand species out like
   * any other, so a hold whose ordinary draw happened to put one inside the innermost ring stood two
   * grands — measured at 12-23% of holds — while a single-seed probe passed. The species is reserved
   * from the tier draw and a plant already wearing it is never skipped, which is what makes one an
   * upper bound rather than a likely outcome.
   */
  it.each([
    ['patch-tree', 'on'], ['patch-flora', 'on'], ['patch-tree', 'off'], ['patch-flora', 'off'],
  ] as const)('%s: stands at most one grand specimen, and only at the oldest centre, with the load limit %s', (id, limit) => {
    const lead = id === 'patch-tree' ? ItemCategory.Tree : ItemCategory.Flora;
    const grand = successionPalette(lead)!.grand;
    const ringWidth = RADIUS / CLIMAX_STAGE;
    let stood = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const kit = setup();
      kit.state.ignoreChunkLoad = limit === 'off';
      hold(kit, id, BURSTS, seed);
      const specimens = [...kit.state.objects.values()].filter((o) => o.catalogId === grand);
      expect(specimens.length, `seed ${seed}: ${specimens.length} grand specimens`).toBeLessThanOrEqual(1);
      for (const s of specimens) {
        stood++;
        // In the climax ring itself: a lone showpiece out among the rim pioneers (which is where the
        // nearest plant can be when the inner rings are unplantable) reads as a stray, not a heart.
        expect(Math.hypot(s.position.x - AT.x, s.position.y - AT.y), `seed ${seed}: the grand stands outside the climax ring`).toBeLessThan(ringWidth);
      }
    }
    // The sweep has to have seen one: an upper bound nothing reaches proves nothing.
    expect(stood).toBeGreaterThan(10);
  });

  it('plants no tree on the flora-led card however long it is held', () => {
    for (const seed of SEEDS) {
      const kit = setup();
      hold(kit, 'patch-flora', BURSTS, seed);
      const trees = [...kit.state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Tree);
      expect(trees.length, `seed ${seed}: a held flora press grew a tree`).toBe(0);
      expect(kit.state.objects.size).toBeGreaterThan(0);
    }
  });

  it('keeps the tree-led card a stand of TREES as it ages', () => {
    for (const seed of SEEDS) {
      const kit = setup();
      hold(kit, 'patch-tree', BURSTS, seed);
      const objs = [...kit.state.objects.values()];
      const trees = objs.filter((o) => categoryOf(o) === ItemCategory.Tree).length;
      const flora = objs.filter((o) => categoryOf(o) === ItemCategory.Flora).length;
      expect(trees, `seed ${seed}: flora (${flora}) outgrew trees (${trees})`).toBeGreaterThan(flora);
    }
  });

  it.each(['patch-tree', 'patch-flora'] as const)('%s: the same hold grows the same stand', (id) => {
    const a = setup();
    const b = setup();
    hold(a, id, BURSTS, 42);
    hold(b, id, BURSTS, 42);
    expect(shapeOf(a.state).length).toBeGreaterThan(0);
    expect(shapeOf(a.state)).toBe(shapeOf(b.state));
  });

  it('leaves a SHORT press exactly what it was before the ladder existed', () => {
    const withStage = setup();
    const plain = setup();
    applyMacro(withStage, 'patch-tree', { seed: 5, at: AT, radius: RADIUS, stage: 1 });
    applyMacro(plain, 'patch-tree', { seed: 5, at: AT, radius: RADIUS });
    expect(shapeOf(plain.state).length).toBeGreaterThan(0);
    expect(shapeOf(withStage.state)).toBe(shapeOf(plain.state));
  });
});

/**
 * The tool's own fold, with a plant already standing where the hold will grow: the hold's ageing
 * must reach only what it planted, so the hand-placed plant survives untouched and the hold's own
 * growth still folds to one entry.
 */
describe('the whole hold as one undo entry', () => {
  let state: GridState;
  let exec: CommandExecutor;
  // Pinned to its own default: the burst's radius (`ctx.arming.brushSize + 3`) reads it live, and a
  // test that raises it must not leak that into a sibling that assumes the default.
  let brushSize = 1;

  const ctxFor = (): HostedToolContext => makeToolCtx(state, exec, brushSize, 1, { armedMacro: 'patch-flora' });

  beforeEach(() => {
    state = makeState(40, 40);
    exec = makeExecutor(state);
    brushSize = 1;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grows its own stand, folded into one undo entry, and never touches a hand-placed plant standing where it grows', () => {
    const standing: PlacedObject = {
      id: 'hand-planted', catalogId: 'flower-daisy', position: { ...AT }, rotation: 0, elevation: 0,
    };
    expect(exec.execute(placeObjectCommand(standing)).success).toBe(true);
    const watermark = exec.historyDepth();

    const tool = new MacroTool();
    tool.onActivate();
    const ctx = ctxFor();
    tool.onPointerDown(cell(AT as MacroCoord), point({ x: AT.x, y: AT.y }), ctx);
    // Held in place long enough to climb the ladder, then released.
    vi.advanceTimersByTime(350 * BURSTS);
    tool.onPointerUp(cell(AT as MacroCoord), point({ x: AT.x, y: AT.y }), ctx);

    // The hold grew a stand of its own — this is growth, not a hold that did nothing — and the
    // whole of it, planting and ageing alike, still folds to the one entry a press promises.
    expect(state.objects.size, 'the hold grew nothing to fold').toBeGreaterThan(1);
    expect(exec.historyDepth(), 'the hold left more than one entry').toBe(watermark + 1);

    // The hand-placed daisy stood in the same disc the whole time and never planted this hold's own
    // stand: it must survive completely untouched, id and species alike, with no undo required.
    const hand = state.objects.get('hand-planted');
    expect(hand, 'the hold removed a hand-placed plant it never grew').toBeTruthy();
    expect(hand!.catalogId).toBe('flower-daisy');
  });

  /**
   * Travel re-anchors: a burst far enough from the resting spot is a fresh press, so `stage` resets
   * and `anchorSeed` is recaptured there. A stale anchorSeed shows only through the composition
   * (`patch.ts`: `composition = anchorSeed ?? seed`), so `rest`/`travel` and the 11-tick hold were
   * picked by sweeping `delightRoll`: the rest seed rolls no delight and the travel seed rolls a
   * `fairy-ring`, which the rest seed replayed cannot produce.
   */
  it("re-anchors on travel: the new spot draws its own fresh, unaged composition, not the rest point's", () => {
    const rest = { x: 10, y: 20 };
    const travel = { x: 30, y: 20 }; // far enough apart that the two radius-8 discs never touch
    brushSize = 5; // ctx.brushSize + 3 = 8

    const tool = new MacroTool();
    tool.onActivate();
    const ctx = ctxFor();
    tool.onPointerDown(cell(rest as MacroCoord), point({ x: rest.x, y: rest.y }), ctx);
    // Ages the rest point well past climax, and lands the seed the travel burst consumes on 13.
    vi.advanceTimersByTime(350 * 11);
    tool.onPointerMove(cell(travel as MacroCoord), point({ x: travel.x, y: travel.y }), ctx);
    tool.onPointerUp(cell(travel as MacroCoord), point({ x: travel.x, y: travel.y }), ctx);

    const shapeNear = (centre: { x: number; y: number }): string[] => [...state.objects.values()]
      .filter((o) => Math.hypot(o.position.x - centre.x, o.position.y - centre.y) < 9)
      .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort();

    // A plain press at the travel spot with the seed the tool's own burst just consumed: byte for
    // byte what a click there would have laid had the hold never rested at `rest` at all.
    const fresh = setup();
    applyMacro(fresh, 'patch-flora', { seed: 13, at: travel as MacroCoord, radius: 8 });
    const freshShape = [...fresh.state.objects.values()]
      .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort();
    expect(shapeNear(travel)).toEqual(freshShape);

    // A stale rest-point anchor seed produces a different composition from the travel point.
    const stale = setup();
    applyMacro(stale, 'patch-flora', { seed: 13, at: travel as MacroCoord, radius: 8, anchorSeed: 1 });
    const staleShape = [...stale.state.objects.values()]
      .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort();
    expect(shapeNear(travel)).not.toEqual(staleShape);
  });

  /** Release freezes (macro-tool.ts's `finishSpray`): the interval is cleared the moment the press
   *  lifts, so a clock the test advances afterward has nothing left to fire. */
  it('freezes on release: the clock sprays nothing once the pointer lifts', () => {
    const tool = new MacroTool();
    tool.onActivate();
    const ctx = ctxFor();
    tool.onPointerDown(cell(AT as MacroCoord), point({ x: AT.x, y: AT.y }), ctx);
    vi.advanceTimersByTime(350 * 2);
    tool.onPointerUp(cell(AT as MacroCoord), point({ x: AT.x, y: AT.y }), ctx);

    const watermark = exec.historyDepth();
    const objectCount = state.objects.size;
    vi.advanceTimersByTime(350 * 20);
    expect(exec.historyDepth(), 'a tick after release still sprayed').toBe(watermark);
    expect(state.objects.size, 'a tick after release still planted').toBe(objectCount);
  });
});

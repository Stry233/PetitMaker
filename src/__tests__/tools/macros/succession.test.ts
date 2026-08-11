/**
 * Hold to grow: the smart-planting press's spray turns a hold into TIME.
 *
 * Each burst at the spot the hand rests on advances the stand one succession step, so age falls off
 * from the press centre — climax at the heart, the middle tier a ring out, pioneers at the rim. What
 * is pinned here is that geometry, the card promises that must survive it (a flora-led hold plants
 * no tree, whatever it grows into), the fold to ONE undo entry, and determinism.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { ItemCategory, type EditorEvents, type GridState, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { categoryOf, getPlaceableByCategory } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import type { KitContext } from '../../../kit/context';
import { applyMacro, type MacroId } from '../../../tools/macros';
import { MacroTool } from '../../../tools/macros/macro-tool';
import { CLIMAX_STAGE, successionPalette, tierAt, tierOf } from '../../../tools/macros/succession';
import { objectPlacementCommand } from '../../../tools/objects/object-placer';
import type { ToolContext } from '../../../tools/types';
import { makeState } from '../../rules/_helpers';

const AT = { x: 20, y: 20 };
const RADIUS = 8;
const DENSITY = 0.9;
/** Long enough to reach the top of the ladder and settle there. */
const BURSTS = 5;
/** The seed sweep the pooled probes run over. */
const SEEDS = [1, 7, 13, 29];

function setup(): KitContext {
  const state = makeState(40, 40);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  return { state, executor, registry: executor.getRegistry() };
}

/** One hold at the aim point: `bursts` presses of the same gesture, each one step older. Threads
 *  `heldIds` exactly as `MacroTool`'s spray does (`macro-tool.ts:burst`), since a burst now ages
 *  only what earlier bursts of ITS OWN hold planted. */
function hold(kit: KitContext, id: MacroId, bursts: number, seed = 1): void {
  const baseIds = new Set(kit.state.objects.keys());
  for (let k = 1; k <= bursts; k++) {
    const heldIds = [...kit.state.objects.keys()].filter((objId) => !baseIds.has(objId));
    applyMacro(kit, id, {
      seed: seed + k - 1, at: AT, radius: RADIUS, density: DENSITY, stage: k,
      ...(heldIds.length > 0 ? { heldIds } : {}),
    });
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
    // The grand specimen is one of the category's OWN climax species — the flora card's showpiece
    // is a bloom, never a tree.
    const grandCategory = categoryOf({ catalogId: palette.grand });
    expect(grandCategory).toBe(category);
    expect(tierOf(palette.grand, palette)).toBe(CLIMAX_STAGE);
    // And it is RESERVED: the climax tier still has ordinary species left once its whole species is
    // held back, or the specimen would be indistinguishable from the stand around it.
    const ordinaryClimax = getPlaceableByCategory(category)
      .filter((i) => tierOf(i.id, palette) === CLIMAX_STAGE && !i.id.startsWith(palette.grand));
    expect(ordinaryClimax.length).toBeGreaterThan(1);
  });

  it('ages from the centre outward and freezes once the ladder is climbed', () => {
    // One ring per tier, at a stage that has reached the top.
    expect(tierAt(3, 0, 2)).toBe(3);
    expect(tierAt(3, 2.5, 2)).toBe(2);
    expect(tierAt(3, 4.5, 2)).toBe(1);
    expect(tierAt(3, 40, 2)).toBe(1);
    // A short press ages nothing anywhere.
    expect(tierAt(1, 0, 2)).toBe(1);
    // A hold longer than the ladder is the same stand, not a climax one out to the rim.
    expect(tierAt(99, 4.5, 2)).toBe(tierAt(3, 4.5, 2));
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
   * A 30-seed sweep per card, not one press: the stage-1 community hands the grand SPECIES out like
   * any other, so a hold whose ordinary draw happened to put one inside the innermost ring stood two
   * grands — measured at 12-23% of holds — while a single-seed probe passed. The species is reserved
   * from the tier draw AND a plant already wearing it is never skipped, which is what makes one an
   * upper bound rather than a likely outcome.
   */
  it.each(['patch-tree', 'patch-flora'] as const)('%s: stands at most one grand specimen, and only at the oldest centre', (id) => {
    const lead = id === 'patch-tree' ? ItemCategory.Tree : ItemCategory.Flora;
    const grand = successionPalette(lead)!.grand;
    const ringWidth = RADIUS / CLIMAX_STAGE;
    let stood = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const kit = setup();
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
    // The sweep has to have SEEN one: an upper bound nothing reaches proves nothing.
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
    applyMacro(withStage, 'patch-tree', { seed: 5, at: AT, radius: RADIUS, density: DENSITY, stage: 1 });
    applyMacro(plain, 'patch-tree', { seed: 5, at: AT, radius: RADIUS, density: DENSITY });
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
  // Pinned to its own default: the burst's radius (`ctx.brushSize + 3`) reads it live, and a test
  // that raises it must not leak that into a sibling that assumes the default.
  let brushSize = 1;

  const ctxFor = (): ToolContext => ({
    gridState: state,
    overlay: { showGhost: vi.fn(), clearGhost: vi.fn() },
    getUndoStackSize: () => exec.getUndoStackSize(),
    collapseHistory: (start: number) => { exec.collapseHistory(start); },
    t: (key: string) => key,
    armedMacro: 'patch-flora',
    brushSize,
    macroContext: { state, executor: exec, registry: exec.getRegistry() },
  } as unknown as ToolContext);

  beforeEach(() => {
    state = makeState(40, 40);
    exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
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
    expect(exec.execute(objectPlacementCommand(standing)).success).toBe(true);
    const watermark = exec.getUndoStackSize();

    const tool = new MacroTool();
    tool.onActivate();
    const ctx = ctxFor();
    tool.onPointerDown(AT as MacroCoord, { x: AT.x, y: AT.y }, ctx);
    // Held in place long enough to climb the ladder, then released.
    vi.advanceTimersByTime(350 * BURSTS);
    tool.onPointerUp(AT as MacroCoord, { x: AT.x, y: AT.y }, ctx);

    // The hold grew a stand of its own — this is growth, not a hold that did nothing — and the
    // whole of it, planting and ageing alike, still folds to the one entry a press promises.
    expect(state.objects.size, 'the hold grew nothing to fold').toBeGreaterThan(1);
    expect(exec.getUndoStackSize(), 'the hold left more than one entry').toBe(watermark + 1);

    // The hand-placed daisy stood in the same disc the whole time and never planted this hold's own
    // stand: it must survive completely untouched, id and species alike, with no undo required.
    const hand = state.objects.get('hand-planted');
    expect(hand, 'the hold removed a hand-placed plant it never grew').toBeTruthy();
    expect(hand!.catalogId).toBe('flower-daisy');
  });

  /**
   * TRAVEL RE-ANCHORS (macro-tool.ts:174-193): a burst far enough from the spot the hold has been
   * resting on treats the new spot as a fresh press, never the old one's next year — `stage` resets
   * to 0, so the burst that lands there is stage 1, and `anchorSeed` is recaptured as the seed
   * landing there rather than carried over from the rest point.
   *
   * The `anchorSeed` fact only shows on the map through a COMPOSITION (`patch.ts`'s
   * `composition = anchorSeed ?? seed`, what a delight or a bed is drawn from): a STALE anchorSeed
   * would have the travel spot draw the REST point's composition, seeds "colliding" so the two
   * spots wear the same design. `rest`/`travel` and the 11-tick hold below were picked by sweeping
   * `delightRoll` (exported for exactly this) so the rest point's own seed rolls no delight at all
   * and the seed the travel burst actually consumes rolls a `fairy-ring` — a shape a stale seed
   * could not have produced, since replayed with the rest point's seed it produces nothing of the
   * kind (asserted below, rather than asserted against the private field itself).
   */
  it("re-anchors on travel: the new spot draws its own fresh, unaged composition, not the rest point's", () => {
    const rest = { x: 10, y: 20 };
    const travel = { x: 30, y: 20 }; // far enough apart that the two radius-8 discs never touch
    brushSize = 5; // ctx.brushSize + 3 = 8

    const tool = new MacroTool();
    tool.onActivate();
    const ctx = ctxFor();
    tool.onPointerDown(rest as MacroCoord, { x: rest.x, y: rest.y }, ctx);
    // Ages the rest point well past climax, and lands the seed the travel burst consumes on 13.
    vi.advanceTimersByTime(350 * 11);
    tool.onPointerMove(travel as MacroCoord, { x: travel.x, y: travel.y }, ctx);
    tool.onPointerUp(travel as MacroCoord, { x: travel.x, y: travel.y }, ctx);

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

    // The regression this pins: a stale anchorSeed (the rest point's, 1) draws the rest point's
    // composition instead of its own — no fairy ring, a few ordinary wild plants.
    const stale = setup();
    applyMacro(stale, 'patch-flora', { seed: 13, at: travel as MacroCoord, radius: 8, anchorSeed: 1 });
    const staleShape = [...stale.state.objects.values()]
      .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort();
    expect(shapeNear(travel)).not.toEqual(staleShape);
  });

  /** RELEASE FREEZES (macro-tool.ts's `finishSpray`): the interval is cleared the moment the press
   *  lifts, so a clock the test advances afterward has nothing left to fire. */
  it('freezes on release: the clock sprays nothing once the pointer lifts', () => {
    const tool = new MacroTool();
    tool.onActivate();
    const ctx = ctxFor();
    tool.onPointerDown(AT as MacroCoord, { x: AT.x, y: AT.y }, ctx);
    vi.advanceTimersByTime(350 * 2);
    tool.onPointerUp(AT as MacroCoord, { x: AT.x, y: AT.y }, ctx);

    const watermark = exec.getUndoStackSize();
    const objectCount = state.objects.size;
    vi.advanceTimersByTime(350 * 20);
    expect(exec.getUndoStackSize(), 'a tick after release still sprayed').toBe(watermark);
    expect(state.objects.size, 'a tick after release still planted').toBe(objectCount);
  });
});

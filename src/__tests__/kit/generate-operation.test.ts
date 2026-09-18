/**
 * One generate implementation, three callers. This is the test that fails if a second one appears:
 * two contexts, one seed, and the results have to be indistinguishable down to the provenance.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateMap, generateCandidate, clearGenerated } from '../../kit/operations';
import { currentKit } from '../../kit/context';
import { newMap } from '../../kit/operations';
import { objectPlacementCommand } from '../../tools/objects/object-placer';
import { generateObjectId } from '../../core/model/object-id';
import { serialize } from '../../io/json-codec';
import { stableSerialize } from './_stable-serialize';
import { CommandType, TerrainType } from '../../core/model/types';
import type { GenerateConfig, GridState, MacroCoord, PlacedObject } from '../../core/model/types';

// A full island generation is the expensive operation in this file and it runs 21 of them, several
// as a pair whose POINT is that both runs produce identical bytes. Measured: one case here takes
// 584ms-1246ms on an idle machine, so it is a pair on a loaded worker that passes the default 5s
// rather than a single run. 60s is the budget the repository's other generation suites already use.
vi.setConfig({ testTimeout: 60_000 });

const config = (seed: number): GenerateConfig => ({
  algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 4, seed, region: null,
  richness: 1,
});

/** A square over the TOWN — the ground around hexia's plaza, which every planet design builds on,
 *  so a scoped run reliably drops both pavement and planting there AND leaves at least one cell free
 *  for a hand placement. A region over open outskirts legitimately comes back bare: the planet is
 *  designed whole and the commands are cropped, so a region only receives what the design put in it. */
function denseRegion(): MacroCoord[] {
  const region: MacroCoord[] = [];
  for (let y = 62; y < 92; y++) for (let x = 56; x < 100; x++) region.push({ x, y });
  return region;
}

/** The map itself: its cells and its objects, ids included. An object id is minted per placement
 *  and is never seed-derived, so two maps that match down to the ids were made by one run. */
const withIds = (state: GridState): string =>
  JSON.stringify({ cells: state.cells, objects: [...state.objects.values()] });

/**
 * The map alone, through the codec, which is what makes it comparable.
 *
 * Two things about a restored map are not facts about it: the ORDER `state.objects` was refilled in
 * (undo reinstates what it removed, not in the order it was placed), and the order of a cell's own
 * keys (a cell written by an undo carries the same values under a different insertion order, and
 * `JSON.stringify` prints that). Serializing normalises both. The provenance ledger is left out for
 * the reason it is left out everywhere else: it is a HISTORY, and a history does not rewind.
 */
const mapOnly = (state: GridState): string => {
  const parsed = JSON.parse(serialize(state));
  return JSON.stringify({
    cells: parsed.cells,
    objects: (parsed.objects as { id: string }[]).slice().sort((a, b) => a.id.localeCompare(b.id)),
  });
};

/** The same by VALUE, which is what two separate runs of one recipe can be expected to share. */
const withoutIds = (state: GridState): string => JSON.stringify({
  cells: state.cells,
  objects: [...state.objects.values()].map(({ id, ...rest }) => rest),
});

/** Somebody paints a block while the cards are standing on the shelf. */
function paintByHand(state: GridState, at: MacroCoord): void {
  const kit = currentKit()!;
  const watermark = kit.executor.getUndoStackSize();
  kit.executor.execute({
    type: CommandType.PaintTerrain, timestamp: 1, cells: [at],
    terrainType: TerrainType.Mountain, elevation: 1,
  });
  kit.executor.commitStroke(watermark);
  expect(state.cells[at.y]![at.x]!.terrain, 'the hand paint landed').not.toBeNull();
}

beforeEach(() => newMap('hexia'));

describe('generate operation', () => {
  it('produces the same map from the same seed whoever calls it', async () => {
    await generateMap(currentKit()!, { config: config(4242), region: null });
    const first = stableSerialize(currentKit()!.state);

    newMap('hexia');
    await generateMap(currentKit()!, { config: config(4242), region: null });
    expect(stableSerialize(currentKit()!.state)).toBe(first);
  });

  it('is one undo step', async () => {
    const kit = currentKit()!;
    await generateMap(kit, { config: config(7), region: null });
    expect(kit.executor.getUndoStackSize()).toBe(1);
  });

  it('attributes what it made to the generator', async () => {
    const kit = currentKit()!;
    await generateMap(kit, { config: config(7), region: null });
    expect(kit.executor.getProvenanceSummary().containsProcedural).toBe(true);
  });

  it('records a full run as replayable and a scoped run as not', async () => {
    const kit = currentKit()!;
    await generateMap(kit, { config: config(7), region: null });
    expect(kit.state.generation).toBeDefined();

    await generateMap(kit, { config: config(8), region: [{ x: 40, y: 40 }, { x: 41, y: 40 }] });
    expect(kit.state.generation).toBeUndefined();
  });

  it('reports what it placed rather than announcing it', async () => {
    const outcome = await generateMap(currentKit()!, { config: config(11), region: null });
    expect(outcome.placed).toBeGreaterThan(0);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.violations).toEqual([]);
  });

  it('leaves nothing behind when cancelled', async () => {
    const kit = currentKit()!;
    const signal = { cancelled: false };
    const promise = generateMap(kit, { config: config(9), region: null, signal });
    signal.cancelled = true;
    const outcome = await promise;

    expect(outcome.cancelled).toBe(true);
    expect(kit.executor.getUndoStackSize()).toBe(0);
  });

  it('treats an empty region array the same as no region, like the UI\'s at-rest state', async () => {
    const kit = currentKit()!;
    const outcome = await generateMap(kit, { config: config(6), region: [] });
    // A full run: state.generation gets recorded and the flash covers the whole template.
    expect(kit.state.generation).toBeDefined();
    expect(outcome.cells.length).toBe(kit.state.template.width * kit.state.template.height);
  });

  it('does not alias or mutate the caller\'s region array', async () => {
    const kit = currentKit()!;
    const region = [{ x: 40, y: 40 }, { x: 41, y: 40 }];
    const original = region.map((c) => ({ ...c }));
    const outcome = await generateMap(kit, { config: config(5), region });

    outcome.cells.push({ x: 999, y: 999 });
    expect(region).toEqual(original); // the caller's own array is untouched by the outcome

    const clearOutcome = clearGenerated(kit, { region: null }); // falls back to the remembered scope
    expect(clearOutcome.cells).not.toContainEqual({ x: 999, y: 999 });
  });

  it('clears within the last run scope', async () => {
    const kit = currentKit()!;
    const region = [{ x: 40, y: 40 }, { x: 41, y: 40 }, { x: 40, y: 41 }, { x: 41, y: 41 }];
    await generateMap(kit, { config: config(3), region });
    const outcome = clearGenerated(kit, { region: null });   // falls back to the last run's scope
    expect(outcome.cells).toEqual(region);
    expect(kit.state.generation).toBeUndefined();
  });

  it('an empty region on Clear also falls back to the last run\'s scope', async () => {
    const kit = currentKit()!;
    const region = [{ x: 40, y: 40 }, { x: 41, y: 40 }, { x: 40, y: 41 }, { x: 41, y: 41 }];
    await generateMap(kit, { config: config(3), region });
    const outcome = clearGenerated(kit, { region: [] });
    expect(outcome.cells).toEqual(region);
  });

  it('lands a candidate rather than building the same recipe a second time', async () => {
    const kit = currentKit()!;
    const candidate = await generateCandidate(kit, { config: config(2718), region: null });
    expect(candidate).not.toBeNull();

    await generateMap(kit, { config: config(2718), region: null, candidate });

    // The candidate's own run arriving on the map, not a repeat of it.
    expect(withIds(kit.state)).toBe(withIds(candidate!.state));
    expect(kit.executor.getUndoStackSize()).toBe(1);
    expect(kit.executor.getProvenanceSummary().containsProcedural).toBe(true);
    expect(kit.state.generation).toBeDefined();
  }, 60_000);

  it('takes a landed candidate back to the map that was under it', async () => {
    const kit = currentKit()!;
    paintByHand(kit.state, { x: 40, y: 40 });
    const before = withIds(kit.state);

    const candidate = await generateCandidate(kit, { config: config(31), region: null });
    await generateMap(kit, { config: config(31), region: null, candidate });
    expect(withIds(kit.state)).toBe(withIds(candidate!.state));

    kit.executor.undo();
    expect(withIds(kit.state)).toBe(before);
  }, 60_000);

  it('lands a second candidate by reuse once the first has been taken back', async () => {
    const kit = currentKit()!;
    const first = await generateCandidate(kit, { config: config(2718), region: null });
    const second = await generateCandidate(kit, { config: config(2719), region: null });

    await generateMap(kit, { config: config(2718), region: null, candidate: first });
    kit.executor.undo();
    await generateMap(kit, { config: config(2719), region: null, candidate: second });

    // Undo put the map back to the one both were built on, so the second lands as itself.
    expect(withIds(kit.state)).toBe(withIds(second!.state));
  }, 90_000);

  /**
   * A CARD LANDED OVER ANOTHER CARD'S PLANET IS STILL ITS OWN RUN ARRIVING, because a full run
   * clears before it builds and a planet clears to the same ground a blank map does. What the
   * candidate was photographed on is not the map underneath, it is the map after that clearing.
   *
   * And each click is still its own undo step. Undoing the previous apply before landing another
   * card is the other way to make the replay run — it puts the candidate's base map back — but it
   * costs the history: one entry and one redo however many planets have been looked at.
   */
  it('lands a second card over the first planet without building it again', async () => {
    const kit = currentKit()!;
    const first = await generateCandidate(kit, { config: config(2718), region: null });
    const second = await generateCandidate(kit, { config: config(2719), region: null });

    await generateMap(kit, { config: config(2718), region: null, candidate: first });
    const landedFirst = mapOnly(kit.state);
    await generateMap(kit, { config: config(2719), region: null, candidate: second });

    // The card's own run arrived, over a planet, without being built a second time.
    expect(withIds(kit.state)).toBe(withIds(second!.state));
    // A second planet, not the first one left standing.
    expect(mapOnly(kit.state)).not.toBe(landedFirst);
    expect(kit.executor.getUndoStackSize()).toBe(2);

    // AND EVERY STEP WALKS BACK, compared by CONTENT rather than by `state.objects`' iteration
    // order, which is the order the undo happened to reinstate them in and is not a fact about the
    // map.
    kit.executor.undo();
    expect(mapOnly(kit.state)).toBe(landedFirst);
  }, 120_000);

  /** A paint the run's own clearing takes with it is not a map that moved: the card was never a
   *  promise about that cell. */
  it('lands the card over a hand paint the run would erase anyway', async () => {
    const kit = currentKit()!;
    const candidate = await generateCandidate(kit, { config: config(1729), region: null });
    paintByHand(kit.state, { x: 40, y: 40 });

    await generateMap(kit, { config: config(1729), region: null, candidate });

    expect([...kit.state.objects.keys()]).toEqual([...candidate!.state.objects.keys()]);
    expect(withoutIds(kit.state)).toBe(withoutIds(candidate!.state));
    expect(kit.executor.getUndoStackSize()).toBe(2);   // the hand stroke, then the run
  }, 90_000);

  /** A SCOPED run keeps its surroundings, so a paint outside the region IS the map moving: the
   *  commands were validated against ground that no longer exists and the recipe runs again. */
  it('builds for real when a scoped candidate\'s surroundings moved, and still lands the picture', async () => {
    const kit = currentKit()!;
    const region = denseRegion();
    const rich: GenerateConfig = config(3);
    const candidate = await generateCandidate(kit, { config: rich, region });
    expect(candidate!.state.objects.size, 'the scoped run placed something').toBeGreaterThan(1);
    paintByHand(kit.state, { x: 60, y: 60 });   // outside the region, so the run will not take it

    await generateMap(kit, { config: rich, region, candidate });

    // Fresh ids: the stale commands were dropped and the generator ran.
    expect([...kit.state.objects.keys()]).not.toEqual([...candidate!.state.objects.keys()]);
    expect(kit.executor.getUndoStackSize()).toBe(2);   // the hand stroke, then the run
  }, 90_000);

  it('spares a hand-placed object inside the region while clearing the generated ones', async () => {
    const kit = currentKit()!;
    const region = denseRegion();
    const richConfig: GenerateConfig = config(3);
    await generateMap(kit, { config: richConfig, region });
    expect(kit.state.objects.size, 'the region run placed something').toBeGreaterThan(0);

    let mine: PlacedObject | null = null;
    for (const c of region) {
      const o: PlacedObject = { id: generateObjectId(), catalogId: 'tree-apple', position: c, rotation: 0, elevation: 0 };
      if (kit.executor.execute(objectPlacementCommand(o)).success) { mine = o; break; }
    }
    expect(mine, 'planted a tree in the region by hand').not.toBeNull();

    const outcome = clearGenerated(kit, { region: null }); // falls back to the last run's scope

    expect(outcome.cells).toEqual(region);
    expect(outcome.removedObjects).toBeGreaterThan(0);
    expect(kit.state.objects.has(mine!.id), 'the hand-planted tree stayed').toBe(true);
  });
});

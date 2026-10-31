/**
 * The one generate operation every caller shares: a seed gives the same map in any editor context, and
 * a candidate lands, cancels and undoes as one run.
 */
import { placeObjectCommand } from '../../../core/model/command-build';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateMap, generateCandidate, clearGenerated, newMap } from '../../../editor/operations';
import { currentEditor, editorPort } from '../../../editor/session/context';
import { generateObjectId } from '../../../core/model/object-id';
import { serialize } from '../../../io/save/json-codec';
import { stableSerialize } from '../../_support/stable-serialize';
import { CommandType, TerrainType } from '../../../core/model/types';
import type { GridState, MacroCoord, PlacedObject } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';

const config = (seed: number): GenerateConfig => (defaultConfig('designed', { maxElevation: 4, seed, richness: 1 }));

/** The ground around hexia's plaza, where every design builds, so a scoped run reliably places
 *  pavement and planting there and leaves a cell free for a hand placement. A region over open
 *  outskirts may come back bare: the design is whole and the commands are cropped to the region. */
function denseRegion(): MacroCoord[] {
  const region: MacroCoord[] = [];
  for (let y = 62; y < 92; y++) for (let x = 56; x < 100; x++) region.push({ x, y });
  return region;
}

/** Cells and objects, ids included. Object ids are minted per placement, never seed-derived, so two
 *  maps that match with ids were made by one run. */
const withIds = (state: GridState): string =>
  JSON.stringify({ cells: state.cells, objects: [...state.objects.values()] });

/**
 * The map through the codec, with objects sorted by id: undo refills `state.objects` and a cell's keys
 * in a different order, and the codec normalises cell key order. The provenance ledger is a history
 * that undo does not rewind, so it is left out.
 */
const mapOnly = (state: GridState): string => {
  const parsed = JSON.parse(serialize(state));
  return JSON.stringify({
    cells: parsed.cells,
    objects: (parsed.objects as { id: string }[]).slice().sort((a, b) => a.id.localeCompare(b.id)),
  });
};

/** Cells and objects without ids: what two separate runs of one recipe share. */
const withoutIds = (state: GridState): string => JSON.stringify({
  cells: state.cells,
  objects: [...state.objects.values()].map(({ id, ...rest }) => rest),
});

/** A hand paint, as a user makes while candidate cards stand on the shelf. */
function paintByHand(state: GridState, at: MacroCoord): void {
  const kit = currentEditor()!;
  const watermark = kit.executor.beginStroke();
  kit.executor.execute({
    type: CommandType.PaintTerrain, cells: [at],
    terrainType: TerrainType.Mountain, elevation: 1,
  });
  watermark.commit();
  expect(state.cells[at.y]![at.x]!.terrain, 'the hand paint landed').not.toBeNull();
}

beforeEach(() => newMap(editorPort, 'hexia'));

describe('generate operation', () => {
  it('produces the same map from the same seed whoever calls it', { timeout: 20_000 }, async () => {
    await generateMap(currentEditor()!, { config: config(4242), region: null });
    const first = stableSerialize(currentEditor()!.state);

    newMap(editorPort, 'hexia');
    await generateMap(currentEditor()!, { config: config(4242), region: null });
    expect(stableSerialize(currentEditor()!.state)).toBe(first);
  });

  it('is one undo step', async () => {
    const kit = currentEditor()!;
    await generateMap(kit, { config: config(7), region: null });
    expect(kit.executor.historyDepth()).toBe(1);
  });

  it('attributes what it made to the generator', async () => {
    const kit = currentEditor()!;
    await generateMap(kit, { config: config(7), region: null });
    expect(kit.executor.getProvenanceSummary().containsProcedural).toBe(true);
  });

  it('records a full run as replayable and a scoped run as not', async () => {
    const kit = currentEditor()!;
    await generateMap(kit, { config: config(7), region: null });
    expect(kit.state.generation).toBeDefined();

    await generateMap(kit, { config: config(8), region: [{ x: 40, y: 40 }, { x: 41, y: 40 }] });
    expect(kit.state.generation).toBeUndefined();
  });

  it('reports what it placed rather than announcing it', async () => {
    const outcome = await generateMap(currentEditor()!, { config: config(11), region: null });
    expect(outcome.placed).toBeGreaterThan(0);
    expect(outcome.cancelled).toBe(false);
    expect(outcome.violations).toEqual([]);
  });

  it('leaves nothing behind when cancelled', async () => {
    const kit = currentEditor()!;
    const controller = new AbortController();
    const { signal } = controller;
    const promise = generateMap(kit, { config: config(9), region: null, signal });
    controller.abort();
    const outcome = await promise;

    expect(outcome.cancelled).toBe(true);
    expect(kit.executor.historyDepth()).toBe(0);
  });

  it('treats an empty region array the same as no region, like the UI\'s at-rest state', async () => {
    const kit = currentEditor()!;
    const outcome = await generateMap(kit, { config: config(6), region: [] });
    // A full run records state.generation and its flash covers the whole template.
    expect(kit.state.generation).toBeDefined();
    expect(outcome.cells.length).toBe(kit.state.template.width * kit.state.template.height);
  });

  it('does not alias or mutate the caller\'s region array', async () => {
    const kit = currentEditor()!;
    const region = [{ x: 40, y: 40 }, { x: 41, y: 40 }];
    const original = region.map((c) => ({ ...c }));
    const outcome = await generateMap(kit, { config: config(5), region });

    outcome.cells.push({ x: 999, y: 999 });
    expect(region).toEqual(original); // the caller's own array is untouched by the outcome

    const clearOutcome = clearGenerated(kit, { region: null }); // falls back to the remembered scope
    expect(clearOutcome.cells).not.toContainEqual({ x: 999, y: 999 });
  });

  it('clears within the last run scope', async () => {
    const kit = currentEditor()!;
    const region = [{ x: 40, y: 40 }, { x: 41, y: 40 }, { x: 40, y: 41 }, { x: 41, y: 41 }];
    await generateMap(kit, { config: config(3), region });
    const outcome = clearGenerated(kit, { region: null });   // falls back to the last run's scope
    expect(outcome.cells).toEqual(region);
    expect(kit.state.generation).toBeUndefined();
  });

  it('an empty region on Clear also falls back to the last run\'s scope', async () => {
    const kit = currentEditor()!;
    const region = [{ x: 40, y: 40 }, { x: 41, y: 40 }, { x: 40, y: 41 }, { x: 41, y: 41 }];
    await generateMap(kit, { config: config(3), region });
    const outcome = clearGenerated(kit, { region: [] });
    expect(outcome.cells).toEqual(region);
  });

  it('lands a candidate rather than building the same recipe a second time', async () => {
    const kit = currentEditor()!;
    const candidate = await generateCandidate(kit, { config: config(2718), region: null });
    expect(candidate).not.toBeNull();

    await generateMap(kit, { config: config(2718), region: null, candidate });

    // Matching ids prove the candidate's own run landed rather than a rerun.
    expect(withIds(kit.state)).toBe(withIds(candidate!.state));
    expect(kit.executor.historyDepth()).toBe(1);
    expect(kit.executor.getProvenanceSummary().containsProcedural).toBe(true);
    expect(kit.state.generation).toBeDefined();
  }, 60_000);

  it('takes a landed candidate back to the map that was under it', async () => {
    const kit = currentEditor()!;
    paintByHand(kit.state, { x: 40, y: 40 });
    const before = withIds(kit.state);

    const candidate = await generateCandidate(kit, { config: config(31), region: null });
    await generateMap(kit, { config: config(31), region: null, candidate });
    expect(withIds(kit.state)).toBe(withIds(candidate!.state));

    kit.executor.undo();
    expect(withIds(kit.state)).toBe(before);
  }, 60_000);

  it('takes a landing cancelled mid-replay back whole, leaving the map and its history as they were', async () => {
    const kit = currentEditor()!;
    paintByHand(kit.state, { x: 40, y: 40 });
    const before = mapOnly(kit.state);
    const depth = kit.executor.historyDepth();
    const candidate = await generateCandidate(kit, { config: config(31), region: null });
    expect(candidate!.commands.length).toBeGreaterThan(300);

    const controller = new AbortController();
    const { signal } = controller;
    const execute = kit.executor.execute.bind(kit.executor);
    let calls = 0;
    const spy = vi.spyOn(kit.executor, 'execute').mockImplementation((cmd) => {
      if (++calls === 300) controller.abort();
      return execute(cmd);
    });
    const outcome = await generateMap(kit, { config: config(31), region: null, candidate, signal });
    spy.mockRestore();

    expect(calls).toBe(300);
    expect(outcome.cancelled).toBe(true);
    expect(mapOnly(kit.state)).toBe(before);
    expect(kit.executor.historyDepth()).toBe(depth);
  }, 60_000);

  it('lands a second candidate by reuse once the first has been taken back', async () => {
    const kit = currentEditor()!;
    const first = await generateCandidate(kit, { config: config(2718), region: null });
    const second = await generateCandidate(kit, { config: config(2719), region: null });

    await generateMap(kit, { config: config(2718), region: null, candidate: first });
    kit.executor.undo();
    await generateMap(kit, { config: config(2719), region: null, candidate: second });

    // Undo restored the map both were built on, so the second lands by reuse.
    expect(withIds(kit.state)).toBe(withIds(second!.state));
  }, 90_000);

  /**
   * A full run clears before it builds, and a planet clears to the same ground a blank map does, so a
   * card lands by reuse over another card's planet. Each landing stays its own undo step.
   */
  it('lands a second card over the first planet without building it again', async () => {
    const kit = currentEditor()!;
    const first = await generateCandidate(kit, { config: config(2718), region: null });
    const second = await generateCandidate(kit, { config: config(2719), region: null });

    await generateMap(kit, { config: config(2718), region: null, candidate: first });
    const landedFirst = mapOnly(kit.state);
    await generateMap(kit, { config: config(2719), region: null, candidate: second });

    expect(withIds(kit.state)).toBe(withIds(second!.state));
    expect(mapOnly(kit.state)).not.toBe(landedFirst);
    expect(kit.executor.historyDepth()).toBe(2);

    kit.executor.undo();
    expect(mapOnly(kit.state)).toBe(landedFirst);
  }, 120_000);

  /** A paint the run's own clearing erases does not invalidate the candidate. */
  it('lands the card over a hand paint the run would erase anyway', async () => {
    const kit = currentEditor()!;
    const candidate = await generateCandidate(kit, { config: config(1729), region: null });
    paintByHand(kit.state, { x: 40, y: 40 });

    await generateMap(kit, { config: config(1729), region: null, candidate });

    expect([...kit.state.objects.keys()]).toEqual([...candidate!.state.objects.keys()]);
    expect(withoutIds(kit.state)).toBe(withoutIds(candidate!.state));
    expect(kit.executor.historyDepth()).toBe(2);   // the hand stroke, then the run
  }, 90_000);

  /** A scoped run keeps its surroundings, so a paint outside the region invalidates the validated
   *  commands and the recipe runs again. */
  it('builds for real when a scoped candidate\'s surroundings moved, and still lands the picture', async () => {
    const kit = currentEditor()!;
    const region = denseRegion();
    const rich: GenerateConfig = config(3);
    const candidate = await generateCandidate(kit, { config: rich, region });
    expect(candidate!.state.objects.size, 'the scoped run placed something').toBeGreaterThan(1);
    paintByHand(kit.state, { x: 60, y: 60 });   // outside the region, so the run will not take it

    await generateMap(kit, { config: rich, region, candidate });

    // Fresh ids show the generator ran again.
    expect([...kit.state.objects.keys()]).not.toEqual([...candidate!.state.objects.keys()]);
    expect(kit.executor.historyDepth()).toBe(2);   // the hand stroke, then the run
  }, 90_000);

  it('spares a hand-placed object inside the region while clearing the generated ones', async () => {
    const kit = currentEditor()!;
    const region = denseRegion();
    const richConfig: GenerateConfig = config(3);
    await generateMap(kit, { config: richConfig, region });
    expect(kit.state.objects.size, 'the region run placed something').toBeGreaterThan(0);

    let mine: PlacedObject | null = null;
    for (const c of region) {
      const o: PlacedObject = { id: generateObjectId(), catalogId: 'tree-apple', position: c, rotation: 0, elevation: 0 };
      if (kit.executor.execute(placeObjectCommand(o)).success) { mine = o; break; }
    }
    expect(mine, 'planted a tree in the region by hand').not.toBeNull();

    const outcome = clearGenerated(kit, { region: null }); // falls back to the last run's scope

    expect(outcome.cells).toEqual(region);
    expect(outcome.removedObjects).toBeGreaterThan(0);
    expect(kit.state.objects.has(mine!.id), 'the hand-planted tree stayed').toBe(true);
  });
});

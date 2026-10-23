/** Where a generation may build and what Clear takes back: a painted region, the last run's scope,
 *  the landmark and the person's own work. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { world } from '../_world';
import { useEditorStore } from '../../../state/store';
import { currentEditor } from '../../../editor/session/context';
import { landCandidate } from '../../../editor/editing/generate-batch';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { cloneGridState } from '../../../core/model/grid-model';
import {
  changedCells, clear, freshPage, generate, landmarkGround, mapValue, maze, picture, slab, westSquare,
} from './_generation';

const key = (c: { x: number; y: number }): string => `${c.x},${c.y}`;

describe('a painted region', () => {
  spec('GEN-05', 'bounds a run to the cells inside it, leaves the rest exactly as it was, and stays painted', async () => {
    freshPage();
    useEditorStore.getState().initMap(getMapTemplate('hexia'), createDefaultRegistry());
    const kit = currentEditor()!;
    const region = westSquare(kit.state, 24);
    useEditorStore.getState().setRegion(region);
    const before = cloneGridState(kit.state);
    const landing = landCandidate({
      settings: { kind: 'island', richness: 0, maxElevation: 4, corridorWidth: 1, gates: null },
      seed: 7, plan: null, candidate: null, region: useEditorStore.getState().region, stencil: null,
    });
    expect(await landing!.done).not.toBeNull();
    const changed = changedCells(before, kit.state);
    expect(changed.size, 'the run built something in the region').toBeGreaterThan(0);
    const inside = new Set(region.map(key));
    expect([...changed].filter((c) => !inside.has(c)), 'cells changed outside the region').toEqual([]);
    expect(useEditorStore.getState().region).toEqual(region);
  });
});

describe('Clear generated', () => {
  spec('GEN-10', 'takes back the run and Smart Build inside the last scope, keeps hand work and the landmark, as one undo step', async () => {
    freshPage();
    const w = world();
    const region = westSquare(w.state, 24);
    const inside = new Set(region.map(key));
    const corner = region[0]!;
    await generate(w, picture(slab(6), corner, 'flower-protea'), region);
    const ran = cloneGridState(w.state);
    const landmarks = landmarkGround(w.state);

    // The person's own tree, then a Smart Build planting, both inside the region.
    const spot = [...region].reverse().find((c) => w.place('tree-apple', c.x, c.y).ok);
    expect(spot, 'a hand-planted tree in the region').toBeDefined();
    const mine = [...w.state.objects.values()].find((o) => o.position.x === spot!.x && o.position.y === spot!.y)!;
    const centre = { x: corner.x + 12, y: corner.y + 12 };
    expect(w.sandbox.applyMacro('patch-flora', { seed: 3, at: centre, radius: 4, region }).changes).toBeGreaterThan(0);
    const beforeClear = mapValue(w.state);
    const depth = w.sandbox.executor.historyDepth();

    clear(w);
    expect(w.sandbox.executor.historyDepth(), 'one undo step').toBe(depth + 1);
    expect(w.state.objects.get(mine.id), 'the hand-planted tree').toEqual(mine);
    expect(landmarkGround(w.state)).toBe(landmarks);
    const left = [...w.state.objects.values()].filter((o) => !o.locked && o.id !== mine.id);
    expect(left.filter((o) => inside.has(key(o.position))), 'generated objects left in the region').toEqual([]);
    expect([...changedCells(ran, w.state)].filter((c) => !inside.has(c)), 'cells changed outside the scope').toEqual([]);
    w.undo();
    expect(mapValue(w.state)).toBe(beforeClear);
  });

  spec('GEN-10', 'takes the whole planet back to its own ground when the last run had no region, and undoing it gives the recipe back', async () => {
    freshPage();
    const bare = world();
    const w = world();
    await generate(w, maze(8));
    const recipe = w.state.generation;
    expect(recipe).toBeDefined();
    const { width, height } = w.state.template;
    let mine: string | undefined;
    for (let y = 0; y < height && !mine; y++) for (let x = 0; x < width && !mine; x++) mine = w.place('flower-protea', x, y).id;
    expect(mine, 'a hand-planted flower').toBeDefined();
    const beforeClear = mapValue(w.state);

    clear(w);
    const differs: string[] = [];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (JSON.stringify(w.terrainAt({ x, y })) !== JSON.stringify(bare.terrainAt({ x, y }))) differs.push(key({ x, y }));
    }
    expect(differs, 'cells that are not the planet\'s own ground').toEqual([]);
    expect([...w.state.objects.values()].filter((o) => !o.locked).map((o) => o.id)).toEqual([mine]);
    expect(w.state.generation).toBeUndefined();
    w.undo();
    expect(mapValue(w.state)).toBe(beforeClear);
    expect(w.state.generation).toEqual(recipe);
  });
});

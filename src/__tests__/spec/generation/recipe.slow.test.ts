/** A recipe as the player meets it: a card's picture, the same map again from the same recipe, and a
 *  run that undoes, redoes or is cancelled as one step. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world } from '../_world';
import { card, freshPage, generate, mapValue, maze, planet } from './_generation';

describe('a recipe card', () => {
  spec('GEN-02', 'pictures the map its click lands, and building a batch leaves the map being edited as it was', async () => {
    freshPage();
    const w = world();
    const at = w.openGround(3, 3);
    expect(w.stroke(rect(at, 3, 3), TerrainType.Mountain, 1).ok).toBe(true);
    const before = mapValue(w.state);
    const depth = w.sandbox.executor.historyDepth();
    const batch = [];
    for (const seed of [21, 22, 23]) batch.push(await card(w, maze(seed)));
    expect(mapValue(w.state), 'a batch of cards').toBe(before);
    expect(w.sandbox.executor.historyDepth()).toBe(depth);

    const chosen = batch[1]!;
    await generate(w, maze(22), null, { candidate: chosen });
    expect(mapValue(w.state)).toBe(mapValue(chosen.state));
  });
});

describe('one recipe, one map', () => {
  spec('GEN-03', 'builds the same planet from the same seed and settings on a fresh page, on the page and on a copy alike', async () => {
    freshPage();
    const a = world();
    await generate(a, planet(7));
    freshPage();
    const b = world();
    await generate(b, planet(7));
    expect(mapValue(b.state)).toBe(mapValue(a.state));
    freshPage();
    const ahead = await card(world(), planet(7));
    expect(mapValue(ahead!.state), 'a card built on a copy, as the background builds it').toBe(mapValue(a.state));
  });

  spec('GEN-03', 'builds the same Smart Build from the same seed and settings', () => {
    const run = (): string => {
      const w = world();
      const at = w.openGround(12, 12);
      const centre = { x: at.x + 6, y: at.y + 6 };
      expect(w.sandbox.applyMacro('patch-tree', { seed: 5, at: centre, radius: 5 }).changes).toBeGreaterThan(0);
      expect(w.sandbox.applyMacro('raise', { seed: 9, at: { x: centre.x - 4, y: centre.y - 4 }, radius: 3, stage: 2 }).changes).toBeGreaterThan(0);
      return mapValue(w.state);
    };
    expect(run()).toBe(run());
  });
});

describe('a run in the history', () => {
  spec('GEN-08', 'is one undo step that takes back the map and the recipe before it, and redo puts it back', async () => {
    freshPage();
    const w = world();
    const bare = mapValue(w.state);
    await generate(w, maze(1));
    const first = { map: mapValue(w.state), recipe: w.state.generation };
    await generate(w, maze(2));
    const second = { map: mapValue(w.state), recipe: w.state.generation };
    expect(w.sandbox.executor.historyDepth(), 'one step per card clicked').toBe(2);

    w.undo();
    expect(mapValue(w.state)).toBe(first.map);
    expect(w.state.generation).toEqual(first.recipe);
    w.undo();
    expect(mapValue(w.state)).toBe(bare);
    expect(w.state.generation).toBeUndefined();
    w.redo();
    w.redo();
    expect(mapValue(w.state)).toBe(second.map);
    expect(w.state.generation).toEqual(second.recipe);
  });

  spec('GEN-09', 'leaves the map, its history and the previous run untouched when cancelled before it lands', async () => {
    freshPage();
    const w = world();
    await generate(w, maze(3));
    const before = { map: mapValue(w.state), recipe: w.state.generation, depth: w.sandbox.executor.historyDepth() };
    for (const when of ['at once', 'while it builds'] as const) {
      const controller = new AbortController();
      const run = generate(w, maze(4), null, { signal: controller.signal });
      if (when === 'while it builds') await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      expect((await run).cancelled, when).toBe(true);
      expect(mapValue(w.state), when).toBe(before.map);
      expect(w.state.generation, when).toEqual(before.recipe);
      expect(w.sandbox.executor.historyDepth(), when).toBe(before.depth);
      expect(w.sandbox.executor.canRedo(), when).toBe(false);
    }
  });
});

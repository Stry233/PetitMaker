/** A Picture or Letter under the regional load, and what the editor says about the run afterwards. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world } from '../_world';
import { translateFor } from '../../../i18n/context';
import { defaultConfig, type Stencil } from '../../../tools/generation/recipe';
import { freshPage, generate, mapValue, maze, picture, slab, told, westSquare } from './_generation';

/** Every other cell of every other row: a shape that reads only at full density. */
function dots(side: number): Stencil {
  const s = slab(side);
  s.coverage.forEach((_, i, c) => { c[i] = i % 2 === 0 && Math.floor(i / side) % 2 === 0 ? 255 : 0; });
  return s;
}

const en = (key: Parameters<typeof translateFor>[1], n = 0): string => translateFor('en', key, { n });

describe('a Picture or Letter short of regional load', () => {
  spec('GEN-12', 'keeps its size, place and material and thins its objects, outline and corners first', async () => {
    freshPage();
    const w = world();
    const side = 16;
    const square = westSquare(w.state, side);
    const origin = square[0]!;
    const outcome = await generate(w, picture(slab(side), origin, 'flower-protea'), square);
    expect(outcome.placed, 'placed more sparsely than the full picture').toBeLessThan(side * side);
    const laid = [...w.state.objects.values()].filter((o) => !o.locked);
    expect(new Set(laid.map((o) => o.catalogId))).toEqual(new Set(['flower-protea']));
    const at = new Set(laid.map((o) => `${o.position.x - origin.x},${o.position.y - origin.y}`));
    const xs = laid.map((o) => o.position.x - origin.x), ys = laid.map((o) => o.position.y - origin.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], 'the picture keeps its extent').toEqual([0, side - 1, 0, side - 1]);
    const outline = rect({ x: 0, y: 0 }, side, side).filter(({ x, y }) => x === 0 || y === 0 || x === side - 1 || y === side - 1);
    expect(outline.filter(({ x, y }) => !at.has(`${x},${y}`)), 'outline cells left out').toEqual([]);
  });

  spec('GEN-13', 'is refused with a notice when its smallest readable form cannot fit, leaving the map, its history and the last run', async () => {
    freshPage();
    const w = world();
    await generate(w, maze(5));
    const before = { map: mapValue(w.state), recipe: w.state.generation, depth: w.sandbox.executor.historyDepth() };
    const square = westSquare(w.state, 16);
    const outcome = await generate(w, picture(dots(16), square[0]!, 'tree-apple'), square);
    expect(told(outcome, 'image')).toEqual({ notices: [en('generate.budget_blocked')], landed: false });
    expect(mapValue(w.state)).toBe(before.map);
    expect(w.state.generation).toEqual(before.recipe);
    expect(w.sandbox.executor.historyDepth()).toBe(before.depth);
  });
});

describe('after a Picture or Letter run', () => {
  spec('GEN-16', 'says nothing when the run was laid whole, and says so when it was made sparser or refused', async () => {
    freshPage();
    const whole = world();
    const small = westSquare(whole.state, 12);
    expect(told(await generate(whole, picture(slab(12), small[0]!, 'flower-protea'), small), 'text').notices).toEqual([]);

    const sparse = world();
    const square = westSquare(sparse.state, 16);
    expect(told(await generate(sparse, picture(slab(16), square[0]!, 'flower-protea'), square), 'image').notices)
      .toEqual([en('generate.budget_adapted')]);

    const refused = world();
    expect(told(await generate(refused, picture(dots(16), square[0]!, 'tree-apple'), square), 'image').notices)
      .toEqual([en('generate.budget_blocked')]);
  });

  spec('GEN-16', 'says when the run laid nothing, and how many cells it left out and why', async () => {
    freshPage();
    const sea = world();
    const offshore = rect({ x: 2, y: 2 }, 8, 8);
    expect(told(await generate(sea, picture(slab(8), offshore[0]!, 'flower-protea'), offshore), 'image').notices)
      .toEqual([en('generate.picture_nothing_laid')]);

    // A word whose region is a small square inside it, over a plateau the person built: the rest of
    // the word stands on the plateau and its rim cannot carry the letter's height.
    const w = world();
    const at = w.openGround(14, 14);
    for (const layer of [1, 2, 3]) expect(w.stroke(rect(at, 12, 12), TerrainType.Mountain, layer).ok).toBe(true);
    const scope = rect({ x: at.x + 3, y: at.y + 3 }, 3, 3);
    const word = defaultConfig('stencil', {
      seed: 1, maxElevation: 8,
      stencilPlan: { read: 'shape', fill: { kind: 'terrain', terrain: TerrainType.Mountain }, stencil: slab(10), origin: { x: at.x + 1, y: at.y + 1 } },
    });
    const { notices } = told(await generate(w, word, scope), 'text');
    expect(notices).toHaveLength(1);
    const n = Number(/\d+/.exec(notices[0]!)?.[0]);
    expect(n).toBeGreaterThan(0);
    const leftOut = (['generate.text_off_base', 'generate.text_unsupported', 'generate.text_at_ceiling'] as const).map((key) => en(key, n));
    expect(leftOut).toContain(notices[0]);
  });
});

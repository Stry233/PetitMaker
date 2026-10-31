/** The two smart-planting cards are two macros, `patch-tree` and `patch-flora`, each held to the
 *  property its card promises. */
import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../../../rules';
import type { GridState } from '../../../../core/model/types';
import { categoryOf } from '../../../../state/catalog';
import { applyMacro } from '../../../../tools/macros';
import { previewMacro } from '../../../../tools/macros/runtime/preview';
import type { EditContext } from '../../../../core/commands/edit-context';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { ItemCategory } from '../../../../config/catalog/categories';

function setup(w = 40, h = 40): EditContext {
  const state = makeState(w, h);
  const registry = createDefaultRegistry();
  const executor = makeExecutor(state, registry);
  return { state, executor, registry: executor.getRegistry() };
}

/** Counts, per catalog category, of every object standing on the map. */
function counts(state: GridState): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  for (const o of state.objects.values()) {
    const c = categoryOf(o);
    if (c) out[c] = (out[c] ?? 0) + 1;
  }
  return out;
}

const AT = { x: 20, y: 20 };
const RADIUS = 8;

describe('the tree-led card (patch-tree)', () => {
  /** The mass and floor passes draw over independent noise, so 300 seeds are swept: every press that
   *  plants anything plants a tree, trees outnumber flora (`capFloorToMass`), and no flora share
   *  exceeds `FLOOR_CAP_FRACTION`. */
  it('plants trees, allows flora too, and its mass is STRICTLY trees, over 300 seeds', () => {
    let pressed = 0;
    let worstShare = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const kit = setup();
      const outcome = applyMacro(kit, 'patch-tree', { seed, at: AT, radius: RADIUS });
      if (outcome.changes === 0) continue;
      pressed++;
      const c = counts(kit.state);
      const trees = c[ItemCategory.Tree] ?? 0;
      const flora = c[ItemCategory.Flora] ?? 0;
      const share = flora / (trees + flora);
      worstShare = Math.max(worstShare, share);
      expect(trees, `seed ${seed}: the tree-led card planted no tree at all`).toBeGreaterThan(0);
      expect(trees, `seed ${seed}: flora (${flora}) was not strictly outnumbered by trees (${trees})`).toBeGreaterThan(flora);
      expect(share, `seed ${seed}: flora share ${share} exceeded the accent ceiling`).toBeLessThanOrEqual(0.25);
    }
    expect(pressed).toBeGreaterThan(100);
    // Some press comes close to the ceiling, so the bound is exercised.
    expect(worstShare).toBeGreaterThan(0.15);
  });
});

describe('the flora-led card (patch-flora)', () => {
  it('never plants a tree, whatever the seed', () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let anyPlanted = false;
    for (const seed of seeds) {
      const kit = setup();
      applyMacro(kit, 'patch-flora', { seed, at: AT, radius: RADIUS });
      const c = counts(kit.state);
      expect(c[ItemCategory.Tree] ?? 0, `seed ${seed}: the flora-led card planted a tree`).toBe(0);
      if ((c[ItemCategory.Flora] ?? 0) > 0) anyPlanted = true;
    }
    // Over the sweep it plants something.
    expect(anyPlanted).toBe(true);
  });
});

describe('the ghost and the preview cache', () => {
  it('answers the two cards as two different plantings, and caches each on its own', () => {
    const kit = setup();
    const opts = { seed: 4, at: AT, radius: RADIUS };

    const treeCells = previewMacro(kit, 'patch-tree', opts).added;
    const floraCells = previewMacro(kit, 'patch-flora', opts).added;
    expect(treeCells.length).toBeGreaterThan(0);
    expect(floraCells.length).toBeGreaterThan(0);
    // Everything but the id is the same.
    const key = (cells: typeof treeCells) => cells.map((c) => `${c.x},${c.y}`).sort().join('|');
    expect(key(treeCells)).not.toBe(key(floraCells));

    // The same question again is a cache hit: the identical array.
    expect(previewMacro(kit, 'patch-tree', opts).added).toBe(treeCells);
    expect(previewMacro(kit, 'patch-flora', opts).added).toBe(floraCells);
  });
});

describe('determinism', () => {
  it.each(['patch-tree', 'patch-flora'] as const)('%s builds the same thing at the same seed', (id) => {
    const shape = (kit: EditContext): string => {
      applyMacro(kit, id, { seed: 42, at: AT, radius: RADIUS });
      return [...kit.state.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort().join('|');
    };
    const a = shape(setup());
    const b = shape(setup());
    expect(a.length).toBeGreaterThan(0);
    expect(a).toBe(b);
  });
});

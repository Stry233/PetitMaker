import { describe, it, expect } from 'vitest';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { categoryOf } from '../../../../state/catalog';
import { ItemCategory } from '../../../../config/catalog/categories';
import { makeCtx } from '../../../../tools/placement/object';
import { analyzeTerrain } from '../../../../tools/placement/analysis';
import { placeNature } from '../../../../tools/macros/planting/nature';
import { buildCommunity, buildHabitatField } from '../../../../tools/macros/planting/habitat';

function run(nature: number, seed = 7) {
  const state = makeState(48, 48);
  const exec = makeExecutor(state);
  const whole = exec.beginStroke();
  const ctx = makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), seed);
  const a = analyzeTerrain(state);
  placeNature(ctx, a, nature, new Set(), { pick: buildCommunity(buildHabitatField(a), 24 * 48 + 24, seed) });
  whole.commit();
  return [...state.objects.values()];
}

describe('placeNature', () => {
  it('more vegetation at higher nature, none at 0, deterministic', () => {
    expect(run(0).length).toBe(0);
    expect(run(1).length).toBeGreaterThan(run(0.3).length);
    expect(run(0.7).map((o) => o.catalogId)).toEqual(run(0.7).map((o) => o.catalogId));
  });
  it('trees keep exclusionRadius spacing (no two trees within 1 cell)', () => {
    const trees = run(1).filter((o) => categoryOf(o) === ItemCategory.Tree);
    for (const a of trees) for (const b of trees) {
      if (a === b) continue;
      expect(Math.max(Math.abs(a.position.x - b.position.x), Math.abs(a.position.y - b.position.y))).toBeGreaterThan(1);
    }
  });
});

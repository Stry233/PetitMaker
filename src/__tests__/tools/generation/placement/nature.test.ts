import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules/index';
import { makeState } from '../../../rules/_helpers';
import { categoryOf } from '../../../../state/catalog';
import { ItemCategory } from '../../../../core/model/types';
import { makeCtx } from '../../../../tools/generation/placement/object';
import { analyzeTerrain } from '../../../../tools/generation/placement/analysis';
import { placeNature } from '../../../../tools/generation/placement/nature';
import { type EditorEvents } from '../../../../core/model/types';

function run(nature: number, seed = 7) {
  const state = makeState(48, 48);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const ctx = makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), seed);
  placeNature(ctx, analyzeTerrain(state), nature, new Set());
  exec.commitStrokeGroup(0);
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

import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules/index';
import { makeState } from '../../../rules/_helpers';
import { makeCtx } from '../../../../tools/generation/placement/object';
import { analyzeTerrain } from '../../../../tools/generation/placement/analysis';
import { placeSettlement } from '../../../../tools/generation/placement/settlement';
import { TUNING } from '../../../../tools/generation/tuning';
import { ObjectCategory, type EditorEvents } from '../../../../core/model/types';

function run(settlement: number, seed = 7) {
  const state = makeState(60, 60);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const ctx = makeCtx(state, (c) => exec.execute(c), exec.getRegistry(), seed);
  const { settled, nodes } = placeSettlement(ctx, analyzeTerrain(state), settlement, new Map());
  exec.commitStrokeGroup(0);
  const buildings = [...state.objects.values()].filter((o) => !o.locked && (o.category === ObjectCategory.Facility || o.category === ObjectCategory.House));
  return { buildings, settled, nodes };
}

describe('placeSettlement (hamlet network)', () => {
  it('emits one hub + distributed, well-separated hamlet nodes; buildings placed; rule-clean', () => {
    const { nodes, buildings } = run(1);
    expect(nodes.filter((n) => n.kind === 'hub')).toHaveLength(1);
    const hamlets = nodes.filter((n) => n.kind === 'hamlet').map((n) => n.pos);
    expect(hamlets.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < hamlets.length; i++) for (let j = i + 1; j < hamlets.length; j++) {
      const d = Math.hypot(hamlets[i]!.x - hamlets[j]!.x, hamlets[i]!.y - hamlets[j]!.y);
      expect(d, `hamlets ${i},${j} spread`).toBeGreaterThanOrEqual(TUNING.hamletSpacing);
    }
    expect(buildings.length).toBeGreaterThan(0);
    expect(nodes.every((n) => n.region >= 0)).toBe(true);
  });
  it('places nothing at settlement 0; deterministic for a (seed,settlement)', () => {
    expect(run(0).buildings.length).toBe(0);
    const key = (r: ReturnType<typeof run>) => r.nodes.map((n) => `${n.kind}@${n.pos.x},${n.pos.y}`).join('|');
    expect(key(run(0.8))).toBe(key(run(0.8)));
  });
});

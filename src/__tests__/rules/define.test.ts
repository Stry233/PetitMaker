import { describe, it, expect } from 'vitest';
import { definePostRule, definePreRule } from '../../rules/define';
import { RuleRegistry } from '../../rules/registry';
import { CommandType, TerrainType } from '../../core/model/types';
import { TERRAIN_GRID } from '../../core/game/profile';
import { evidenceOn } from '../../core/grid/grids';
import { makeState, paintCmd } from '../_support/map-state';

describe('rule declarations', () => {
  const rule = definePreRule({
    id: 'V-TEST-PRE',
    description: 'No terrain may be painted.',
    appliesTo: [CommandType.PaintTerrain],
    validate: (cmd, _state, fail) => [fail('error.floating_block', evidenceOn(TERRAIN_GRID, cmd.cells), { messageParams: { n: 1 } })],
  });

  it('a pre-command rule judges only the command types it applies to', () => {
    const state = makeState();
    expect(rule.phase).toBe('pre-command');
    expect(rule.appliesTo).toEqual([CommandType.PaintTerrain]);
    expect(rule.validate({ type: CommandType.EraseTerrain, cells: [{ x: 1, y: 1 }]}, state)).toEqual([]);
  });

  it('an error carries its rule id, message, params and evidence grid', () => {
    const [err] = rule.validate(paintCmd([{ x: 2, y: 3 }], TerrainType.Mountain, 1), makeState());
    expect(err).toEqual({ ruleId: 'V-TEST-PRE', message: 'error.floating_block', messageParams: { n: 1 }, grid: TERRAIN_GRID, cells: [{ x: 2, y: 3 }] });
  });

  it('a post-stroke rule hands its options through and omits an absent hint', () => {
    const seen: unknown[] = [];
    const post = definePostRule({ id: 'V-TEST-POST', description: 'Every map holds.', validate: (_state, opts) => { seen.push(opts); return []; } });
    post.validate(makeState(), { firstOnly: true });
    expect(post.phase).toBe('post-stroke');
    expect(seen).toEqual([{ firstOnly: true }]);
  });

  it('a registry reports each rule with the description it was declared with', () => {
    const registry = new RuleRegistry();
    registry.register(rule);
    registry.register(definePostRule({ id: 'V-TEST-POST', description: 'Every map holds.', validate: () => [] }));
    expect(registry.getRules()).toEqual([
      { id: 'V-TEST-PRE', phase: 'pre-command', description: 'No terrain may be painted.' },
      { id: 'V-TEST-POST', phase: 'post-stroke', description: 'Every map holds.' },
    ]);
  });
});

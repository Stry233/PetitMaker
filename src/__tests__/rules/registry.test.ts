import { describe, it, expect } from 'vitest';
import { RuleRegistry } from '../../rules/registry';
import {
  CommandType,
  TerrainType,
  type PaintTerrainCommand,
  type PreCommandRule,
  type PostStrokeRule,
  type GridState,
} from '../../core/model/types';

function makeCmd(): PaintTerrainCommand {
  return {
    type: CommandType.PaintTerrain,
    timestamp: 0,
    cells: [{ x: 5, y: 5 }],
    terrainType: TerrainType.Mountain,
    elevation: 1,
  };
}

const dummyState = {} as GridState;

describe('RuleRegistry', () => {
  it('runs pre-command rules that match the command type', () => {
    const registry = new RuleRegistry();
    const rule: PreCommandRule = {
      id: 'test-rule', phase: 'pre-command',
      appliesTo: [CommandType.PaintTerrain],
      validate: () => [{ ruleId: 'test-rule', message: 'blocked', cells: [], severity: 'error' }],
    };
    registry.register(rule);
    const errors = registry.validatePreCommand(makeCmd(), dummyState);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ruleId).toBe('test-rule');
  });

  it('skips pre-command rules that do not match the command type', () => {
    const registry = new RuleRegistry();
    const rule: PreCommandRule = {
      id: 'place-only', phase: 'pre-command',
      appliesTo: [CommandType.PlaceObject],
      validate: () => [{ ruleId: 'place-only', message: 'x', cells: [], severity: 'error' }],
    };
    registry.register(rule);
    expect(registry.validatePreCommand(makeCmd(), dummyState)).toHaveLength(0);
  });

  it('runs all post-stroke rules', () => {
    const registry = new RuleRegistry();
    const rule: PostStrokeRule = {
      id: 'post-rule', phase: 'post-stroke',
      validate: () => [{ ruleId: 'post-rule', message: 'bad', cells: [], severity: 'error' }],
    };
    registry.register(rule);
    const errors = registry.validatePostStroke(dummyState);
    expect(errors).toHaveLength(1);
  });

  it('collects errors from multiple rules', () => {
    const registry = new RuleRegistry();
    registry.register({ id: 'A', phase: 'pre-command', appliesTo: [CommandType.PaintTerrain], validate: () => [{ ruleId: 'A', message: 'a', cells: [], severity: 'error' }] });
    registry.register({ id: 'B', phase: 'pre-command', appliesTo: [CommandType.PaintTerrain], validate: () => [{ ruleId: 'B', message: 'b', cells: [], severity: 'error' }] });
    expect(registry.validatePreCommand(makeCmd(), dummyState)).toHaveLength(2);
  });

  it('returns empty array when no rules registered', () => {
    const registry = new RuleRegistry();
    expect(registry.validatePreCommand(makeCmd(), dummyState)).toHaveLength(0);
    expect(registry.validatePostStroke(dummyState)).toHaveLength(0);
  });
});

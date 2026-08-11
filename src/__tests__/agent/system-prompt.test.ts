import { describe, it, expect } from 'vitest';
import { createDefaultRegistry, RULE_HINTS } from '../../rules';
import { buildSystemPrompt } from '../../agent/system-prompt';
import { getAllItems } from '../../state/catalog';

describe('buildSystemPrompt', () => {
  const registry = createDefaultRegistry();
  const prompt = buildSystemPrompt(registry);

  it('covers every registered rule id', () => {
    for (const { id } of registry.getRules()) expect(prompt).toContain(id);
  });

  it('every registered rule carries its own agentHint (single source of truth, drift guard)', () => {
    for (const { id } of registry.getRules()) {
      expect(RULE_HINTS[id], `rule ${id} is missing an agentHint in its rule file`).toBeTruthy();
    }
  });

  it('digests every catalog item id (synthetic items excluded)', () => {
    for (const item of getAllItems()) {
      if (item.id.startsWith('__')) continue;
      expect(prompt).toContain(item.id);
    }
  });

  it('teaches coordinates, traits, and revert semantics', () => {
    expect(prompt).toContain('cells[y][x]');
    expect(prompt).toContain('waterSpan');
    expect(prompt).toContain('REVERTED');
  });

  it('states the region lock, since the model otherwise learns the boundary only by hitting it', () => {
    expect(prompt).toContain('REGION LOCK');
    expect(prompt).toContain('OUT OF REGION');
    expect(prompt).toContain('FOOTPRINT');
  });

  it('carries the recipes section and the search/scatter tool guidance', () => {
    expect(prompt).toContain('# RECIPES');
    expect(prompt).toContain('find_flat_areas');
    expect(prompt).toContain('scatter_objects');
  });
});

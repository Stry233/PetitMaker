import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { ruleHint } from '../../../agent/tools/rule-hints';
import { BANNERS } from '../../../agent/tools/feedback';
import { buildSystemPrompt } from '../../../agent/prompts';
import { getAllItems } from '../../../state/catalog';

describe('buildSystemPrompt', () => {
  const registry = createDefaultRegistry();
  const prompt = buildSystemPrompt(registry);

  it('applies the user language to thinking and preserves structured tool formats', () => {
    for (const uiLocale of ['en', 'zh', 'ja', 'ru', 'th', 'id', 'fr']) {
      const localized = buildSystemPrompt(registry, { uiLocale });
      expect(localized).toContain('same language throughout your thinking process');
      expect(localized).toContain('structured tool arguments in their required formats');
      expect(localized).toContain('follow immediately if they switch mid-conversation');
    }
  });

  it('covers every registered rule id', () => {
    for (const { id } of registry.getRules()) expect(prompt).toContain(id);
  });

  it('every rule the editor registers has an assistant hint (drift guard)', () => {
    for (const { id } of registry.getRules()) {
      expect(ruleHint(id), `rule ${id} has no entry in agent/tools/rule-hints.ts`).toBeTruthy();
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
  });

  it('quotes every rollback and region banner the tools open their refusals with', () => {
    for (const banner of Object.values(BANNERS)) expect(prompt).toContain(`"${banner}"`);
  });

  it('tells the model a post-stroke rollback undoes only enough to restore a legal map', () => {
    expect(prompt).toContain('only the commands needed to restore a legal map are rolled back');
    expect(prompt).not.toContain('WHOLE TOOL CALL IS ROLLED BACK');
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

  it('reports plan completion independently of whole-map scoring', () => {
    expect(prompt).toContain('completedStages');
    expect(prompt).toContain('never rebuild completed stages');
  });

  it('asks when a missing fact would materially change the requested result', () => {
    expect(prompt).toContain('missing information materially changes the result');
  });
});

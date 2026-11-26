import { describe, it, expect } from 'vitest';
import { createDefaultRegistry, createPlanetRegistry } from '../../../rules';
import { TRAIT_DESCRIPTIONS } from '../../../rules/placement';
import { CommandType } from '../../../core/model/types';
import { BANNERS } from '../../../agent/tools/feedback';
import { buildSystemPrompt, districtSystemPrompt, helperSystemPrompt } from '../../../agent/prompts';
import { getAllItems } from '../../../state/catalog';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  it("lists every registered rule with the rule's own description", () => {
    for (const { id, phase, description } of registry.getRules()) {
      expect(description, id).not.toBe('');
      expect(prompt).toContain(`- ${id} [${phase}]: ${description}`);
    }
  });

  it('lists a rule the moment a registry holds it, in the words it was registered with', () => {
    const planet = createPlanetRegistry();
    const held = planet.getRules().find((rule) => rule.id === 'V-PLANET-01')!;
    expect(prompt).not.toContain('V-PLANET-01');
    expect(buildSystemPrompt(planet)).toContain(`- V-PLANET-01 [pre-command]: ${held.description}`);

    const own = createDefaultRegistry();
    own.register({ id: 'V-TEST-QUIET', description: 'Nothing may be placed beside a sleeping cat.', phase: 'pre-command', appliesTo: [CommandType.PlaceObject], validate: () => [] });
    expect(buildSystemPrompt(own)).toContain('- V-TEST-QUIET [pre-command]: Nothing may be placed beside a sleeping cat.');
  });

  it("lists every placement trait with the trait's own description", () => {
    const traits = new Set(getAllItems().flatMap((item) => item.traits.map((trait) => trait.type)));
    expect(traits.size).toBeGreaterThan(0);
    for (const type of traits) {
      const description = TRAIT_DESCRIPTIONS.get(type)!;
      expect(description, type).not.toBe('');
      expect(prompt).toMatch(new RegExp(`^- ${type}[^:\\n]*: ${escapeRegExp(description)}`, 'm'));
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

  it('tells a helper and a district lead only about tools they are offered: the app tools read in the lead\'s prompt alone', () => {
    for (const name of ['list_app_actions', 'run_app_action']) {
      expect(prompt, name).toContain(name);
      expect(helperSystemPrompt(prompt), name).not.toContain(name);
      expect(districtSystemPrompt(prompt), name).not.toContain(name);
    }
    expect(helperSystemPrompt(prompt)).toContain('# BUILDING A PLACE');
    expect(districtSystemPrompt(prompt)).toContain('# LEADING A DISTRICT');
  });
});

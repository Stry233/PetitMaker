/** The game's neighbours, as the assistant knows them: whose house is whose, and what they love. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { buildSystemPrompt } from '../../../agent/prompts';
import { SKILLS } from '../../../agent/skills';
import { createDefaultRegistry } from '../../../rules';
import { NEIGHBORS } from '../../../config/neighbors';

describe('a home for a neighbour', () => {
  spec('ASST-41', 'the catalogue the assistant reads names whose home each house is, in the interface language too', () => {
    const prompt = buildSystemPrompt(createDefaultRegistry(), { uiLocale: 'zh' });
    for (const { name, profile } of NEIGHBORS) {
      if (!profile) continue;
      expect(prompt).toContain(`${profile.house} ${name.en} / ${name.zh ?? name.en}`);
    }
  });

  spec('ASST-41', 'the neighbors skill gives each neighbour by every name with what they love', () => {
    const body = SKILLS.neighbors!.body;
    for (const { name, profile } of NEIGHBORS) {
      if (!profile) continue;
      for (const n of Object.values(name)) expect(body).toContain(n);
      for (const loved of profile.loves) expect(body).toContain(loved);
    }
  });
});

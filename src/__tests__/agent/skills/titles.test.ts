/** Every skill the panel can show has a title key, and its English copy is the title the model reads. */
import { describe, expect, it } from 'vitest';
import { SKILLS } from '../../../agent/skills';
import { skillTitleKey } from '../../../agent/skills/titles';
import { LOCALES } from '../../../core/model/locale';
import { translateFor } from '../../../i18n/context';
import { skillTitle } from '../../../ui/agent/parts/skill-title';
import type { TextKey } from '../../../i18n/keys';

describe('skill titles', () => {
  it('give every skill a key whose English copy is its title', () => {
    for (const [name, skill] of Object.entries(SKILLS)) expect(translateFor('en', skillTitleKey(name)!), name).toBe(skill.title);
  });

  it('show a known skill in the interface language and an unknown one as recorded', () => {
    for (const locale of LOCALES) {
      const t = (key: TextKey) => translateFor(locale, key);
      expect(skillTitle({ name: 'cozy-village', title: 'Cozy Village' }, t)).toBe(translateFor(locale, 'agent.skill_cozy_village'));
    }
    expect(skillTitle({ name: 'retired-skill', title: 'Retired' }, (key) => key)).toBe('Retired');
  });
});

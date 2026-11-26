import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../agent/prompts';
import { createDefaultRegistry } from '../../../rules';

describe('the catalogue the assistant reads', () => {
  it('gives an item\'s name where it says more than the id, such as a flower\'s colour', () => {
    const prompt = buildSystemPrompt(createDefaultRegistry(), { uiLocale: 'en' });
    expect(prompt).toContain('flower-rose=? "Pink Mooncycle Rose"');
    expect(prompt).not.toMatch(/path-seaside-wave=\d+ "/);
  });
});

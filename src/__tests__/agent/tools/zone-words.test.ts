/**
 * The assistant's tool text names zones through `agent/tools/game-terms.ts`, never as literals: with
 * the profile's zone words renamed, no original buildable-zone word may remain in what the model
 * reads. (Words such as "sea" or "boundary" also serve as plain English, so only the buildable ones
 * are checked everywhere.)
 */
import { describe, expect, it, vi } from 'vitest';
import { makeState } from '../../_support/map-state';
import { wireSchemas } from '../../../agent/tools';
import { mapSummary, selectionContext } from '../../../agent/tools/serialize';
import { ruleHint } from '../../../agent/tools/rule-hints';
import { buildSystemPrompt } from '../../../agent/prompts';
import { createDefaultRegistry } from '../../../rules';
import { BUILDABLE_ZONES } from '../../../agent/tools/game-terms';

/** The profile's real buildable-zone words, read before the mock renames them. */
const real = vi.hoisted(() => ({ buildable: [] as string[] }));

vi.mock('../../../core/game/profile', async (importOriginal) => {
  const profile = await importOriginal<typeof import('../../../core/game/profile')>();
  real.buildable = Object.values(profile.ZONES).filter((z) => z.buildable).map((z) => z.name);
  const ZONES = Object.fromEntries(Object.entries(profile.ZONES).map(([id, z]) => [id, { ...z, name: `zone${id}word` }]));
  return { ...profile, ZONES };
});

describe('zone words in tool text', () => {
  it('reads the renamed words', () => {
    expect(real.buildable.length).toBeGreaterThan(0);
    expect(BUILDABLE_ZONES).toMatch(/^zone\d+word/);
  });

  it('carries no buildable-zone literal in tool descriptions or map context', () => {
    const text = [
      JSON.stringify(wireSchemas()),
      mapSummary(makeState(20, 20)),
      selectionContext([]),
    ].join('\n');
    for (const word of real.buildable) expect(text).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
  });

  it("lists the ground shape by the profile's zone words", () => {
    expect(ruleHint('V-GROUND-LOCK')).toMatch(/zone\d+word/);
  });

  it('carries no buildable-zone literal in the rule hints the system prompt lists', () => {
    const prompt = buildSystemPrompt(createDefaultRegistry());
    const hints = prompt.split('\n').filter((line) => /^- [A-Z]+-[A-Z0-9-]+ \[/.test(line)).join('\n');
    expect(hints).toContain(ruleHint('V-GROUND-LOCK')!);
    for (const word of real.buildable) expect(hints).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'));
  });
});

/**
 * The model follows the system prompt and the loop's nudges verbatim, so every tool name and rule id
 * they mention must be one the editor registers: a renamed tool or rule would otherwise go stale in
 * prose without failing anything.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '../../../rules';
import { buildSystemPrompt } from '../../../agent/prompts';
import * as nudges from '../../../agent/core/nudges';
import { BUDGET_WARN_AT } from '../../../agent/core/governor';
import { TOOL_FACTS, wireSchemas } from '../../../agent/tools';
import summaryPrompt from '../../../agent/prompts/10-summary.md?raw';
import replyPrompt from '../../../agent/prompts/11-reply-suggestion.md?raw';

const registry = createDefaultRegistry();
const GUIDES = TOOL_FACTS.guides;
const TOOL_NAMES = new Set(wireSchemas().map((t) => t.name));
const RULE_IDS = new Set(registry.getRules().map((r) => r.id));
/** Non-tool snake_case wire names prose may legitimately use. */
const WIRE_NAMES = new Set(['map_context', 'summary_data', 'playbook_data']);

/** Every nudge's text, from arguments that make each one speak. */
function nudgeTexts(): Record<string, string> {
  const out: Record<string, string | undefined> = {
    repeatRefusal: nudges.repeatRefusal(GUIDES, { error: 'refused', repeats: 2 }),
    deliveryNudge: nudges.deliveryNudge(),
    reviewNudge: nudges.reviewNudge(GUIDES),
    unfinishedPlanNudge: nudges.unfinishedPlanNudge(GUIDES, { stageCount: 3, current: 1, nextLabel: 'stage' }),
    verbatimRetryNudge: nudges.verbatimRetryNudge(GUIDES, 1),
    revertNudge: `${nudges.revertNudge(GUIDES, 'paint_terrain', 1)}\n${nudges.revertNudge(GUIDES, 'paint_terrain', 4)}`,
    budgetWarning: nudges.budgetWarning(0, BUDGET_WARN_AT),
    emptyTurnNudge: nudges.emptyTurnNudge(1),
    reasoningOnlyNudge: nudges.reasoningOnlyNudge(1),
    lengthStopNudge: nudges.lengthStopNudge(1),
    capMessage: nudges.capMessage(),
    reissueMessage: nudges.reissueMessage(),
    planProgressResult: nudges.planProgressResult(1, 3),
    planProgressRefusal: nudges.planProgressRefusal(),
    planMalformed: nudges.planMalformed(),
    planRevisionLimit: nudges.planRevisionLimit(),
    planSet: nudges.planSet(),
    replyNoted: nudges.replyNoted(),
    helperInterrupted: nudges.helperInterrupted(),
    helperNoSummary: nudges.helperNoSummary(),
    helperFailed: `${nudges.helperFailed()}\n${nudges.helperFailed({ cls: 'auth', detail: 'refused' })}`,
    helperAborted: nudges.helperAborted(),
    delegateNeedsTask: nudges.delegateNeedsTask(),
    unknownTool: nudges.unknownTool('paint_terrain'),
    contextOverflow: nudges.contextOverflow(),
    lengthStreakOverflow: nudges.lengthStreakOverflow(),
    toolCrashed: nudges.toolCrashed(new Error('boom')),
    skippedCallResult: nudges.skippedCallResult(),
    noResultRecorded: nudges.noResultRecorded(),
    clearedWhilePending: nudges.clearedWhilePending(),
    gateWords: nudges.gateWords('smaller'),
    compactionSummary: nudges.compactionSummary('built a village'),
    playbookStillLoaded: nudges.playbookStillLoaded('Village', 'body'),
    mapLedger: nudges.mapLedger('a village', 3),
    ledgerMessage: nudges.ledgerMessage('ledger'),
    automaticSummary: nudges.automaticSummary('ledger'),
    orderMessage: nudges.orderMessage('context', 'a village'),
  };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v ?? '']));
}

const TEXTS: Record<string, string> = {
  'system prompt': buildSystemPrompt(registry),
  'summary prompt': summaryPrompt,
  'reply prompt': replyPrompt,
  ...nudgeTexts(),
};

describe('prompt and nudge prose names only real things', () => {
  it('reads every nudge the loop can send', () => {
    const functions = Object.entries(nudges).filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();
    expect(functions).toEqual(Object.keys(nudgeTexts()).sort());
    for (const [name, text] of Object.entries(nudgeTexts())) expect(text.length, name).toBeGreaterThan(0);
  });

  it('every snake_case token is a registered tool name', () => {
    for (const [source, text] of Object.entries(TEXTS)) {
      for (const tok of text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []) {
        expect(TOOL_NAMES.has(tok) || WIRE_NAMES.has(tok), `${source} names "${tok}"`).toBe(true);
      }
    }
  });

  it('every rule id is a registered rule', () => {
    for (const [source, text] of Object.entries(TEXTS)) {
      for (const id of text.match(/\bV-[A-Z]+(?:-[A-Z0-9]+)+\b/g) ?? []) {
        expect(RULE_IDS.has(id), `${source} names rule "${id}"`).toBe(true);
      }
    }
  });
});

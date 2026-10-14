/**
 * The harness's model-facing English: the nudges it appends to a result, a system note or a final
 * turn when the governor's counts call for one, the results the loop, the executor and the tool
 * registry answer themselves, the wrappers the projection and compaction put around replayed text,
 * and the incident details a job ends on. The tools they point to come from
 * `ToolFacts.guides` or `PROTOCOL`, never as literals.
 */
import { quotePromptData } from '../../platform/remote/prompt-data';
import { redactSecrets } from '../../platform/remote/redact';
import { BUDGET_WARN_AT } from './governor';
import { PROTOCOL } from './protocol';
import type { GuideTools } from './tool-facts';

/** The result of a refused byte-identical retry; its first line is the op's summary in the panel. */
export function repeatRefusal(tools: GuideTools, streak: { error?: string; repeats: number }): string {
  const base = '(system) Not run: this exact call just failed with:\n'
    + `${streak.error ?? 'the same refusal as before'}\n`
    + 'Change the arguments or the approach; sending it again unchanged will not run.';
  if (streak.repeats < 2) return base;
  return `${base}\n`
    + `Look before acting: ${tools.inspect} the area you are editing, or ${tools.skill} for a relevant `
    + 'technique, and build from what the map actually shows.';
}

/** Sent once at a zero-edit close; an impossible or unspecified request may correctly leave no edits. */
export function deliveryNudge(): string {
  return '(system) No edit has landed. Check whether that is appropriate for this request. '
    + 'If the user asked for advice, gave no buildable subject, needs to choose an alternative, '
    + 'or requested something that cannot be done, make no substitute edits. Give the answer, '
    + 'explain the constraint, or ask one short question ending in a question mark. Otherwise, '
    + 'if the requested edit is feasible and already authorized, deliver that edit. Do not '
    + 'invent a different task to satisfy this check. Your next close is final.';
}

/** One review pass scoped to the order, sent once in place of a landed build's first close. It
 *  names the view tool, never the score tool, whose whole-map scorecard invites edits beyond the order. */
export function reviewNudge(tools: GuideTools): string {
  return '(system) Verify the result against the user request and preserved work. Use the existing '
    + `tool results; use a focused ${tools.view} or read only if something is uncertain. If all requested `
    + 'outcomes are satisfied, close now. Otherwise make only the smallest necessary correction '
    + 'and verify it once. Do not add features, clear and rebuild completed work, or chase '
    + 'whole-map scores. Intentional planting is not an error. State any unmet constraint '
    + 'honestly; ask the user only when their decision is needed. Your next close is final.';
}

/** Sent once in place of a close that leaves plan stages unfinished. */
export function unfinishedPlanNudge(
  tools: GuideTools,
  plan: { stageCount: number; current: number; nextLabel: string } | undefined,
): string | undefined {
  if (!plan || plan.current >= plan.stageCount) return undefined;
  const remaining = plan.stageCount - plan.current;
  return `(system) The plan records ${remaining} of ${plan.stageCount} stages as unfinished (current: `
    + `"${plan.nextLabel}"). Check their requested outcomes against the work already present. `
    + `Report completed stages with ${PROTOCOL.plan} completedStages; do not rebuild them or run `
    + `${tools.score} to move the plan. Finish only missing requested work, or explain what is `
    + 'blocked and why. Your next close is final.';
}

/** Escalates once a call has failed with these exact arguments before in this job; successes do not reset it. */
export function verbatimRetryNudge(tools: GuideTools, failures: number): string | undefined {
  if (failures < 1) return undefined;
  return '(system) This exact call has already failed once with these same arguments, so repeating '
    + `it again will not help. Look before acting with a ${tools.search} tool, ${tools.skill} for a relevant `
    + 'technique, or ask the user instead of retrying it verbatim.';
}

/** Escalates once one tool's edits have reverted before in this job, asking for another approach. */
export function revertNudge(tools: GuideTools, toolName: string, reverts: number): string | undefined {
  if (reverts < 1) return undefined;
  // Four reverts make inspection a precondition for another call.
  if (reverts >= 4) {
    return `(system) STOP: ${reverts} ${toolName} edits have reverted in this job. Do not call it `
      + `again until you have LOOKED — ${tools.inspect} or ${tools.view} the exact target — and are acting `
      + 'on ground the look confirmed clear. Repeating the probe builds nothing.';
  }
  return `(system) ${toolName}'s edits keep reverting, which points at the approach rather than `
    + `where it is aimed. Change strategy: look at the map with a ${tools.search} tool, ${tools.skill} for the `
    + 'relevant technique, or ask the user before trying again.';
}

/** Fires once, when exactly `BUDGET_WARN_AT` turns remain. */
export function budgetWarning(turnsUsed: number, maxTurns: number): string | undefined {
  const remaining = maxTurns - turnsUsed;
  if (remaining !== BUDGET_WARN_AT) return undefined;
  return `(system) ${remaining} turns remain before the iteration limit ends this job. Wrap up `
    + 'now, or ask the user for more room if the job genuinely needs it.';
}

/** How many nudged retries a silent or truncated streak gets before the loop ends the job. */
export const NUDGE_RETRIES = 2;

/** A bounded nudge for a turn with no text, no tool call and no reasoning. */
export function emptyTurnNudge(consecutiveEmpty: number): string | undefined {
  if (consecutiveEmpty < 1 || consecutiveEmpty > NUDGE_RETRIES) return undefined;
  return '(system) That turn produced no text and no tool calls. Continue the job, or ask the '
    + 'user a clarifying question if something is blocking it.';
}

/** The same bound for a turn that reasoned but sent no text and no call; it asks for the missing half. */
export function reasoningOnlyNudge(consecutiveSilent: number): string | undefined {
  if (consecutiveSilent < 1 || consecutiveSilent > NUDGE_RETRIES) return undefined;
  return '(system) That turn was all reasoning: no message and no tool call reached the user. '
    + 'State your conclusion as text, or call a tool.';
}

/** A bounded nudge for a truncated turn. The turn itself is dropped from replay (`DROPPED_STOPS`), so
 *  without it the next request would repeat the one that truncated. */
export function lengthStopNudge(streak: number): string | undefined {
  if (streak < 1 || streak > NUDGE_RETRIES) return undefined;
  return '(system) Your last turn was cut off by the output limit before it finished, and its tool '
    + 'calls were not run. Do not repeat the same call: issue smaller calls (fewer cells, a smaller '
    + 'area) or give a shorter answer.';
}

/** The final turn appended at the iteration limit, handing the rest back to the user. */
export function capMessage(): string {
  return '(system) The iteration limit is reached and this job is ending now. Summarize what was '
    + 'done and ask the user how to continue.';
}

/** The result for a call whose arguments a truncated turn left incomplete. */
export function reissueMessage(): string {
  return '(system) The turn was cut off before the arguments were complete. '
    + 'Reissue the calls with complete arguments.';
}

/** The result of a valid plan progress report. */
export function planProgressResult(completed: number, stageCount: number): string {
  return `Plan progress: ${completed}/${stageCount} stages complete.`;
}

/** The result of a progress report without a plan, with stages beside it or out of range. */
export function planProgressRefusal(): string {
  return 'Progress requires an existing plan and completedStages alone, an integer from the current '
    + 'completed count through the total stage count. Do not rebuild work to update progress.';
}

/** The result of a plan filing whose stages do not parse. */
export function planMalformed(): string {
  return `(system) ${PROTOCOL.plan} needs a non-empty "stages" array of objects, each with a label. `
    + 'Example: stages: [{"label":"terrace the north hills"}]. Reissue the call with a valid plan.';
}

/** The result of a plan filing past the job's one revision. */
export function planRevisionLimit(): string {
  return '(system) The plan has already been revised once; the stage list is a commitment the '
    + 'user is reading, not a scratchpad. Keep building the current plan\'s remaining stages, and '
    + 'put any leftover ideas in your closing summary instead of a new plan.';
}

/** The result of an accepted plan filing. */
export function planSet(): string {
  return 'Plan set.';
}

/** The result acknowledging a reply suggestion in place. */
export function replyNoted(): string {
  return 'Noted.';
}

/** The result for a delegated helper a reload interrupted; its child log is not resumable. */
export function helperInterrupted(): string {
  return '(system) The helper run was interrupted by a reload. Edits it already made are on the map; '
    + 'look at the map, then delegate a fresh task for what remains.';
}

/** A finished helper's result when its last turn said nothing. */
export function helperNoSummary(): string {
  return '(the helper task finished with no summary)';
}

/** What the parent model is told when a child job ended in an incident, in the child's own terms:
 *  the error class it ended on (so an 'auth' failure is not laundered into a generic "something went
 *  wrong" the model answers by delegating the same task again) plus the first line of its detail,
 *  already redacted by its producer per the `TurnError` contract. Later lines are a provider's own
 *  advice to whoever holds the key and say nothing the model can act on. A `TurnError` detail may or
 *  may not end in a period, so the trailing one is stripped before this sentence supplies its own. */
export function helperFailed(incident?: { cls: string; detail: string }): string {
  const tail = 'Delegate a fresh task or ask the user.';
  if (!incident) return `(system) The helper run failed before it finished. ${tail}`;
  const first = (incident.detail.split('\n')[0] ?? '').trim().replace(/\.+$/, '');
  const said = first.length > 0 ? `(${incident.cls}): ${first}. ` : `(${incident.cls}). `;
  return `(system) The helper run failed ${said}${tail}`;
}

/** The result of a helper job the user's stop aborted. */
export function helperAborted(): string {
  return '(system) The delegated task was aborted before it finished.';
}

/** The result of a delegation with no task text. */
export function delegateNeedsTask(): string {
  return `${PROTOCOL.delegate} needs a non-empty "task" string.`;
}

/** The result of a call naming a tool this executor does not offer. */
export function unknownTool(name: string): string {
  return `Unknown tool "${name}".`;
}

/** The incident detail when compaction cannot bring the conversation under the context window. */
export function contextOverflow(): string {
  return 'The conversation no longer fits the context window and cannot be shortened further.';
}

/** The incident detail when the output limit cut off more turns in a row than the nudges allow. */
export function lengthStreakOverflow(): string {
  return `${NUDGE_RETRIES + 1} turns in a row were cut off by the output limit; the job cannot make progress this way.`;
}

/** What the model is told when a tool throws, with key-shaped tokens redacted. */
export function toolCrashed(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `(system) The tool crashed: ${redactSecrets(message)}. Try a different approach or ask the user.`;
}

/** The result of a call the user's gate skipped; a user choice, not a tool failure. */
export function skippedCallResult(): string {
  return 'The user chose not to run this call. Continue without it, or ask what they would prefer.';
}

/** The result replayed for a call whose result the log never recorded. */
export function noResultRecorded(): string {
  return 'No result recorded.';
}

/** The replayed result of a call still pending when the user cleared the history around it. */
export function clearedWhilePending(): string {
  return 'Conversation history was cleared while this operation was pending. Its outcome is unknown. '
    + 'Inspect the current map before planning further changes; do not repeat the operation without checking its effects.';
}

/** A typed gate answer, replayed as user context right after the call's result. */
export function gateWords(words: string): string {
  return `(about your request) ${words}`;
}

/** The compaction summary that replaces the evicted prefix. */
export function compactionSummary(summary: string): string {
  return `(conversation summary, reference only) <summary_data>${quotePromptData(summary)}</summary_data>`;
}

/** A skill body the compaction evicted, reissued while the retained window does not load it again. */
export function playbookStillLoaded(title: string, body: string): string {
  return `(playbook still loaded: ${quotePromptData(title)})\n<playbook_data>${quotePromptData(body)}</playbook_data>`;
}

/** The mechanical facts a compaction keeps whatever the summarizer writes. */
export function mapLedger(lastOrder: string, toolCalls: number): string {
  return `Last order: ${quotePromptData(lastOrder)}. Tool calls so far this job: ${toolCalls}.`;
}

/** The ledger as the summarizer's last message. */
export function ledgerMessage(ledger: string): string {
  return `(map ledger) ${ledger}`;
}

/** The summary when the summarizer is unreachable or says nothing: the ledger alone. */
export function automaticSummary(ledger: string): string {
  return `(automatic summary) ${ledger}`;
}

/** An order as the model reads it: the map context, then the user's words. */
export function orderMessage(mapContext: string, words: string): string {
  return `<map_context>${quotePromptData(mapContext)}</map_context>\n${words}`;
}

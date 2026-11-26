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

/** What a loop-authored note opens with. A result made of one is filed through
 *  `tool-result.ts:loopNoteResult`, so readers tell it by `detail.loopNote`, never by this mark. */
export const NOTE_MARK = '(system)';

/** The result of a refused byte-identical retry; its first line is the op's summary in the panel. */
export function repeatRefusal(tools: GuideTools, streak: { error?: string; repeats: number }): string {
  const base = NOTE_MARK + ' Not run: this exact call just failed with:\n'
    + `${streak.error ?? 'the same refusal as before'}\n`
    + 'Change the arguments or the approach; sending it again unchanged will not run.';
  if (streak.repeats < 2) return base;
  return `${base}\n`
    + `Look before acting: ${tools.inspect} the area you are editing, or ${tools.skill} for a relevant `
    + 'technique, and build from what the map actually shows.';
}

/** Sent once at a zero-edit close; an impossible or unspecified request may correctly leave no edits. */
export function deliveryNudge(): string {
  return NOTE_MARK + ' No edit has landed. Check whether that is appropriate for this request. '
    + 'If the user asked for advice, gave no buildable subject, needs to choose an alternative, '
    + 'or requested something that cannot be done, make no substitute edits. Give the answer, '
    + 'explain the constraint, or ask one short question ending in a question mark. Otherwise, '
    + 'if the requested edit is feasible and already authorized, deliver that edit. Do not '
    + 'invent a different task to satisfy this check. Your next close is final.';
}

/** One review pass scoped to the order, sent once in place of a landed build's first close. It
 *  names the view tool, never the score tool, whose whole-map scorecard invites edits beyond the order. */
export function reviewNudge(tools: GuideTools): string {
  return NOTE_MARK + ' Filled is not finished. Before this closes, hold the work once to the standard of a skilled builder who would sign it: '
    + 'compare what stands with the design you set out to build and name what is missing or was reduced to something plainer. '
    + `Use the tool results you have; use a focused ${tools.view} or read only where they leave you unsure. `
    + 'Correct what falls short in place and keep what is right; do not clear and rebuild finished work. '
    + 'Then close, stating plainly anything a skilled builder would still find wanting. Your next close is final.';
}

/** Sent once in place of a close after planning annotations were drawn and no plan was filed. */
export function unfiledSketchNudge(tools: GuideTools): string {
  return NOTE_MARK + ' Planning annotations stand on the map, but no plan was filed. If this order calls '
    + `for a plan or a build, read the drawing back with ${tools.sketch} and compare it with every item `
    + 'the order names: repair a missing item, zones no path reaches, or ground the order wanted planned '
    + `and left empty. Then file the plan with ${PROTOCOL.plan}, stages naming the zone numbers; its `
    + 'approval is how the user answers, so do not ask in text whether to build. If the user only wanted '
    + 'annotations or advice, close. Your next close is final.';
}

/** Sent once in place of a close that leaves plan stages unfinished. */
export function unfinishedPlanNudge(
  tools: GuideTools,
  plan: { stageCount: number; current: number; nextLabel: string } | undefined,
): string | undefined {
  if (!plan || plan.current >= plan.stageCount) return undefined;
  const remaining = plan.stageCount - plan.current;
  return NOTE_MARK + ` The plan records ${remaining} of ${plan.stageCount} stages as unfinished (current: `
    + `"${plan.nextLabel}"). Check their requested outcomes against the work already present. `
    + `Report completed stages with ${PROTOCOL.plan} completedStages; do not rebuild them or run `
    + `${tools.score} to move the plan. Finish only missing requested work, or explain what is `
    + 'blocked and why. Your next close is final.';
}

/** Escalates once a call has failed with these exact arguments before in this job; successes do not reset it. */
export function verbatimRetryNudge(tools: GuideTools, failures: number): string | undefined {
  if (failures < 1) return undefined;
  return NOTE_MARK + ' This exact call has already failed once with these same arguments, so repeating '
    + `it again will not help. Look before acting with a ${tools.search} tool, ${tools.skill} for a relevant `
    + 'technique, or ask the user instead of retrying it verbatim.';
}

/** Escalates once one tool's edits have reverted before in this job, asking for another approach. */
export function revertNudge(tools: GuideTools, toolName: string, reverts: number): string | undefined {
  if (reverts < 1) return undefined;
  // Four reverts make inspection a precondition for another call.
  if (reverts >= 4) {
    return NOTE_MARK + ` STOP: ${reverts} ${toolName} edits have reverted in this job. Do not call it `
      + `again until you have LOOKED — ${tools.inspect} or ${tools.view} the exact target — and are acting `
      + 'on ground the look confirmed clear. Repeating the probe builds nothing.';
  }
  return NOTE_MARK + ` ${toolName}'s edits keep reverting, which points at the approach rather than `
    + `where it is aimed. Change strategy: look at the map with a ${tools.search} tool, ${tools.skill} for the `
    + 'relevant technique, or ask the user before trying again.';
}

/** Fires once, when exactly `BUDGET_WARN_AT` turns remain. */
export function budgetWarning(turnsUsed: number, maxTurns: number): string | undefined {
  const remaining = maxTurns - turnsUsed;
  if (remaining !== BUDGET_WARN_AT) return undefined;
  return NOTE_MARK + ` ${remaining} turns remain before the iteration limit ends this job. Wrap up `
    + 'now, or ask the user for more room if the job genuinely needs it.';
}

/** How many nudged retries a silent or truncated streak gets before the loop ends the job. */
export const NUDGE_RETRIES = 2;

/** A bounded nudge for a turn with no text, no tool call and no reasoning. */
export function emptyTurnNudge(consecutiveEmpty: number): string | undefined {
  if (consecutiveEmpty < 1 || consecutiveEmpty > NUDGE_RETRIES) return undefined;
  return NOTE_MARK + ' That turn produced no text and no tool calls. Continue the job, or ask the '
    + 'user a clarifying question if something is blocking it.';
}

/** The same bound for a turn that reasoned but sent no text and no call; it asks for the missing half. */
export function reasoningOnlyNudge(consecutiveSilent: number): string | undefined {
  if (consecutiveSilent < 1 || consecutiveSilent > NUDGE_RETRIES) return undefined;
  return NOTE_MARK + ' That turn was all reasoning: no message and no tool call reached the user. '
    + 'State your conclusion as text, or call a tool.';
}

/** A bounded nudge for a truncated turn. The turn itself is dropped from replay (`DROPPED_STOPS`), so
 *  without it the next request would repeat the one that truncated. */
export function lengthStopNudge(streak: number): string | undefined {
  if (streak < 1 || streak > NUDGE_RETRIES) return undefined;
  return NOTE_MARK + ' Your last turn was cut off by the output limit before it finished, and its tool '
    + 'calls were not run. The limit covers your thinking as well as your calls. If it went on thinking, '
    + 'decide less in one turn: think briefly, then act, and write a drawing or a long argument straight '
    + 'into the call instead of working it out first. If it went on the call, issue smaller calls (fewer '
    + 'cells, a smaller area, a large drawing in parts) or give a shorter answer.';
}

/** The final turn appended at the iteration limit, handing the rest back to the user. */
export function capMessage(): string {
  return NOTE_MARK + ' The iteration limit is reached and this job is ending now. Summarize what was '
    + 'done and ask the user how to continue.';
}

/** The result for a call whose arguments a truncated turn left incomplete. */
export function reissueMessage(): string {
  return NOTE_MARK + ' The turn was cut off before the arguments were complete. '
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
  return NOTE_MARK + ` ${PROTOCOL.plan} needs a non-empty "stages" array of objects, each with a label. `
    + 'Example: stages: [{"label":"terrace the north hills"}]. Reissue the call with a valid plan.';
}

/** The result of a plan filing past the job's one revision. */
export function planRevisionLimit(): string {
  return NOTE_MARK + ' The plan has already been revised once; the stage list is a commitment the '
    + 'user is reading, not a scratchpad. Keep building the current plan\'s remaining stages, and '
    + 'put any leftover ideas in your closing summary instead of a new plan.';
}

/** A plan of this many stages or more is built region by region by helpers. */
const HELPER_PLAN_STAGES = 3;

/** The result of an accepted plan filing: a plan of several stages is told to hand its regions to helpers. */
export function planSet(stageCount = 0, guides?: Pick<GuideTools, 'helper'>): string {
  if (!guides || stageCount < HELPER_PLAN_STAGES) return 'Plan set.';
  return `Plan set, ${stageCount} stages. Build in this order. First the ground of the whole area: the levels, `
    + 'then the routes that join them. Then hand every place to a helper, all in one turn so they work at the same '
    + `time: one ${guides.helper} per place with its box as the bounds, the idea of the whole and of this place, what `
    + 'to include, the ground level and the cell where a path enters it. Calm places are handed over too, with their '
    + 'one rule. Build a place yourself only when it takes a call or two.';
}

/** The result acknowledging a reply suggestion in place. */
export function replyNoted(): string {
  return 'Noted.';
}

/** The result of a helper's call that was waiting its turn at the map when the job was stopped. */
export function stoppedBeforeRun(): string {
  return NOTE_MARK + ' The job was stopped before this call ran. Nothing was changed.';
}

/** The result for a delegated helper a reload interrupted; its child log is not resumable. */
export function helperInterrupted(): string {
  return NOTE_MARK + ' The helper run was interrupted by a reload. Edits it already made are on the map; '
    + 'look at the map, then hand what remains to a new helper.';
}

/** A finished helper's report when its last turn said nothing. */
export function helperNoSummary(): string {
  return '(the helper closed without a report)';
}

/** Inclusive corners of a map rectangle, as a helper's brief and result name its bounds. */
export interface HelperBounds { x1: number; y1: number; x2: number; y2: number }

const boundsText = (b: HelperBounds): string => `(${b.x1},${b.y1})-(${b.x2},${b.y2})`;

/** One region's brief as the lead model fills it in. `bounds` and `cells` are the region the harness
 *  enforces, which is the brief's rectangle cut to the map and to the user's painted region. */
interface HelperBrief {
  label: string;
  bounds: HelperBounds;
  cells: number;
  goal: string;
  include?: readonly string[];
  preserve?: readonly string[];
  interfaces?: string;
  skills?: readonly string[];
  done?: readonly string[];
}

const briefList = (title: string, items: readonly string[] | undefined): string[] =>
  (items && items.length > 0 ? [title, ...items.map((item) => `- ${item}`)] : []);

/** A helper's order, rendered from its brief in one fixed layout; an empty section is left out. */
export function helperOrder(tools: GuideTools, brief: HelperBrief): string {
  return [
    `Helper brief: ${brief.label}`,
    `Bounds: ${boundsText(brief.bounds)}, ${brief.cells} cells. These cells are your selection; an edit outside them is refused.`,
    `Goal: ${brief.goal}`,
    ...briefList('Include:', brief.include),
    ...briefList('Preserve:', brief.preserve),
    ...(brief.interfaces ? [`Interfaces: ${brief.interfaces}`] : []),
    ...(brief.skills && brief.skills.length > 0 ? [`Skills: ${tools.skill} each of these first: ${brief.skills.join(', ')}`] : []),
    ...briefList('Done when:', brief.done),
    'Build this place and only this place, inside the bounds, as your instructions for building a place say: design '
      + 'the whole of it, draw it, check it, report.',
  ].join('\n');
}

/** The order a district lead starts from: the brief, and that it leads the building of this area as its own job. */
export function districtOrder(tools: GuideTools, brief: HelperBrief): string {
  return [
    `District brief: ${brief.label}`,
    `Bounds: ${boundsText(brief.bounds)}, ${brief.cells} cells. These cells are your selection; an edit outside them is refused.`,
    `Goal: ${brief.goal}`,
    ...briefList('Include:', brief.include),
    ...briefList('Preserve:', brief.preserve),
    ...(brief.interfaces ? [`Interfaces: ${brief.interfaces}`] : []),
    ...(brief.skills && brief.skills.length > 0 ? [`Skills: ${tools.skill} each of these first: ${brief.skills.join(', ')}`] : []),
    ...briefList('Done when:', brief.done),
    'Lead the building of this district and only this district, inside the bounds, as your instructions for leading a '
      + 'district say: plan it, shape its whole ground, lay its paths, hand its places to helpers, finish it, report.',
  ].join('\n');
}

/** How a helper's run ended, as the harness reads it off the run. */
export type HelperStatus = 'done' | 'partial' | 'capped' | 'failed';

/** What the harness measured of a helper's run. `objects` and `terrain` are the net change inside
 *  the bounds; `fault` is the incident a failed run ended on, absent when the user stopped it. */
export interface HelperReport {
  label: string;
  status: HelperStatus;
  bounds: HelperBounds;
  landed: number;
  refused: number;
  objects: number;
  terrain: number;
  report: string;
  fault?: { cls: string; detail: string };
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Only the first line of a fault's detail: later lines are a provider's advice to whoever holds the
 *  key. The detail is already redacted by its producer per the `TurnError` contract. */
function faultText(fault: HelperReport['fault']): string {
  if (!fault) return 'it was stopped';
  const first = (fault.detail.split('\n')[0] ?? '').trim().replace(/\.+$/, '');
  return first.length > 0 ? `${fault.cls}: ${first}` : fault.cls;
}

function helperState(r: HelperReport): string {
  const unfinished = 'The region is unfinished, and the work the helper landed remains on the map. '
    + 'Look at the region before deciding what remains.';
  switch (r.status) {
    case 'done': return 'The helper finished its brief. Read this result; do not inspect the region again.';
    case 'partial': return 'The helper finished, but some of its edits were refused or rolled back, so part of the brief may be missing. Look only where the report names a gap.';
    case 'capped': return `The helper ran out of turns before it finished. ${unfinished}`;
    case 'failed': return `The helper did not finish (${faultText(r.fault)}). ${unfinished}`;
  }
}

/** A helper's result as the lead model reads it: the harness's own measurements in one fixed
 *  layout, then the helper's closing words. */
export function helperResult(r: HelperReport): string {
  return [
    `Helper result: ${r.label}`,
    `Status: ${r.status}`,
    `Bounds: ${boundsText(r.bounds)}`,
    `Write calls: ${r.landed} landed, ${r.refused} refused or reverted`,
    `Region change: objects ${signed(r.objects)}, cells with terrain ${signed(r.terrain)}`,
    `State: ${helperState(r)}`,
    `Report: ${r.report}`,
  ].join('\n');
}

/** The refusal of a brief whose required text field is blank. */
export function helperBriefBlank(field: string): string {
  return `${field} must not be empty.`;
}

/** The refusal of a brief whose rectangle is more than its builder takes: `district` is the side a district lead takes, absent where the brief comes from one. */
export function helperBoundsLarge(bounds: HelperBounds, limits: { cells: number; side: number; district?: number }): string {
  const wide = bounds.x2 - bounds.x1 + 1, tall = bounds.y2 - bounds.y1 + 1;
  const size = `the bounds (${bounds.x1},${bounds.y1})-(${bounds.x2},${bounds.y2}) are ${wide} by ${tall} cells; `;
  const place = `one place of at most ${limits.cells} cells and ${limits.side} on a side`;
  return limits.district === undefined
    ? `${size}a helper builds ${place}. Divide this area into places and brief each, in the same turn.`
    : `${size}a district is at most ${limits.district} on a side and a single place is ${place.slice(4)}. Divide this area into districts and brief each, in the same turn.`;
}

/** The refusal of a brief whose rectangle holds no cell the helper may edit: `region` is the user's
 *  painted region when that is what the rectangle misses, absent when it misses the map. */
export function helperBoundsEmpty(bounds: HelperBounds, region?: HelperBounds): string {
  return region
    ? `the bounds ${boundsText(bounds)} hold no cell of the user's region, which lies within ${boundsText(region)}. Choose bounds inside it. No helper was started.`
    : `the bounds ${boundsText(bounds)} hold no cell of the map. No helper was started.`;
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
  return NOTE_MARK + ` The tool crashed: ${redactSecrets(message)}. Try a different approach or ask the user.`;
}

/** The result of a call the user's gate skipped; a user choice, not a tool failure. */
export function skippedCallResult(): string {
  return 'The user chose not to run this call. Continue without it, or ask what they would prefer.';
}

/** What stands in for the map context of an order the session has moved past. */
export function earlierMapContext(): string {
  return 'Omitted: this was the map when an earlier order was given. The latest order carries the current map.';
}

/** What stands in for a long read from an earlier order, whose ground later edits may have changed. */
export function earlierRead(): string {
  return 'Omitted: a read from an earlier order. The map may have changed since; read again if the current order needs it.';
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

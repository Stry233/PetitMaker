/** Neutral wire and log types for the v3 agent harness. Pure data: no imports. */

/** `config` and `model` are the two halves of a connection the user filed wrong: the address the
 *  request could not be built from, and the model the address does not serve. */
export type ErrorClass =
  | 'auth' | 'quota' | 'rate-limit' | 'overloaded' | 'network' | 'cors'
  | 'overflow' | 'abort' | 'config' | 'model' | 'unknown';

/** A failed turn as a VALUE. `detail` must already be redacted by the producer. */
export interface TurnError { cls: ErrorClass; detail: string; retryAfterMs?: number; status?: number }

export type StopReason = 'stop' | 'tool-calls' | 'length' | 'error' | 'aborted';

/** A turn the provider itself cut short is replayed nowhere: not resent to the model
 *  (`project-messages.ts`), not shown to a judge (`agent/eval/dump.ts`), not kept as a live ghost
 *  (`project-view.ts`). The ONE list; every consumer imports it rather than naming its own. */
export const DROPPED_STOPS: ReadonlySet<StopReason> = new Set<StopReason>(['aborted', 'error', 'length']);

/** The turn's token accounting, recorded on the `assistant` event for the log's own record. No
 *  panel surface projects it and no loop stage reads it back; a token meter would read it here. */
export interface Usage { input: number; output: number; cacheRead?: number; cacheWrite?: number }

export interface TextPart { kind: 'text'; text: string; done: boolean }
export interface ReasoningPart {
  kind: 'reasoning';
  text: string;
  done: boolean;
  /** Set when `text` is a stored excerpt: the original character count (the panel's "thought for"
   *  datum). A live part has none — it holds the whole thought and can measure itself. */
  chars?: number;
}
/** How much of a thought a stored event keeps. Reasoning is never replayed to a provider and never
 *  the transcript's own content, so storage keeps a readable head of it plus the original length. */
export const REASONING_EXCERPT_CHARS = 240;
/** What a reasoning part is WORTH, in characters — the one answer both the governor (is this turn
 *  silent, or did it think?) and the panel's projection (how much was thought this job?) read, so
 *  the two can never disagree about what counts as a thought.
 *
 *  A blank part is not a thought: an adapter opens one on any delta, an empty or whitespace
 *  `reasoning_content` field included. And ABSENT IS UNKNOWN, NOT ZERO — a part written before the
 *  stored excerpt existed carries no `chars` key and still holds its whole thought, so measuring
 *  the text is the honest answer there; reading a missing key as 0 would report a session that
 *  thought at length as one that never thought at all. Where `chars` IS set the text is only a
 *  head, and the count must come off `chars` rather than off what survived storage. */
export function thoughtSize(p: ReasoningPart): number {
  return p.text.trim().length === 0 ? 0 : p.chars ?? p.text.length;
}
/** A tool call as STREAMED. Execution outcomes live in `toolResult` events; the view joins on `callId`. */
export interface ToolPart {
  kind: 'tool';
  callId: string;
  name: string;
  /** Best-effort object while args stream; the authoritative parse lands with the final event. */
  input: Record<string, unknown>;
  /** The raw arg buffer; kept until `argsDone`, then only when the parse failed. */
  rawInput?: string;
  argsDone: boolean;
}
export type Part = TextPart | ReasoningPart | ToolPart;

/**
 * A WIRE ODDITY THE ADAPTER HAD TO NORMALIZE, carried on the turn it happened to.
 *
 * `tool-call-as-prose`: the turn carried no tool_calls at all and its whole message body parsed as
 * one `{name, arguments}` object naming a tool the request had offered, so the adapter delivered it
 * as the call it is. An Open WebUI-style gateway in front of a local runtime answers that way on its
 * STREAMING path while answering the identical request with a proper `tool_calls` array unstreamed.
 *
 * Additive: the marker says how the turn's parts came to be, and changes none of them.
 */
export type TurnQuirk = 'tool-call-as-prose';

/** What an adapter emits. Adapters normalize both SDK dialects to this. */
export type StreamEvent =
  | { t: 'text'; delta: string }
  | { t: 'reasoning'; delta: string }
  | { t: 'tool-start'; callId: string; name: string }
  | { t: 'tool-args'; callId: string; delta: string }
  | { t: 'done'; stop: StopReason; usage?: Usage; raw?: unknown; final?: FinalToolCall[]; quirks?: TurnQuirk[] }
  | { t: 'error'; error: TurnError };

/** The provider's own final read of a call, reconciled over the streamed deltas. `args` is
 *  undefined when the wire bytes did not parse, which the loop reports back as a re-issue error. */
export interface FinalToolCall { callId: string; name: string; args?: Record<string, unknown>; rawArgs: string }

export interface PlanStage { label: string; checkpoint?: boolean }

/** `update_plan`'s `stages` argument as a plan, or undefined where the model sent nothing usable.
 *  Model-authored input, so every member is checked rather than trusted.
 *
 *  IT LIVES HERE BECAUSE TWO LAYERS READ THE SAME ARGUMENT. The loop parses it to decide whether a
 *  plan is loggable at all, and the projection parses it again to list the stages on the approval
 *  gate's own card — the `plan` event lands only AFTER the answer, so at ask time the call's
 *  arguments are the only place the stages exist. Two parsers would let the card list a stage the
 *  loop would refuse. */
export function parseStages(raw: unknown): PlanStage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const stages: PlanStage[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue;
    const label = (item as Record<string, unknown>).label;
    if (label === undefined) continue;
    const stage: PlanStage = { label: String(label) };
    const checkpoint = (item as Record<string, unknown>).checkpoint;
    if (typeof checkpoint === 'boolean') stage.checkpoint = checkpoint;
    stages.push(stage);
  }
  return stages.length > 0 ? stages : undefined;
}

export type GateAnswer = 'allow' | 'allow-always' | 'skip' | 'words';

export type JobOutcome = 'done' | 'capped' | 'aborted' | 'incident';

/** Structured extras a tool result carries for the VIEW only (never sent to the provider). */
export interface ToolResultDetail {
  cells?: number; objects?: number; reverted?: boolean; regionBlocked?: boolean;
  /** A successful load_skill names what it loaded, so the identity survives into the log, the
   *  projection and storage without the fold importing the skill catalogue. */
  skill?: { name: string; kind: 'method' | 'style'; title: string };
  /** Set when the loop leaned on the model through THIS result: a governor nudge
   *  (`verbatimRetryNudge`/`revertNudge`) escalated onto an executed result's content, or the loop
   *  refused a repeat outright (`repeatRefused` below). The panel stamps it on the job so a human
   *  reviewing it can see where that happened. */
  damper?: true;
  /** The loop answered this call itself instead of running it: a byte-identical retry of a call
   *  that just failed (`governor.ts:repeatedFailure`). Always rides with `damper`; distinct from
   *  it because `damper` also stamps executed results, and the streak counter must not mistake a
   *  refusal for another executed attempt. */
  repeatRefused?: true;
  /** A delegate's child ops, in order, so the helper's work survives the child log (which dies
   *  with the call): the minimum record the helper lane and any audit can stand on. */
  childOps?: { name: string; status: 'ok' | 'error' | 'revert'; skill?: { name: string; kind: 'method' | 'style'; title: string } }[];
  /** The class of the incident that ended a failed child job — no more laundering to a generic error. */
  childError?: ErrorClass;
  /**
   * WHAT REFUSED THE CALL, carried as the RULE rather than as a sentence.
   *
   * The `content` beside this is written FOR the model and is therefore always English
   * (`tools-common.ts:formatErrors` → `translateFor('en', …)`, which is correct and must not change:
   * the model converses in any language and reasons over stable rule feedback). The panel renders
   * the same refusal to the USER, and lifting the rule text out of the model's copy put three lines
   * of English inside a Russian panel — while the very sentence in question ships in all seven
   * locales, keyed. So the violation travels as its own i18n key and params and is translated at the
   * well, in the reader's language.
   *
   * ADDITIVE ONLY, which is what keeps the model-visible⟺logged binding: `content` is unchanged, so
   * nothing here alters a byte the model sees or a byte the transcript records.
   */
  violations?: { ruleId: string; message: string; params?: Record<string, string | number> }[];
}

/** The region an order was FILED under, stamped at push time from `regionBounds` — the composer
 *  chip reads the LIVE store region instead, and the two legitimately diverge once the run is
 *  under way, so a ticket's own record must not silently track the store's later state. */
export interface OrderRegion { count: number; x1: number; y1: number; x2: number; y2: number }

/** One option a pick ask offers: the caption the card shows, and where on the map it is so the panel
 *  can photograph the ground it describes. The rect is read by the same reader a gated call's
 *  footprint is (`ui/agent/map-shot.ts:callFootprint`), which is why it is spelled the same way; an
 *  option that names no place on the map simply carries none and its card shows no picture. */
export interface GateOption { cap: string; rect?: { x1: number; y1: number; x2: number; y2: number } }

interface Base { seq: number; at: number }
export type SessionEvent = Base & (
  // `mapId` is the template the order was FILED against (`state.gridState.template.id`), stamped at
  // push time so a record carries the identity of the map its edits landed on. The panel's rollback
  // guard is the reader: an undo aimed at a job built elsewhere would pop THIS map's stack instead.
  // `mapContext` cannot answer it — that is the system prompt's own prose (a size, cell counts, a
  // token grid) with no name and no id in it. Optional because a log written before the field
  // existed carries none, and absent is UNVERIFIABLE rather than "the map that is open".
  | { kind: 'order'; text: string; mapContext: string; region?: OrderRegion; mapId?: string }
  // `rawModel` names which model produced `raw`, and is recorded only alongside it: `raw` is
  // provider-specific bytes (a thinking block and its signature, the exact tool_use shape) that
  // may only be echoed back to the model that minted it, and a log outlives the armed model.
  // The wire model name alone identifies the producer because the Anthropic dialect is the only
  // one that mints `raw` at all (providers/openai.ts emits none and ignores any it is handed).
  // `quirks` records that the adapter NORMALIZED something about this turn's wire shape (see
  // `TurnQuirk`). Absent on every turn that needed nothing, which is nearly all of them.
  | { kind: 'assistant'; parts: Part[]; stop: StopReason; usage?: Usage; raw?: unknown; rawModel?: string;
      error?: TurnError; quirks?: TurnQuirk[] }
  // `write` and `turnSeq` are stamped by the loop at APPEND time, from facts the fold cannot
  // recover on its own: write-ness is the executor's answer (`ToolExecutor.isWrite`, out of scope
  // by then, and the panel's lazily-loaded read-tool list is a poor stand-in), and a callId is
  // unique only within ONE assistant turn, so the seq of the turn that minted this occurrence is
  // the only durable key for it. Both optional: a log written before they existed carries neither.
  | { kind: 'toolResult'; callId: string; name: string; content: string; isError: boolean; image?: string;
      detail?: ToolResultDetail; write?: boolean; turnSeq?: number }
  | { kind: 'steer'; text: string }
  | { kind: 'steerRecalled'; steerSeq: number }
  | { kind: 'steerDelivered'; steerSeq: number }
  // `quickAnswers` and `options` are what the ask OFFERS, carried on the ask itself because that is
  // the only event that exists at ask time — the answer lands as the user's own sentence
  // (`gateAnswered.words`), and without the offer beside it nothing downstream can tell a tapped
  // pill or a chosen option from a typed reply. Both are optional and neither is model-facing:
  // `project-messages.ts` reads a gate's `callId` and its answer, never these.
  | { kind: 'gateAsked'; gateId: string; scope: 'tool' | 'plan'; callId?: string; summary: string; turnSeq?: number;
      quickAnswers?: string[]; options?: GateOption[] }
  | { kind: 'gateAnswered'; gateId: string; answer: GateAnswer; words?: string }
  | { kind: 'plan'; stages: PlanStage[]; revision: number }
  | { kind: 'stage'; index: number }
  | { kind: 'checkpoint'; undoIndex: number; label: 'job' | 'stage' | 'write'; stageIndex?: number }
  | { kind: 'pauseRequested' }
  | { kind: 'paused' }
  | { kind: 'resumed'; note?: string } // the log's own record of a resume; the model hears the note as the steer queued alongside it, not by reading this field (a future panel may render it)
  // A note the LOOP itself addressed to the model between turns. It is an event rather than a
  // per-request extra because it is sent ONCE and must survive: the request-time notes (a budget
  // warning, a silent-turn nudge) are re-derived from the log on every request, while this one is
  // replayed as a user message from here (`project-messages.ts`) and belongs to the record — a run
  // dump that omitted it would show the model changing course for no visible reason. `note` names
  // the governor that wrote it, and the loop's once-guard counts events with that tag: 'delivery'
  // is the one-per-job answer to a zero-write closing turn, 'review' the one-per-job order-scoped
  // review invitation on the first close of a landed build (both `loop.ts:runJob`).
  | { kind: 'systemNote'; text: string; note: 'delivery' | 'review' }
  | { kind: 'retry'; attempt: number; cls: ErrorClass; delayMs: number }
  | { kind: 'compaction'; summary: string; retainedFromSeq: number }
  | { kind: 'incident'; error: TurnError }
  // `summary` is the last turn's own words, carried across the settle so the record and the answer
  // card can show what was said rather than only that something ended. Absent when there were none:
  // the quiet giveup past three silent turns, and an `incident` (whose turn produced no assistant
  // event at all — its `TurnError` is what carries the trouble). `question` says that text ENDS in a
  // question mark, halfwidth or fullwidth, so a settled job waiting on the user is distinguishable
  // from one that simply finished. It is claimed only where the MODEL chose the ending: a
  // provider-truncated turn or a mid-stream abort keeps its words and never the mark, since a
  // fragment cut at a question mark asks nobody anything.
  // `undoIndex` is the map's undo depth as the job SETTLED, the upper half of the pair whose lower
  // half is the job's first `checkpoint`. Together they bound the entries the job itself wrote, so a
  // take-back can say how much of what it is about to pop is the job's and how much the user has
  // laid on top since. Optional, and absent is UNKNOWABLE rather than zero: a log written before the
  // field existed can only be told the total.
  | { kind: 'jobEnd'; outcome: JobOutcome; summary?: string; question?: boolean; undoIndex?: number }
);
export type SessionEventInput =
  SessionEvent extends infer E ? (E extends Base & infer R ? R : never) : never;

/** Provider-neutral stream and event-log types. Pure data with no imports. */

/** `config` identifies an invalid connection; `model` identifies a model unavailable there. */
export type ErrorClass =
  | 'auth' | 'quota' | 'rate-limit' | 'overloaded' | 'network' | 'cors'
  | 'overflow' | 'abort' | 'config' | 'model' | 'unknown';

/** A failed turn. Producers must redact `detail` before constructing it. */
export interface TurnError { cls: ErrorClass; detail: string; retryAfterMs?: number; status?: number }

export type StopReason = 'stop' | 'tool-calls' | 'length' | 'error' | 'aborted';

/** Provider-interrupted turns excluded from replay, evaluation and reply suggestions. */
export const DROPPED_STOPS: ReadonlySet<StopReason> = new Set<StopReason>(['aborted', 'error', 'length']);

/** Provider-reported token accounting stored with an assistant turn. */
export interface Usage { input: number; output: number; cacheRead?: number; cacheWrite?: number }

export interface TextPart { kind: 'text'; text: string; done: boolean }
export interface ReasoningPart {
  kind: 'reasoning';
  text: string;
  done: boolean;
  /** Original character count when `text` is a persisted excerpt. */
  chars?: number;
}
/** Maximum reasoning excerpt persisted with an event. */
export const REASONING_EXCERPT_CHARS = 240;
/** Measures non-empty reasoning from its original count when available, otherwise from its text. */
export function thoughtSize(p: ReasoningPart): number {
  return p.text.trim().length === 0 ? 0 : p.chars ?? p.text.length;
}
/** A streamed tool call. Execution outcomes live in `toolResult` events. */
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

/** Adapter normalization applied to a provider turn without changing its projected parts. */
export type TurnQuirk = 'tool-call-as-prose';

/** What an adapter emits. Adapters normalize both SDK dialects to this. */
export type StreamEvent =
  | { t: 'text'; delta: string }
  | { t: 'reasoning'; delta: string }
  | { t: 'tool-start'; callId: string; name: string }
  | { t: 'tool-args'; callId: string; delta: string }
  | { t: 'done'; stop: StopReason; usage?: Usage; raw?: unknown; final?: FinalToolCall[]; quirks?: TurnQuirk[] }
  | { t: 'error'; error: TurnError };

/** Provider-finalized call; `args` is absent when its streamed JSON could not be parsed. */
export interface FinalToolCall { callId: string; name: string; args?: Record<string, unknown>; rawArgs: string }

export interface PlanStage { label: string; checkpoint?: boolean }

/** Validates model-authored plan stages for both the loop and the pre-approval projection. */
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

/** Structured tool-result details used by the local view, never sent to the provider. */
export interface ToolResultDetail {
  cells?: number; objects?: number; reverted?: boolean; regionBlocked?: boolean;
  /** Identity of a successfully loaded skill. */
  skill?: { name: string; kind: 'method' | 'style'; title: string };
  /** Marks a result carrying a loop-authored retry, revert or repeat-refusal nudge. */
  damper?: true;
  /** Marks an identical failed call refused by the loop without another execution. */
  repeatRefused?: true;
  /** Ordered child operations retained after a delegated helper's child log closes. */
  childOps?: { name: string; status: 'ok' | 'error' | 'revert'; skill?: { name: string; kind: 'method' | 'style'; title: string } }[];
  /** Incident class that ended a failed child job. */
  childError?: ErrorClass;
  /** Rule identities and parameters used to localize refusal details for the panel. */
  violations?: { ruleId: string; message: string; params?: Record<string, string | number> }[];
}

/** Region snapshot attached to an order when it is submitted. */
export interface OrderRegion { count: number; x1: number; y1: number; x2: number; y2: number }

/** Choice-card caption with an optional map rectangle for its preview. */
export interface GateOption { cap: string; rect?: { x1: number; y1: number; x2: number; y2: number } }

interface Base { seq: number; at: number }
export type SessionEvent = Base & (
  // `mapId` binds rollback to the template active when the order was submitted.
  | { kind: 'order'; text: string; mapContext: string; region?: OrderRegion; mapId?: string }
  // `rawModel` binds provider-specific raw blocks to the model allowed to receive them again.
  | { kind: 'assistant'; parts: Part[]; stop: StopReason; usage?: Usage; raw?: unknown; rawModel?: string;
      error?: TurnError; quirks?: TurnQuirk[] }
  // `write` and `turnSeq` preserve executor classification and call occurrence identity.
  | { kind: 'toolResult'; callId: string; name: string; content: string; isError: boolean; image?: string;
      detail?: ToolResultDetail; write?: boolean; turnSeq?: number }
  | { kind: 'steer'; text: string }
  | { kind: 'steerRecalled'; steerSeq: number }
  | { kind: 'steerDelivered'; steerSeq: number }
  // Offered quick answers and cards distinguish structured picks from typed responses.
  | { kind: 'gateAsked'; gateId: string; scope: 'tool' | 'plan'; callId?: string; summary: string; turnSeq?: number;
      quickAnswers?: string[]; options?: GateOption[] }
  | { kind: 'gateAnswered'; gateId: string; answer: GateAnswer; words?: string }
  | { kind: 'plan'; stages: PlanStage[]; revision: number }
  | { kind: 'stage'; index: number }
  | { kind: 'checkpoint'; undoIndex: number; label: 'job' | 'stage' | 'write'; stageIndex?: number }
  | { kind: 'pauseRequested' }
  | { kind: 'paused' }
  | { kind: 'resumed'; note?: string }
  // Persistent loop-authored instruction replayed as a user message on the next turn.
  // Its tag also enforces at-most-once delivery, review and unfinished-plan nudges per job.
  | { kind: 'systemNote'; text: string; note: 'delivery' | 'review' | 'plan-close' }
  | { kind: 'retry'; attempt: number; cls: ErrorClass; delayMs: number }
  | { kind: 'compaction'; summary: string; retainedFromSeq: number }
  | { kind: 'incident'; error: TurnError }
  // `summary` preserves the final turn's words. `question` marks a model-chosen question ending;
  // truncated and aborted fragments retain their text without entering the waiting state.
  // `undoIndex` pairs with the first checkpoint to bound the job's own undo entries.
  | { kind: 'jobEnd'; outcome: JobOutcome; summary?: string; question?: boolean; undoIndex?: number }
);
export type SessionEventInput =
  SessionEvent extends infer E ? (E extends Base & infer R ? R : never) : never;

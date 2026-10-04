import type { ChildOpStatus, ErrorClass, GateAnswer, JobOutcome, SessionEvent, SkillKind, StopReason, ToolResultDetail, TurnQuirk } from '../core/types';

type Check = (value: unknown) => boolean;
type Fields = Record<string, Check>;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const string: Check = (v) => typeof v === 'string';
const boolean: Check = (v) => typeof v === 'boolean';
const number: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const index: Check = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const optional = (check: Check): Check => (v) => v === undefined || check(v);
const list = (check: Check): Check => (v) => Array.isArray(v) && v.every(check);
const oneOf = (...values: readonly string[]): Check => (v) => typeof v === 'string' && values.includes(v);
const shape = (fields: Fields): Check => (v) => record(v) && Object.entries(fields).every(([key, check]) => check(v[key]));
const values = (check: Check): Check => (v) => record(v) && Object.values(v).every(check);
/** A check for a string union, from a table keyed by every member so the type keeps it complete. */
const member = <T extends string>(table: Record<T, true>): Check => oneOf(...Object.keys(table));
type EventField<K extends SessionEvent['kind'], F extends string> = Extract<SessionEvent, { kind: K }>[F & keyof Extract<SessionEvent, { kind: K }>] & string;

const ERROR_CLASSES: Record<ErrorClass, true> = {
  auth: true, quota: true, 'rate-limit': true, overloaded: true, network: true, cors: true,
  overflow: true, abort: true, config: true, model: true, unknown: true,
};
const errorClass = member(ERROR_CLASSES);
const skillKind = member<SkillKind>({ method: true, style: true });
const childStatus = member<ChildOpStatus>({ ok: true, error: true, revert: true });
const stopReason = member<StopReason>({ stop: true, 'tool-calls': true, length: true, error: true, aborted: true });
const turnQuirk = member<TurnQuirk>({ 'tool-call-as-prose': true });
const gateScope = member<EventField<'gateAsked', 'scope'>>({ tool: true, plan: true });
const gateAnswer = member<GateAnswer>({ allow: true, 'allow-always': true, skip: true, words: true });
const checkpointLabel = member<EventField<'checkpoint', 'label'>>({ job: true, stage: true, write: true });
const noteTag = member<EventField<'systemNote', 'note'>>({ delivery: true, review: true, 'plan-close': true });
const jobOutcome = member<JobOutcome>({ done: true, capped: true, aborted: true, incident: true });
const turnError = shape({ cls: errorClass, detail: string, retryAfterMs: optional(number), status: optional(number) });
const rect = shape({ x1: number, y1: number, x2: number, y2: number });
const skill = shape({ name: string, kind: skillKind, title: string });
const stage = shape({ label: string, checkpoint: optional(boolean) });
const detailFields: { [K in keyof ToolResultDetail]-?: Check } = {
  cells: optional(index), objects: optional(index), reverted: optional(boolean), regionBlocked: optional(boolean),
  partialRevert: optional((v) => v === true), skill: optional(skill),
  damper: optional((v) => v === true), repeatRefused: optional((v) => v === true),
  childOps: optional(list(shape({ name: string, status: childStatus, skill: optional(skill) }))),
  childError: optional(errorClass),
  violations: optional(list(shape({
    ruleId: string, message: string, params: optional(values((v) => string(v) || number(v))),
  }))),
};
const part: Check = (v) => {
  if (!record(v)) return false;
  switch (v.kind) {
    case 'text': return string(v.text) && boolean(v.done);
    case 'reasoning': return string(v.text) && boolean(v.done) && optional(index)(v.chars);
    case 'tool': return string(v.callId) && string(v.name) && record(v.input) && boolean(v.argsDone) && optional(string)(v.rawInput);
    default: return false;
  }
};

/** Validate stored payloads before projections or resumption can interpret them as events. */
const EVENT_FIELDS: Record<SessionEvent['kind'], Fields> = {
  order: {
    text: string, mapContext: string, mapId: optional(string),
    region: optional((v) => rect(v) && record(v) && index(v.count)),
  },
  assistant: {
    parts: list(part), stop: stopReason,
    usage: optional(shape({ input: number, output: number, cacheRead: optional(number), cacheWrite: optional(number) })),
    error: optional(turnError), rawModel: optional(string), quirks: optional(list(turnQuirk)),
  },
  toolResult: {
    callId: string, name: string, content: string, isError: boolean, image: optional(string),
    detail: optional(shape(detailFields)), write: optional(boolean), turnSeq: optional(index),
  },
  steer: { text: string },
  steerRecalled: { steerSeq: index },
  steerDelivered: { steerSeq: index },
  gateAsked: {
    gateId: string, scope: gateScope, callId: optional(string), summary: string, turnSeq: optional(index),
    quickAnswers: optional(list(string)), options: optional(list(shape({ cap: string, rect: optional(rect) }))),
  },
  gateAnswered: { gateId: string, answer: gateAnswer, words: optional(string) },
  plan: { stages: list(stage), revision: index },
  stage: { index },
  checkpoint: { undoIndex: index, label: checkpointLabel, stageIndex: optional(index) },
  pauseRequested: {},
  paused: {},
  resumed: { note: optional(string) },
  systemNote: { text: string, note: noteTag },
  retry: { attempt: index, cls: errorClass, delayMs: number },
  compaction: { summary: string, retainedFromSeq: index },
  incident: { error: turnError },
  replySuggested: { orderSeq: index, reply: string, usage: optional(shape({ input: number, output: number, cacheRead: optional(number), cacheWrite: optional(number) })) },
  jobEnd: { outcome: jobOutcome, summary: optional(string), question: optional(boolean), undoIndex: optional(index) },
};

export function validStoredEvents(events: unknown): events is SessionEvent[] {
  if (!Array.isArray(events)) return false;
  let previousSeq = 0;
  for (const event of events) {
    if (!record(event) || !index(event.seq) || !number(event.at)) return false;
    const seq = event.seq as number;
    if (seq <= previousSeq || seq >= Number.MAX_SAFE_INTEGER) return false;
    if (typeof event.kind !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_FIELDS, event.kind)) return false;
    if (!shape(EVENT_FIELDS[event.kind as SessionEvent['kind']])(event)) return false;
    previousSeq = seq;
  }
  return true;
}

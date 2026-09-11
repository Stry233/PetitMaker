import type { ErrorClass, SessionEvent, ToolResultDetail } from '../core/types';

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

const ERROR_CLASSES: Record<ErrorClass, true> = {
  auth: true, quota: true, 'rate-limit': true, overloaded: true, network: true, cors: true,
  overflow: true, abort: true, config: true, model: true, unknown: true,
};
const errorClass = oneOf(...Object.keys(ERROR_CLASSES));
const turnError = shape({ cls: errorClass, detail: string, retryAfterMs: optional(number), status: optional(number) });
const rect = shape({ x1: number, y1: number, x2: number, y2: number });
const skill = shape({ name: string, kind: oneOf('method', 'style'), title: string });
const stage = shape({ label: string, checkpoint: optional(boolean) });
const detailFields: { [K in keyof ToolResultDetail]-?: Check } = {
  cells: optional(index), objects: optional(index), reverted: optional(boolean), regionBlocked: optional(boolean),
  partialRevert: optional((v) => v === true), skill: optional(skill),
  damper: optional((v) => v === true), repeatRefused: optional((v) => v === true),
  childOps: optional(list(shape({ name: string, status: oneOf('ok', 'error', 'revert'), skill: optional(skill) }))),
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
    parts: list(part), stop: oneOf('stop', 'tool-calls', 'length', 'error', 'aborted'),
    usage: optional(shape({ input: number, output: number, cacheRead: optional(number), cacheWrite: optional(number) })),
    error: optional(turnError), rawModel: optional(string), quirks: optional(list(oneOf('tool-call-as-prose'))),
  },
  toolResult: {
    callId: string, name: string, content: string, isError: boolean, image: optional(string),
    detail: optional(shape(detailFields)), write: optional(boolean), turnSeq: optional(index),
  },
  steer: { text: string },
  steerRecalled: { steerSeq: index },
  steerDelivered: { steerSeq: index },
  gateAsked: {
    gateId: string, scope: oneOf('tool', 'plan'), callId: optional(string), summary: string, turnSeq: optional(index),
    quickAnswers: optional(list(string)), options: optional(list(shape({ cap: string, rect: optional(rect) }))),
  },
  gateAnswered: { gateId: string, answer: oneOf('allow', 'allow-always', 'skip', 'words'), words: optional(string) },
  plan: { stages: list(stage), revision: index },
  stage: { index },
  checkpoint: { undoIndex: index, label: oneOf('job', 'stage', 'write'), stageIndex: optional(index) },
  pauseRequested: {},
  paused: {},
  resumed: { note: optional(string) },
  systemNote: { text: string, note: oneOf('delivery', 'review', 'plan-close') },
  retry: { attempt: index, cls: errorClass, delayMs: number },
  compaction: { summary: string, retainedFromSeq: index },
  incident: { error: turnError },
  jobEnd: { outcome: oneOf('done', 'capped', 'aborted', 'incident'), summary: optional(string), question: optional(boolean), undoIndex: optional(index) },
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

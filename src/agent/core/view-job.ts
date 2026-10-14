/** One job's span of the log, accumulated while `deriveView` folds it and settled into a `JobView`. */
import { resultStatus } from './tool-result';
import { thoughtSize } from './types';
import type { GateAnswer, JobOutcome, OrderRegion, Part, PlanStage, SessionEvent, TextPart } from './types';
import type {
  AskRecord, GateVerdict, JobView, OpRow, ProjectionFacts, ThoughtTurn,
} from './view-types';
/** Exhaustive mapping from persisted gate answers to UI verdicts. */
export const GATE_VERDICT: Record<GateAnswer, GateVerdict> = {
  allow: 'approved',
  'allow-always': 'approved-always',
  skip: 'declined',
  words: 'words',
};

type ToolResultEvent = Extract<SessionEvent, { kind: 'toolResult' }>;

/** Mutable accumulator for one order-to-settlement span during the log fold. */
export interface JobBuilder {
  orderSeq: number; orderText: string; orderAt: number; region?: OrderRegion; mapId?: string;
  plan?: JobView['plan'];
  callOrder: string[];
  names: Map<string, string>;
  inputs: Map<string, Record<string, unknown>>;
  checkpointByCall: Map<string, number>;
  results: Map<string, ToolResultEvent>;
  gateIdToCallId: Map<string, string>;
  /** The asks, in ask order, mutated in place as their answers land. */
  asks: AskRecord[];
  /** Proposed stages indexed before a gated plan becomes an accepted `plan` event. */
  planStagesByCall: Map<string, PlanStage[]>;
  /** Active plan stage captured when each call is registered. */
  stageByCall: Map<string, number>;
  /** Furthest stage reached by either a stage event or its checkpoint. */
  stageAt: number;
  pendingGateCallIds: Set<string>;
  skippedCallIds: Set<string>;
  wordsCallIds: Set<string>;
  /** True once a write call is issued, including one stopped at its supervision gate. */
  writeIssued: boolean;
  /** True once a write result succeeds without being reverted. */
  writeApplied: boolean;
  steerNoteSeqs: number[];
  refusals: string[];
  checkpoints: JobView['checkpoints'];
  stamps: JobView['stamps'];
  /** Reasoning characters in committed turns; `settle` adds the live stream. */
  thoughtChars: number;
  thoughtTurns: number;
  /** One digest per committed turn that thought, in log order. */
  thoughtMarks: ThoughtTurn[];
  skills: JobView['skills'];
}

export function newJob(
  orderSeq: number, orderText: string, orderAt: number, region?: OrderRegion, mapId?: string,
): JobBuilder {
  return {
    orderSeq, orderText, orderAt, region, mapId,
    callOrder: [], names: new Map(), inputs: new Map(), checkpointByCall: new Map(), results: new Map(),
    gateIdToCallId: new Map(), asks: [], planStagesByCall: new Map(),
    stageByCall: new Map(), stageAt: 0,
    pendingGateCallIds: new Set(), skippedCallIds: new Set(),
    wordsCallIds: new Set(), writeIssued: false, writeApplied: false,
    steerNoteSeqs: [], refusals: [], checkpoints: [], stamps: [],
    thoughtChars: 0, thoughtTurns: 0, thoughtMarks: [], skills: [],
  };
}

/** Records the first stamp of each kind at its operation-list position. */
export function stamp(job: JobBuilder, kind: JobView['stamps'][number]['kind']): void {
  if (job.stamps.some((s) => s.kind === kind)) return;
  job.stamps.push({ kind, beforeIndex: job.callOrder.length });
}

/** Returns the first substantive result line, skipping the banner a `detail.banner` result opens with. */
function resultLine(result: ToolResultEvent): string {
  const lines = result.content.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const line = (result.detail?.banner ? lines[1] : lines[0]) ?? '';
  return line.slice(0, 96);
}

/** Derives a call status, converting unresolved calls to `cut` when their job has settled. */
function opStatus(
  pendingGate: boolean, skipped: boolean, words: boolean, result: ToolResultEvent | undefined,
  settled: boolean,
): OpRow['status'] {
  if (pendingGate) return settled ? 'cut' : 'pending-gate';
  if (words) return 'words';
  if (skipped) return 'skipped';
  if (result) return resultStatus(result);
  return settled ? 'cut' : 'run';
}

/** Joins tool parts (committed via `assistant` events, or still streaming in `live`), their
 *  results and their gate/skip history by callId, in first-appearance order. `live` extends the
 *  registry with any call the assembler has not yet committed as an `assistant` event, but never
 *  duplicates one already known from the committed history. */
function buildOps(
  job: JobBuilder, live: readonly Part[] | undefined, facts: ProjectionFacts | undefined,
  settled: boolean,
): OpRow[] {
  const callOrder = job.callOrder.slice();
  const names = new Map(job.names);
  const inputs = new Map(job.inputs);
  for (const p of live ?? []) {
    if (p.kind === 'tool' && !names.has(p.callId)) {
      names.set(p.callId, p.name);
      callOrder.push(p.callId);
    }
    if (p.kind === 'tool' && p.argsDone && p.rawInput === undefined) inputs.set(p.callId, p.input);
  }
  return callOrder.map((callId) => {
    const name = names.get(callId) ?? '';
    const result = job.results.get(callId);
    const status = opStatus(
      job.pendingGateCallIds.has(callId), job.skippedCallIds.has(callId),
      job.wordsCallIds.has(callId), result, settled,
    );
    const row: OpRow = {
      callId, name, status,
      summary: result ? resultLine(result) : '',
      // Persisted result stamps take precedence; the tool facts cover unstamped and in-flight calls.
      isRead: result?.write !== undefined ? !result.write : facts?.access(name) === 'read',
    };
    const stage = job.stageByCall.get(callId);
    const input = inputs.get(callId);
    if (input && Object.keys(input).length > 0) {
      row.input = input;
      const footprint = facts?.footprint(input);
      if (footprint) row.footprint = footprint;
    }
    const checkpoint = job.checkpointByCall.get(callId);
    if (checkpoint !== undefined) row.checkpointIndex = checkpoint;
    if (stage !== undefined && job.plan) row.stageIndex = stage;
    if (result?.detail) row.detail = result.detail;
    // Persisted logs omit rendered images and retain only the result summary.
    if (result?.image !== undefined) row.image = result.image;
    // A successful skill row uses its localized title chip instead of the raw result line.
    if (result?.detail?.skill && !result.isError) { row.skill = result.detail.skill; row.summary = ''; }
    return row;
  });
}

function saysFromLive(live: readonly Part[] | undefined): TextPart | undefined {
  return live?.find((p): p is TextPart => p.kind === 'text');
}

/** Counts reasoning characters in one committed or live turn. */
export function thoughtOf(parts: readonly Part[]): number {
  let chars = 0;
  for (const p of parts) if (p.kind === 'reasoning') chars += thoughtSize(p);
  return chars;
}

/** Joins visible reasoning text, or returns undefined for hidden or empty reasoning. */
export function thoughtTextOf(parts: readonly Part[]): string | undefined {
  const text = parts
    .filter((p): p is Extract<Part, { kind: 'reasoning' }> => p.kind === 'reasoning')
    .map((p) => p.text)
    .join('\n\n')
    .trim();
  return text.length > 0 ? text : undefined;
}

/** Adds persisted truncation deltas to the exact text length displayed by the thought box. */
export function markChars(parts: readonly Part[], text: string): number {
  let cut = 0;
  for (const p of parts) {
    if (p.kind !== 'reasoning' || p.chars === undefined) continue;
    cut += Math.max(0, p.chars - p.text.length);
  }
  return text.length + cut;
}

/** Builds the shared panel view for an active or settled job, including kind and celebration state. */
export function settle(
  job: JobBuilder, end: { outcome: JobOutcome; summary?: string; question?: boolean; undoIndex?: number } | undefined,
  steers: { recalled: ReadonlySet<number>; steerBySeq: ReadonlyMap<number, string> },
  extra: { live?: readonly Part[]; facts?: ProjectionFacts } = {},
): JobView {
  const { recalled, steerBySeq } = steers;
  const { live, facts } = extra;
  const view: JobView = {
    orderSeq: job.orderSeq, orderText: job.orderText, orderAt: job.orderAt,
    ops: buildOps(job, live, facts, end !== undefined),
    // Questions left open at settlement remain in history as unanswered, not actionable gates.
    asks: job.asks.map((ask) => (end !== undefined && ask.verdict === undefined
      ? { ...ask, verdict: 'unanswered' as const }
      : ask)),
    steerNotes: job.steerNoteSeqs.filter((seq) => !recalled.has(seq)).map((seq) => steerBySeq.get(seq) ?? ''),
    checkpoints: job.checkpoints,
    stamps: job.stamps,
    celebrate: end?.outcome === 'done' && job.writeApplied && end.question !== true,
    skills: job.skills,
  };
  if (job.plan) view.plan = job.plan;
  if (job.region) view.region = job.region;
  if (job.refusals.length > 0) view.refusals = job.refusals;
  if (job.mapId !== undefined) view.mapId = job.mapId;
  if (end?.undoIndex !== undefined) view.endUndoIndex = end.undoIndex;
  // Include the uncommitted live turn so reasoning totals update while it streams.
  const liveChars = live ? thoughtOf(live) : 0;
  const chars = job.thoughtChars + liveChars;
  if (chars > 0) {
    const liveText = live && liveChars > 0 ? thoughtTextOf(live) : undefined;
    view.thought = {
      chars,
      turns: job.thoughtTurns + (liveChars > 0 ? 1 : 0),
      marks: job.thoughtMarks,
      ms: job.thoughtMarks.reduce((sum, m) => sum + m.ms, 0),
      ...(liveText !== undefined ? { live: liveText } : {}),
    };
  }
  const says = saysFromLive(live);
  if (says !== undefined) {
    view.says = says.text;
    if (says.done !== true) view.saysStreaming = true;
  }
  if (end === undefined) return view;
  view.outcome = end.outcome;
  if (end.summary !== undefined) view.summary = end.summary;
  if (end.question === true) view.question = true;
  if (end.outcome === 'done') {
    view.kind = job.writeIssued ? 'build' : end.summary !== undefined ? 'answer' : 'quiet';
  }
  return view;
}

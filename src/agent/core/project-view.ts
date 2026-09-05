import type { SessionLog } from './log';
import { eventsOf } from './log';
import { DROPPED_STOPS, parseStages, thoughtSize } from './types';
import type {
  ErrorClass, GateAnswer, GateOption, JobOutcome, OrderRegion, Part, PlanStage, SessionEvent, TextPart,
  ToolResultDetail,
} from './types';

export type SessionPhase =
  | 'idle' | 'thinking' | 'streaming' | 'executing' | 'gated' | 'retrying'
  | 'pausing' | 'paused' | 'aborted' | 'incident';

export interface OpRow {
  callId: string; name: string;
  /** `skipped` is a user decline; `cut` is a call left unresolved when its job ended. */
  status: 'run' | 'ok' | 'revert' | 'error' | 'blocked' | 'skipped' | 'cut' | 'words' | 'pending-gate';
  summary: string; detail?: ToolResultDetail; isRead: boolean;
  /** Plan stage active when the call was registered. */
  stageIndex?: number;
  /** A successful `load_skill`'s identity, for the op row's skill chip. */
  skill?: { name: string; kind: 'method' | 'style'; title: string };
  /** Rendered map shown to the model. Persisted logs omit the data URL. */
  image?: string;
}

/** UI verdict derived from a gate answer. A settled unanswered gate uses `unanswered`. */
export type GateVerdict = 'approved' | 'approved-always' | 'declined' | 'words' | 'unanswered';

/**
 * Reasoning digest for one turn. The assembler merges a turn's reasoning spans, and stream deltas
 * have no timestamps, so the turn is the finest durable unit for both content and elapsed time.
 */
export interface ThoughtTurn {
  /** The turn's own log seq: the mark's stable key across re-folds. */
  seq: number;
  /** The turn's span, in ms (see above). */
  ms: number;
  chars: number;
  /** Full live text or the persisted excerpt; absent when the provider exposes no text. */
  text?: string;
  /** Operation-list index before the turn's tool calls. */
  beforeIndex: number;
}

/** Persistent record of a supervision question and its eventual answer. */
export interface AskRecord {
  gateId: string;
  scope: 'tool' | 'plan';
  /** The ask's own sentence, logged in the locale it was asked in (never re-translated). */
  summary: string;
  callId?: string;
  /** Absent while the ask is still open. */
  verdict?: GateVerdict;
  /** What the user typed, on a `words` answer. */
  words?: string;
  /** Proposed stages carried by a gated `update_plan` call before approval. */
  stages?: PlanStage[];
  /** Quick answers offered with the question. */
  quickAnswers?: string[];
  /** Choice cards offered with the question. */
  options?: GateOption[];
}

export interface JobView {
  orderSeq: number; orderText: string;
  /** Timestamp used by the history record. */
  orderAt: number;
  /** Template ID stamped on the order. Missing IDs cannot pass the rollback map guard. */
  mapId?: string;
  /** Region attached to the order; the live composer region may later differ. */
  region?: OrderRegion;
  plan?: { stages: PlanStage[]; currentIndex: number; doneCount: number; revision: number };
  /** Every ask this job made, in the order it made them, each carrying its verdict once answered. */
  asks: AskRecord[];
  ops: OpRow[]; steerNotes: string[]; says?: string;
  /** The displayed response text is still streaming. */
  saysStreaming?: true;
  outcome?: JobOutcome; summary?: string;
  /** Error class from the incident that settled the job. */
  errorCls?: ErrorClass;
  checkpoints: { undoIndex: number; label: string; stageIndex?: number }[];
  /** Undo depth at settlement, paired with the first checkpoint to bound the job's writes. */
  endUndoIndex?: number;
  /** First occurrence of each side stamp, positioned among operation and thought rows. */
  stamps: { kind: 'compaction' | 'damper' | 'interrupted'; beforeIndex: number }[];
  /** Done-job classification: issued write, text-only answer, or no output. */
  kind?: 'build' | 'answer' | 'quiet';
  /** The model chose to end its closing text with a question. */
  question?: boolean;
  /** True for a completed, non-question job with at least one applied write. */
  celebrate: boolean;
  /**
   * Reasoning observed in committed and live turns. Character counts work across providers whose
   * token accounting differs; a turn may count without text when the provider hides its reasoning.
   */
  thought?: {
    chars: number;
    turns: number;
    /** Committed turns that thought, oldest first. */
    marks: readonly ThoughtTurn[];
    /** The committed turns' total span, in ms. */
    ms: number;
    /** What the turn still streaming has thought so far, where it is exposing the text. */
    live?: string;
  };
  /** Loaded skills in newest-use order, deduplicated by name. */
  skills: { name: string; kind: 'method' | 'style'; title: string }[];
}

export interface PanelView {
  phase: SessionPhase;
  jobs: JobView[]; // settled, oldest first
  current?: JobView; // the running/paused job
  gate?: { gateId: string; scope: 'tool' | 'plan'; summary: string; callId?: string };
  queuedSteers: { seq: number; text: string }[];
  retry?: { attempt: number; cls: ErrorClass; delayMs: number; since: number };
  vitals: { cells: number; objects: number; reverts: number; jobs: number };
  /** Latest sanitized `suggest_reply` text, cleared when a new order starts. */
  suggestion: string | null;
  /** Timestamp of the last event in log order, or zero for an empty log. */
  lastEventAt: number;
  /** Present after a session-wide `allow-always` answer. */
  allowAll?: boolean;
}

/** Exhaustive mapping from persisted gate answers to UI verdicts. */
const GATE_VERDICT: Record<GateAnswer, GateVerdict> = {
  allow: 'approved',
  'allow-always': 'approved-always',
  skip: 'declined',
  words: 'words',
};

type GateAskedEvent = Extract<SessionEvent, { kind: 'gateAsked' }>;
type RetryEvent = Extract<SessionEvent, { kind: 'retry' }>;
type ToolResultEvent = Extract<SessionEvent, { kind: 'toolResult' }>;

/** Mutable accumulator for one order-to-settlement span during the log fold. */
interface JobBuilder {
  orderSeq: number; orderText: string; orderAt: number; region?: OrderRegion; mapId?: string;
  plan?: JobView['plan'];
  callOrder: string[];
  names: Map<string, string>;
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
  checkpoints: JobView['checkpoints'];
  stamps: JobView['stamps'];
  /** Reasoning characters in committed turns; `settle` adds the live stream. */
  thoughtChars: number;
  thoughtTurns: number;
  /** One digest per committed turn that thought, in log order. */
  thoughtMarks: ThoughtTurn[];
  skills: JobView['skills'];
}

function newJob(
  orderSeq: number, orderText: string, orderAt: number, region?: OrderRegion, mapId?: string,
): JobBuilder {
  return {
    orderSeq, orderText, orderAt, region, mapId,
    callOrder: [], names: new Map(), results: new Map(),
    gateIdToCallId: new Map(), asks: [], planStagesByCall: new Map(),
    stageByCall: new Map(), stageAt: 0,
    pendingGateCallIds: new Set(), skippedCallIds: new Set(),
    wordsCallIds: new Set(), writeIssued: false, writeApplied: false,
    steerNoteSeqs: [], checkpoints: [], stamps: [],
    thoughtChars: 0, thoughtTurns: 0, thoughtMarks: [], skills: [],
  };
}

/** Records the first stamp of each kind at its operation-list position. */
function stamp(job: JobBuilder, kind: JobView['stamps'][number]['kind']): void {
  if (job.stamps.some((s) => s.kind === kind)) return;
  job.stamps.push({ kind, beforeIndex: job.callOrder.length });
}

function firstLine(content: string): string {
  return (content.split('\n')[0] ?? '').slice(0, 96);
}

/** Recognizes the summary banners that precede a tool's actionable refusal reason. */
function isHeaderLine(line: string): boolean {
  return line.startsWith('REVERTED') || line.endsWith('rejected:');
}

/** Returns the first substantive result line, skipping refusal banners. */
function resultLine(content: string): string {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line !== '' && !isHeaderLine(line)) return line.slice(0, 96);
  }
  return '';
}

/** Restricts a model-authored reply suggestion to one non-empty display line. */
function sanitizeSuggestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : firstLine(trimmed);
}

/** Derives a call status, converting unresolved calls to `cut` when their job has settled. */
function opStatus(
  pendingGate: boolean, skipped: boolean, words: boolean, result: ToolResultEvent | undefined,
  settled: boolean,
): OpRow['status'] {
  if (pendingGate) return settled ? 'cut' : 'pending-gate';
  if (words) return 'words';
  if (skipped) return 'skipped';
  if (result) {
    if (result.detail?.reverted) return 'revert';
    if (result.detail?.regionBlocked) return 'blocked';
    if (result.isError) return 'error';
    return 'ok';
  }
  return settled ? 'cut' : 'run';
}

/** Joins tool parts (committed via `assistant` events, or still streaming in `live`), their
 *  results and their gate/skip history by callId, in first-appearance order. `live` extends the
 *  registry with any call the assembler has not yet committed as an `assistant` event, but never
 *  duplicates one already known from the committed history. */
function buildOps(
  job: JobBuilder, live: readonly Part[] | undefined, readTools: ReadonlySet<string> | undefined,
  settled: boolean,
): OpRow[] {
  const callOrder = job.callOrder.slice();
  const names = new Map(job.names);
  for (const p of live ?? []) {
    if (p.kind === 'tool' && !names.has(p.callId)) {
      names.set(p.callId, p.name);
      callOrder.push(p.callId);
    }
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
      summary: result ? resultLine(result.content) : '',
      // Persisted result stamps take precedence; `readTools` covers unstamped and in-flight calls.
      isRead: result?.write !== undefined ? !result.write : readTools?.has(name) ?? false,
    };
    const stage = job.stageByCall.get(callId);
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
function thoughtOf(parts: readonly Part[]): number {
  let chars = 0;
  for (const p of parts) if (p.kind === 'reasoning') chars += thoughtSize(p);
  return chars;
}

/** Joins visible reasoning text, or returns undefined for hidden or empty reasoning. */
function thoughtTextOf(parts: readonly Part[]): string | undefined {
  const text = parts
    .filter((p): p is Extract<Part, { kind: 'reasoning' }> => p.kind === 'reasoning')
    .map((p) => p.text)
    .join('\n\n')
    .trim();
  return text.length > 0 ? text : undefined;
}

/** Adds persisted truncation deltas to the exact text length displayed by the thought box. */
function markChars(parts: readonly Part[], text: string): number {
  let cut = 0;
  for (const p of parts) {
    if (p.kind !== 'reasoning' || p.chars === undefined) continue;
    cut += Math.max(0, p.chars - p.text.length);
  }
  return text.length + cut;
}

/** Builds the shared panel view for an active or settled job, including kind and celebration state. */
function settle(
  job: JobBuilder, end: { outcome: JobOutcome; summary?: string; question?: boolean; undoIndex?: number } | undefined,
  recalled: ReadonlySet<number>, steerBySeq: ReadonlyMap<number, string>,
  live?: readonly Part[], readTools?: ReadonlySet<string>,
): JobView {
  const view: JobView = {
    orderSeq: job.orderSeq, orderText: job.orderText, orderAt: job.orderAt,
    ops: buildOps(job, live, readTools, end !== undefined),
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

/**
 * Projects the append-only log into the panel view. The forward fold builds job spans and tracks
 * session-wide markers. Open gates outrank retries; pause outranks both. Live non-reasoning parts
 * promote thinking or retrying to streaming or executing after the fold.
 */
export function deriveView(log: SessionLog, opts?: { live?: readonly Part[]; readTools?: ReadonlySet<string> }): PanelView {
  const jobs: JobView[] = [];
  let currentJob: JobBuilder | undefined;
  let phase: SessionPhase = 'idle';
  let openGate: GateAskedEvent | undefined;
  let openRetry: RetryEvent | undefined;
  // Reply suggestions survive settlement and clear when the next order starts.
  let suggestion: string | null = null;
  const vitals = { cells: 0, objects: 0, reverts: 0, jobs: 0 };
  const steerBySeq = new Map<number, string>();
  const deliveredSteerSeqs = new Set<number>();
  const recalledSteerSeqs = new Set<number>();
  let lastEventAt = 0;
  // `allow-always` survives job settlement for the rest of the session.
  let allowAll = false;

  for (const e of eventsOf(log)) {
    // Turn spans begin at the preceding log event because stream deltas carry no timestamps.
    const sinceAt = lastEventAt;
    lastEventAt = e.at;
    switch (e.kind) {
      case 'order':
        // A new order replaces any malformed unterminated job span.
        currentJob = newJob(e.seq, e.text, e.at, e.region, e.mapId);
        phase = 'thinking';
        openRetry = undefined;
        suggestion = null; // a fresh order carries no suggestion of its own yet
        break;
      case 'assistant':
        if (currentJob) {
          // Position the thought mark before this turn's tool rows are registered.
          const beforeIndex = currentJob.callOrder.length;
          for (const p of e.parts) {
            if (p.kind === 'tool' && !currentJob.names.has(p.callId)) {
              currentJob.names.set(p.callId, p.name);
              currentJob.callOrder.push(p.callId);
              currentJob.stageByCall.set(p.callId, currentJob.stageAt);
            }
            // Suggestions from dropped turns may be incomplete and are not offered to the user.
            if (p.kind === 'tool' && p.name === 'suggest_reply' && !DROPPED_STOPS.has(e.stop)) {
              suggestion = sanitizeSuggestion(p.input.reply);
            }
            if (p.kind === 'tool' && p.name === 'update_plan') {
              const stages = parseStages(p.input.stages);
              if (stages) currentJob.planStagesByCall.set(p.callId, stages);
            }
          }
          // Reasoning totals include stopped turns because their work was observed.
          const thought = thoughtOf(e.parts);
          if (thought > 0) {
            currentJob.thoughtChars += thought;
            currentJob.thoughtTurns += 1;
            const text = thoughtTextOf(e.parts);
            currentJob.thoughtMarks.push({
              seq: e.seq,
              ms: sinceAt > 0 ? Math.max(0, e.at - sinceAt) : 0,
              chars: text !== undefined ? markChars(e.parts, text) : thought,
              beforeIndex,
              ...(text !== undefined ? { text } : {}),
            });
          }
          phase = 'thinking';
        }
        openRetry = undefined;
        break;
      case 'toolResult':
        vitals.cells += e.detail?.cells ?? 0;
        vitals.objects += e.detail?.objects ?? 0;
        if (e.detail?.reverted) vitals.reverts += 1;
        if (currentJob) {
          currentJob.results.set(e.callId, e);
          if (!currentJob.names.has(e.callId)) {
            currentJob.names.set(e.callId, e.name);
            currentJob.callOrder.push(e.callId);
            currentJob.stageByCall.set(e.callId, currentJob.stageAt);
          }
          // Only an explicit write stamp classifies the job as a build; older records omit it.
          if (e.write === true) {
            currentJob.writeIssued = true;
            if (!e.isError && e.detail?.reverted !== true) currentJob.writeApplied = true;
          }
          const loadedSkill = e.detail?.skill;
          if (loadedSkill && !e.isError) {
            currentJob.skills = [...currentJob.skills.filter((s) => s.name !== loadedSkill.name), loadedSkill];
          }
          if (e.detail?.damper) stamp(currentJob, 'damper');
        }
        break;
      case 'steer':
        steerBySeq.set(e.seq, e.text);
        break;
      case 'steerDelivered':
        deliveredSteerSeqs.add(e.steerSeq);
        if (currentJob && steerBySeq.has(e.steerSeq)) currentJob.steerNoteSeqs.push(e.steerSeq);
        break;
      case 'steerRecalled':
        recalledSteerSeqs.add(e.steerSeq);
        break;
      case 'gateAsked':
        // Gate and retry precedence is resolved after the fold from their open markers.
        openGate = e;
        if (currentJob) {
          const ask: AskRecord = { gateId: e.gateId, scope: e.scope, summary: e.summary };
          if (e.quickAnswers && e.quickAnswers.length > 0) ask.quickAnswers = e.quickAnswers;
          if (e.options && e.options.length > 0) ask.options = e.options;
          if (e.callId !== undefined) {
            ask.callId = e.callId;
            const stages = currentJob.planStagesByCall.get(e.callId);
            if (e.scope === 'plan' && stages) ask.stages = stages;
          }
          currentJob.asks.push(ask);
        }
        if (currentJob && e.scope === 'tool' && e.callId !== undefined) {
          currentJob.gateIdToCallId.set(e.gateId, e.callId);
          currentJob.pendingGateCallIds.add(e.callId);
          // A tool gate implies an issued write even when the user skips it before execution.
          currentJob.writeIssued = true;
        }
        break;
      case 'gateAnswered':
        if (openGate?.gateId === e.gateId) openGate = undefined;
        if (e.answer === 'allow-always') allowAll = true;
        if (currentJob) {
          const ask = currentJob.asks.find((a) => a.gateId === e.gateId);
          if (ask) {
            ask.verdict = GATE_VERDICT[e.answer];
            if (e.words !== undefined) ask.words = e.words;
          }
          const callId = currentJob.gateIdToCallId.get(e.gateId);
          if (callId !== undefined) {
            currentJob.pendingGateCallIds.delete(callId);
            if (e.answer === 'skip') currentJob.skippedCallIds.add(callId);
            if (e.answer === 'words') currentJob.wordsCallIds.add(callId);
          }
        }
        break;
      case 'plan':
        if (currentJob) {
          currentJob.plan = { stages: e.stages, currentIndex: 0, doneCount: 0, revision: e.revision };
          currentJob.stageAt = 0;
        }
        break;
      case 'stage':
        if (currentJob?.plan) {
          const lastIndex = currentJob.plan.stages.length - 1;
          const clamped = lastIndex >= 0 ? Math.min(Math.max(e.index, 0), lastIndex) : 0;
          currentJob.plan = { ...currentJob.plan, currentIndex: clamped, doneCount: clamped };
          currentJob.stageAt = Math.max(currentJob.stageAt, clamped);
        }
        break;
      case 'checkpoint':
        if (currentJob) {
          const row: JobView['checkpoints'][number] = { undoIndex: e.undoIndex, label: e.label };
          if (e.stageIndex !== undefined) {
            row.stageIndex = e.stageIndex;
            currentJob.stageAt = Math.max(currentJob.stageAt, e.stageIndex);
          }
          currentJob.checkpoints.push(row);
        }
        break;
      case 'pauseRequested':
        phase = 'pausing';
        break;
      // Pausing ends the active retry timer; resume starts from thinking state.
      case 'paused':
        phase = 'paused';
        openRetry = undefined;
        break;
      case 'resumed':
        phase = currentJob ? 'thinking' : 'idle';
        openRetry = undefined;
        if (currentJob) stamp(currentJob, 'interrupted');
        break;
      case 'retry':
        openRetry = e; // see the 'gateAsked' comment: reconciled against openGate after the fold
        break;
      case 'systemNote':
        // Loop-authored nudges mark the job as damped for the UI summary.
        if (currentJob) stamp(currentJob, 'damper');
        break;
      case 'compaction':
        if (currentJob) stamp(currentJob, 'compaction');
        break;
      case 'incident':
        if (currentJob) {
          const settled = settle(currentJob, { outcome: 'incident' }, recalledSteerSeqs, steerBySeq);
          // Preserve the incident class used to select the panel's failure message.
          settled.errorCls = e.error.cls;
          jobs.push(settled);
          currentJob = undefined;
        }
        // Settlement clears gates and retries owned by the ended job.
        openGate = undefined;
        openRetry = undefined;
        phase = 'incident';
        break;
      case 'jobEnd':
        vitals.jobs += 1;
        if (currentJob) {
          jobs.push(settle(
            currentJob, { outcome: e.outcome, summary: e.summary, question: e.question, undoIndex: e.undoIndex },
            recalledSteerSeqs, steerBySeq,
          ));
          currentJob = undefined;
        }
        openGate = undefined;
        openRetry = undefined;
        phase = e.outcome === 'incident' ? 'incident' : e.outcome === 'aborted' ? 'aborted' : 'idle';
        break;
      default: {
        // Exhaustiveness guard: a new SessionEvent kind must be handled above, not silently
        // dropped here as a no-op.
        const _exhaustive: never = e;
        void _exhaustive;
      }
    }
  }

  // Open gates outrank retries, while an active pause suppresses both surfaces.
  if (currentJob && phase !== 'paused' && phase !== 'pausing') {
    if (openGate) phase = 'gated';
    else if (openRetry) phase = 'retrying';
  }

  // Only visible text or tool parts promote thinking/retrying; reasoning alone keeps the prior phase.
  if ((phase === 'thinking' || phase === 'retrying') && opts?.live && opts.live.length > 0) {
    const newest = [...opts.live].reverse().find((p) => p.kind !== 'reasoning');
    if (newest) {
      phase = newest.kind === 'tool' && !currentJob?.results.has(newest.callId) ? 'executing' : 'streaming';
    }
  }

  const queuedSteers = [...steerBySeq.entries()]
    .filter(([seq]) => !deliveredSteerSeqs.has(seq) && !recalledSteerSeqs.has(seq))
    .sort((a, b) => a[0] - b[0])
    .map(([seq, text]) => ({ seq, text }));

  const view: PanelView = { phase, jobs, queuedSteers, vitals, suggestion, lastEventAt };
  if (allowAll) view.allowAll = true;
  if (currentJob) view.current = settle(currentJob, undefined, recalledSteerSeqs, steerBySeq, opts?.live, opts?.readTools);
  // Publish a gate only while the running loop can receive its answer.
  if (openGate && phase === 'gated') {
    view.gate = { gateId: openGate.gateId, scope: openGate.scope, summary: openGate.summary };
    if (openGate.callId !== undefined) view.gate.callId = openGate.callId;
  }
  // Publish retry timing only while backoff is the session's active phase.
  if (openRetry && phase === 'retrying') {
    view.retry = { attempt: openRetry.attempt, cls: openRetry.cls, delayMs: openRetry.delayMs, since: openRetry.at };
  }
  return view;
}

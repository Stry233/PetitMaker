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
  /** `skipped` is the user's own DECLINE and nothing else; a call that never ran because the job
   *  ended under it is `cut`. The two are different facts and the panel draws them differently (a
   *  quiet cross against a stop mark), so the fold keeps them apart rather than reporting one. */
  status: 'run' | 'ok' | 'revert' | 'error' | 'blocked' | 'skipped' | 'cut' | 'words' | 'pending-gate';
  summary: string; detail?: ToolResultDetail; isRead: boolean;
  /** WHICH PLAN STAGE THE CALL RAN UNDER, where the job filed a plan at all. The log names a stage
   *  twice — the `stage` event as the model advances, and the `stageIndex` on the checkpoint the
   *  next step boundary banks — so the fold carries the LATEST of the two forward and stamps each
   *  call with it as the call is registered. That is what lets a finished record report per stage
   *  (`FlipTicket`'s capped ledger); with one flat op list and no stamp there is no partition to
   *  count from, and a figure guessed onto the wrong stage is worse than none. */
  stageIndex?: number;
  /** A successful `load_skill`'s identity, for the op row's skill chip. */
  skill?: { name: string; kind: 'method' | 'style'; title: string };
  /** The rendered picture this call's result carried (a sighted view_map): what the model SAW,
   *  as a data URL. Live sessions only — persistence strips images, so a rehydrated row has none. */
  image?: string;
}

/**
 * HOW AN ASK WAS ANSWERED, for the card that goes on standing in the record after it.
 *
 * DERIVED FROM THE `gateAnswered` EVENT'S OWN `answer`, because the log carries no verdict field:
 * allow → `approved`, allow-always → `approved-always`, skip → `declined`, words → `words`. An ask
 * a settled job never answered reads `unanswered` — the job ended under the question.
 *
 * The two verdicts the artifact also draws — "answered: {word}" for a quick pill and "picked" for an
 * option card — are the SAME `words` answer said more precisely, and the card decides which by
 * matching `AskRecord.words` against what it offered: a quick answer and an option pick both reach
 * the loop as the user's sentence, so the OFFER (`quickAnswers`/`options`, carried on the ask) is
 * what tells the three apart.
 */
export type GateVerdict = 'approved' | 'approved-always' | 'declined' | 'words' | 'unanswered';

/**
 * ONE TURN'S REASONING, and the turn is the unit BECAUSE NOTHING FINER SURVIVES: the assembler
 * merges every reasoning stretch of a turn into one part at the first stretch's index, so a
 * reason → tool → reason turn keeps no record of which thought came before which call. A digest
 * per turn is the finest honest grain there is.
 *
 * `ms` IS THE TURN'S OWN SPAN, from the event before it to the event that logged it, which is what
 * the log can measure: deltas carry no stamps of their own, so a turn that thought for a minute and
 * then said one sentence cannot be split into the two. On a reasoning turn the span IS the thinking,
 * which is the only shape this is ever shown for. A gate answered in between is its own event, so a
 * question the user sat on for five minutes is not counted as thought.
 */
export interface ThoughtTurn {
  /** The turn's own log seq: the mark's stable key across re-folds. */
  seq: number;
  /** The turn's span, in ms (see above). */
  ms: number;
  chars: number;
  /** As much of the thought as is still held — the whole of it in memory, the stored head
   *  (`REASONING_EXCERPT_CHARS`) after a reload. Absent where the provider exposed no text, which is
   *  what keeps a hidden-CoT turn from offering a box with nothing in it. */
  text?: string;
  /** Where the mark files in the job's op list: the number of calls the job had opened BEFORE this
   *  turn, which is the index of the first row the turn produced. A turn that called nothing files
   *  above whatever the next turn opened, so the marks stay in log order either way. */
  beforeIndex: number;
}

/**
 * One ask the job made, open or answered. THE ASK OUTLIVES THE ANSWER: `PanelView.gate` is the
 * question that can still BE answered (published only at `phase === 'gated'`, so a held session
 * offers no button that reaches nothing), while this is the record of it — the card stays in the log
 * wearing its verdict and the job continues after it.
 */
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
  /** A PLAN ask's stages, read off the `update_plan` call the gate is holding: the `plan` event is
   *  appended only once the ask is approved, so at ask time the call's own arguments are the only
   *  place the stages exist. Absent on a tool ask, and on a plan ask whose call the fold never saw. */
  stages?: PlanStage[];
  /** The quick answers this ask OFFERED, read straight off the `gateAsked` event. An answer lands as
   *  the user's own sentence, so without the offer standing beside it the card cannot tell a tapped
   *  pill from a typed one. */
  quickAnswers?: string[];
  /** The options this ask offered, same carrier: an ask carrying these is a PICK, and the answer is
   *  the caption of whichever card was taken. */
  options?: GateOption[];
}

export interface JobView {
  orderSeq: number; orderText: string;
  /** When the order was filed (the order event's `at`) — the date the history record carries. */
  orderAt: number;
  /** WHICH MAP THIS RECORD'S EDITS ARE ON, the template id stamped on the order. Undefined on a log
   *  written before the field existed, and that is UNVERIFIABLE rather than "the open one": the
   *  panel's rollback guard refuses a take-back it cannot prove aims at the map that is standing. */
  mapId?: string;
  /** The region the order was FILED under, stamped at push time. The composer chip shows the LIVE
   *  store region instead, which legitimately diverges mid-run — this is the ticket's own record,
   *  not a mirror of the store, and is undefined when the order carried none. */
  region?: OrderRegion;
  plan?: { stages: PlanStage[]; currentIndex: number; doneCount: number; revision: number };
  /** Every ask this job made, in the order it made them, each carrying its verdict once answered. */
  asks: AskRecord[];
  ops: OpRow[]; steerNotes: string[]; says?: string;
  /** The says line is still ARRIVING (the live text part's own `done` is not yet set), which is what
   *  the ticket's caret reports. A separate fact from the phase: a turn whose text has landed while
   *  a tool call runs on reads `executing`, and one whose text has landed with nothing after it is
   *  a line that is finished rather than a line being typed. */
  saysStreaming?: true;
  outcome?: JobOutcome; summary?: string;
  /** The class of the failure that ended an `outcome: 'incident'` job, read off the settling
   *  `incident` event. The panel captions the trouble from this (its banner table keys on
   *  `ErrorClass`), which the outcome alone cannot answer — "incident" is nine different notices. */
  errorCls?: ErrorClass;
  checkpoints: { undoIndex: number; label: string; stageIndex?: number }[];
  /** The map's undo depth as this job SETTLED (`jobEnd.undoIndex`). With the first checkpoint's
   *  watermark it bounds the entries the job itself wrote, which is what lets a take-back name the
   *  user's own later work separately from the job's. Absent on a job still running and on a log
   *  written before the field existed — and absent means UNKNOWABLE, so the take-back names its
   *  total rather than guessing at a split. */
  endUndoIndex?: number;
  /** The side stamps this job carries, at most one per kind, each with the place in the op list it
   *  files above — `beforeIndex` exactly as a thought mark's, so the marks and the stamps interleave
   *  in log order. A stamp mid-run has work after it (a compaction is followed by the turns it made
   *  room for), and a stamp read at the foot of a list it happened in the middle of claims to be the
   *  newest thing the job did. */
  stamps: { kind: 'compaction' | 'damper' | 'interrupted'; beforeIndex: number }[];
  /** What the job turned out to BE, for a `done` job only (an unfinished one is neither).
   *  'build' = a write call was ISSUED, whatever became of it (applied, refused, reverted, skipped
   *  at its gate) — a construction that failed still owes the user its receipt; 'answer' = no write
   *  was issued and the job said something; 'quiet' = no write and no words (the giveup). */
  kind?: 'build' | 'answer' | 'quiet';
  /** The closing words stand as a question to the user (`jobEnd.question`), so the job is waiting
   *  rather than finished. */
  question?: boolean;
  /** `done` AND at least one write LANDED (not errored, not reverted) AND it did not end on a
   *  question. The one answer both the celebrate edge and the character read, so a refusal, a
   *  read-only answer or a job still awaiting a reply cannot set anything dancing. */
  celebrate: boolean;
  /** Reasoning received this job, from committed turns plus the live stream: the character total
   *  and the number of turns that carried any. Absent when nothing was thought. CHARACTERS, not
   *  tokens: usage is reported per TURN, not per thought, so it cannot split a turn's count between
   *  a reasoning part and the rest; characters read straight off the text itself, on every
   *  provider including a custom endpoint whose token accounting the harness cannot assume.
   *
   *  `marks` is the per-turn digest the record's own thought rows stand on, `ms` their total (the
   *  receipt's one honest line) and `live` the turn still streaming, whose text has no mark yet.
   *  A HIDDEN-CoT TURN STILL COUNTS: nothing here is keyed on a provider capability, only on what
   *  actually arrived — so a session whose reasoning field is never read simply has no `thought` at
   *  all, rather than a promise of a transcript that will not come. */
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
  /** Loads this job, in order, deduped by name keeping the newest position — the dock names ONE
   *  by rule (newest style, else newest method), which is a panel-side pick over this list. */
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
  /** The newest `suggest_reply` call's predicted text (the composer's ghost), in the current job or
   *  the one that most recently settled — `null` once a fresh `order` starts (see the fold's own
   *  note on why that reset needs no bespoke code). */
  suggestion: string | null;
  /** The newest log event's `at`, 0 for an empty log: the anchor a panel clock ticks from, and the
   *  one reading that says how long nothing has arrived. Taken in fold ORDER rather than by
   *  comparing stamps, so a clock that stepped backwards still reports the last thing logged. */
  lastEventAt: number;
  /** Set once an "always allow" answer has been given, which is a SESSION-wide fact (`gates.ts`) and
   *  so is read off the whole log rather than scoped to a job. The dock says it on its meta line: a
   *  session that has stopped asking should say so wherever the user is looking. Absent, not false,
   *  so a view holds only the facts it has. */
  allowAll?: boolean;
}

/** The one mapping from a logged answer to the verdict a card wears. `Record` rather than a chain, so
 *  a new `GateAnswer` member fails `tsc` here instead of silently reading as an open ask. */
const GATE_VERDICT: Record<GateAnswer, GateVerdict> = {
  allow: 'approved',
  'allow-always': 'approved-always',
  skip: 'declined',
  words: 'words',
};

type GateAskedEvent = Extract<SessionEvent, { kind: 'gateAsked' }>;
type RetryEvent = Extract<SessionEvent, { kind: 'retry' }>;
type ToolResultEvent = Extract<SessionEvent, { kind: 'toolResult' }>;

/** One order-to-jobEnd (or -incident) span, built incrementally as the fold walks the log. Every
 *  map/array here is mutated in place while the job is `current` and read out once, at settle. */
interface JobBuilder {
  orderSeq: number; orderText: string; orderAt: number; region?: OrderRegion; mapId?: string;
  plan?: JobView['plan'];
  callOrder: string[];
  names: Map<string, string>;
  results: Map<string, ToolResultEvent>;
  gateIdToCallId: Map<string, string>;
  /** The asks, in ask order, mutated in place as their answers land. */
  asks: AskRecord[];
  /** Every `update_plan` call this job streamed, by callId, so a plan ask can list what it is
   *  asking about before the `plan` event exists (see `AskRecord.stages`). */
  planStagesByCall: Map<string, PlanStage[]>;
  /** The stage each call ran under, by callId — stamped as the call is registered, since the op
   *  rows are assembled in a later pass that no longer knows where in the log a call sat. */
  stageByCall: Map<string, number>;
  /** The stage the walk has reached, and it only ever goes FORWARD: a checkpoint banks a stage the
   *  `stage` event already announced, so taking the later of the two would step the count back. */
  stageAt: number;
  pendingGateCallIds: Set<string>;
  skippedCallIds: Set<string>;
  wordsCallIds: Set<string>;
  /** A write call was issued at all — the build/answer boundary. Set by a stamped write result AND
   *  by a tool-scope gate (only a write is ever gated, `gates.ts:shouldGate`), so a write the user
   *  skipped before it ran still reads as a build. */
  writeIssued: boolean;
  /** A write LANDED: a stamped write result that neither errored nor was reverted. */
  writeApplied: boolean;
  steerNoteSeqs: number[];
  checkpoints: JobView['checkpoints'];
  stamps: JobView['stamps'];
  /** Reasoning in this job's COMMITTED turns; the live stream is added at read-out, in `settle`. */
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

/**
 * File a side stamp WHERE IT HAPPENED: at most one per kind, positioned by the op list as it stood
 * when the event landed (`callOrder.length`, the thought marks' own `beforeIndex`).
 *
 * ONE PER KIND is the reading rather than a limitation — "the notes were tidied" and "another way
 * was tried" are facts about the job, not counters — and keeping the FIRST occurrence's position is
 * what makes it a fact about the job's shape too: the work that followed the tidying is the reason
 * the stamp is not at the foot.
 */
function stamp(job: JobBuilder, kind: JobView['stamps'][number]['kind']): void {
  if (job.stamps.some((s) => s.kind === kind)) return;
  job.stamps.push({ kind, beforeIndex: job.callOrder.length });
}

function firstLine(content: string): string {
  return (content.split('\n')[0] ?? '').slice(0, 96);
}

/** A model-facing REFUSAL BANNER: a line that announces a call failed rather than saying why, with
 *  the rule text one line BELOW it — the shape every write tool's own refusal takes ("REVERTED:",
 *  "REVERTED, nothing changed:", "All commands rejected:", "Partially applied — N command(s)
 *  rejected:"). NOT any line ending in a colon: a SUCCESS result routinely opens on one too
 *  ("Legal bridge-plank anchors (…):", "Available skills:"), and skipping that line would bury the
 *  one line a well has to show behind the sentence introducing it. So this names the two shapes a
 *  refusal actually takes rather than the punctuation both happen to share with other sentences. */
function isHeaderLine(line: string): boolean {
  return line.startsWith('REVERTED') || line.endsWith('rejected:');
}

/** The first line of a tool result that SAYS something, capped like `firstLine`.
 *
 *  A refusal's first line is the tool's own banner and its second is the rule that refused it, so
 *  reading line 0 left the panel's detail well showing "All commands rejected:" and nothing else —
 *  the one fact the user wanted was one line further down. Headers are skipped; a result that is
 *  ALL header (a bare "REVERTED:") reports nothing, which the panel answers with its own sentence. */
function resultLine(content: string): string {
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (line !== '' && !isHeaderLine(line)) return line.slice(0, 96);
  }
  return '';
}

/** `suggest_reply`'s predicted text is model-authored and schema-unconstrained (no length cap, may
 *  carry newlines) — the one projected field carrying it verbatim must not skip the same
 *  `firstLine` treatment applied to every command summary above. A non-string or
 *  empty-after-trim `reply` (the tool's own arg name — `tools/tools.ts`'s `TOOL_SCHEMAS`) reports
 *  `null`, same as no call at all. */
function sanitizeSuggestion(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : firstLine(trimmed);
}

/** A call answered in WORDS is never run: the loop hands the user's sentence back to the model
 *  instead, so no result will ever arrive for it and the row would otherwise read 'run' forever.
 *
 *  A SETTLED JOB RESOLVES NOTHING FURTHER, which is why `settled` is an input: the two UNSETTLED
 *  statuses describe a call the loop is still driving, and the loop behind a job that has ended is
 *  gone. Left alone, an abort at a gate kept a live question mark on ask paper in the permanent
 *  record, and a call cut off mid-flight kept the in-progress mark, both forever. Neither ever ran,
 *  so both read as `cut` — cut short by the end of the job, which is NOT the same fact as the user
 *  declining one (`skipped`) and does not wear its mark. */
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
      // The result's own stamp first: it is the executor's answer, recorded when the call ran.
      // `readTools` is the fallback for a log written before the stamp existed, and for a call
      // still in flight (no result yet), and answers `false` when the caller passed no set at all.
      isRead: result?.write !== undefined ? !result.write : readTools?.has(name) ?? false,
    };
    const stage = job.stageByCall.get(callId);
    if (stage !== undefined && job.plan) row.stageIndex = stage;
    if (result?.detail) row.detail = result.detail;
    // The picture the MODEL was shown, carried so the record can show the reader the same thing.
    // Live sessions only by construction: persistence strips images, so a rehydrated row falls
    // back to its summary line ("Rendered view … attached"), which still says a look happened.
    if (result?.image !== undefined) row.image = result.image;
    // The ALL-CAPS em-dashed body first-line never reaches a 7-locale detail well; the chip
    // carries the title instead, so a loaded skill's summary is blanked here. Guarded like
    // the JobView.skills fold: an error result carries no loaded skill to show.
    if (result?.detail?.skill && !result.isError) { row.skill = result.detail.skill; row.summary = ''; }
    return row;
  });
}

function saysFromLive(live: readonly Part[] | undefined): TextPart | undefined {
  return live?.find((p): p is TextPart => p.kind === 'text');
}

/** The characters of reasoning in one turn's parts, committed or live (`thoughtSize` is where what
 *  a thought is WORTH is decided, and the governor reads the same answer). A total above zero is
 *  also the `turns` increment: a turn that thought twice still thought once. */
function thoughtOf(parts: readonly Part[]): number {
  let chars = 0;
  for (const p of parts) if (p.kind === 'reasoning') chars += thoughtSize(p);
  return chars;
}

/** What a turn's reasoning parts hold, joined, or undefined where they hold nothing readable. A
 *  turn reasoned about by a provider that exposes no text has parts with no text in them, and an
 *  empty string would open a box on nothing. */
function thoughtTextOf(parts: readonly Part[]): string | undefined {
  const text = parts
    .filter((p): p is Extract<Part, { kind: 'reasoning' }> => p.kind === 'reasoning')
    .map((p) => p.text)
    .join('\n\n')
    .trim();
  return text.length > 0 ? text : undefined;
}

/**
 * THE MARK'S TWO NUMBERS MUST MEASURE ONE STRING, and this is where they are made to.
 *
 * `text` is the thought as the box DISPLAYS it (joined and trimmed by `thoughtTextOf`), while a size
 * read straight off the parts counts every character the trim took and every separator the join did
 * not add — and `ThoughtsBox` reads any difference between the two as "a reload kept only the
 * beginning". A `reasoning_content` stream that opens or closes on a newline is the common shape, so
 * a live thought that has never been near a reload reads as truncated.
 *
 * What a reload GENUINELY cuts is per part: the length storage recorded (`chars`) less the head it
 * kept. Adding that to the displayed length is the one figure both readings agree on — equal to
 * `text.length` where nothing was cut, whatever the whitespace, and the true size where it was.
 */
function markChars(parts: readonly Part[], text: string): number {
  let cut = 0;
  for (const p of parts) {
    if (p.kind !== 'reasoning' || p.chars === undefined) continue;
    cut += Math.max(0, p.chars - p.text.length);
  }
  return text.length + cut;
}

/** Reads a job builder out as the `JobView` the panel renders, for both a settled job (`end` given,
 *  carrying the whole of what the settling event said) and the still-open `current` one (no `end`,
 *  live/readTools passed as needed by the caller).
 *
 *  `kind` and `celebrate` are decided HERE rather than by each consumer, so the answer card, the
 *  history record and the character all read one answer to "did this build something, and did the
 *  work land?". Both are `done`-only: an unfinished job is neither a build nor an answer, and a
 *  celebration over a capped or aborted run would congratulate the user on being cut off. */
function settle(
  job: JobBuilder, end: { outcome: JobOutcome; summary?: string; question?: boolean; undoIndex?: number } | undefined,
  recalled: ReadonlySet<number>, steerBySeq: ReadonlyMap<number, string>,
  live?: readonly Part[], readTools?: ReadonlySet<string>,
): JobView {
  const view: JobView = {
    orderSeq: job.orderSeq, orderText: job.orderText, orderAt: job.orderAt,
    ops: buildOps(job, live, readTools, end !== undefined),
    // AN ASK THE JOB ENDED UNDER WAS NEVER ANSWERED, and its card must say so rather than standing
    // as an open question forever: the loop that was waiting on it is gone (the same fact `opStatus`
    // reads as `cut`).
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
  // The turn still streaming is counted from `live`, since the loop appends nothing until it
  // closes: without this the reading sits still for the whole of a long think and then jumps.
  // (An `assistant` append and the `setLive(null)` behind it land in one tick, so the instant
  // between them counts one turn twice; the next read is correct and nothing renders in between.)
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

/** Projects the append-only log into everything the panel renders. One forward fold builds each
 *  order-to-jobEnd/incident span as a `JobView`; a few markers (the open gate, the open retry,
 *  steer bookkeeping, vitals) accumulate across the WHOLE log because they are not job-scoped.
 *  `phase` during the fold only ever tracks the SEQUENTIAL states (thinking/pausing/paused/
 *  aborted/incident/idle: order, assistant, pauseRequested, paused, resumed, jobEnd, incident),
 *  where the last event of that kind legitimately wins. Gate and retry are NOT folded into `phase`
 *  as they occur: an open gate and an open retry are two independent, clearable markers, and which
 *  one the panel shows (gate always wins) is reconciled once, after the fold, from the FINAL state
 *  of both markers — never from whichever of 'gateAsked'/'retry' happened to be logged later. Both
 *  markers are cleared the instant their job settles (`jobEnd`/`incident`): a stale unanswered gate
 *  or pending retry from a job that no longer exists must not leak into the next one. The retry
 *  marker is cleared by a HOLD too (`paused`/`resumed`), which ends a backoff as surely as an abort
 *  does. NEITHER MARKER IS PUBLISHED OUTSIDE ITS OWN PHASE (see the two writes at the foot): a
 *  question or a wait the view shows is one the session is actually holding, so a surface cannot
 *  offer an answer that reaches nothing. `live` promotes a bare 'thinking' or 'retrying' tail to
 *  'streaming'/'executing', and only on a part that is not
 *  reasoning — it never overrides a higher-precedence marker still in effect, and a stream that has
 *  only thought so far leaves the phase alone. A log that does not open on an `order` event does not
 *  crash: every job-scoped mutation below is guarded on `currentJob`, so a stray pre-order event is
 *  simply ignored. */
export function deriveView(log: SessionLog, opts?: { live?: readonly Part[]; readTools?: ReadonlySet<string> }): PanelView {
  const jobs: JobView[] = [];
  let currentJob: JobBuilder | undefined;
  let phase: SessionPhase = 'idle';
  let openGate: GateAskedEvent | undefined;
  let openRetry: RetryEvent | undefined;
  // Unlike openGate/openRetry, this is NOT cleared at jobEnd/incident: it must read through into
  // the last-settled job until a fresh order starts (the `case 'order'` reset below is the only
  // clear it ever needs).
  let suggestion: string | null = null;
  const vitals = { cells: 0, objects: 0, reverts: 0, jobs: 0 };
  const steerBySeq = new Map<number, string>();
  const deliveredSteerSeqs = new Set<number>();
  const recalledSteerSeqs = new Set<number>();
  let lastEventAt = 0;
  // Session-wide, so it is never cleared by a job settling: an "always allow" holds for the session
  // that gave it.
  let allowAll = false;

  for (const e of eventsOf(log)) {
    // The event BEFORE this one, kept before the stamp moves: a turn's span is measured from
    // whatever the log last recorded (the order, a tool result, a gate answered), which is the only
    // clock a turn has. Zero means there is nothing to measure from — this is the log's first event.
    const sinceAt = lastEventAt;
    lastEventAt = e.at;
    switch (e.kind) {
      case 'order':
        // A prior unsettled job here means the log skipped its own jobEnd/incident; there is
        // nothing legal to do with it, so it is dropped rather than reported as "settled".
        currentJob = newJob(e.seq, e.text, e.at, e.region, e.mapId);
        phase = 'thinking';
        openRetry = undefined;
        suggestion = null; // a fresh order carries no suggestion of its own yet
        break;
      case 'assistant':
        if (currentJob) {
          // Read before the parts register their calls: a turn's mark files above the first row
          // that turn produced, and the loop below is what pushes those rows.
          const beforeIndex = currentJob.callOrder.length;
          for (const p of e.parts) {
            if (p.kind === 'tool' && !currentJob.names.has(p.callId)) {
              currentJob.names.set(p.callId, p.name);
              currentJob.callOrder.push(p.callId);
              currentJob.stageByCall.set(p.callId, currentJob.stageAt);
            }
            // A turn that aborted, errored or hit the length cap is dropped wholesale from the
            // conversation the model is re-sent (`project-messages.ts`'s own `stop` filter), so a
            // suggestion streamed inside one is text nothing else in the session acknowledges —
            // half a sentence the composer would offer as if the assistant stood behind it.
            if (p.kind === 'tool' && p.name === 'suggest_reply' && !DROPPED_STOPS.has(e.stop)) {
              suggestion = sanitizeSuggestion(p.input.reply);
            }
            if (p.kind === 'tool' && p.name === 'update_plan') {
              const stages = parseStages(p.input.stages);
              if (stages) currentJob.planStagesByCall.set(p.callId, stages);
            }
          }
          // Counted whatever the turn's `stop` was, unlike the suggestion above: what `thought`
          // reports is effort spent, and a turn the provider cut off still spent it.
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
          // `=== true`, not truthiness: the flag is ABSENT on a legacy result, and an absent stamp
          // is not the claim that the call was a write. Such a log reads its done jobs as answers.
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
        // Not a `phase` write: whether an open gate wins over an open retry (or vice versa) is
        // decided once, after the fold, from which markers are still open — never from which of
        // the two events happened to land last in the log.
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
          // Only a write is ever gated (`gates.ts:shouldGate`), so the ask alone settles the
          // build/answer boundary — a write the user skips or answers in words never produces a
          // stamped result, and the job would otherwise read as an answer for having only asked.
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
      // A HOLD ENDS THE WAIT as surely as an abort does: the loop that was keeping the backoff has
      // returned, so the marker describes a clock nobody is running. Left standing it survived the
      // resume (which sets 'thinking' only for the reconciliation below to promote it straight back
      // to 'retrying'), and the resumed job wore a retry face whose countdown read 0 forever.
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
        // The loop leaned on the model between turns (a delivery or review nudge), so the job
        // wears the same stamp an escalated tool result files.
        if (currentJob) stamp(currentJob, 'damper');
        break;
      case 'compaction':
        if (currentJob) stamp(currentJob, 'compaction');
        break;
      case 'incident':
        if (currentJob) {
          const settled = settle(currentJob, { outcome: 'incident' }, recalledSteerSeqs, steerBySeq);
          // The class rides on the event that ends the job, and nowhere else: the `jobEnd`
          // following it carries the outcome only, so reading the caption off that would leave
          // every trouble looking the same.
          settled.errorCls = e.error.cls;
          jobs.push(settled);
          currentJob = undefined;
        }
        // A job that just settled can carry no open question forward: an unanswered gate or a
        // pending retry from the job that just ended is moot the instant the job is gone.
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

  // Gate vs. retry is reconciled HERE, from which markers are still open, rather than from
  // whichever of 'gateAsked'/'retry' happened to be the later event: an open unanswered gate
  // always wins (a retry sitting behind it is held, not surfaced, until the gate resolves).
  // Neither marker outranks an active pause: the job is not proceeding either way, so the pause
  // itself is what the panel should show.
  if (currentJob && phase !== 'paused' && phase !== 'pausing') {
    if (openGate) phase = 'gated';
    else if (openRetry) phase = 'retrying';
  }

  // Live streaming promotes a bare 'thinking' tail AND a 'retrying' one: any other marker
  // (gated/paused/pausing/incident/aborted) still holds regardless of what is streaming.
  // A REASONING PART IS NOT SPEECH and promotes nothing: a thinking model streams thoughts for as
  // long as it likes before it says a word, and reading the newest part alone would say 'streaming'
  // throughout — the panel claiming the assistant is talking while nothing has been said. So the
  // promotion reads the newest part that is NOT reasoning, and a stream carrying only thought
  // leaves the phase where the log put it.
  // RETRYING IS LIFTED FOR THE SAME REASON IT IS SHOWN AT ALL: the marker is cleared by the
  // `assistant` append that ENDS the new attempt, so without the lift the whole of that attempt —
  // thirty to sixty seconds on a slow model — reads "waiting to try again" while the words are
  // already arriving. A stream is the attempt having begun, which is the end of the wait.
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
  // ONLY WHERE SOMETHING IS ASKING. `phase === 'gated'` is exactly "an open gate, and a job not on
  // hold" (the reconciliation above), so this publishes the question when it can be answered and
  // withholds it otherwise. Published unconditionally, a reload's synthetic `paused` left a live
  // Allow/Skip standing under a dock offering Resume: pressing Allow appended the answer, the
  // question vanished, and nothing ran — there was no loop awaiting it. The ask is not lost, it is
  // held: `loop.ts:existingGateId` re-enters the SAME gate when the job resumes, so Resume is what
  // puts the question back, with something behind it this time.
  if (openGate && phase === 'gated') {
    view.gate = { gateId: openGate.gateId, scope: openGate.scope, summary: openGate.summary };
    if (openGate.callId !== undefined) view.gate.callId = openGate.callId;
  }
  // Gated on the PHASE for the same reason the gate above is: the marker is held internally (an
  // assistant/jobEnd/incident afterward still clears it normally) and surfaced only where the wait
  // is what the session is doing. `phase === 'retrying'` is exactly that — a gate, a hold or a
  // stream that has begun each outranks it, and the field saying "a backoff is pending" in any of
  // those states is a fact the panel would have to know not to trust.
  if (openRetry && phase === 'retrying') {
    view.retry = { attempt: openRetry.attempt, cls: openRetry.cls, delayMs: openRetry.delayMs, since: openRetry.at };
  }
  return view;
}

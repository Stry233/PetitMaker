/** Adapts editor tool schemas and results to the agent loop's `ToolExecutor` contract.
 * `delegate_task` runs a helper at depth one, inside the bounds of its brief; child executors omit
 * delegation from their allowed tools. */
import type { ToolExecutor, ExecutedResult, LoopDeps } from '../core/loop';
import { runJob } from '../core/loop';
import { append, createLog, eventsOf, subscribe, type SessionLog } from '../core/log';
import { answerGate, askGate, awaitGate, type Oversight } from '../core/gates';
import { MAX_TURNS_DEFAULT, SUBAGENT_MAX_TURNS } from '../core/governor';
import { loopNoteResult, resultStatus, retainedWrite } from '../core/tool-result';
import { PROTOCOL } from '../core/protocol';
import {
  districtOrder, helperBoundsEmpty, helperBoundsLarge, helperBriefBlank, helperNoSummary, helperOrder, helperResult, stoppedBeforeRun, unknownTool,
  type HelperBounds, type HelperReport, type HelperStatus,
} from '../core/nudges';
import type { ChildProgress, ErrorClass, JobOutcome, SessionEvent, TextPart, ToolResultDetail, TurnError } from '../core/types';
import type { Adapter } from '../core/adapter';
import {
  TOOL_FACTS, buildMapContext, checkToolArgs, executeToolCall, toolFacts, wireSchemas, type AgentToolDeps, type TOOLS,
} from '../tools';
import { describeToolCall } from '../tools/describe';
import { districtSystemPrompt, helperSystemPrompt } from '../prompts/index';
import { argError } from '../tools/feedback';
import type { Infer } from '../tools/schema';
import { cellKey, regionBounds } from '../../core/grid/rect';
import { groundUnder } from '../tools/serialize';
import type { GridState, MacroCoord } from '../../core/model/types';
import { translate } from '../../i18n/context';

/** Runtime context needed to execute and surface a delegated child job. */
export interface DelegateOpts {
  adapter: Adapter;
  model: string;
  capabilities?: LoopDeps['capabilities'];
  thinking?: LoopDeps['thinking'];
  system: string;
  oversight: Oversight;
  signal: AbortSignal;
  log: SessionLog;
  /** The latest operation and count of the child the call `callId` started; null once that child settles. */
  onChildProgress?: (callId: string, p: ChildProgress | null) => void;
  /** Hands over each child's log as the child starts, `label` naming it under its parents; for a
   *  record of whole trajectories, which the job's own log keeps only as each child's result. */
  onChildLog?: (label: string, log: SessionLog) => void;
}

type AssistantEvent = Extract<SessionEvent, { kind: 'assistant' }>;

/** Returns the final assistant text, or a plain fallback if the child produced none. */
function childFinalText(childLog: SessionLog): string {
  const assistants = eventsOf(childLog).filter((e): e is AssistantEvent => e.kind === 'assistant');
  const last = assistants[assistants.length - 1];
  const text = last?.parts
    .filter((p): p is TextPart => p.kind === 'text')
    .map((p) => p.text)
    .join('')
    .trim() ?? '';
  return text.length > 0 ? text : helperNoSummary();
}

/** Summarizes edits, operation outcomes and terminal error class from the ephemeral child log, with
 *  the child's write calls by how they settled: left as called, or refused or rolled back. */
function childDetail(childLog: SessionLog): { detail?: ToolResultDetail; writes: Pick<HelperReport, 'landed' | 'refused'> } {
  let cells = 0;
  let objects = 0;
  let reverted = false;
  let partialRevert = false;
  let retained = false;
  const childOps: NonNullable<ToolResultDetail['childOps']> = [];
  let childError: ErrorClass | undefined;
  const writes = { landed: 0, refused: 0 };
  for (const e of eventsOf(childLog)) {
    if (e.kind === 'incident') { childError = e.error.cls; continue; }
    if (e.kind !== 'toolResult') continue;
    if (retainedWrite(e)) retained = true;
    cells += e.detail?.cells ?? 0;
    objects += e.detail?.objects ?? 0;
    if (e.detail?.reverted) reverted = true;
    if (e.detail?.partialRevert) partialRevert = true;
    const status = resultStatus(e);
    if (e.write) { if (status === 'ok') writes.landed++; else writes.refused++; }
    childOps.push({
      name: e.name,
      // A region refusal is a failed call to the helper's rollup.
      status: status === 'blocked' ? 'error' : status,
      ...(e.detail?.skill ? { skill: e.detail.skill } : {}),
    });
  }
  const detail: ToolResultDetail = {};
  if (cells > 0) detail.cells = cells;
  if (objects > 0) detail.objects = objects;
  if (reverted) detail.reverted = true;
  if (partialRevert || (reverted && retained)) detail.partialRevert = true;
  if (childOps.length > 0) detail.childOps = childOps;
  if (childError) detail.childError = childError;
  return { ...(Object.keys(detail).length > 0 ? { detail } : {}), writes };
}

/** The incident a failed child job ended on, if it logged one. */
function childFault(childLog: SessionLog): TurnError | undefined {
  const incident = [...eventsOf(childLog)].reverse().find((e) => e.kind === 'incident');
  return incident?.kind === 'incident' ? incident.error : undefined;
}

function helperStatus(outcome: JobOutcome | 'paused', refused: number): HelperStatus {
  if (outcome === 'capped') return 'capped';
  if (outcome === 'done') return refused > 0 ? 'partial' : 'done';
  // Aborted, an incident, or the never-reached pause: nothing asks a child log to pause.
  return 'failed';
}

/** The cells a helper may edit: the brief's rectangle cut to the map, and to the user's painted
 *  region when there is one. */
function helperRegion(state: GridState, rect: HelperBounds, userRegion: readonly MacroCoord[]): MacroCoord[] {
  const x1 = Math.max(0, rect.x1), x2 = Math.min(state.template.width - 1, rect.x2);
  const y1 = Math.max(0, rect.y1), y2 = Math.min(state.template.height - 1, rect.y2);
  if (userRegion.length > 0) return userRegion.filter((c) => c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2);
  const cells: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) cells.push({ x, y });
  return cells;
}

/** What stands in `region`: its cells with terrain under them, and the objects anchored in it. */
function regionCensus(state: GridState, region: readonly MacroCoord[]): { objects: number; terrain: number } {
  const inside = new Set(region.map((c) => cellKey(c.x, c.y)));
  let terrain = 0;
  for (const c of region) {
    const g = groundUnder(state, c.x, c.y);
    if (g.kind !== 'bare' && g.kind !== 'off') terrain++;
  }
  let objects = 0;
  for (const o of state.objects.values()) {
    if (inside.has(cellKey(Math.floor(o.position.x), Math.floor(o.position.y)))) objects++;
  }
  return { objects, terrain };
}

type BriefArgs = Infer<(typeof TOOLS)[typeof PROTOCOL.delegate]['input']>;

/** A name for a brief that came without one: the opening clause of its goal, or its first words when that is too short to read. */
function briefName(goal: string): string {
  const clause = (goal.split(/[\u3002\uff0c\uff1b\uff1a\n]|[.,;:](?=\s|$)/)[0] ?? '').trim();
  return (clause.length >= 3 ? clause : goal).slice(0, 24).trim();
}

/** A brief's list with blank items dropped, or nothing where none remain. */
function briefList(items: readonly string[] | undefined): string[] | undefined {
  const kept = (items ?? []).map((item) => item.trim()).filter((item) => item !== '');
  return kept.length > 0 ? kept : undefined;
}

/** Mirrors child approval gates into the visible parent log and forwards each answer back. */
function bridgeChildGates(childLog: SessionLog, parentLog: SessionLog, signal: AbortSignal): () => void {
  const mirrored = new Set<string>();
  let scanned = 0;
  const scan = (): void => {
    const events = eventsOf(childLog);
    for (; scanned < events.length; scanned++) {
      const e = events[scanned];
      if (!e || e.kind !== 'gateAsked' || mirrored.has(e.gateId)) continue;
      mirrored.add(e.gateId);
      const childGateId = e.gateId;
      const parentGateId = askGate(parentLog, {
        scope: e.scope,
        summary: translate('agent.helper_gate', { helper: translate('agent.helper'), summary: e.summary }),
      });
      awaitGate(parentLog, parentGateId, signal)
        .then(({ answer, words }) => {
          try { answerGate(childLog, childGateId, answer, words); } catch { /* child settled another way (e.g. abort) already */ }
        })
        .catch(() => { /* the parent-side wait aborted; the child's own awaitGate rejects off the same signal */ });
    }
  };
  const unsubscribe = subscribe(childLog, scan);
  scan(); // covers the (normally impossible) case of a gate already asked before this subscribed
  return unsubscribe;
}

/** The rectangle one helper is given, a place a single drawing can hold: its cells and its longer side at most. */
const PLACE_CELLS_MAX = 1600;
const PLACE_SIDE_MAX = 56;
/** The longest side of a district, which a lead of its own plans and divides into places. */
const DISTRICT_SIDE_MAX = 72;

/** The helpers of one job: the gate that lets one edit reach the map at a time. */
interface Team { enter<T>(edit: () => Promise<T>): Promise<T> }

/** Helpers think at the same time and edit in turn: each tool call waits for the one before it to settle. */
function createTeam(): Team {
  let last: Promise<unknown> = Promise.resolve();
  return {
    enter(edit) {
      const mine = last.then(edit, edit);
      last = mine.catch(() => undefined);
      return mine;
    },
  };
}

/**
 * Runs one brief as a child job on a fresh log, on the parent's map and executor (so provenance and
 * approvals ride along) with its own tool set, turn budget and region. A brief for one place runs a
 * helper. A brief for a larger area, from the job the user started, runs a district lead: the lead's
 * prompt and tools, and helpers of its own for its places. `byDistrict` is true when the brief comes
 * from such a lead, which hands out places only.
 */
async function delegateTask(
  deps: AgentToolDeps, delegate: DelegateOpts, call: { callId: string; args: BriefArgs }, team: Team, byDistrict: boolean,
): Promise<ExecutedResult> {
  const { callId, args } = call;
  // A brief with a name and no goal takes the name as its goal; one without a name is named by the opening of its goal.
  const goal = (args.goal?.trim() || args.label?.trim()) ?? '';
  const label = args.label?.trim() || briefName(goal);
  if (!goal) return { content: argError(helperBriefBlank('goal')).content, isError: true };

  const state = deps.getState();
  const rect: HelperBounds = {
    x1: Math.min(args.x1, args.x2), y1: Math.min(args.y1, args.y2),
    x2: Math.max(args.x1, args.x2), y2: Math.max(args.y1, args.y2),
  };
  const wide = rect.x2 - rect.x1 + 1, tall = rect.y2 - rect.y1 + 1;
  const side = Math.max(wide, tall);
  const place = wide * tall <= PLACE_CELLS_MAX && side <= PLACE_SIDE_MAX;
  const district = !place && !byDistrict;
  if (!place && (byDistrict || side > DISTRICT_SIDE_MAX)) {
    const limits = { cells: PLACE_CELLS_MAX, side: PLACE_SIDE_MAX, ...(byDistrict ? {} : { district: DISTRICT_SIDE_MAX }) };
    return { content: argError(helperBoundsLarge(rect, limits)).content, isError: true };
  }
  const userRegion = deps.getRegion();
  const region = helperRegion(state, rect, userRegion);
  const bounds = regionBounds(region);
  if (!bounds) {
    const user = regionBounds(userRegion);
    return { content: argError(helperBoundsEmpty(rect, user ?? undefined)).content, isError: true };
  }

  // The child's edits stop at its own region. It is offered neither undo nor redo, so it can reverse
  // or replay neither the lead's work nor the user's.
  const helperDeps: AgentToolDeps = { ...deps, getRegion: () => region };

  const include = briefList(args.include), preserve = briefList(args.preserve), done = briefList(args.done);
  const interfaces = args.interfaces?.trim();
  const childLog = createLog();
  delegate.onChildLog?.(label, childLog);
  append(childLog, {
    kind: 'order',
    text: (district ? districtOrder : helperOrder)(TOOL_FACTS.guides, {
      label, bounds, cells: bounds.count, goal,
      ...(include ? { include } : {}),
      ...(preserve ? { preserve } : {}),
      ...(interfaces ? { interfaces } : {}),
      ...(args.skills && args.skills.length > 0 ? { skills: args.skills } : {}),
      ...(done ? { done } : {}),
    }),
    mapContext: buildMapContext(state, region, helperDeps),
  });

  // A district lead briefs helpers of its own, whose gates and progress reach the user through its
  // log; a helper briefs no one. Every edit below the user's job takes its turn at the one map.
  const inner = district
    ? createExecutor(helperDeps, {
      district: true, team,
      delegate: {
        adapter: delegate.adapter, model: delegate.model, capabilities: delegate.capabilities, thinking: delegate.thinking,
        system: delegate.system, get oversight() { return delegate.oversight; }, signal: delegate.signal, log: childLog,
        // A district's helpers show on the district's own row, named as its place; when one settles the row reads the district lead again.
        onChildProgress: (_place, p) => (p ? delegate.onChildProgress?.(callId, { ...p, label: `${label} / ${p.label ?? ''}` }) : report()),
        ...(delegate.onChildLog ? { onChildLog: (place: string, log: SessionLog) => delegate.onChildLog!(`${label} / ${place}`, log) } : {}),
      },
    })
    : createExecutor(helperDeps, { subagent: true });
  const helperExecutor: ToolExecutor = {
    ...inner,
    // A hand-over runs for as long as its helpers do, so it does not hold the map while they work.
    execute: (call) => (call.name === PROTOCOL.delegate ? inner.execute(call) : team.enter(
      // A call that was waiting its turn when the job was stopped does not run.
      async () => (delegate.signal.aborted ? loopNoteResult(stoppedBeforeRun()) : inner.execute(call)),
    )),
  };
  const childLoopDeps: LoopDeps = {
    adapter: delegate.adapter,
    model: delegate.model,
    capabilities: delegate.capabilities, thinking: delegate.thinking,
    system: district ? districtSystemPrompt(delegate.system) : helperSystemPrompt(delegate.system),
    tools: wireSchemas(district ? { district: true } : { subagent: true }),
    executor: helperExecutor,
    // Read per gate decision, like the parent's own: `DelegateOpts.oversight` is the parent's live
    // tier, and a child mid-task must answer to a change the user has just made.
    get oversight() { return delegate.oversight; },
    sameModel: true,
    contextWindow: delegate.capabilities?.context,
    maxTurns: district ? MAX_TURNS_DEFAULT : SUBAGENT_MAX_TURNS,
    signal: delegate.signal,
    undoStackSize: () => deps.getExecutor().historyDepth(),
  };

  const before = regionCensus(state, region);
  const unbridge = bridgeChildGates(childLog, delegate.log, delegate.signal);
  // Live view for the panel's helper lane: recomputed off the child's own ops on every append to
  // its log, so a standing subscriber sees the count rise and the newest op's name change as the
  // child works, without waiting for the call to return.
  function report(): void {
    let ops = 0;
    let opName: string | undefined;
    for (const e of eventsOf(childLog)) if (e.kind === 'toolResult') { ops++; opName = e.name; }
    delegate.onChildProgress?.(callId, { task: goal, opName, ops, label });
  }
  const unprogress = subscribe(childLog, report);
  report();
  try {
    const outcome = await runJob(childLog, childLoopDeps);
    const { detail, writes } = childDetail(childLog);
    const status = helperStatus(outcome, writes.refused);
    const after = regionCensus(state, region);
    const fault = status === 'failed' && outcome !== 'aborted' ? childFault(childLog) : undefined;
    const content = helperResult({
      label, status, bounds, ...writes,
      objects: after.objects - before.objects,
      terrain: after.terrain - before.terrain,
      report: childFinalText(childLog),
      ...(fault ? { fault: { cls: fault.cls, detail: fault.detail } } : {}),
    });
    // A helper that ran out of turns or stopped on a fault left its region unfinished.
    return { content, isError: status === 'capped' || status === 'failed', ...(detail ? { detail } : {}) };
  } finally {
    unprogress();
    delegate.onChildProgress?.(callId, null);
    unbridge();
  }
}

export function createExecutor(
  deps: AgentToolDeps, opts?: { subagent?: boolean; district?: boolean; delegate?: DelegateOpts; team?: Team },
): ToolExecutor {
  const allowed = new Set(wireSchemas(opts).map((s) => s.name));
  // Delegation runs only where a delegate context was supplied.
  if (!opts?.delegate) allowed.delete(PROTOCOL.delegate);
  // One team for the whole job: a district lead's helpers take their turns with everyone else's.
  const team = opts?.team ?? createTeam();
  return {
    async execute(call): Promise<ExecutedResult> {
      if (!allowed.has(call.name)) {
        return { content: unknownTool(call.name), isError: true };
      }
      if (call.name === PROTOCOL.delegate && opts?.delegate) {
        const args = checkToolArgs(call.name, call.args);
        if ('refusal' in args) return { content: args.refusal.content, isError: true };
        return delegateTask(deps, opts.delegate, { callId: call.callId, args: args.input as BriefArgs }, team, opts.district === true);
      }
      const result = await executeToolCall({ id: call.callId, name: call.name, input: call.args }, deps);
      // The loop carries the image as a bare data URL; the tool layer wraps it in `{ dataUrl }`.
      const executed: ExecutedResult = { content: result.content, isError: result.isError };
      if (result.image) executed.image = result.image.dataUrl;
      if (result.detail) executed.detail = result.detail;
      return executed;
    },
    facts: toolFacts(deps),
    describe(call) {
      // The gate summary stands in front of a human, so it reads in whatever locale they are
      // using right now (imperative `translate`, not a locale pinned at executor construction).
      return describeToolCall({ name: call.name, input: call.args }, translate, {
        catalog: (id) => deps.catalogName?.(id),
        object: (id) => {
          const object = deps.getState().objects.get(id);
          return object ? deps.catalogName?.(object.catalogId) : undefined;
        },
        action: (id) => deps.listAppActions?.().find((action) => action.id === id),
      });
    },
  };
}

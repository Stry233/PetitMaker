/**
 * The executor: the carried legacy tool layer (tools/tools.ts) behind the v3 loop's ONE
 * interface, `ToolExecutor` (core/loop.ts). It adapts the legacy per-call `executeToolCall`
 * (returns a `ToolResult`, keyed by `toolCallId`) onto the loop's `ExecutedResult`, and the
 * legacy JSON-schema `ToolSchema[]` onto the loop's flat `{name, description, parameters}`
 * wire shape.
 *
 * `delegate_task` runs a CHILD job (depth 1: the child's own executor is built with no
 * `delegate` opt, so `wireSchemas({subagent:true})`'s exclusion of `delegate_task` from its
 * schema means a scripted child that calls it anyway falls straight to the `allowed` check
 * above and gets the ordinary unknown-tool error). With no `opts.delegate` supplied (no
 * adapter to run a child turn on) it reports itself unwired rather than falling through to the
 * legacy handler's different wording.
 */
import type { ToolExecutor, ExecutedResult, LoopDeps } from '../core/loop';
import { runJob } from '../core/loop';
import { append, createLog, eventsOf, subscribe, type SessionLog } from '../core/log';
import { answerGate, askGate, awaitGate, type Oversight } from '../core/gates';
import { SUBAGENT_MAX_TURNS } from '../core/governor';
import type { ErrorClass, SessionEvent, TextPart, ToolResultDetail } from '../core/types';
import type { Adapter } from '../providers/types';
import {
  TOOL_SCHEMAS, SUBAGENT_TOOL_SCHEMAS, WRITE_TOOLS, buildMapContext, executeToolCall, type AgentToolDeps,
} from '../tools/tools';
import { describeToolArgs } from '../describe-call';
import { translate } from '../../i18n/context';

/** The per-job pieces `delegate_task` needs that a bare `AgentToolDeps` cannot carry: the
 *  adapter/model/system to actually run a child TURN on, and the parent's own oversight/signal/
 *  log so the child answers to the SAME restrictions and can be cancelled and gated through the
 *  ONE surface a human watches. `oversight`/`signal`/`log` ride the parent's live `LoopDeps` /
 *  session, which is why they live here rather than on `AgentToolDeps` (a pure map/executor
 *  handle with no notion of a running job) — the runner wires this at job-launch time, where all
 *  five are already in scope together. */
export interface DelegateOpts {
  adapter: Adapter;
  model: string;
  system: string;
  oversight: Oversight;
  signal: AbortSignal;
  log: SessionLog;
  /** Live child progress for the panel's helper lane: latest op name + running count; null when
   *  the delegate call ends, however it ends. `label` rides through unchanged from the call's own
   *  args — `task` still carries the model's complete instructions in full, since the lane (not
   *  this layer) is what decides which of the two to show as the helper's name. */
  onChildProgress?: (p: { task: string; opName?: string; ops: number; label?: string } | null) => void;
}

/** A subagent delegate gets the same default per-job budget the runner gives an ordinary job
 *  (`exec/runner.ts`'s `DEFAULT_BUDGET_TOKENS`); kept as its own constant since importing the
 *  runner here would run the wrong way (`exec/executor.ts` sits below `exec/runner.ts`). */
const DELEGATE_BUDGET_TOKENS = 128_000;

type AssistantEvent = Extract<SessionEvent, { kind: 'assistant' }>;

/** The child's own summary, or a plain fallback when the job ended (capped/aborted/incident)
 *  before ever producing one: only the LAST assistant turn is asked, since an earlier turn's
 *  text was superseded by whatever came after it. */
function childFinalText(childLog: SessionLog): string {
  const assistants = eventsOf(childLog).filter((e): e is AssistantEvent => e.kind === 'assistant');
  const last = assistants[assistants.length - 1];
  const text = last?.parts
    .filter((p): p is TextPart => p.kind === 'text')
    .map((p) => p.text)
    .join('')
    .trim() ?? '';
  return text.length > 0 ? text : '(the helper task finished with no summary)';
}

/** THE CHILD LOG'S WHOLE LEGACY, read once at return: the child's edit counts summed (the same
 *  fields every write tool's result carries, so a delegate's report reads like one
 *  of the parent's own ops rather than an opaque paragraph), its ops listed in order, and the class
 *  of the incident that ended it. The child log itself is garbage-collected with this call — it is
 *  never persisted, never projected and never shown — so anything not lifted here is gone, which
 *  is why the op list is kept even for a run that FAILED: those edits are on the map.
 *
 *  `undefined` only when the child never ran an op at all and ended cleanly (an immediately-aborted
 *  delegate), matching how an ordinary tool omits `detail` rather than carrying an empty one. */
function childDetail(childLog: SessionLog): ToolResultDetail | undefined {
  let cells = 0;
  let objects = 0;
  let reverted = false;
  const childOps: NonNullable<ToolResultDetail['childOps']> = [];
  let childError: ErrorClass | undefined;
  for (const e of eventsOf(childLog)) {
    if (e.kind === 'incident') { childError = e.error.cls; continue; }
    if (e.kind !== 'toolResult') continue;
    cells += e.detail?.cells ?? 0;
    objects += e.detail?.objects ?? 0;
    if (e.detail?.reverted) reverted = true;
    childOps.push({
      name: e.name,
      status: e.detail?.reverted ? 'revert' : e.isError ? 'error' : 'ok',
      ...(e.detail?.skill ? { skill: e.detail.skill } : {}),
    });
  }
  const detail: ToolResultDetail = {};
  if (cells > 0) detail.cells = cells;
  if (objects > 0) detail.objects = objects;
  if (reverted) detail.reverted = true;
  if (childOps.length > 0) detail.childOps = childOps;
  if (childError) detail.childError = childError;
  return Object.keys(detail).length > 0 ? detail : undefined;
}

/** What the parent model is told when a child job ended in an incident, in the child's own terms:
 *  the error CLASS it ended on (so an 'auth' failure is not laundered into a generic "something went
 *  wrong" the model answers by delegating the same task again) plus the first line of its detail,
 *  already redacted by its producer per the `TurnError` contract. Later lines are a provider's own
 *  advice to whoever holds the key and say nothing the model can act on. A `TurnError` detail may or
 *  may not end in a period, so the trailing one is stripped before this sentence supplies its own. */
function childIncidentMessage(childLog: SessionLog): string {
  const tail = 'Delegate a fresh task or ask the user.';
  for (const e of [...eventsOf(childLog)].reverse()) {
    if (e.kind !== 'incident') continue;
    const first = (e.error.detail.split('\n')[0] ?? '').trim().replace(/\.+$/, '');
    const said = first.length > 0 ? `(${e.error.cls}): ${first}. ` : `(${e.error.cls}). `;
    return `(system) The helper run failed ${said}${tail}`;
  }
  return `(system) The helper run failed before it finished. ${tail}`;
}

/** THE ONE TRICKY PIECE. The child's own loop gates on ITS OWN log exactly like any job
 *  (`loop.ts`'s ordinary `askGate`/`awaitGate` over `childLog`) — it has no idea a parent exists.
 *  A human only ever watches the PARENT log, so every `gateAsked` the child appends is mirrored
 *  onto the parent log (prefixed so it reads as the helper's own ask, not the parent's), and once
 *  the mirrored gate is answered THERE, that same answer is forwarded onto the child's original
 *  gate id, which is exactly what unblocks the child loop's own `awaitGate` wait. Scoped to this
 *  one `execute()` call and torn down in its `finally` — no module state, no leak past the job. */
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
        summary: `${translate('agent2.helper')}: ${e.summary}`,
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

/** Runs `task` as a depth-1 child job on a fresh log, under the SAME map/executor (region lock
 *  and provenance ride along by construction — `deps` is the parent's own, never cloned) but the
 *  child's OWN tool set and turn budget. */
async function delegateTask(
  deps: AgentToolDeps, delegate: DelegateOpts, args: Record<string, unknown>,
): Promise<ExecutedResult> {
  const task = typeof args.task === 'string' ? args.task.trim() : '';
  if (!task) return { content: 'delegate_task needs a non-empty "task" string.', isError: true };
  // OPTIONAL, and carried verbatim: the schema's short display name for the lane, never sent to the
  // child (the child's own order is `task` alone, unabridged).
  const label = typeof args.label === 'string' && args.label.trim() !== '' ? args.label.trim() : undefined;

  const childLog = createLog();
  const mapContext = buildMapContext(deps.getState(), deps.getRegion(), deps);
  append(childLog, { kind: 'order', text: task, mapContext });

  const childLoopDeps: LoopDeps = {
    adapter: delegate.adapter,
    model: delegate.model,
    system: delegate.system,
    tools: wireSchemas({ subagent: true }),
    executor: createExecutor(deps, { subagent: true }), // no `delegate`: depth capped at 1
    // Read per gate decision, like the parent's own: `DelegateOpts.oversight` is the parent's live
    // tier, and a child mid-task must answer to a change the user has just made.
    get oversight() { return delegate.oversight; },
    sameModel: true,
    budgetTokens: DELEGATE_BUDGET_TOKENS,
    maxTurns: SUBAGENT_MAX_TURNS,
    signal: delegate.signal,
    undoStackSize: () => deps.getExecutor().getUndoStackSize(),
  };

  const unbridge = bridgeChildGates(childLog, delegate.log, delegate.signal);
  // Live view for the panel's helper lane: recomputed off the child's own ops on every append to
  // its log, so a standing subscriber sees the count rise and the newest op's name change as the
  // child works, without waiting for the call to return.
  const report = (): void => {
    let ops = 0;
    let opName: string | undefined;
    for (const e of eventsOf(childLog)) if (e.kind === 'toolResult') { ops++; opName = e.name; }
    delegate.onChildProgress?.({ task, opName, ops, ...(label ? { label } : {}) });
  };
  const unprogress = subscribe(childLog, report);
  report();
  try {
    const outcome = await runJob(childLog, childLoopDeps);
    const detail = childDetail(childLog);
    if (outcome === 'done' || outcome === 'capped') {
      return { content: childFinalText(childLog), isError: false, ...(detail ? { detail } : {}) };
    }
    // 'aborted' | 'incident' | (the never-reached 'paused', since nothing ever asks this log to pause)
    const content = outcome === 'aborted'
      ? '(system) The delegated task was aborted before it finished.'
      : childIncidentMessage(childLog);
    return { content, isError: true, ...(detail ? { detail } : {}) };
  } finally {
    unprogress();
    delegate.onChildProgress?.(null);
    unbridge();
  }
}

/** Tools whose blast radius can reach far beyond what the model named in its own args (a
 *  generator run, a region clear, a whole road network) — gated as "wide" regardless of the
 *  oversight tier's ordinary write gate.
 *
 *  `delegate_task` is the widest of them: the helper it spawns runs its own writes ungated in a
 *  fresh context, so this one approval covers that whole burst and is the only place a user in
 *  checkpoint oversight can decline it. */
export const WIDE_TOOLS: ReadonlySet<string> = new Set([
  'run_generator', 'clear_area', 'build_road_network', 'delegate_task',
]);

/** The wire-format schema list for the model: every carried tool, or (for a subagent, which
 *  never owns the parent's plan/export/reply surfaces or a further delegation) the same
 *  SUBAGENT exclusion the legacy schema list already carries. */
export function wireSchemas(opts?: { subagent?: boolean }): { name: string; description: string; parameters: Record<string, unknown> }[] {
  const schemas = opts?.subagent ? SUBAGENT_TOOL_SCHEMAS : TOOL_SCHEMAS;
  return schemas.map((s) => ({ name: s.name, description: s.description, parameters: s.inputSchema }));
}

export function createExecutor(
  deps: AgentToolDeps, opts?: { subagent?: boolean; delegate?: DelegateOpts },
): ToolExecutor {
  const allowed = new Set(wireSchemas(opts).map((s) => s.name));
  return {
    async execute(call): Promise<ExecutedResult> {
      if (!allowed.has(call.name)) {
        return { content: `Unknown tool "${call.name}".`, isError: true };
      }
      if (call.name === 'delegate_task') {
        return opts?.delegate
          ? delegateTask(deps, opts.delegate, call.args)
          : { content: 'Delegation is not wired yet.', isError: true };
      }
      const result = await executeToolCall({ id: call.callId, name: call.name, input: call.args }, deps);
      const executed: ExecutedResult = { content: result.content, isError: result.isError };
      if (result.image) executed.image = result.image.dataUrl;
      if (result.detail) executed.detail = result.detail;
      return executed;
    },
    isWrite: (name) => WRITE_TOOLS.has(name),
    isWide: (name) => WIDE_TOOLS.has(name),
    describe(call) {
      // The gate summary stands in front of a human, so it reads in whatever locale they are
      // using right now (imperative `translate`, not a locale pinned at executor construction).
      const args = describeToolArgs({ name: call.name, input: call.args }, translate);
      return args ? `${call.name}: ${args}` : call.name;
    },
  };
}
